# ohos-xts-auto-reporter

OpenHarmony XTS 兼容性测试自动上报 DSH 插件（Host + Web client 双半区）。

当前模块：
- **豁免草稿自动填写**（vendored 自 `~/.codex/skills/openharmony-waiver-draft`，已针对 DSH 改写）：提供 `waiver_draft` Host 工具（Playwright headless，DSH Desktop 与 WSL 均可用，测试套分类按豁免资料目录自动识别，系统类型/版本号按测评编号反查，只保存不提交）与 `browser_*` 逐页流程两条路径。

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
waiver_draft(assessmentNumber="OHC007500008641", moduleName="ActsValidator",
testsuite="ActsPCSTest", testcases=["RebootScreenUnlock"], waiverReason="……",
attachmentPath="D:\\ohos\\...\\ActsValidator\\ActsPCSTest-豁免材料.zip")
```

`testCategory` 可选：省略时按 `attachmentPath` 的上级目录自动识别（`Acts`→`ACTS`、`ActsValidator`→`ACTS-Validator`、`Hats`→`HATS`、`Dcts`→`DCTS`、`Ssts`→`SSTS`，大小写不敏感）。

也可以完全在设置页操作：填「测评编号（豁免）」与「豁免资料路径」（目录或单个 `.txt`），点「识别」按目录结构自动列出每条资料的可识别测试套分类、模块、套件与平台提交路径，再点「豁免资料预检」或「保存豁免草稿」；测试套分类不再手填，**批量模式也不再接收分类参数**（每条记录自带 `testCategory` 与 `submissionPath`）。卡片会逐条显示进度，任一条失败即停止后续创建，**绝不提交**。

前置（人工）：
```bash
export OH_USERNAME='...'          # 仅本流程使用
export OH_PASSWORD='...'          # 新轮换密码
```

也可以在 DSH Web「设置」左侧“GitLab 凭据”下面新增的「XTS报告上传」页面填写账号和密码。账号、密码由 DSH settings 的 secret 字段保存，卡片不会回显已保存密码；环境变量仍可作为命令行兼容回退。

设置页字段（保存在 `~/.dsh/ohos-xts-auto-reporter.json`）：

| 设置项 | 说明 |
|---|---|
| 账号 / 密码 | 兼容性测评平台登录凭据；密码留空表示沿用已保存值，命令行可用 `OH_USERNAME` / `OH_PASSWORD` 回退 |
| 设备目录（或批量父目录） | **只填目录**：目录内直接有 `OpenHarmony兼容性申请资料.xlsx` 时按单条处理；没有则按批量父目录扫描一级子目录。设置页会据此自动带出豁免资料路径与固件包路径 |
| 企业联系电话 / 企业邮箱 | 保存申请时写入平台 |
| 镜像固件路径 | 固件文件或目录：文件支持 `.zip` / `.7z` / `.rar` / `.tar.gz` 等；目录时自动取其中优先 `.zip` / `.7z` 的固件。设置页标签为「固件包路径」 |
| 测评编号（豁免） / 豁免资料路径 | 豁免草稿流程使用；「识别」按钮按目录结构推断测试套分类 |

第二阶段卡片使用：

1. 单条处理时填写**设备目录**的绝对路径（支持 Windows 路径和 WSL 路径），例如 `D:\\ohos\\XTS6.1\\DHong\\DH-76AM-HS26A`：目录里直接放着 `OpenHarmony兼容性申请资料.xlsx` 就按这一条任务处理。
2. 批量处理时填写父目录，例如 `D:\\ohos\\XTS6.1\\DHong`。插件只扫描该目录的**一级子目录**；每个子目录代表一个评测任务，且仅当其中存在精确文件名 `OpenHarmony兼容性申请资料.xlsx` 时才进入处理队列。
3. 对每个进入队列的目录，插件按目录自动定位 PCS 自检表（`OpenHarmony设备兼容性规范5.x自检表_标准系统.xlsx`，找不到 5.x 时接受 6.x 等版本）与 XTS 报告 `report/report.zip`（`report/` 下有其它 `*.zip` 时也接受）。缺少申请表的目录标记为“已跳过”，不会登录或调用平台处理该目录。
4. 需要上传镜像固件时，在「固件包路径」填固件文件或目录，先点「校验固件」（纯本地，不上传）确认文件名与格式，再点「上传固件」真实上传；两者都不参与「预检」和「评测资料提交」。
5. 确认每份工作簿的三个工作表中只有一个设备类型有业务数据：`模组开发板`、`发行版` 或 `商用设备`。
6. 点击「预检」，查看每个目录的字段、附件路径或恢复状态错误；批量目录会逐项展示“待处理 / 已跳过 / 预检失败”。
7. 点击「评测资料预检」：预检通过且已填写固件包路径时，会自动接着上传固件（相当于把「上传固件」按钮串在后面）；点「评测资料提交」时则按申请人意愿推进申请。
8. 「评测资料提交」会保存联系人、产品定义、软件定义，建立 XTS/PCS 报告关联、选择镜像固件，并保存样机寄送（工作簿填了「快递单号」时）；每一步都回读平台校验。批量任务按目录顺序逐项处理，卡片会同时显示总进度和每个评测目录的独立进度。

保存前请关闭 WPS/Excel 中打开的第二阶段工作簿。插件会先尝试以可写方式打开工作簿，并在短时间内等待文件释放；如果检测到 `~$` 锁定文件，会在卡片中提示关闭占用程序。预检仍可在工作簿打开时执行，但保存必须具备写权限。

保存或预检时，卡片会显示实时进度条、当前阶段和阶段说明。批量任务额外显示各目录的独立进度条和最终状态。进度按流程阶段计算：登录、申请核对、产品/软件定义、等待第 4 步报告关联、上传 XTS 报告、上传 PCS 自检表、附件回读。大体积 `report.zip` 上传期间进度会停留在“上传 XTS 报告”，直到平台返回结果后继续，不代表插件卡死；任务完成或失败后进度会变为 100%，并保留最终状态。

固定目录约定：Excel 同级目录放 PCS 自检表，报告放在同级 `report/report.zip`。**外观图与 `PCID.sc` 也按该目录自动定位**（目录里的图片文件、`pcid.sc`），不再从工作簿读取这两项，工作簿里也不再有「外观图路径」「PCID.sc路径」两行（旧表格仍可读，运行 `node scripts/migrate_phase2_workbook.mjs --input <工作簿或设备目录>` 可清理成新格式，会先备份 `.bak`）。批量根目录本身不作为评测任务，且不会递归扫描更深层目录。报告上传支持较大的 ZIP 文件，插件会使用较长的 multipart 超时；镜像上传按设置里的固件包路径单独执行，不受上述固定目录约定影响。

预检要求设备目录里能找到外观图（最多 10 张）与标准/小型系统的 `PCID.sc`（扩展名 `.sc`）；外观图优先取文件名与型号/目录名匹配的图片，目录里只有一张图片时直接用它。软件版本、安全补丁标签、版本 Id、版本 Hash 和产品描述仍需完整。新建申请时测评编号和申请标识留空，由平台回读写回工作簿。

### 第二阶段工作簿字段

模板三个工作表（`模组开发板`、`商用设备`、`发行版`）的字段坐标与必填情况如下。读取按标签定位，坐标仅供填写/排查参考。

| 字段 | 模组开发板 | 商用设备 | 发行版 | 必填 |
|---|---|---|---|---|
| 操作系统类型 / 操作系统版本号 | C8 / C9 | C8 / C9 | C8 / C9 | 是 |
| 内核 | C10 | C10 | C10 | 是（`LiteOS-M` / `LiteOS-A` / `Linux`，平台第 2 步字典 `system_kernel`） |
| 名称（传播名） | C11 | C11 | C11 | 是 |
| 模组型号 | C12 | C17 | 设备1/2 的 B17 / F17 | 模组开发板、发行版必填；**商用设备选填** |
| 认证方式 | — | C20 | — | **选填**；填写时必须是 `产线预置` / `一型一密` / `不涉及` |
| 软件版本号 / 安全补丁标签 | C21 / C22 | C27 / C28 | C24 / C25 | 是 |
| 版本Id / 版本Hash | C23 / C24 | C29 / C30 | 设备1/2 的 B27/F27、B28/F28 | 是 |
| 快递单号 | C26 | C32 | C30 | 否；多个单号可用逗号或分号分隔，原样保存 |

旧模板没有「内核」「快递单号」两行时仍可读（读取按标签定位），但预检会提示缺少内核；先运行 `node scripts/migrate_phase2_workbook.mjs --input <工作簿或设备目录>` 迁移成新布局（会先备份 `.bak`），再补填内核即可。

浏览器窗口弹出后，OpenAtom 登录/OAuth/验证码在窗口内人工处理一次，登录态持久（profile 目录）。

单条模式：准备输入 JSON（assessmentNumber/moduleName/testsuite/testcases/waiverReason/attachmentPath，`testCategory` 可选）后直接说「保存豁免草稿」。

## 豁免资料规范（强制）

**一个模块的一个 Testsuite = 一个 `.txt` + 一个附件（优先 `-豁免材料.zip`，没有 zip 时直接用该套件的 `.txt`）+ 一条平台申请，各自独立豁免单号。** 同一模块有多个 Testsuite 必须拆成多个文件、多个附件、多条申请，禁止合并成一条。

```
exemption/<测试大项>/<模块名>/
├── <套件>.txt                 # 三节式：1. 失败用例 / 2. 失败原因 / 3. 申请豁免理由
├── <套件>-豁免材料.zip        # 平台附件（单文件）：本套件 txt + 本套件 evidence/；没有这个 zip 时直接上传 <套件>.txt
└── evidence/
    ├── <套件>-report.txt      # 报告摘录
    ├── <套件>-rerun.log       # 本机复跑日志摘录
    └── <套件>-hilog.txt       # 按需
