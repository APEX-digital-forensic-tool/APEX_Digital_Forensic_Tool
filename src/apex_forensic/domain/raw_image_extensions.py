"""Raw disk image extensions.

``frontend/src/imageExtensions.ts`` repeats this list for the intake guidance and the file
picker; ``tests/unit/test_raw_image_extension_definition.py`` fails if the two differ.
"""

from __future__ import annotations

from apex_forensic.domain.enums import EvidenceFormat

RAW_IMAGE_FORMATS: dict[str, EvidenceFormat] = {
    ".dd": EvidenceFormat.DD,
    ".img": EvidenceFormat.IMG,
    ".raw": EvidenceFormat.RAW,
    ".001": EvidenceFormat.RAW,
}
