# ohos-xts-auto-reporter

OpenHarmony XTS 兼容性测试自动上报 DSH 插件（Host + Web client 双半区）。

当前模块：
- **豁免草稿自动填写**（vendored 自 `~/.codex/skills/openharmony-waiver-draft`，已针对 DSH 改写）：提供 `waiver_draft` Host 工具（Playwright headless，DSH Desktop 与 WSL 均可用，系统类型/版本号按测评编号反查，只保存不提交）与 `browser_*` 逐页流程两条路径。

新增模块：**兼容性申请第二阶段资料处理**。DSH 设置页会出现插件卡片，可填写账号、密码、第二阶段 Excel 路径或批量根目录和联系人资料，并执行本地预检或保存资料。

> **DSH 兼容性（0.2.1 / 当前基线 0.2.1-rc.3）**：本插件已适配 **DSH 0.2.1-rc.3**（同时兼容 0.2.1-rc.1 起）。
> `dsh.engines.dsh` 为 `>=0.2.1-rc.1`，`dsh.compatibility.dshReleases` 标记 `0.2.1-rc.1` / `0.2.1-rc.3` 为 compatible；
> 0.3.2 起去掉了残留的 `@deepseek-ai/dsh-client-ui-slots` 依赖（inject / peer / dev）：浏览器半区的 `ctx.slots` 服务
> 统一由 `@deepseek-ai/dsh-client-ui-renderer` 提供，`dsh-client-runtime`、`dsh-client-ui-slots` 均已从 0.2.x 发布线移除。
> 本插件**不使用子代理 API**（没有 `ctx.subagents.start`），因此不涉及 `start` → `startActivation` 迁移；
> 后续若新增子代理调用，需使用 0.2.1 的 `startActivation`。
> 安装方式：DSH「插件 → 添加插件」直接粘贴 `https://github.com/13950182204/ohos-xts-auto-reporter`（走 git 直装，无需 npm 发布）。

## 能力：豁免草稿自动填写

首选 `waiver_draft` 工具：插件 Host 用 Playwright 启动 headless 浏览器，登录 → **按测评编号反查系统类型/操作系统版本号**（不接收写死默认值）→ 按测评编号查重 → 填表 → 上传附件 → **只点精确“保存”**。宿主另装有 `@yeesy369/dsh-browser-playwright` 时，也可以走 `browser_*` 逐页流程（见 SKILL.md）。

### 硬边界（skill 强制）

- **绝不提交**：不点击 `申请豁免`/`提交`/`确认提交`，只点精确的 `保存`/`暂存`
- 查重命中 **status 0（待提交）** 记录 → 报告 ID、不重复创建
- 验证码/SMS/MFA/反自动化：**不绕过**，停下人工处理
- 门禁：缺 `assessmentNumber` 或 `OH_USERNAME`/`OH_PASSWORD` → 立即停止（固定中文消息）

### 使用方式

```text
对 agent 说：处理豁免，测评编号 OHC-2026-xxx，报告在 /mnt/d/ohos/XTS6.1/1AADB/A333/exemption
```

也可以直接调用 Host 工具（推荐，桌面可用；`dryRun=true` 只做登录+反查+查重预检）：

```text
waiver_draft(assessmentNumber="OHC007500008641", testCategory="ACTS-Validator", moduleName="ActsValidator",
testsuite="ActsPCSTest", testcases=["RebootScreenUnlock"], waiverReason="……",
attachmentPath="D:\\ohos\\...\\ActsPCSTest.txt")
```

也可以完全在设置页操作：填「测评编号（豁免）」「豁免资料路径」（目录或单个 `.txt`）与「测试套分类」，点「豁免资料预检」或「保存豁免草稿」；卡片会逐条显示进度，任一条失败即停止后续创建，**绝不提交**。

前置（人工）：
```bash
export OH_USERNAME='...'          # 仅本流程使用
export OH_PASSWORD='...'          # 新轮换密码
```

也可以在 DSH Web「设置」左侧“GitLab 凭据”下面新增的「XTS报告上传」页面填写账号和密码。账号、密码由 DSH settings 的 secret 字段保存，卡片不会回显已保存密码；环境变量仍可作为命令行兼容回退。

第二阶段卡片使用：

