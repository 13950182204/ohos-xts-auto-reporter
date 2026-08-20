import z from 'schemastery'

/**
 * 插件配置。默认值即可开箱即用；可在 profile 的 cordis.patch.yml
 * 覆盖该行的 config，或在 web GUI 的 Settings → 插件配置 中调整。
 */
export interface Config {
  /** 预留：未来模块（如报告生成）的开关列表 */
  enabledSkills?: string[]
}

export const Config: z<Config> = z.object({
  enabledSkills: z.array(z.string()),
})
