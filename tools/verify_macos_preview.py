"""Verify and launch the actual certificate-free DMG/ZIP payloads on native CI.

This verifies ad-hoc bundle integrity, not Developer ID identity or notarization.
It never removes quarantine or changes machine-wide security policy.
"""

import hashlib
import json
import os
import platform
import plistlib
import re
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
MACHO = {
    b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca",
}
CHECKS = [
    "zip-bundle-signature", "zip-native-signatures", "zip-runtime-smoke", "zip-electron-smoke",
    "dmg-bundle-signature", "dmg-native-signatures", "dmg-electron-smoke",
]


def run(*args: str, timeout: int = 300) -> str:
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr.strip()}")
    return result.stdout + result.stderr


def assert_preview_signature(details: str) -> None:
    if "Signature=adhoc" not in details.splitlines():
        raise RuntimeError("Preview must have an explicit ad-hoc signature")
    if re.search(r"flags=.*\bruntime\b", details):
        raise RuntimeError("Certificate-free preview must not enable Hardened Runtime")


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_app(app: Path, version: str, arch: str) -> int:
    with (app / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    if info.get("CFBundleIdentifier") != "org.apex.forensic":
        raise RuntimeError("Wrong application bundle ID")
    if info.get("CFBundleShortVersionString") != version:
        raise RuntimeError("Wrong application version")
    run("codesign", "--verify", "--deep", "--strict", str(app))
    assert_preview_signature(run("codesign", "--display", "--verbose=4", str(app)))
    executables = [app / "Contents/MacOS/APEX", app / "Contents/Resources/runtime/apex-local-api"]
    for executable in executables:
        if arch not in run("lipo", "-archs", str(executable)).split():
            raise RuntimeError("Wrong executable architecture")
    checked: set[Path] = set()
    for entry in app.rglob("*"):
        if not entry.is_file():
            continue
        path = entry.resolve()
        if not path.is_relative_to(app.resolve()):
            raise RuntimeError("Payload symlink leaves the application bundle")
        if path in checked:
            continue
        with path.open("rb") as stream:
            magic = stream.read(4)
        if magic in MACHO:
            run("codesign", "--verify", "--strict", str(path))
            checked.add(path)
    if not checked:
        raise RuntimeError("No native payloads verified")
    return len(checked)


def electron_smoke(app: Path, data: Path) -> None:
    data.mkdir()
    result = subprocess.run(
        [str(app / "Contents/MacOS/APEX"), "--apex-smoke-test"],
        env={
            **os.environ, "APEX_SMOKE_DATA_DIR": str(data),
            "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "ORT_DISABLE_TELEMETRY": "1",
        },
        capture_output=True, text=True, timeout=180, check=False,
    )
    messages = []
    for line in result.stdout.splitlines():
        try:
            messages.append(json.loads(line))
        except ValueError:
            continue
    expected = {"type": "apex-desktop-smoke", "ok": True, "renderer": True, "backend": True}
    if result.returncode or expected not in messages:
        raise RuntimeError("Packaged Electron, preload IPC or backend smoke test failed")


def main() -> None:
    if sys.platform != "darwin":
        raise RuntimeError("Preview verification requires a native Mac")
    version = json.loads((ROOT / "frontend/package.json").read_text())["version"]
    arch = "arm64" if platform.machine() == "arm64" else "x64"
    native_arch = "arm64" if arch == "arm64" else "x86_64"
    release = ROOT / "frontend/release"
    report = release / f"verification-macOS-{arch}.json"
    report.unlink(missing_ok=True)
    dmg = release / f"APEX-{version}-macOS-{arch}.dmg"
    archive = release / f"APEX-{version}-macOS-{arch}.zip"
    if not dmg.is_file() or not archive.is_file():
        raise RuntimeError("Both named DMG and ZIP preview artifacts are required")
    with TemporaryDirectory(prefix="apex-preview-check-") as temporary:
        root = Path(temporary)
        unpacked = root / "zip"
        run("ditto", "-x", "-k", str(archive), str(unpacked))
        zip_app = unpacked / "APEX.app"
        zip_count = verify_app(zip_app, version, native_arch)
        run(sys.executable, str(ROOT / "tools/verify_desktop_runtime.py"),
            str(zip_app / "Contents/Resources/runtime/apex-local-api"), timeout=900)
        electron_smoke(zip_app, root / "zip-user-data")
        mount = root / "dmg"
        mount.mkdir()
        run("hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", str(mount), str(dmg))
        try:
            dmg_app = mount / "APEX.app"
            dmg_count = verify_app(dmg_app, version, native_arch)
            electron_smoke(dmg_app, root / "dmg-user-data")
        finally:
            run("hdiutil", "detach", str(mount))
    report.write_text(json.dumps({
        "status": "verified", "signing_mode": "adhoc", "notarized": False,
        "version": version, "arch": arch,
        "source_commit": os.environ.get("GITHUB_SHA"), "run_id": os.environ.get("GITHUB_RUN_ID"),
        "checks": CHECKS, "native_files": {"zip": zip_count, "dmg": dmg_count},
        "sha256": {dmg.name: sha256(dmg), archive.name: sha256(archive)},
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Verified {arch} preview DMG/ZIP signatures, renderer IPC and native runtime.")


if __name__ == "__main__":
    main()
