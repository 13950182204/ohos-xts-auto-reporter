#!/usr/bin/env python3
"""process_directory.py 纯解析逻辑单测（无浏览器依赖）。"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "openharmony-waiver-draft" / "scripts"))
import process_directory as pd  # noqa: E402


class PathMappingTests(unittest.TestCase):
    def test_windows_path_maps_to_wsl_mnt(self):
        self.assertEqual(
            str(pd.normalize_windows_path(r"D:\ohos\XTS6.1\1AADB\A333\exemption")),
            "/mnt/d/ohos/XTS6.1/1AADB/A333/exemption",
        )
        self.assertEqual(str(pd.normalize_windows_path("/home/cx/os")), "/home/cx/os")


class ParseTests(unittest.TestCase):
    def test_parse_report_single_case(self):
        text = "\n".join([
            "1. 失败用例",
            "- ActsPCSTest#ActsPCS#RebootScreenUnlock",
            "2. 分析",
            "3. 豁免原因",
            "设备重启后解锁场景在目标产品上为已知差异",
        ])
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "a.txt"
            report.write_text(text, encoding="utf-8-sig")
            records = pd.parse_report(report, "OHC-2026-001", "标准系统", "OpenHarmony 6.1 Release", "ACTS-Validator")
            self.assertEqual(len(records), 1)
            rec = records[0]
            self.assertEqual(rec["assessmentNumber"], "OHC-2026-001")
            self.assertEqual(rec["moduleName"], "ActsPCSTest")
            self.assertEqual(rec["testsuite"], "ActsPCS")
            self.assertEqual(rec["testcases"], ["RebootScreenUnlock"])
            self.assertIn("已知差异", rec["waiverReason"])
            self.assertEqual(rec["attachmentPath"], str(report))

    def test_multiple_cases_join_with_commas(self):
        text = "\n".join([
            "1. 失败用例",
            "- M1#S1#CaseA",
            "- M1#S1#CaseB",
            "2. 分析",
            "3. 豁免原因",
            "原因文本",
        ])
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "b.txt"
            report.write_text(text, encoding="utf-8")
            records = pd.parse_report(report, "OHC-1", "标准系统", "OpenHarmony 6.1 Release", "ACTS-Validator")
            self.assertEqual(records[0]["testcases"], ["CaseA", "CaseB"])

    def test_mixed_module_rejected(self):
        text = "\n".join([
            "1. 失败用例",
            "- M1#S1#CaseA",
            "- M2#S1#CaseB",
            "3. 豁免原因",
            "原因",
        ])
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "c.txt"
            report.write_text(text, encoding="utf-8")
            with self.assertRaises(ValueError):
                pd.parse_report(report, "OHC-1", "标准系统", "OpenHarmony 6.1 Release", "ACTS-Validator")


class GateTests(unittest.TestCase):
    def test_missing_credentials_are_a_gate(self):
        os.environ.pop("OH_USERNAME", None)
        os.environ.pop("OH_PASSWORD", None)
        old_argv = sys.argv
        sys.argv = ["process_directory.py", "--report-dir", "/tmp"]
        try:
            self.assertEqual(pd.main(), 2)
        finally:
            sys.argv = old_argv


if __name__ == "__main__":
    unittest.main()
