"""Custody repository port."""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from apex_forensic.domain.models import CustodyEvent


class CustodyRepository(Protocol):
    """Persistence operations for the append-only custody ledger."""

    def save_custody_event(self, event: CustodyEvent) -> None:
        """Append a custody event."""
        ...

    def append_custody_event(
        self, evidence_id: str, build: Callable[[CustodyEvent | None], CustodyEvent]
    ) -> CustodyEvent:
        """Atomically read the ledger tail and append the event built from it."""
        ...

    def list_custody_events(self, evidence_id: str) -> list[CustodyEvent]:
        """Return custody events ordered by immutable revision."""
        ...

    def get_custody_event(self, event_id: str) -> CustodyEvent | None:
        """Return one custody event."""
        ...
