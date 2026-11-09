"""Notarize the DMG and verify the actual DMG/ZIP payloads before publication.

Run on a native macOS runner after dist:mac:release. No quarantine removal or
Gatekeeper disabling is used. All subprocesses fail closed.
"""

import hashlib
import json
import os
import platform
import plistlib
import re
import subprocess
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
MACHO_MAGICS = {
    b"\xfe\xed\xfa\xce",
    b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
    b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbe",
    b"\xbe\xba\xfe\xca",
    b"\xca\xfe\xba\xbf",
    b"\xbf\xba\xfe\xca",
}


def run(*args: str, timeout: int = 300, include_stderr: bool = False) -> str:
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        # No private key contents/passwords are passed as arguments to these tools.
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr.strip()}")
    return result.stdout + result.stderr if include_stderr else result.stdout


def assert_signature(details: str, team: str, *, executable: bool = False) -> None:
    if not re.search(r"^Authority=Developer ID Application:", details, re.MULTILINE):
        raise RuntimeError("Missing Developer ID Application signature")
    if f"TeamIdentifier={team}" not in details.splitlines():
        raise RuntimeError("Unexpected Apple signing team")
    if not re.search(r"^Timestamp=.+", details, re.MULTILINE):
        raise RuntimeError("Missing secure signing timestamp")
    if executable and not re.search(r"flags=.*\bruntime\b", details):
        raise RuntimeError("Executable does not enable Hardened Runtime")


def verify_signature(path: Path, team: str, *, executable: bool = False) -> None:
    run("codesign", "--verify", "--strict", str(path))
    assert_signature(
        run("codesign", "--display", "--verbose=4", str(path), include_stderr=True),
        team,
        executable=executable,
    )


def verify_app(app: Path, version: str, arch: str, team: str) -> int:
    with (app / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    if info.get("CFBundleIdentifier") != "org.apex.forensic":
        raise RuntimeError("Wrong application bundle ID")
    if info.get("CFBundleShortVersionString") != version:
        raise RuntimeError("Wrong application version")
    run("codesign", "--verify", "--deep", "--strict", str(app))
    verify_signature(app, team, executable=True)
    run("xcrun", "stapler", "validate", str(app))
    run("spctl", "--assess", "--type", "execute", "--verbose=4", str(app))
    runtime = app / "Contents/Resources/runtime/apex-local-api"
    for executable in [app / "Contents/MacOS/APEX", runtime]:
        if arch not in run("lipo", "-archs", str(executable)).split():
            raise RuntimeError("Wrong native executable architecture")
        verify_signature(executable, team, executable=True)
    # Check all native payloads, including PyInstaller's Python/extensions and
    # OCR/STT shared libraries. Symlink aliases are only verified once.
    checked: set[Path] = set()
    root = app.resolve()
    for entry in app.rglob("*"):
        if not entry.is_file():
            continue
        path = entry.resolve()
        if not path.is_relative_to(root):
            raise RuntimeError("App contains a file symlink outside its bundle")
        if path in checked:
            continue
        with path.open("rb") as stream:
            magic = stream.read(4)
        if magic in MACHO_MAGICS:
            verify_signature(path, team)
            checked.add(path)
    if not checked:
        raise RuntimeError("No Mach-O payloads verified")
    return len(checked)


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main() -> None:
    if sys.platform != "darwin":
        raise RuntimeError("macOS verification requires a native Mac runner")
    team = os.environ.get("APPLE_TEAM_ID", "")
    if not re.fullmatch(r"[A-Z0-9]{10}", team):
        raise RuntimeError("APPLE_TEAM_ID is required")
    credentials = [
        os.environ.get(key, "") for key in ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]
    ]
    if not all(credentials) or not Path(credentials[0]).is_file():
        raise RuntimeError("App Store Connect notarization credentials are required")
    version = json.loads((ROOT / "frontend/package.json").read_text())["version"]
    arch = "arm64" if platform.machine() == "arm64" else "x64"
    native_arch = "arm64" if arch == "arm64" else "x86_64"
    release = ROOT / "frontend/release"
    report = release / f"verification-macOS-{arch}.json"
    report.unlink(missing_ok=True)
    dmg = release / f"APEX-{version}-macOS-{arch}.dmg"
    zip_path = release / f"APEX-{version}-macOS-{arch}.zip"
    if not dmg.is_file() or not zip_path.is_file():
        raise RuntimeError("Both named DMG and ZIP release artifacts are required")

    verify_signature(dmg, team)
    result = json.loads(
        run(
            "xcrun",
            "notarytool",
            "submit",
            str(dmg),
            "--key",
            credentials[0],
            "--key-id",
            credentials[1],
            "--issuer",
            credentials[2],
            "--wait",
            "--timeout",
            "30m",
            "--output-format",
            "json",
            timeout=1900,
        )
    )
    if result.get("status") != "Accepted":
        raise RuntimeError(f"DMG notarization not accepted: {result.get('id')}")
    # Apple ticket propagation can briefly lag an Accepted response.
    for attempt in range(5):
        try:
            run("xcrun", "stapler", "staple", str(dmg))
            break
        except RuntimeError:
            if attempt == 4:
                raise
            time.sleep(5)
    run("xcrun", "stapler", "validate", str(dmg))
    run(
        "spctl",
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        "--verbose=4",
        str(dmg),
    )

    with TemporaryDirectory(prefix="apex-release-check-") as temp:
        unpacked = Path(temp) / "zip"
        run("ditto", "-x", "-k", str(zip_path), str(unpacked))
        zip_app = unpacked / "APEX.app"
        zip_count = verify_app(zip_app, version, native_arch, team)
        # Exercise the signed, redistributed engine, not only the unsigned input.
        run(
            sys.executable,
            str(ROOT / "tools/verify_desktop_runtime.py"),
            str(zip_app / "Contents/Resources/runtime/apex-local-api"),
            timeout=900,
        )
        mount = Path(temp) / "dmg"
        mount.mkdir()
        run("hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", str(mount), str(dmg))
        try:
            dmg_count = verify_app(mount / "APEX.app", version, native_arch, team)
        finally:
            run("hdiutil", "detach", str(mount))

    report.write_text(
        json.dumps(
            {
                "status": "verified",
                "version": version,
                "arch": arch,
                "team_id": team,
                "source_commit": os.environ.get("GITHUB_SHA"),
                "run_id": os.environ.get("GITHUB_RUN_ID"),
                "dmg_notarization_id": result["id"],
                "checks": [
                    "developer-id",
                    "hardened-runtime",
                    "nested-signatures",
                    "app-and-dmg-stapling",
                    "gatekeeper",
                    "signed-runtime-smoke",
                ],
                "native_files": {"zip": zip_count, "dmg": dmg_count},
                "sha256": {dmg.name: sha256(dmg), zip_path.name: sha256(zip_path)},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Verified {arch} DMG/ZIP signatures, tickets, Gatekeeper and signed runtime.")


if __name__ == "__main__":
    main()
