"""Raw disk image extensions, shared with the desktop intake guidance and file picker."""

from __future__ import annotations

import json
from importlib.resources import files

from apex_forensic.domain.enums import EvidenceFormat

RAW_IMAGE_FORMATS: dict[str, EvidenceFormat] = {
    f".{extension}": EvidenceFormat[name]
    for extension, name in json.loads(
        files(__package__).joinpath("raw_image_extensions.json").read_text(encoding="utf-8")
    ).items()
}
