"""The preview gate rejects invalid signatures and missing real launch evidence."""

import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "macos_preview", Path(__file__).resolve().parents[2] / "tools/verify_macos_preview.py"
)
assert spec is not None and spec.loader is not None
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class PreviewVerificationTests(unittest.TestCase):
    def test_signature_requires_adhoc_without_hardened_runtime(self):
        preview.assert_preview_signature("Signature=adhoc\nflags=0x2(adhoc)\n")
        for details in ["", "Signature=adhoc\nflags=0x10002(adhoc,runtime)\n",
                        "Authority=Developer ID Application: test\n"]:
            with self.subTest(details=details), self.assertRaises(RuntimeError):
                preview.assert_preview_signature(details)

    def test_launch_requires_successful_renderer_and_backend_message(self):
        message = {"type": "apex-desktop-smoke", "ok": True, "renderer": True, "backend": True}
        for code, output, success in [
            (0, json.dumps(message), True), (0, "", False), (1, json.dumps(message), False),
            (0, json.dumps({**message, "backend": False}), False),
        ]:
            with self.subTest(code=code, output=output), TemporaryDirectory() as temporary:
                result = subprocess.CompletedProcess([], code, output, "")
                with patch.object(preview.subprocess, "run", return_value=result):
                    if success:
                        preview.electron_smoke(Path(temporary), Path(temporary) / "data")
                    else:
                        with self.assertRaises(RuntimeError):
                            preview.electron_smoke(Path(temporary), Path(temporary) / "data")

    def test_native_failure_and_timeout_cannot_produce_report(self):
        result = subprocess.CompletedProcess([], 1, "", "invalid signature")
        with (
            patch.object(preview.subprocess, "run", return_value=result),
            self.assertRaises(RuntimeError),
        ):
            preview.run("codesign", "--verify")
        timeout = subprocess.TimeoutExpired("app", 180)
        with patch.object(preview.subprocess, "run", side_effect=timeout):
            with TemporaryDirectory() as temporary, self.assertRaises(subprocess.TimeoutExpired):
                preview.electron_smoke(Path(temporary), Path(temporary) / "data")


if __name__ == "__main__":
    unittest.main()
