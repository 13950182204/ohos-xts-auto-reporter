import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { VENDORED_SKILLS, buildSkillContent, parseSkillFrontmatter, registerVendoredSkills } from '../src/vendor.ts'

describe('parseSkillFrontmatter', () => {
  it('解析合法 frontmatter 并剥离正文', () => {
    const raw = [
      '---',
      'name: openharmony-waiver-draft',
      'description: 豁免草稿自动填写',
      'whenToUse: 处理豁免目录时',
      '---',
      '# 标题',
      '正文',
      '',
    ].join('\n')
    const parsed = parseSkillFrontmatter(raw)
    expect(parsed).toBeDefined()
    expect(parsed!.name).toBe('openharmony-waiver-draft')
    expect(parsed!.content).toContain('# 标题')
    expect(parsed!.content).not.toContain('---')
  })

  it('缺少 frontmatter 或必需字段返回 undefined', () => {
    expect(parseSkillFrontmatter('# no frontmatter')).toBeUndefined()
    expect(parseSkillFrontmatter('---\nname: x\n---\nbody')).toBeUndefined()
  })
})

describe('buildSkillContent', () => {
  it('替换 {{SKILLS_DIR}} 并追加资源尾注', () => {
    const out = buildSkillContent(
      'python3 {{SKILLS_DIR}}/openharmony-waiver-draft/scripts/process_directory.py --report-dir X\n',
      '/opt/pkg/skills',
    )
    expect(out).toContain('/opt/pkg/skills/openharmony-waiver-draft/scripts/process_directory.py')
    expect(out).toContain('## 技能资源')
    expect(out).not.toContain('{{SKILLS_DIR}}')
  })
})

describe('registerVendoredSkills', () => {
  const registrations: any[] = []
  const ctx = {
    skills: { register: (reg: any) => registrations.push(reg) },
    logger: { warn: vi.fn(), info: vi.fn() },
  } as any

  it('注册仓库内 vendored skill，占位符已解析', () => {
    // 用真实仓库根（src/vendor.ts → 仓库根）
    const root = join(__dirname, '..')
    registerVendoredSkills(ctx, root)
    expect(registrations).toHaveLength(VENDORED_SKILLS.length)
    for (const reg of registrations) {
      expect(reg.source).toBe('bundled')
      expect(reg.content).not.toContain('{{SKILLS_DIR}}')
      expect(reg.content).toContain('## 技能资源')
      expect(reg.resourceBase.kind).toBe('directory')
    }
    const waiver = registrations.find((r) => r.name === 'openharmony-waiver-draft')
    expect(waiver.content).toContain('硬边界')
    expect(waiver.content).toContain('process_directory.py')
  })

  it('缺失的 skill 记警告并跳过，不阻断其余注册', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reporter-vendor-'))
    try {
      mkdirSync(join(dir, 'skills'), { recursive: true })
      registerVendoredSkills(ctx, dir)
      expect(ctx.logger.warn).toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
