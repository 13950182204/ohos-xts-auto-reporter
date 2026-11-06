#!/usr/bin/env python3
"""Parse an OpenHarmony exemption-report directory into separate waiver input records.

纯本地解析（无浏览器、无凭据依赖）：每个 .txt 报告解析为一条记录，输出给模型
调用 waiver_draft 工具（或 browser_* 流程）使用。

资料目录与提交模型（强制，2026-11-05 用户确认）：

- 目录：exemption/<测试大项>/<测试项=模块>/；
- 一个模块的一个 Testsuite = 一个 <套件>.txt + 一个 <套件>-豁免材料.zip
  + 一条平台豁免申请（各自独立豁免单号），同一模块不同套件禁止合并；
- .txt 三节式：1. 失败用例 / 2. 失败原因 / 3. 申请豁免理由；用例行写成
  模块#套件#用例；佐证放同目录 evidence/<套件>-* 并用相对路径引用；
- 平台「豁免附件」只收单个文件：优先上传 <套件>-豁免材料.zip（内含 txt 与本套件
  evidence），没有 zip 时才退回 txt；
- 解析器强制一个文件只含一个模块 + 一个套件（混用即报错要求拆分）。

系统类型 / 操作系统版本号不在此处写死：它们必须由平台按测评编号反查
（/certificate/exempt/checkCertification?number=），因此记录里不再输出这两个字段。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile
from pathlib import Path

CASE_RE = re.compile(r"(?:^|[-*]\s*)([A-Za-z0-9_]+)#([A-Za-z0-9_]+)#(.+?)\s*$")
EVIDENCE_RE = re.compile(r"^\s*[-*]?\s*(evidence/[^\s：:，,]+)")
ZIP_SUFFIX = "-豁免材料.zip"


def normalize_windows_path(value: str) -> Path:
    match = re.match(r"^([A-Za-z]):[\\/]?(.*)$", value)
    if match:
        return Path("/mnt", match.group(1).lower(), match.group(2).replace("\\", "/"))
    return Path(value)


def clean_text(lines: list[str]) -> str:
    return " ".join(line.strip().lstrip("- ") for line in lines if line.strip()).strip()


def split_sections(lines: list[str]) -> dict[int, list[str]]:
    sections: dict[int, list[str]] = {}
    current = None
    for line in lines:
        match = re.match(r"^\s*([123])\.\s+", line)
        if match:
            current = int(match.group(1))
            sections[current] = []
            continue
        if current is not None:
            sections[current].append(line)
    return sections


TRAILING_NOTE_RE = re.compile(r"[（(][^（）()]*[)）]\s*$")


def parse_cases(lines: list[str]) -> list[dict[str, str]]:
    cases = []
    for line in lines:
        match = CASE_RE.search(line.strip())
        if match:
            # 用例行允许带「（报告耗时 1.003s）」之类的尾注，提交给平台的 Testcase 只要裸用例名。
            testcase = TRAILING_NOTE_RE.sub("", match.group(3)).strip()
            cases.append({"module": match.group(1), "testsuite": match.group(2), "testcase": testcase})
    return cases


def attachment_zip_path(report: Path, testsuite: str) -> Path:
    """该套件专属附件：<套件>-豁免材料.zip（与 .txt 同目录）。"""
    return report.with_name(f"{testsuite}{ZIP_SUFFIX}")


def resolve_attachment(report: Path, testsuite: str) -> tuple[Path, str]:
    """优先套件 zip（平台只收单文件，目录会被拒绝）；无 zip 时退回 .txt。"""
    archive = attachment_zip_path(report, testsuite)
    if archive.is_file():
        return archive, "zip"
    return report, "txt"


def referenced_evidence(lines: list[str]) -> list[str]:
    refs = []
    for line in lines:
        match = EVIDENCE_RE.match(line)
        if match and match.group(1) not in refs:
            refs.append(match.group(1))
    return refs


def check_layout(report: Path, module: str, testsuite: str, evidence_refs: list[str]) -> list[str]:
    """校验目录布局是否符合「一模块一 Testsuite 一文件一附件」规范。"""
    problems: list[str] = []
    if report.stem != testsuite:
        problems.append(f"文件名应为 <套件>.txt（当前 {report.name}，套件 {testsuite}）")
    if report.parent.name != module:
        problems.append(f"应放在模块目录 {module}/ 下（当前 {report.parent}）")
    archive = attachment_zip_path(report, testsuite)
    if not archive.is_file():
        problems.append(f"缺少套件附件 {archive.name}（表单只收单文件，需包含本套件 txt 与 evidence）")
    else:
        try:
            names = zipfile.ZipFile(archive).namelist()
        except zipfile.BadZipFile:
            problems.append(f"附件损坏（无法解压）：{archive.name}")
        else:
            if not any(name.endswith("/" + report.name) or name == report.name for name in names):
                problems.append(f"附件 {archive.name} 内没有本套件 txt（{report.name}）")
            if not any("evidence/" in name for name in names):
                problems.append(f"附件 {archive.name} 内没有 evidence/ 佐证")
    for ref in evidence_refs:
        if not (report.parent / ref).is_file():
            problems.append(f"正文引用的佐证不存在：{ref}")
    return problems


def parse_report(path: Path, assessment: str, test_category: str, strict_layout: bool = False) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig")
    lines = text.splitlines()
    sections = split_sections(lines)
    cases = parse_cases(sections.get(1, []))
    if not cases:
        raise ValueError(f"No failure cases found in {path}")
    first = cases[0]
    if any((case["module"], case["testsuite"]) != (first["module"], first["testsuite"]) for case in cases):
        raise ValueError(f"Mixed module/test suite in {path}：一个 .txt 只能对应一个模块的一个 Testsuite，请拆分文件")

    # One report file is one waiver. Keep all subsection reasons together so the
    # form receives one Testcase list and one complete waiver reason text area.
    reason = clean_text(sections.get(3, [])) or clean_text(sections.get(2, []))
    if not reason:
        raise ValueError(f"Missing exemption reason in {path}")

    evidence_refs = referenced_evidence(sections.get(1, []))
    problems = check_layout(path, first["module"], first["testsuite"], evidence_refs)
    if strict_layout and problems:
        raise ValueError("豁免资料布局不符合规范：" + "；".join(problems))
    attachment, attachment_kind = resolve_attachment(path, first["testsuite"])
    return [{
        "assessmentNumber": assessment,
        "testCategory": test_category,
        "moduleName": first["module"],
        "testsuite": first["testsuite"],
        "testcases": [case["testcase"] for case in cases],
        "caseCount": len(cases),
        "waiverReason": reason,
        "attachmentPath": str(attachment),
        "attachmentKind": attachment_kind,
        "evidenceRelative": evidence_refs,
        "layoutProblems": problems,
        "sourceReport": str(path),
    }]


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse OpenHarmony exemption-report directory into separate waiver input records.")
    parser.add_argument("--report-dir", required=True, help="豁免资料根目录（如 exemption/Acts）或单个 .txt")
    parser.add_argument("--assessment-number")
    parser.add_argument("--test-category", default="ACTS-Validator")
    parser.add_argument("--output-dir", help="导出每条记录的 JSON 目录（缺省仅打印清单）")
    parser.add_argument("--allow-legacy", action="store_true", help="允许不符合「一模块一 Testsuite 一文件一附件」的旧格式（仅警告）")
    args = parser.parse_args()

    assessment = (args.assessment_number or os.environ.get("OH_ASSESSMENT_NUMBER", "")).strip()
    if not assessment or re.match(r"^(replace|请输入|OHC\.\.\.)", assessment, re.I):
        print("没有填写对应测评编号，已停止执行。", file=sys.stderr)
        return 2

    report_dir = normalize_windows_path(args.report_dir)
    if report_dir.is_file():
        reports = [report_dir]
    elif report_dir.is_dir():
        # 只解析豁免报告本身：跳过 evidence/ 下的日志摘录等 .txt
        reports = [path for path in sorted(report_dir.rglob("*.txt")) if "evidence" not in path.parts]
    else:
        print(f"豁免资料路径不存在：{report_dir}", file=sys.stderr)
        return 2
    if not reports:
        print(f"报告目录没有 .txt 豁免报告：{report_dir}", file=sys.stderr)
        return 2

    records = []
    try:
        for report in reports:
            records.extend(parse_report(report, assessment, args.test_category, strict_layout=not args.allow_legacy))
    except (OSError, UnicodeError, ValueError, zipfile.BadZipFile) as error:
        print(f"报告解析失败：{error}", file=sys.stderr)
        return 1
    if not records:
        print("没有解析出可处理的豁免记录。", file=sys.stderr)
        return 1

    total_cases = sum(record["caseCount"] for record in records)
    suites = {(record["moduleName"], record["testsuite"]) for record in records}
    print(f"解析到 {len(records)} 条独立豁免记录（{len(suites)} 个模块+套件，{total_cases} 条用例）。")
    for index, record in enumerate(records, 1):
        kind = "zip" if record["attachmentKind"] == "zip" else "txt"
        print(f"{index}. {record['moduleName']}#{record['testsuite']}#{','.join(record['testcases'])}"
              f" [附件:{kind}] <- {record['sourceReport']}")
        if record["layoutProblems"]:
            print("   警告（旧格式）：" + "；".join(record["layoutProblems"]))

    if args.output_dir:
        out_dir = Path(args.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        for index, record in enumerate(records, 1):
            out_path = out_dir / f"{index:03d}.json"
            out_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"已导出 {len(records)} 条记录 JSON 到 {out_dir}")
        print("逐条调用 waiver_draft 工具（或按 SKILL.md 的 browser_* 流程）：")
        print("一个模块的一个 Testsuite 一条申请；testsuite 必填；附件取该套件的 <套件>-豁免材料.zip；")
        print("系统类型/操作系统版本号由测评编号反查；查重命中待提交(status 0)记录时跳过该条；")
        print("任何一条查重不完整、验证挑战、解析或保存错误都会停止整个批次。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
