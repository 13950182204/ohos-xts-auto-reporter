import type { Context } from '@deepseek-ai/cordis';
/**
 * browser_upload 工具：向当前浏览器页面的文件输入框写入本地文件。
 *
 * 依赖：@yeesy369/dsh-browser-playwright 的 DSH 定制补丁（setInputFiles），
 * 补丁记录见 docs/browser-upload-patch.md（pnpm patch 方式，可复现）。
 * 用法：selector 通常传 'input[type=file]'；多文件用逗号分隔路径。
 */
export declare function registerBrowserUploadTool(ctx: Context): void;
