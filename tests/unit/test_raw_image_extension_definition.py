import re
from pathlib import Path

from apex_forensic.application.services.evidence_manager import EvidenceManager
from apex_forensic.domain.raw_image_extensions import RAW_IMAGE_FORMATS

FRONTEND = Path(__file__).parents[2] / "frontend/src/imageExtensions.ts"


def test_engine_detects_every_raw_image_extension() -> None:
    assert {".001", ".dd", ".img", ".raw"} == set(RAW_IMAGE_FORMATS)
    for extension, expected in RAW_IMAGE_FORMATS.items():
        for spelling in (extension, extension.upper()):
            assert EvidenceManager._detect_evidence_format(Path(f"evidence{spelling}")) is expected


def test_frontend_lists_the_same_raw_image_extensions() -> None:
    match = re.search(r"RAW_IMAGE_EXTENSIONS = \[([^\]]*)\]", FRONTEND.read_text())
    assert match is not None
    listed = {f".{item}" for item in re.findall(r'"([^"]+)"', match.group(1))}
    assert listed == set(RAW_IMAGE_FORMATS)
