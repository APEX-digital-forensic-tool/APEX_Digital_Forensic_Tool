"""Present index coverage without interpreting missing results as checked evidence."""

from typing import Any

from apex_forensic.config import ServiceBundle


def index_state(
    services: ServiceBundle, case_id: str, evidence_id: str | None = None
) -> list[dict[str, Any]]:
    repository = services.repository
    search = repository.analysis_index_coverage(case_id, evidence_id, "SEARCH")
    timeline = {
        item["evidence_id"]: item
        for item in repository.analysis_index_coverage(case_id, evidence_id, "TIMELINE")
    }

    def state(coverage: dict[str, Any]) -> dict[str, Any]:
        status = coverage["status"]
        return {
            "state": (
                "CURRENT"
                if status == "COMPLETE"
                else "NONE"
                if status == "NOT_INDEXED"
                else "PARTIAL"
            ),
            "status": status,
            "job_id": coverage["job_id"],
            "source_status": coverage["source_status"],
        }

    result = []
    for item in search:
        eid = item["evidence_id"]
        sources = repository.connection.execute(
            "SELECT (SELECT COUNT(*) FROM fs_nodes WHERE case_id = ? AND evidence_id = ?)"
            " + (SELECT COUNT(*) FROM artifacts WHERE case_id = ? AND evidence_id = ?)",
            (case_id, eid, case_id, eid),
        ).fetchone()[0]
        indexed = repository.connection.execute(
            "SELECT COUNT(*) FROM search_documents"
            " WHERE case_id = ? AND evidence_id = ? AND is_stale = 0",
            (case_id, eid),
        ).fetchone()[0]
        result.append(
            {
                "evidence_id": eid,
                "display_name": item["display_name"],
                "search": {**state(item), "source_items": sources, "indexed_items": indexed},
                "timeline": {**state(timeline[eid]), "source_items": sources},
            }
        )
    return result