```

- 提交前用解析器做严格校验：文件名必须等于 Testsuite 名、父目录必须等于 Module 名、`.txt` 只能含一个模块的一个套件、附件优先用 `<套件>-豁免材料.zip`，没有时回退为该套件的 `.txt`（平台接受单个 txt 作为豁免材料）、正文用相对路径引用的 `evidence/` 文件必须真实存在；不符即报「豁免资料布局不符合规范」。
- 用例行 `模块#套件#用例`（可带 `（报告耗时 x s）` 尾注，解析时剥掉）；平台 Testcase 填逗号分隔的裸用例名，Testsuite 必填且只能一个。
- 旧格式（一文件混多套件、无 zip）可用 `--allow-legacy` 解析，仅警告；正式提交前必须整理成上面的布局。

目录批处理（每份 `.txt` = 一个模块的一个 Testsuite，无浏览器依赖的纯解析）：

```bash
python3 skills/openharmony-waiver-draft/scripts/process_directory.py \
  --report-dir 'D:/ohos/XTS6.1/DHong/DH-76AM-HS26A/exemption/Acts' \
  --assessment-number <测评编号> --test-category ACTS \
  --output-dir /tmp/waiver-records
```

输出形如「34 条独立豁免记录（34 个模块+套件，44 条用例）」并逐条标注 `[附件:zip]`（数字随资料变化，不是固定值）。导出的每条 JSON 由模型按 SKILL.md 流程逐条执行（查重命中即跳过；任一失败停止整批）。

