import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * 平台第 4 步只收一个 zip 报告包，而测试产物常常是解压后的 report/ 目录。
 * 这里用 Node 自带的 zlib 直接写 ZIP（deflate），不引入第三方依赖。
 * 目录项以 `/` 结尾、保留相对路径，和平台侧 zip 的既有结构保持一致。
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, date: day };
}

function localHeader(entry) {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(entry.compression === 'deflate' ? 20 : 10, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(entry.compression === 'deflate' ? 8 : 0, 8);
  header.writeUInt16LE(entry.time, 10);
  header.writeUInt16LE(entry.date, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressedLength, 18);
  header.writeUInt32LE(entry.uncompressedLength, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function centralHeader(entry) {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x031e, 4);
  header.writeUInt16LE(entry.compression === 'deflate' ? 20 : 10, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(entry.compression === 'deflate' ? 8 : 0, 10);
  header.writeUInt16LE(entry.time, 12);
  header.writeUInt16LE(entry.date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedLength, 20);
  header.writeUInt32LE(entry.uncompressedLength, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(entry.directory ? 0x10 : 0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, name]);
}

const IGNORED_NAMES = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);

/** 报告目录里常混着占位文件与 Office 锁文件，打包时一并跳过。 */
export function isIgnoredEntry(name) {
  const lower = String(name || '').toLowerCase();
  return lower.startsWith('.') || lower.startsWith('~$') || IGNORED_NAMES.has(lower);
}

async function walk(root, current = '', ignore = new Set()) {
  const absolute = current ? path.join(root, current) : root;
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const listed = [];
  for (const entry of entries) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    if (isIgnoredEntry(entry.name)) continue;
    if (ignore.has(path.resolve(path.join(root, relative)))) continue;
    if (entry.isDirectory()) {
      listed.push({ name: `${relative}/`, directory: true, source: path.join(root, relative) });
      listed.push(...(await walk(root, relative, ignore)));
    } else if (entry.isFile()) {
      listed.push({ name: relative, directory: false, source: path.join(root, relative) });
    }
  }
  return listed;
}

export async function newestMtimeMs(directory, { ignore = new Set() } = {}) {
  let newest = 0;
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (ignore.has(path.resolve(full))) continue;
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat && stat.mtimeMs > newest) newest = stat.mtimeMs;
      }
    }
  }
  return newest;
}

/**
 * 把 sourceDirectory 打成 zipPath（相对路径以 sourceDirectory 为根）。
 * 先写临时文件再原子改名，避免中途失败留下半个包。
 */
export async function packDirectoryToZip(sourceDirectory, zipPath) {
  const listed = await walk(sourceDirectory, '', new Set([path.resolve(zipPath)]));
  const temporary = `${zipPath}.tmp-${process.pid}`;
  const handle = await fs.open(temporary, 'w');
  const central = [];
  let offset = 0;
  let fileCount = 0;
  try {
    for (const entry of listed) {
      const stat = await fs.stat(entry.source).catch(() => null);
      if (!stat) continue;
      const isDirectory = entry.directory;
      const raw = isDirectory ? Buffer.alloc(0) : await fs.readFile(entry.source);
      const payload = isDirectory ? Buffer.alloc(0) : zlib.deflateRawSync(raw, { level: 6 });
      const stamp = dosDateTime(stat.mtime);
      const record = {
        name: entry.name,
        directory: isDirectory,
        compression: isDirectory ? 'store' : 'deflate',
        crc: isDirectory ? 0 : crc32(raw),
        compressedLength: payload.length,
        uncompressedLength: raw.length,
        time: stamp.time,
        date: stamp.date,
        offset,
      };
      const header = localHeader(record);
      await handle.write(header);
      if (payload.length) await handle.write(payload);
      offset += header.length + payload.length;
      central.push(record);
      if (!isDirectory) fileCount += 1;
    }
    const directoryBuffer = Buffer.concat(central.map((entry) => centralHeader(entry)));
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(directoryBuffer.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    await handle.write(directoryBuffer);
    await handle.write(end);
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, zipPath);
  const stat = await fs.stat(zipPath);
  return { zipPath, fileCount, bytes: stat.size };
}
