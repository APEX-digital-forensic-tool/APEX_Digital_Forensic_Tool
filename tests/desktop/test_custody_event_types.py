import re
from pathlib import Path
from typing import get_args

from apex_desktop.models import CustodyAdd

APP = Path(__file__).parents[2] / "frontend/src/App.tsx"


def test_analyst_event_types_match_the_custody_dialog():
    listing = re.search(r"const CUSTODY_EVENTS = \[(.*?)\];", APP.read_text(), re.S)
    assert listing is not None
    dialog_types = re.findall(r'"([A-Z_]+)"', listing.group(1))
    allowed = get_args(CustodyAdd.model_fields["event_type"].annotation)
    assert list(allowed) == dialog_types
