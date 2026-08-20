import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** ctx.browser 的 setInputFiles 结构（由 @yeesy369/dsh-browser-playwright 的 DSH 定制补丁提供，类型面未包含） */
interface UploadCapableBrowser {
  setInputFiles(selector: string, paths: string[], signal?: AbortSignal): Promise<{ ok: boolean; url?: string | null }>
}

/**
 * browser_upload 工具：向当前浏览器页面的文件输入框写入本地文件。
 *
 * 依赖：@yeesy369/dsh-browser-playwright 的 DSH 定制补丁（setInputFiles），
 * 补丁记录见 docs/browser-upload-patch.md（pnpm patch 方式，可复现）。
 * 用法：selector 通常传 'input[type=file]'；多文件用逗号分隔路径。
 */
export function registerBrowserUploadTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'browser_upload',
    description:
      '向当前浏览器页面中的文件输入框（input[type=file]）写入本地文件，替代无法自动操作的原生文件对话框。'
      + '参数 selector 为文件输入框的 CSS 选择器（缺省 input[type=file]），paths 为一个或多个本地文件绝对路径。'
      + '写入后文件输入即携带所选文件（触发 change 事件由页面框架处理）。',
    parameters: {
      selector: { type: 'string', description: '文件输入框 CSS 选择器，缺省 input[type=file]' },
      paths: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: '本地文件绝对路径（一个或多个）',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const text = typeof value === 'object' && value !== null && 'detail' in value ? String(value.detail) : String(value)
        return [{ type: 'text', text }]
      },
    },
    async execute(rawArgs: unknown, exec) {
      const args = rawArgs as { selector?: string; paths?: string[] }
      const paths = args.paths ?? []
      if (paths.length === 0) throw new Error('paths 不能为空')
      const browser = ctx.browser as unknown as UploadCapableBrowser | undefined
      if (!browser || typeof browser.setInputFiles !== 'function') {
        throw new Error('ctx.browser 缺少 setInputFiles（需要 @yeesy369/dsh-browser-playwright 的 DSH 定制补丁，见 docs/browser-upload-patch.md）')
      }
      const selector = args.selector || 'input[type=file]'
      const result = await browser.setInputFiles(selector, paths, exec.signal)
      return { ok: result.ok, detail: `已写入 ${paths.length} 个文件到 ${selector}` }
    },
  }))
  ctx.logger.info('ohos-xts-auto-reporter: 已注册 browser_upload 工具')
}
