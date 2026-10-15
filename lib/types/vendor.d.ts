import type { Context } from '@deepseek-ai/cordis';
/**
 * vendored skill 注册器：把插件包内 skills/ 目录下的 OpenHarmony XTS
 * 上报 skill 注册进 DSH 的 ctx.skills 注册表（source: 'bundled'）。
 * 与 openharmony-debug-test-pipeline 插件的注册机制一致；多模块预留：
 * 新增 skill 时往 skills/ 加目录、往 VENDORED_SKILLS 加名字即可。
 */
/** 随插件 vendored 的模块 skill 清单（保持与仓库 skills/ 目录一致） */
export declare const VENDORED_SKILLS: readonly ["openharmony-waiver-draft"];
export interface ParsedSkill {
    name: string;
    description: string;
    whenToUse?: string;
    content: string;
}
/** 解析 SKILL.md：提取 YAML frontmatter（name/description/whenToUse），正文去掉 frontmatter 块。 */
export declare function parseSkillFrontmatter(raw: string): ParsedSkill | undefined;
/** 替换 skill 正文中的 {{SKILLS_DIR}} 占位符并追加资源尾注。 */
export declare function buildSkillContent(raw: string, skillsDir: string): string;
/** 插件包根目录（lib/vendor.js → 包根） */
export declare function packageRoot(): string;
/** 注册全部 vendored skill；缺失或 frontmatter 非法时记警告并跳过，不阻断加载。 */
export declare function registerVendoredSkills(ctx: Context, root?: string): void;
