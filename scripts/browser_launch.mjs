import process from 'node:process';

/**
 * 启动 Chromium。插件在桌面端运行时不保证本机已 `playwright install`，
 * 因此优先用 Playwright 自带 Chromium，失败后退回系统 Edge/Chrome（channel）。
 * 可用 `OH_BROWSER_CHANNEL=msedge|chrome` 强制指定。
 */
export async function launchChromium(playwright, { headless = true } = {}) {
  const preferred = process.env.OH_BROWSER_CHANNEL;
  const channels = preferred
    ? [preferred]
    : (process.platform === 'win32' ? ['msedge', 'chrome'] : ['chrome']);

  let primaryError;
  try {
    return await playwright.chromium.launch({ headless });
  } catch (error) {
    primaryError = error;
  }
  for (const channel of channels) {
    try {
      return await playwright.chromium.launch({ headless, channel });
    } catch {
      // 换下一个通道继续尝试
    }
  }
  const reason = primaryError?.message ?? String(primaryError);
  throw new Error(
    `无法启动浏览器（请先执行 npx playwright install chromium，或安装 Edge/Chrome）：${reason}`,
  );
}