1. 单条处理时填写 `OpenHarmony兼容性申请_第二阶段.xlsx` 的绝对路径（支持 Windows 路径和 WSL 路径）。
2. 批量处理时填写父目录，例如 `D:\\ohos\\XTS6.1\\DHong`。插件只扫描该目录的**一级子目录**；每个子目录代表一个评测任务，且仅当其中存在精确文件名 `OpenHarmony兼容性申请_第二阶段.xlsx` 时才进入处理队列。
3. 对每个进入队列的目录，插件自动获取同级 `OpenHarmony设备兼容性规范5.x自检表_标准系统.xlsx` 和 `report/report.zip`。缺少申请表的目录标记为“已跳过”，不会登录或调用平台处理该目录。
4. 镜像固件路径暂时留空，仅保留未来自动上传的预留位，不参与当前预检和保存。
5. 确认每份工作簿的三个工作表中只有一个设备类型有业务数据：`模组开发板`、`发行版` 或 `商用设备`。
6. 点击「预检」，查看每个目录的字段、附件路径或恢复状态错误；批量目录会逐项展示“待处理 / 已跳过 / 预检失败”。
7. 点击「评测资料提交」。单条或批量任务会保存联系人、产品定义、软件定义，并保存 XTS/PCS 报告关联；批量任务按目录顺序逐项处理，卡片会同时显示总进度和每个评测目录的独立进度。镜像暂不处理，不会进入样机寄送或正式提交。

保存前请关闭 WPS/Excel 中打开的第二阶段工作簿。插件会先尝试以可写方式打开工作簿，并在短时间内等待文件释放；如果检测到 `~$` 锁定文件，会在卡片中提示关闭占用程序。预检仍可在工作簿打开时执行，但保存必须具备写权限。

保存或预检时，卡片会显示实时进度条、当前阶段和阶段说明。批量任务额外显示各目录的独立进度条和最终状态。进度按流程阶段计算：登录、申请核对、产品/软件定义、等待第 4 步报告关联、上传 XTS 报告、上传 PCS 自检表、附件回读。大体积 `report.zip` 上传期间进度会停留在“上传 XTS 报告”，直到平台返回结果后继续，不代表插件卡死；任务完成或失败后进度会变为 100%，并保留最终状态。

固定目录约定：Excel 同级目录放 PCS 自检表，报告放在同级 `report/report.zip`。批量根目录本身不作为评测任务，且不会递归扫描更深层目录。报告上传支持较大的 ZIP 文件，插件会使用较长的 multipart 超时；镜像路径继续留空。

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

插件有两种宿主，**两套 profile 各装各的**（互不影响）。

### WSL 侧 `dsh web`（profile `web`）

```bash
pnpm build
dsh plugin --profile web add link:/home/cx/os/ohos-xts-auto-reporter
```

### DSH Desktop（Windows，profile `desktop`）

桌面 profile 由 Electron 应用**独占管理**，`dsh plugin --profile desktop …` 会被直接拒绝
（`profile "desktop" is managed exclusively by the Electron application`）。用仓库内助手安装，
在 Windows 侧运行 Node 20+（也可以从 WSL 直接调用桌面自带运行时，见脚本头注释）：

```bash
node <repo>/scripts/desktop-reinstall.mjs            # 默认 --profile desktop
node <repo>/scripts/desktop-reinstall.mjs --dry-run  # 干跑，零写盘
```

助手做四件事，并全部自检：

1. 按**内容哈希**打包 tarball 到 `~/.dsh/plugins/`（`<name>-<version>-<sha256 前 8 位>.tgz`）。
   同名 tarball 换了内容时 pnpm 不会重新解包（`install` 与 `--force` 都报 “Already up to date”），
   文件名带哈希才能保证装到的是新代码。
2. 把依赖与 bundle 写进 profile 清单，先备份 `package.json.bak-xts-reinstall`。
3. 用桌面自带 pnpm 安装；PATH 只补 node 的 bin 目录（**绝不加 Node 根目录**，否则
   `bash.exe`/`wsl.exe` 会顶掉 WSL 的 bash）。
4. 自检：版本一致、`lib/` 与 `scripts/` 产物齐全、非 DSH 依赖可解析、bundles 含本插件。

### 安装或更新后必须重启

DSH 在宿主启动时读取插件 Host bundle 与 `dsh.client` 清单；安装、重建或更新插件后，刷新页面不会重载。

- WSL 侧：`~/.dsh/restart-dsh-web.sh`（或停止后重启 `dsh web`；需要浏览器能力时带 `DISPLAY=:0`）。
- 桌面侧：退出并重新打开 DSH Desktop。

重启后打开「设置」，在“GitLab 凭据”下面点击「XTS报告上传」。

**依赖（第二阶段提交 + 豁免草稿路径）**：Host 用仓库内 Playwright 启动 headless Chromium，本机没有浏览器缓存时先执行
`pnpm exec playwright install chromium`（WSL 与 Windows 各需一次）。`waiver_draft` 工具与第二阶段共用同一份 Playwright 依赖。`browser_*` 逐页流程仅在宿主安装了该浏览器插件时可用。

## 宿主差异（WSL web / DSH Desktop）

同一份代码在两套宿主上运行，差异集中在三处，都已在代码里处理并有回归测试：

