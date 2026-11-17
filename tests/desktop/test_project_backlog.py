"""Project 1 regressions driven through real Core services and the desktop API."""

import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from queue import Queue
from threading import Barrier, Thread
from time import sleep

import httpx
import pytest
from fastapi.testclient import TestClient
from test_local_api import TOKEN, call, fixture_case, wait

from apex_desktop.app import create_app
from apex_forensic.config import build_services
from apex_forensic.domain.enums import CustodyEventType


@pytest.fixture(params=["asgi", "tcp"])
def client(request, tmp_path):
    """Run the same regressions in-process and through a real engine process."""
    headers = {"Authorization": f"Bearer {TOKEN}"}
    if request.param == "asgi":
        with TestClient(
            create_app(tmp_path / "data", TOKEN), base_url="http://127.0.0.1", headers=headers
        ) as connection:
            yield connection
        return
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "apex_desktop",
            "--data-dir",
            str(tmp_path / "data"),
            "--parent-watch",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=dict(os.environ, APEX_DESKTOP_TOKEN=TOKEN),
        text=True,
    )
    try:
        lines = Queue()
        Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True).start()
        ready = json.loads(lines.get(timeout=20))
        assert ready["type"] == "apex-ready", ready
        with httpx.Client(
            base_url=f"http://127.0.0.1:{ready['port']}",
            headers=headers,
            trust_env=False,
            timeout=30,
        ) as connection:
            yield connection
    finally:
        if process.poll() is None:
            process.stdin.close()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def test_missing_search_and_timeline_indexes_are_explicit(client, tmp_path):
    cid, eid = fixture_case(client, tmp_path)
    for operation, extra in [("search.query", {"query_text": "한글"}), ("timeline.list", {})]:
        result = call(client, operation, case_id=cid, evidence_id=eid, **extra)
        assert result["index_coverage"][0]["status"] == "NOT_INDEXED"
    wait(
        client,
        cid,
        call(
            client,
            "analysis.start",
            case_id=cid,
            evidence_id=eid,
            kind="SEARCH",
            profile_type="FULL_ANALYSIS",
        ),
    )
    result = call(client, "search.query", case_id=cid, query_text="한글")
    assert result["results"]
    assert result["index_coverage"][0]["status"] == "COMPLETE"
    second = tmp_path / "second"
    second.mkdir()
    (second / "later.txt").write_text("not indexed yet")
    new = wait(
        client, cid, call(client, "evidence.register", case_id=cid, source_path=str(second))
    )["result"]["id"]
    result = call(client, "search.query", case_id=cid, query_text="한글")
    assert {item["evidence_id"]: item["status"] for item in result["index_coverage"]}[
        new
    ] == "NOT_INDEXED"
    assert result["execution"]["is_partial"]
    assert result["execution"]["warnings"]


def test_search_over_quick_triage_files_remains_partial(client, tmp_path):
    root = tmp_path / "partial-evidence"
    nested = root / "deep" / "nested"
    nested.mkdir(parents=True)
    (nested / "missing.txt").write_text("not yet traversed")
    cid = call(client, "cases.create", name="Partial source index")["id"]
    eid = wait(client, cid, call(client, "evidence.register", case_id=cid, source_path=str(root)))[
        "result"
    ]["id"]
    for kind, profile in [("FILES", "QUICK_TRIAGE"), ("SEARCH", "FULL_ANALYSIS")]:
        wait(
            client,
            cid,
            call(
                client,
                "analysis.start",
                case_id=cid,
                evidence_id=eid,
                kind=kind,
                profile_type=profile,
            ),
        )
    page = call(client, "search.query", case_id=cid, evidence_id=eid, query_text="missing")
    assert page["execution"]["is_partial"]
    assert page["index_coverage"][0]["source_status"] == "PARTIAL"
    assert page["index_coverage"][0]["status"] == "PARTIAL"
    state = call(client, "index.state", case_id=cid, evidence_id=eid)[0]
    assert state["search"]["state"] == "PARTIAL"


