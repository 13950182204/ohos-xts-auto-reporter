# browser_upload 工具与 provider 补丁说明

`browser_upload` 工具依赖 `@yeesy369/dsh-browser-playwright` 的一个小补丁
（Playwright `setInputFiles` 透传），因为原版只暴露 navigate/click/type 等，
没有文件上传能力（原生文件对话框无法由模型自动操作）。

## 补丁内容

给两个类各加一个 `setInputFiles(selector, paths)` 方法（直接调 Playwright
`page.setInputFiles`）：

- `PlaywrightBrowserPage.setInputFiles`（页面封装）
- provider 的 `BrowserRuntime` 子类 `setInputFiles`（服务入口，页面未就绪时先建页）

## 应用方式（pnpm patch，可复现）

```bash
cd ~/.dsh/profiles/web
pnpm patch @yeesy369/dsh-browser-playwright@0.6.1
# 编辑 <tmp>/lib/index.js：在 PlaywrightBrowserPage 与 provider 类中按上文添加方法
pnpm patch-commit '<tmp>'
```

pnpm 会把补丁记录到 profile 的 `pnpm-workspace.yaml`（patchedDependencies）
并生成 `patches/@yeesy369__dsh-browser-playwright.patch`；后续 `pnpm install`
自动重放。**升级该包版本后需重新应用补丁**（diff 很小，见 patch 文件）。

## 验证

```bash
grep -n setInputFiles ~/.dsh/profiles/web/node_modules/@yeesy369/dsh-browser-playwright/lib/index.js
# 应看到两处方法定义（服务入口 + 页面封装）
```

## 工具使用

```text
browser_upload paths=["/mnt/d/.../A333.png"] selector="input[type=file]"
```

selector 缺省为 `input[type=file]`；若页面有多个文件输入，按顺序或
`:nth-of-type` 等选择器指定。