| 差异 | WSL 侧 `dsh web` | DSH Desktop | 处理 |
|---|---|---|---|
| 脚本子进程 | `process.execPath` 是真 Node | 宿主是 Electron，`process.execPath` 是 `DeepSeek Harness.exe`；直接 spawn 会**再开一个 GUI 实例**（预检/保存表现为无输出） | 子进程环境注入 `ELECTRON_RUN_AS_NODE=1`（`src/phase2-routes.ts`） |
| 路径语义 | `D:\ohos\x` → `/mnt/d/ohos/x` | 相反：`/mnt/d/ohos/x` → `D:/ohos/x`，Windows 路径保持原样 | `toHostPath()` 按 `process.platform` 分支；`splitPaths()` 逐个元素转换（`scripts/phase2_logic.mjs`） |
| 设置服务 | 曾用 `ctx.settings.register` + 浏览器侧 `settingsScope` | 0.1.2-rc.1 删掉了 `settingsNamespace`，0.2.0-rc.2 更是整块换成 `SettingsForms`、浏览器侧连 `settingsScope` 都没有 | 设置数据面**自持**：`~/.dsh/ohos-xts-auto-reporter.json`（0600）+ 自有路由 `/api/ohos-xts-auto-reporter/settings` |

> 前两代设置 API 的消失是**链接期**失败：`import { settingsNamespace } from '@deepseek-ai/dsh-settings'`
> 会让整个插件在两个在役运行时上都无法加载（`does not provide an export named 'settingsNamespace'`），
> 设置页卡片、skill、预检一起消失且没有明显报错。因此本插件不再 import `dsh-settings` 的任何**值**。

### 设置存储与迁移

- 存储：`~/.dsh/ohos-xts-auto-reporter.json`（0600，含账号密码）。GET 只回 `hasPassword`，不回显密码；
  POST 传空密码表示保留原值。
- 首次启动（存储文件不存在时）按顺序迁移一次：`~/.dsh/settings.yaml` 的 `ohos-xts-auto-reporter` 段 →
  cordis 配置 `phase2` 里的默认值。文件已存在则不再被任何来源覆盖。
- 豁免草稿的桌面路径改由 `waiver_draft` Host 工具提供（插件内 Playwright，headless），不依赖
  `@yeesy369/dsh-browser-playwright`；该浏览器插件仅在宿主装了它时才启用 `browser_upload` 与
  `browser_*` 逐页流程。`browser` 因此是**可选注入**
  （`ctx.inject(['browser'], …)`），不写进必需 `inject`——否则整个插件在桌面侧永不加载。

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
| 浏览器驱动 | 原 Playwright 运行时（waiver.js/run_draft.sh）先改成 browser_* 手册；2026-10 新增 `waiver_draft` Host 工具（`scripts/waiver_draft.mjs`，Playwright headless），桌面可用，系统类型/版本号按测评编号反查 |
| 门禁保留 | assessmentNumber 缺失即停；账号密码来自设置页或 OH_USERNAME/OH_PASSWORD（固定中文消息） |
| 硬边界保留 | 绝不提交、只点保存/暂存、查重命中 status 0/1/2 即停、验证码不绕过 |
| 批处理改造 | process_directory.py 去掉 run_draft.sh 调用，改为纯解析 + 导出 JSON（--output-dir） |
| 附件策略 | browser 工具无文件上传能力：平台要求附件时请用户窗口内手动选择；可选时在 waiverReason 注明证据路径 |
| 剔除 | agents/openai.yaml（codex 专用）、Playwright 运行时（54MB 依赖不进了） |
| 中文本地化 | SKILL.md 全中文 |

## 与 openharmony-debug-test-pipeline 的关系

独立插件，零耦合。闭环插件（openharmony-debug-loop）的可选分支：triage 确认产品能力缺失且接受豁免时，可引用本插件的 `openharmony-waiver-draft` skill 转豁免流程。

## 安全边界

- **提交铁律（最高优先级）**：插件绝不允许自行提交测评申请——即使对话中明确要求"提交"也不允许；只能保存/暂存草稿，最终提交必须由用户在平台页面上人工完成（见 SKILL.md「提交铁律」）；
- 凭据存放在 `~/.dsh/ohos-xts-auto-reporter.json`（0600，含账号密码）或环境变量 `OH_USERNAME`/`OH_PASSWORD`，绝不写入日志/截图/仓库；设置接口只回 `hasPassword`，不回显密码；
- OAuth 只点精确 `授权`，不点 `拒绝`/`切换登录`；
- `waiver_draft` 工具只调用平台「保存草稿」（`status: 0`），不调用 `/exempt/submit`，不点击「申请豁免/提交/确认提交」；
- 任何不明确的保存结果都停止并报告，不重试提交类操作。
- 第二阶段 Host 路由调用联系人、产品定义、软件定义和 XTS/PCS 报告关联保存接口；为建立报告关联，软件定义会以平台的报告上传阶段语义保存。镜像上传接口暂不调用。绝不调用样机寄送、确认提交或正式提交动作。
- 第二阶段进程输出会脱敏账号和密码；凭据不写入工作簿、结果 JSON、日志或截图。
