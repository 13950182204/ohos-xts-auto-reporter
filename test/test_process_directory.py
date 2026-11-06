#!/usr/bin/env python3
"""process_directory.py 纯解析逻辑单测（无浏览器、无凭据依赖）。"""

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
            records = pd.parse_report(report, "OHC-2026-001", "ACTS-Validator")
            self.assertEqual(len(records), 1)
            rec = records[0]
            self.assertEqual(rec["assessmentNumber"], "OHC-2026-001")
            self.assertEqual(rec["testCategory"], "ACTS-Validator")
            self.assertEqual(rec["moduleName"], "ActsPCSTest")
            self.assertEqual(rec["testsuite"], "ActsPCS")
            self.assertEqual(rec["testcases"], ["RebootScreenUnlock"])
            self.assertIn("已知差异", rec["waiverReason"])
            self.assertEqual(rec["attachmentPath"], str(report))
            # 系统类型/版本号不得由解析器写死，必须由平台按测评编号反查。
            self.assertNotIn("systemType", rec)
            self.assertNotIn("osVersion", rec)

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
            records = pd.parse_report(report, "OHC-1", "ACTS-Validator")
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
                pd.parse_report(report, "OHC-1", "ACTS-Validator")


class SuiteLayoutTests(unittest.TestCase):
    def _write_suite(self, root: Path, module: str = "ActsDemo", suite: str = "DemoSuite") -> Path:
        module_dir = root / module
        evidence = module_dir / "evidence"
        evidence.mkdir(parents=True, exist_ok=True)
        report = module_dir / f"{suite}.txt"
        report.write_text("\n".join([
            "1. 失败用例",
            f"- {module}#{suite}#CaseA（报告耗时 1.0s）",
            f"- {module}#{suite}#CaseB",
            "佐证材料（相对本文件路径）：",
            f"- evidence/{suite}-report.txt：报告摘录",
            "2. 失败原因",
            "原因",
            "3. 申请豁免理由",
            "理由",
        ]), encoding="utf-8")
        (evidence / f"{suite}-report.txt").write_text("report", encoding="utf-8")
        import zipfile
        with zipfile.ZipFile(module_dir / f"{suite}-豁免材料.zip", "w") as archive:
            archive.write(report, arcname=report.name)
            archive.write(evidence / f"{suite}-report.txt", arcname=f"evidence/{suite}-report.txt")
        return report

    def test_case_names_drop_trailing_note(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = self._write_suite(Path(tmp))
            record = pd.parse_report(report, "OHC-1", "ACTS")[0]
            self.assertEqual(record["testcases"], ["CaseA", "CaseB"])

    def test_attachment_prefers_suite_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = self._write_suite(Path(tmp))
            record = pd.parse_report(report, "OHC-1", "ACTS", strict_layout=True)[0]
            self.assertEqual(record["attachmentKind"], "zip")
            self.assertTrue(record["attachmentPath"].endswith("DemoSuite-豁免材料.zip"))
            self.assertEqual(record["layoutProblems"], [])

    def test_strict_layout_requires_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = self._write_suite(Path(tmp))
            (report.parent / "DemoSuite-豁免材料.zip").unlink()
            with self.assertRaises(ValueError):
                pd.parse_report(report, "OHC-1", "ACTS", strict_layout=True)
            relaxed = pd.parse_report(report, "OHC-1", "ACTS")[0]
            self.assertEqual(relaxed["attachmentKind"], "txt")
            self.assertTrue(relaxed["layoutProblems"])

    def test_strict_layout_rejects_misnamed_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = self._write_suite(Path(tmp))
            renamed = report.rename(report.with_name("wrong-name.txt"))
            with self.assertRaises(ValueError):
                pd.parse_report(renamed, "OHC-1", "ACTS", strict_layout=True)


class GateTests(unittest.TestCase):
    def test_missing_assessment_number_is_a_gate(self):
        os.environ.pop("OH_ASSESSMENT_NUMBER", None)
        old_argv = sys.argv
        sys.argv = ["process_directory.py", "--report-dir", "/tmp"]
        try:
            self.assertEqual(pd.main(), 2)
        finally:
            sys.argv = old_argv

    def test_missing_report_directory_is_a_gate(self):
        old_argv = sys.argv
        sys.argv = ["process_directory.py", "--report-dir", "/tmp/definitely-missing-waiver-dir", "--assessment-number", "OHC-1"]
        try:
            self.assertEqual(pd.main(), 2)
        finally:
            sys.argv = old_argv


if __name__ == "__main__":
    unittest.main()
