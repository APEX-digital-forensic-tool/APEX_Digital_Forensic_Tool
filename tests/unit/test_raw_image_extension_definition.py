import json
from pathlib import Path

from apex_forensic.application.services.evidence_manager import EvidenceManager
from apex_forensic.domain.enums import EvidenceFormat
from apex_forensic.domain.raw_image_extensions import RAW_IMAGE_FORMATS

DEFINITION = Path(__file__).parents[2] / "src/apex_forensic/domain/raw_image_extensions.json"


def test_engine_detects_every_extension_in_the_shared_definition() -> None:
    shared = json.loads(DEFINITION.read_text())
    assert {".001", ".dd", ".img", ".raw"} <= {f".{ext}" for ext in shared}
    for ext, name in shared.items():
        detected = EvidenceManager._detect_evidence_format(Path(f"evidence.{ext.upper()}"))
        assert detected is EvidenceFormat[name]
        assert RAW_IMAGE_FORMATS[f".{ext}"] is EvidenceFormat[name]
