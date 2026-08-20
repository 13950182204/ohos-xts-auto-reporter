import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

/**
 * vendored skill 注册器：把插件包内 skills/ 目录下的 OpenHarmony XTS
 * 上报 skill 注册进 DSH 的 ctx.skills 注册表（source: 'bundled'）。
 * 与 openharmony-debug-test-pipeline 插件的注册机制一致；多模块预留：
 * 新增 skill 时往 skills/ 加目录、往 VENDORED_SKILLS 加名字即可。
 */

/** 随插件 vendored 的模块 skill 清单（保持与仓库 skills/ 目录一致） */
export const VENDORED_SKILLS = ['openharmony-waiver-draft'] as const

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export interface ParsedSkill {
  name: string
  description: string
  whenToUse?: string
  content: string
}

/** 解析 SKILL.md：提取 YAML frontmatter（name/description/whenToUse），正文去掉 frontmatter 块。 */
export function parseSkillFrontmatter(raw: string): ParsedSkill | undefined {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) return undefined
  let meta: Record<string, unknown>
  try {
    const parsed = loadYaml(match[1])
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    meta = parsed as Record<string, unknown>
  } catch {
    return undefined
  }
  const { name, description, whenToUse } = meta
  if (typeof name !== 'string' || !name || typeof description !== 'string' || !description) {
    return undefined
  }
  const content = raw.slice(match[0].length).trim() + '\n'
  return {
    name,
    description,
    whenToUse: typeof whenToUse === 'string' && whenToUse ? whenToUse : undefined,
    content,
  }
}

/** 替换 skill 正文中的 {{SKILLS_DIR}} 占位符并追加资源尾注。 */
export function buildSkillContent(raw: string, skillsDir: string): string {
  const content = raw.replaceAll('{{SKILLS_DIR}}', skillsDir)
  return (
    content +
    `\n\n## 技能资源\n\n` +
    `- 技能目录: ${skillsDir}\n` +
    `- 脚本等资源位于技能目录下的 scripts/ 子目录。\n`
  )
}

/** 插件包根目录（lib/vendor.js → 包根） */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

/** 注册全部 vendored skill；缺失或 frontmatter 非法时记警告并跳过，不阻断加载。 */
export function registerVendoredSkills(ctx: Context, root: string = packageRoot()): void {
  const skillsDir = join(root, 'skills')
  for (const name of VENDORED_SKILLS) {
    const skillDir = join(skillsDir, name)
    const skillFile = join(skillDir, 'SKILL.md')
    if (!existsSync(skillFile)) {
      ctx.logger.warn(`ohos-xts-auto-reporter: vendored skill 缺失，跳过: ${skillFile}`)
      continue
    }
    const parsed = parseSkillFrontmatter(readFileSync(skillFile, 'utf8'))
    if (!parsed) {
      ctx.logger.warn(`ohos-xts-auto-reporter: SKILL.md frontmatter 非法，跳过: ${skillFile}`)
      continue
    }
    const registration: SkillRegistration = {
      name: parsed.name,
      description: parsed.description,
      whenToUse: parsed.whenToUse,
      content: buildSkillContent(parsed.content, skillsDir),
      path: skillFile,
      source: 'bundled',
      resourceBase: { kind: 'directory', path: skillDir },
    }
    ctx.skills.register(registration)
    ctx.logger.info(`ohos-xts-auto-reporter: 已注册 skill ${parsed.name}`)
  }
}
