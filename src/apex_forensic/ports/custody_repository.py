"""Custody repository port."""

from __future__ import annotations

from contextlib import AbstractContextManager
from typing import Protocol

from apex_forensic.domain.models import CustodyEvent


class CustodyRepository(Protocol):
    """Persistence operations for the append-only custody ledger."""

    def custody_append(self) -> AbstractContextManager[None]:
        """Serialize the tail read and append across database connections."""
        ...

    def save_custody_event(self, event: CustodyEvent) -> None:
        """Append a custody event."""
        ...

    def list_custody_events(self, evidence_id: str) -> list[CustodyEvent]:
        """Return custody events ordered by immutable revision."""
        ...

    def get_custody_event(self, event_id: str) -> CustodyEvent | None:
        """Return one custody event."""
        ...
