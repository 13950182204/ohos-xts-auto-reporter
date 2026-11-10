# 设备目录模板

复制整个目录、改名为你的设备目录（建议用型号名），然后把文件放进去：

```text
<设备目录>/
├─ OpenHarmony兼容性申请资料.xlsx   # 已给空白模板，直接填
├─ <设备目录>-20261106.7z           # 固件包（.7z 或 .zip）
├─ <设备目录>.png                   # 外观图
├─ pcid.sc
├─ OpenHarmony设备兼容性规范6.x自检表_标准系统.xlsx
├─ OpenHarmony兼容性测试样品清单.xlsx
├─ report/report.zip                # 没有 zip 时插件会自动把 report/ 打包
└─ exemption/                       # 豁免资料，见下
```

## 表格要填什么

- 只填一个 sheet（模组开发板 / 商用设备 / 发行版 三选一），另外两个保持空白即可。
- 「内核」必填：标准系统填 `Linux`，小型系统填 `LiteOS-A`，轻量系统填 `LiteOS-M`（单元格带下拉）。
- 「安全补丁标签」写 `2026/11/01` 这种格式，`2026-11-1`、`20261101` 也会自动归一。
- 「快递单号」选填；填了才会走第 5 步样机寄送。
- 外观图、PCID 不再写进表格——插件按本目录自动找 `*.png` 与 `pcid.sc`。

## 豁免资料（可选）

```text
exemption/
├─ Acts/<模块名>/<套件>.txt          # 报告：失败用例 / 失败原因 / 豁免理由
├─ Acts/<模块名>/<套件>-豁免材料.zip  # 附件；没有 zip 就直传该 txt
├─ Acts/<模块名>/evidence/           # -report.txt / -rerun.log / -hilog.txt
├─ ActsValidator/<套件>/<套件>.txt   # 目录名 = 套件名，无 zip、无 evidence
└─ Hats/ · Dcts/ · Ssts/             # 结构同 Acts，已预留
```

`.gitkeep` 只是占位文件，可以删；插件打包报告与识别豁免时会跳过所有 `.` 开头的文件和 `~$` 锁文件。