def test_invalid_ocr_and_directory_carving_are_rejected_before_queue(client, tmp_path):
    cid, eid = fixture_case(client, tmp_path)
    node = next(
        n
        for n in call(client, "files.list", case_id=cid, evidence_id=eid, all_nodes=True)["items"]
        if n["node_type"] == "FILE"
    )
    before = call(client, "tasks.list", case_id=cid)
    for operation, payload in [
        ("evidence.carve", {"evidence_id": eid}),
        ("machine.run", {"node_id": node["id"], "kind": "OCR"}),
    ]:
        result = client.post("/v1/operations/" + operation, json={"case_id": cid, **payload})
        assert result.status_code == 409
        assert result.json()["error"]["code"] != "DESKTOP_OPERATION_FAILED"
    assert call(client, "tasks.list", case_id=cid) == before


def test_partition_only_raw_001_is_indexed_as_a_filesystem(client, tmp_path):
    import base64
    import gzip
    import json

    fixtures = json.loads(
        (Path(__file__).parents[1] / "fixtures/container-images.json").read_text()
    )
    path = tmp_path / "partition.001"
    path.write_bytes(gzip.decompress(base64.b64decode(fixtures["exfat-times.img"]["gzip_base64"])))
    cid = call(client, "cases.create", name="Raw segment suffix")["id"]
    eid = wait(client, cid, call(client, "evidence.register", case_id=cid, source_path=str(path)))[
        "result"
    ]["id"]
    wait(
        client,
        cid,
        call(
            client,
            "analysis.start",
            case_id=cid,
            evidence_id=eid,
            kind="FILES",
            profile_type="FULL_ANALYSIS",
        ),
    )
    nodes = call(client, "files.list", case_id=cid, evidence_id=eid, all_nodes=True)["items"]
    assert any(n["original_name"] == "when.txt" for n in nodes)


def test_custody_event_view_raw_and_case_boundary(client, tmp_path):
    cid, eid = fixture_case(client, tmp_path)
    event = call(client, "custody.list", case_id=cid, evidence_id=eid)[0]
    p = {"case_id": cid, "resource_type": "CUSTODY_EVENT", "resource_id": event["event_id"]}
    assert call(client, "view", **p)["resource_id"] == event["event_id"]
    assert call(client, "view", **p, view_mode="RAW")["resource_id"] == event["event_id"]
    raw = client.post("/v1/operations/raw.read", json=p)
    assert raw.status_code == 409
    assert raw.json()["error"]["code"] == "RAW_LOCATOR_UNSUPPORTED"
    other = call(client, "cases.create", name="Other")["id"]
    denied = client.post("/v1/operations/view", json={**p, "case_id": other})
    assert denied.status_code == 409


def test_new_report_version_uses_report_approval_cursor(client, tmp_path):
    cid, eid = fixture_case(client, tmp_path)
    rid = call(client, "reports.create", case_id=cid, title="Review revisions")["report_id"]
    for decision in ["reject", "approve"]:
        version = call(
            client,
            "reports.version",
            case_id=cid,
            report_id=rid,
            title="Report",
            executive_summary="Analyst text",
            evidence_ids=[eid],
            limitations=["Synthetic directory fixture; no manifest hash"],
            sections=[
                {
                    "section_type": "KEY_FINDINGS",
                    "title": "Findings",
                    "order": 1,
                    "content": "Synthetic evidence",
                }
            ],
        )
        vid = version["report_version_id"]
        for action in ["submit", "accept_section", "complete", decision]:
            current = next(
                v
                for v in call(client, "reports.get", case_id=cid, report_id=rid)["versions"]
                if v["report_version_id"] == vid
            )
            call(
                client,
                "reports.action",
                case_id=cid,
                report_version_id=vid,
                action=action,
                reason="Analyst review",
                section_id=version["sections"][0]["section_id"],
                expected_review_revision=current["review_state"]["review_revision"],
                expected_approval_revision=current["approval_state"]["approval_revision"],
            )


