---
name: openharmony-waiver-draft
description: 自动化 OpenHarmony 兼容性平台测试豁免（waiver）表单填写，用 browser_* 浏览器工具逐页操作，从单份报告文件或豁免目录分别保存待提交草稿，绝不提交正式豁免。当用户提供兼容性测试失败项、测评编号、报告路径，或要求处理整个豁免目录时使用。执行前必须由人工填写当前测评编号并设置仅用于本流程的账号密码，任一缺失立即停止。
---

# OpenHarmony 豁免草稿填写

用 browser_* 浏览器工具（由 @yeesy369/dsh-browser-playwright 提供，操作弹出的真实浏览器窗口）逐页完成豁免草稿填写。目录批处理时，每个 `.txt` 报告解析为恰好一条豁免记录。流程目标：人工登录后，在 15 分钟内完成查重与草稿保存。

## 硬边界（任何情况下不可逾越）

- **绝不点击或触发** `申请豁免`、`提交`、`确认提交`、`/exempt/submit` 等任何正式提交动作。
- **只允许**点击可见的精确 `保存` 或 `暂存` 控件来保存草稿。
- 查重发现**匹配的 status `0`（待提交）记录**时：报告其 ID，**不再创建新草稿**。
- 以下情况立即停止：查重不完整、出现验证码/短信/人机验证、页面未知、证据不匹配、保存结果不明确。
- 遇到验证码/SMS/MFA/反自动化检查：**不绕过**，停下并请用户在浏览器窗口人工处理或放弃。

## 前置门禁（缺失立即停止，不启动浏览器）

1. **测评编号**：当前有效的 `assessmentNumber` 必须由人工填写（页面或用户输入），**绝不沿用旧任务/旧截图的编号**。
2. **凭据**：仅用于本流程的 `OH_USERNAME` 与 `OH_PASSWORD` 环境变量（用新轮换的密码）；**绝不写进** JSON、脚本、日志、截图或仓库。

缺失时停止并报告对应消息（可多条）：
- `没有填写对应测评编号，已停止执行。`
- `没有填写对应账号密码，已停止执行。`

## 输入 JSON（在源码仓库之外构造，非机密内容）

```json
{
  "assessmentNumber": "<人工填写的最新编号>",
  "systemType": "标准系统",
  "osVersion": "OpenHarmony 6.1 Release",
  "testCategory": "ACTS-Validator",
  "moduleName": "ActsValidator",
  "testsuite": "ActsPCSTest",
  "testcases": ["RebootScreenUnlock"],
  "waiverReason": "……",
  "attachmentPath": "/mnt/d/.../evidence.txt"
}
```

- 从 `模块#套件#用例` 形式的失败标识解析各字段；附件路径优先选择内容与失败用例和原因一致的文件，**不要上传同名但内容矛盾的文件**。
- Windows 路径映射为 `/mnt/<盘符小写>/...`。

## 浏览器操作流程（browser_* 工具）

**准备工作**：确认浏览器窗口已弹出（首次使用会弹出；若已关闭，提示用户等待插件自动重开）。确认门禁满足后开始。

1. **打开平台**：`browser_navigate https://compatibility.openharmony.cn`。
   - 若跳转到 OpenAtom 登录页（`legacy.openatom.cn`）：
     a. `browser_snapshot` 读取表单，用 `browser_type` 填入账号（`OH_USERNAME`）与密码（`OH_PASSWORD`）；
     b. 点击 `用户登录`；若出现 OAuth 授权页，**只点击精确的 `授权` 按钮**，绝不点 `拒绝` 或 `切换登录`；
     c. 出现验证码/短信/MFA：停下请用户人工处理。
   - 若已是登录态（直接进入控制台），跳过登录。
2. **打开豁免列表并查重**：进入豁免/申请列表页，用当前 `assessmentNumber` 查询。`browser_snapshot` 核对返回行中的 module、testsuite、testcase 与 status：
   - 存在**匹配的 status `0`（待提交）**记录 → 报告其 ID，结束（不创建新草稿）。
   - 列表报告的行数超过返回行数（分页/查询不完整）→ **不要假设不存在**，停下做完整查询。
3. **打开创建申请表单**：进入创建/新增申请页。按快照编号逐项填写：
   - `systemType` / `osVersion`：若表单自动填充，核对显示值，不要重复选择；
   - `testCategory` / `moduleName` / `testsuite`：按输入 JSON 选择或填写；
   - `testcases`：多用例用英文逗号连接为一个字段；
   - `waiverReason`：完整的豁免原因文本。
4. **附件**（平台要求时）：
   - browser 工具无法直接上传本地文件。若表单有附件控件：停下，请用户在浏览器窗口手动选择 `attachmentPath` 对应的证据文件，选择后继续；
   - 若附件可选：跳过，在 `waiverReason` 中注明证据文件绝对路径；
   - 不要用内容矛盾的替代文件。
5. **保存草稿**：只点击精确的 `保存` 或 `暂存` 控件。确认成功消息为 `保存成功` 或 `暂存成功`；不明确则停下，把页面快照留给用户判断。
6. **收尾**：报告产物（草稿 ID/待提交状态、证据文件、测评编号）。不要点击任何提交类按钮。

## 目录批处理（多个 .txt 报告）

用 `scripts/process_directory.py` 解析豁免目录（无浏览器依赖）：

```bash
python3 {{SKILLS_DIR}}/openharmony-waiver-draft/scripts/process_directory.py \
  --report-dir '/mnt/d/ohos/XTS6.1/1AADB/A333/exemption' \
  --output-dir /tmp/waiver-records
```

- 每个 `.txt` 文件 = 一条豁免记录（`模块#套件#用例` 解析；同一文件内所有用例 ID 用英文逗号合并进一个 Testcase 字段；完整豁免原因保留在一个 reason 字段；不拆分文件内编号小节）。
- 输出目录内每条记录一个 JSON；`--assessment-number` 缺省读 `OH_ASSESSMENT_NUMBER` 环境变量。
- 然后对每条 JSON **依次**执行上面的浏览器流程（第 2 步查重命中 status 0 时跳过该条继续下一条）；任何一条查重不完整、验证挑战、解析错误或保存错误 → **停止整个批次**，报告已处理与剩余记录。

## 失败处理

- OAuth 只允许精确的 `授权` 控件；绝不选 `拒绝` 或 `切换登录`。
- 验证码/短信/MFA/反自动化：不绕过，停止并保存脱敏页面快照。
- 附件路径是目录时：在临时目录归档（不修改源目录），或请用户选择目录内具体文件。
- 任何不确定的保存结果：停止并报告，不重试提交类操作。
