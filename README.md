# ohos-xts-auto-reporter

OpenHarmony XTS 兼容性测试自动上报 DSH 插件（Host + Web client 双半区）。

当前模块：**豁免草稿自动填写**（vendored 自 `~/.codex/skills/openharmony-waiver-draft`，已针对 DSH 改写）。

新增模块：**兼容性申请第二阶段草稿**。DSH 设置页会出现插件卡片，可填写账号、密码、第二阶段 Excel 路径和联系人资料，并执行本地预检或保存草稿。

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

也可以在 DSH Web「设置」左侧“GitLab 凭据”下面新增的「XTS报告上传」页面填写账号和密码。账号、密码由 DSH settings 的 secret 字段保存，卡片不会回显已保存密码；环境变量仍可作为命令行兼容回退。

第二阶段卡片使用：

1. 只填写 `OpenHarmony兼容性申请_第二阶段.xlsx` 的绝对路径（支持 Windows 路径和 WSL 路径）。
2. 插件从 Excel 所在目录自动获取 `OpenHarmony设备兼容性规范5.x自检表_标准系统.xlsx`，并从同目录的 `report/report.zip` 获取 XTS 报告；卡片中两个路径只读显示。
3. 镜像固件路径暂时留空，仅保留未来自动上传的预留位，不参与当前预检和保存。
4. 确认三个工作表中只有一个设备类型有业务数据：`模组开发板`、`发行版` 或 `商用设备`。
5. 点击「预检」，修复字段、自动附件路径或恢复状态错误。
6. 点击「保存第二阶段草稿」。插件会保存联系人、产品定义、软件定义，并保存 XTS/PCS 报告关联；镜像暂不处理，不会进入样机寄送或正式提交。

保存或预检时，卡片会显示实时进度条、当前阶段和阶段说明。进度按流程阶段计算：登录、申请核对、产品/软件定义、等待第 4 步报告关联、上传 XTS 报告、上传 PCS 自检表、附件回读。大体积 `report.zip` 上传期间进度会停留在“上传 XTS 报告”，直到平台返回结果后继续，不代表插件卡死；任务完成或失败后进度会变为 100%，并保留最终状态。

固定目录约定：Excel 同级目录放 PCS 自检表，报告放在同级 `report/report.zip`。报告上传支持较大的 ZIP 文件，插件会使用较长的 multipart 超时；镜像路径继续留空。

预检要求外观图真实存在（最多 10 张），标准/小型系统的 `PCID.sc` 路径真实存在且扩展名为 `.sc`，软件版本、安全补丁标签、版本 Id、版本 Hash 和产品描述完整。新建申请时测评编号和申请标识留空，由平台回读写回工作簿。
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

### 安装或更新后必须重启

DSH 会在 Web 服务启动时读取插件 Host bundle 和 `dsh.client` 清单；安装、重新构建或更新 link 插件后，单纯刷新设置页不会重新加载插件。执行：

```bash
~/.dsh/restart-dsh-web.sh
```

如果没有该脚本，则停止当前 `dsh web` 后重新启动（需要浏览器能力时带上 `DISPLAY=:0`），再刷新浏览器页面。重启完成后打开「设置」，在“GitLab 凭据”下面点击「XTS报告上传」即可。

**依赖**（浏览器能力）：`@yeesy369/dsh-browser-playwright`、`@yeesy369/dsh-tool-browser`、`@yeesy369/dsh-web-permission` 三个插件需先安装，且 dsh web 以带显示环境启动（`DISPLAY=:0 dsh web`，见 `~/.dsh/restart-dsh-web.sh`）。第二阶段 Host 使用仓库内 Playwright；若本机没有对应浏览器缓存，先执行 `pnpm exec playwright install chromium`。重启后生效。

## 开发

```bash
pnpm install
pnpm build          # Host TypeScript + Web client bundle
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

- **提交铁律（最高优先级）**：插件绝不允许自行提交测评申请——即使对话中明确要求"提交"也不允许；只能保存/暂存草稿，最终提交必须由用户在平台页面上人工完成（见 SKILL.md「提交铁律」）；
- 凭据只从 DSH secret 设置或环境变量读取，绝不写入 JSON/日志/截图/仓库；
- OAuth 只点精确 `授权`，不点 `拒绝`/`切换登录`；
- 任何不明确的保存结果都停止并报告，不重试提交类操作。
- 第二阶段 Host 路由调用联系人、产品定义、软件定义和 XTS/PCS 报告关联保存接口；为建立报告关联，软件定义会以平台的报告上传阶段语义保存。镜像上传接口暂不调用。绝不调用样机寄送、确认提交或正式提交动作。
- 第二阶段进程输出会脱敏账号和密码；凭据不写入工作簿、结果 JSON、日志或截图。