### 识别接口（设置页「识别」按钮）

`POST /api/ohos-xts-auto-reporter/waiver/scan`，请求体 `{ "waiverPath": "<目录或文件>" }`（缺省取设置里的豁免资料路径）。接口纯本地、不联网、不登录，等价于 `node scripts/waiver_batch.mjs --scan --input <路径>`；设置页用它自动定位并显示平台提交路径。成功响应：

```json
{
  "ok": true,
  "root": "/mnt/d/ohos/XTS6.1/DHong/DH-76AM-HS26A/exemption",
  "items": [{
    "sourceReport": "…/Acts/ActsUpdateTest/ActsUpdateTest.txt",
    "categoryFolder": "Acts",
    "testCategory": "ACTS",
    "moduleName": "ActsUpdateTest",
    "testsuite": "ActsUpdateTest",
    "caseCount": 2,
    "testcases": ["RebootScreenUnlock"],
    "attachmentPath": "…/Acts/ActsUpdateTest/ActsUpdateTest-豁免材料.zip",
    "attachmentKind": "zip",
    "evidenceRelative": ["evidence/ActsUpdateTest-report.txt"],
    "submissionPath": "Acts/ActsUpdateTest/ActsUpdateTest.txt",
    "ready": true,
    "problems": []
  }],
  "summary": { "total": 1, "ready": 1, "blocked": 0, "byCategory": { "ACTS": 1 } }
}
```

失败时同样返回 HTTP 200，结构为 `{ "ok": false, "error": "<中文原因>" }`。批量预检/保存（`waiver/preflight`、`waiver/save`）响应里的每条 batch item 也带 `testCategory` 与 `submissionPath`。

### 镜像固件上传接口（设置页「校验固件」/「上传固件」按钮）

`POST /api/ohos-xts-auto-reporter/mirror/upload`，请求体 `{ "mirrorPath": "<固件文件或目录>", "dryRun": false }`（`mirrorPath` 缺省取设置里的镜像固件路径；`dryRun: true` 只做本地校验，不上传，也不要求账号密码）。等价命令行为 `node scripts/mirror_upload.mjs --input <路径> [--dry-run] [--upload] [--rename] [--artifacts <目录>]`，账号密码经 `OH_USERNAME` / `OH_PASSWORD` 环境变量传入。