@pytest.mark.parametrize("event_type", ["HASH_VERIFIED", "CORRECTION"])
def test_analysts_cannot_forge_engine_custody_events(client, tmp_path, event_type):
    cid, eid = fixture_case(client, tmp_path)
    before = call(client, "custody.list", case_id=cid, evidence_id=eid)
    r = client.post(
        "/v1/operations/custody.add",
        json={
            "case_id": cid,
            "evidence_id": eid,
            "event_type": event_type,
            "action": "x",
            "reason": "y",
        },
    )
    assert r.status_code == 422
    assert call(client, "custody.list", case_id=cid, evidence_id=eid) == before


def test_files_page_bounds_are_validated_without_changing_other_pages(client, tmp_path):
    cid, eid = fixture_case(client, tmp_path)
    assert call(client, "files.list", case_id=cid, evidence_id=eid, limit=500)
    for limit in [501, 1000]:
        assert (
            client.post(
                "/v1/operations/files.list",
                json={"case_id": cid, "evidence_id": eid, "limit": limit},
            ).status_code
            == 422
        )
    assert call(client, "reports.list", case_id=cid, limit=1000)


def test_concurrent_custody_appends_and_exports_are_all_recorded(tmp_path, monkeypatch):
    from apex_forensic.adapters.persistence.sqlite.repository import SQLiteRepository

    db = tmp_path / "apex.db"
    source = tmp_path / "evidence.dd"
    source.write_bytes(b"synthetic evidence" * 100)
    with_services = build_services(db)
    cid = with_services.cases.create_case(name="Concurrent writers").case_id
    eid = with_services.evidence.register_evidence(case_id=cid, source_path=source).evidence_id
    with_services.close()
    original = SQLiteRepository.list_custody_events

    def slow_tail(self, evidence_id):
        result = original(self, evidence_id)
        sleep(0.005)  # Amplify the old tail-read/insert race without blocking the writer lock.
        return result

    monkeypatch.setattr(SQLiteRepository, "list_custody_events", slow_tail)
    barrier = Barrier(6)

    def append(worker):
        b = build_services(db, initialize=False)
        try:
            barrier.wait(timeout=10)
            for step in range(4):
                if worker % 2:
                    b.images.export_range(
                        evidence_id=eid,
                        offset=0,
                        length=16,
                        output_root=tmp_path / "exports",
                        filename=f"{worker}-{step}.bin",
                    )
                else:
                    b.custody.add_event(
                        evidence_id=eid,
                        event_type=CustodyEventType.ANALYZED,
                        actor_name="Analyst",
                        action=f"{worker}-{step}",
                    )
        finally:
            b.close()

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(append, range(6)))
    b = build_services(db, initialize=False)
    try:
        events = b.custody.list_events(eid)
        assert len(events) == 25  # Initial RECEIVED plus 24 successful appends.
        assert b.custody.verify_chain(eid)
        paths = {
            e.data["destination_location"]
            for e in events
            if e.event_type is CustodyEventType.EXPORTED
        }
        assert {str(f) for f in (tmp_path / "exports").glob("*.bin")} == paths
    finally:
        b.close()


@pytest.mark.parametrize("overwrite", [False, True])
def test_failed_export_audit_removes_new_output_and_restores_overwritten_output(
    services, tmp_path, monkeypatch, overwrite
):
    source = tmp_path / "evidence.dd"
    source.write_bytes(b"synthetic raw evidence")
    cid = services.cases.create_case(name="Failed receipt").case_id
    eid = services.evidence.register_evidence(case_id=cid, source_path=source).evidence_id
    output = tmp_path / "exports/result.bin"
    if overwrite:
        output.parent.mkdir()
        output.write_bytes(b"previous derived output")

    def fail_receipt(**_kwargs):
        raise OSError("Synthetic unavailable ledger")

    monkeypatch.setattr(services.images, "_audit_export", fail_receipt)
    with pytest.raises(OSError):
        services.images.export_range(
            evidence_id=eid,
            offset=0,
            length=8,
            output_root=output.parent,
            filename=output.name,
            overwrite=overwrite,
        )
    if overwrite:
        assert output.read_bytes() == b"previous derived output"
    else:
        assert not output.exists()
    assert sorted(f.name for f in output.parent.iterdir()) == ([output.name] if overwrite else [])
