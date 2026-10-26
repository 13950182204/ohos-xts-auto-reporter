#!/usr/bin/env python3
"""Parse an OpenHarmony exemption-report directory into separate waiver input records.

纯本地解析（无浏览器、无凭据依赖）：每个 `.txt` 报告解析为一条记录，输出给模型
调用 `waiver_draft` 工具（或 browser_* 流程）使用。

系统类型 / 操作系统版本号**不在此处写死**：它们必须由平台按测评编号反查
（`/certificate/exempt/checkCertification?number=`），因此记录里不再输出这两个字段。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

CASE_RE = re.compile(r"(?:^|[-*]\s*)([A-Za-z0-9_]+)#([A-Za-z0-9_]+)#(.+?)\s*$")


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


def parse_cases(lines: list[str]) -> list[dict[str, str]]:
    cases = []
    for line in lines:
        match = CASE_RE.search(line.strip())
        if match:
            cases.append({"module": match.group(1), "testsuite": match.group(2), "testcase": match.group(3).strip()})
    return cases


def parse_report(path: Path, assessment: str, test_category: str) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig")
    sections = split_sections(text.splitlines())
    cases = parse_cases(sections.get(1, []))
    if not cases:
        raise ValueError(f"No failure cases found in {path}")
    first = cases[0]
    if any((case["module"], case["testsuite"]) != (first["module"], first["testsuite"]) for case in cases):
        raise ValueError(f"Mixed module/test suite in {path}")

    # One report file is one waiver. Keep all subsection reasons together so the
    # form receives one Testcase list and one complete waiver reason text area.
    reason = clean_text(sections.get(3, [])) or clean_text(sections.get(2, []))
    if not reason:
        raise ValueError(f"Missing exemption reason in {path}")
    return [{
        "assessmentNumber": assessment,
        "testCategory": test_category,
        "moduleName": first["module"],
        "testsuite": first["testsuite"],
        "testcases": [case["testcase"] for case in cases],
        "waiverReason": reason,
        "attachmentPath": str(path),
        "sourceReport": str(path),
    }]


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse OpenHarmony exemption-report directory into separate waiver input records.")
    parser.add_argument("--report-dir", required=True)
    parser.add_argument("--assessment-number")
    parser.add_argument("--test-category", default="ACTS-Validator")
    parser.add_argument("--output-dir", help="导出每条记录的 JSON 目录（缺省仅打印清单）")
    args = parser.parse_args()

    assessment = (args.assessment_number or os.environ.get("OH_ASSESSMENT_NUMBER", "")).strip()
    if not assessment or re.match(r"^(replace|请输入|OHC\.\.\.)", assessment, re.I):
        print("没有填写对应测评编号，已停止执行。", file=sys.stderr)
        return 2

    report_dir = normalize_windows_path(args.report_dir)
    if not report_dir.is_dir():
        print(f"报告目录不存在：{report_dir}", file=sys.stderr)
        return 2
    reports = sorted(report_dir.rglob("*.txt"))
    if not reports:
        print(f"报告目录没有 .txt 豁免报告：{report_dir}", file=sys.stderr)
        return 2

    records = []
    try:
        for report in reports:
            records.extend(parse_report(report, assessment, args.test_category))
    except (OSError, UnicodeError, ValueError) as error:
        print(f"报告解析失败：{error}", file=sys.stderr)
        return 1
    if not records:
        print("没有解析出可处理的豁免记录。", file=sys.stderr)
        return 1

    print(f"解析到 {len(records)} 条独立豁免记录。")
    for index, record in enumerate(records, 1):
        print(f"{index}. {record['moduleName']}#{record['testsuite']}#{','.join(record['testcases'])} <- {record['sourceReport']}")

    if args.output_dir:
        out_dir = Path(args.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        for index, record in enumerate(records, 1):
            out_path = out_dir / f"{index:03d}.json"
            out_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"已导出 {len(records)} 条记录 JSON 到 {out_dir}")
        print("逐条调用 waiver_draft 工具（或按 SKILL.md 的 browser_* 流程）：")
        print("系统类型/操作系统版本号由测评编号反查；查重命中待提交(status 0)记录时跳过该条；")
        print("任何一条查重不完整、验证挑战、解析或保存错误都会停止整个批次。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