接口**只做同步校验并立即返回**，上传脚本在后台执行；真实上传 600MB+ 固件需要数分钟，避免撞上 HTTP 超时。成功受理的响应：

```json
{ "ok": true, "message": "已开始上传固件，进度见下方进度条。", "artifacts": "/tmp/oh-mirror-upload-20261107230000" }
```

空路径、路径不存在、账号密码缺失、已有任务在执行等同步失败仍返回 HTTP 200，结构为 `{ "ok": false, "error": "<中文原因>" }`；非 POST 返回 405。上传进度通过 `GET /api/ohos-xts-auto-reporter/status` 轮询：`state.kind` 为 `mirror`、`state.phase` 为 `uploading`，`state.progress` 形如 `{ "percent": 12.3, "stage": "解析固件", "detail": "…" }`（来自脚本的 `MIRROR_PROGRESS=` 行）。任务结束（无论成功或失败）时 `state.phase` 回到 `idle`、`state.finishedAt` 有值，结果行 `MIRROR_RESULT_JSON=` 里的 `fileName` / `fileSize` / `platformStatus` 原样放在 `state.mirror`。脚本缺失结果行或非 0 退出时 `state.ok` 为 `false`，`state.message` 带中文原因与脚本输出末尾 500 字（输出已脱敏，不含密码）。

### 路径推导接口（设置页「设备目录（或批量父目录）」字段）

`POST /api/ohos-xts-auto-reporter/paths/derive`，请求体 `{ "workbookPath": "<设备目录或批量父目录>" }`（也接受同义字段 `path`）。接口纯本地、不联网、不写文件：输入是**目录**时以它为根；输入是**文件**时以文件所在目录为根，再从根目录推出三份默认值。

| 字段 | 推导规则 |
| --- | --- |
| `workbookPath` | 根目录下的 `OpenHarmony兼容性申请资料.xlsx`（仅用于提示「已识别到哪份工作簿」，设置页那一行仍保持目录）；没有则取根目录第一个匹配 `兼容性申请资料*.xlsx` 的文件（忽略 Excel 打开时留下的 `~$…` 锁文件）；输入本身就是该 xlsx 时原样返回 |
| `waiverPath` | 根目录下的 `exemption/`（必须是目录） |
| `mirrorPath` | 根目录**一层**内的固件包（`.zip` / `.7z` / `.tar` / `.tar.gz` / `.tar.bz2` / `.tar.xz`）：文件名含 8 位日期者优先 → 日期新的优先 → mtime 新的优先 |

成功响应（`mirrorCandidates` 是全部候选，按同一优先级排序，第一个即 `mirrorPath`）：

```json
{
  "ok": true,
  "root": "/mnt/d/ohos/XTS6.1/DHong/DH-76AM-KS11C",
  "workbookPath": "…/OpenHarmony兼容性申请资料.xlsx",
  "waiverPath": "…/exemption",
  "mirrorPath": "…/DH-76AM-KS11C-20261104.7z",
  "mirrorCandidates": [{
    "path": "…/DH-76AM-KS11C-20261104.7z",
    "name": "DH-76AM-KS11C-20261104.7z",
    "size": 677966057,
    "modifiedAt": "2026-11-04T00:38:56.409Z"
  }],
  "warnings": []
}
```

推不出来的字段留空并写进 `warnings`（如「未找到 .zip / .7z 固件包」「发现 N 个固件包，已选 <文件名>（最新的一个）」），此时仍是 `ok: true`——批量目录父层这类没有 xlsx/固件包的输入也能安全推导。只有空输入（`请先填写设备目录（或批量父目录）。`）和路径不存在（`路径不存在：<输入>`）是 `ok: false`。任何失败都返回 HTTP 200 `{ "ok": false, "error": "<中文原因>" }`（前端据此提示，不会误判成接口不存在），非 POST 返回 405。

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
| 批处理改造 | process_directory.py 去掉 run_draft.sh 调用，改为纯解析 + 导出 JSON（--output-dir）；2026-11 起强制「一个模块的一个 Testsuite = 一个 txt + 一个 zip + 一条申请」，布局不符直接报错 |
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
- 第二阶段 Host 路由调用联系人、产品定义、软件定义、XTS/PCS 报告关联与样机寄送保存接口；产品定义与第 4 步都以平台的「下一步」语义推进（否则平台不会生成报告关联行）。样机寄送只在工作簿填了「快递单号」时保存，绝不执行「确认提交」或「正式提交」动作。镜像上传接口（`/mirror/upload`）只做平台固件上传。
- 第二阶段进程输出会脱敏账号和密码；凭据不写入工作簿、结果 JSON、日志或截图。
