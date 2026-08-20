# ohos-xts-auto-reporter

OpenHarmony XTS 兼容性测试自动上报 DSH 插件（运行时插件，bundle 聚合包形态，多模块预留）。

当前模块：**豁免草稿自动填写**（vendored 自 `~/.codex/skills/openharmony-waiver-draft`，已针对 DSH 改写）。

## 能力：豁免草稿自动填写

用 **browser_* 浏览器工具**（`@yeesy369/dsh-browser-playwright` 提供，操作真实浏览器窗口）逐页完成 OpenHarmony 兼容性平台的豁免表单填写：登录 → OAuth 授权 → 按测评编号查重 → 填表 → **只保存草稿**。

### 硬边界（skill 强制）

- **绝不提交**：不点击 `申请豁免`/`提交`/`确认提交`，只点精确的 `保存`/`暂存`
- 查重命中 **status 0（待提交）** 记录 → 报告 ID、不重复创建
- 验证码/SMS/MFA/反自动化：**不绕过**，停下人工处理
- 门禁：缺 `assessmentNumber` 或 `OH_USERNAME`/`OH_PASSWORD` → 立即停止（固定中文消息）

### 使用方式

```text
对 agent 说：处理豁免，测评编号 OHC-2026-xxx，报告在 /mnt/d/ohos/XTS6.1/1AADB/A333/exemption
```

前置（人工）：
```bash
export OH_USERNAME='...'          # 仅本流程使用
export OH_PASSWORD='...'          # 新轮换密码
```
浏览器窗口弹出后，OpenAtom 登录/OAuth/验证码在窗口内人工处理一次，登录态持久（profile 目录）。

单条模式：准备输入 JSON（assessmentNumber/systemType/osVersion/testCategory/moduleName/testsuite/testcases/waiverReason/attachmentPath）后直接说「保存豁免草稿」。

目录批处理（每 `.txt` 一条记录，无浏览器依赖的纯解析）：

```bash
python3 skills/openharmony-waiver-draft/scripts/process_directory.py \
  --report-dir '/mnt/d/ohos/XTS6.1/1AADB/A333/exemption' \
  --output-dir /tmp/waiver-records
```

导出的每条 JSON 由模型按 SKILL.md 流程逐条执行（查重命中即跳过；任一失败停止整批）。

## 安装

```bash
pnpm build
dsh plugin --profile web add link:/home/cx/os/ohos-xts-auto-reporter
```

**依赖**（浏览器能力）：`@yeesy369/dsh-browser-playwright`、`@yeesy369/dsh-tool-browser`、`@yeesy369/dsh-web-permission` 三个插件需先安装，且 dsh web 以带显示环境启动（`DISPLAY=:0 dsh web`，见 `~/.dsh/restart-dsh-web.sh`）。重启后生效。

## 开发

```bash
pnpm install
pnpm build          # tsc
pnpm test           # vitest：frontmatter 解析 / 占位符替换 / 注册
pnpm test:python    # process_directory.py 解析单测
```

## 与 ~/.codex/skills 的差异（DSH 定制清单）

| 改造 | 说明 |
|---|---|
| 浏览器驱动改写 | Playwright Node 运行时（waiver.js/run_draft.sh）→ **browser_* 工具逐页操作手册**；人工在真实浏览器窗口登录/处理验证码，保留登录态 |
| 门禁保留 | assessmentNumber + OH_USERNAME/OH_PASSWORD 缺失即停（固定中文消息） |
| 硬边界保留 | 绝不提交、只点保存/暂存、status 0 即停、验证码不绕过 |
| 批处理改造 | process_directory.py 去掉 run_draft.sh 调用，改为纯解析 + 导出 JSON（--output-dir） |
| 附件策略 | browser 工具无文件上传能力：平台要求附件时请用户窗口内手动选择；可选时在 waiverReason 注明证据路径 |
| 剔除 | agents/openai.yaml（codex 专用）、Playwright 运行时（54MB 依赖不进了） |
| 中文本地化 | SKILL.md 全中文 |

## 与 openharmony-debug-test-pipeline 的关系

独立插件，零耦合。闭环插件（openharmony-debug-loop）的可选分支：triage 确认产品能力缺失且接受豁免时，可引用本插件的 `openharmony-waiver-draft` skill 转豁免流程。

## 安全边界

- 凭据只从环境变量读取，绝不写入 JSON/日志/截图/仓库；
- OAuth 只点精确 `授权`，不点 `拒绝`/`切换登录`；
- 任何不明确的保存结果都停止并报告，不重试提交类操作。
