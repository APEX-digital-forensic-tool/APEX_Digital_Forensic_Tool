"""Search and timeline results say which evidence has no index yet (#62)."""

from test_forensic_operations import registered  # noqa: F401
from test_local_api import call, wait
from test_local_api import client as api_client

client = api_client


def folder(tmp_path, name, files):
    root = tmp_path / name
    root.mkdir()
    for file, text in files.items():
        (root / file).write_text(text, encoding="utf-8")
    return root


def add_evidence(client, cid, path):
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
    return eid


def build(client, cid, eid, kind):
    wait(
        client,
        cid,
        call(
            client,
            "analysis.start",
            case_id=cid,
            evidence_id=eid,
            kind=kind,
            profile_type="FULL_ANALYSIS",
        ),
    )


def states(page):
    return {s["evidence_id"]: s for s in page["index_state"]}


def test_unindexed_evidence_is_reported_not_silently_empty(client, tmp_path):
    cid = call(client, "cases.create", name="Index state")["id"]
    first = add_evidence(client, cid, folder(tmp_path, "one", {"alpha.txt": "random alpha"}))
    second = add_evidence(client, cid, folder(tmp_path, "two", {"yakzzz.txt": "yakzzz"}))
    build(client, cid, first, "SEARCH")

    page = call(client, "search.query", case_id=cid, query_text="yakzzz")
    assert page["page"]["returned"] == 0
    state = states(page)
    assert state[first]["search"]["state"] == "CURRENT"
    assert state[second]["search"]["state"] == "NONE"
    assert state[second]["timeline"]["state"] == "NONE"

    only_second = call(client, "search.query", case_id=cid, query_text="x", evidence_id=second)
    assert list(states(only_second)) == [second]

    build(client, cid, second, "SEARCH")
    page = call(client, "search.query", case_id=cid, query_text="yakzzz")
    assert page["page"]["returned"] > 0
    assert states(page)[second]["search"]["state"] == "CURRENT"

    build(client, cid, second, "FILES")
    changed = call(client, "index.state", case_id=cid, evidence_id=second)[0]
    assert changed["search"]["state"] == "PARTIAL"
    assert changed["search"]["status"] == "STALE"


def test_timeline_reports_missing_build(client, tmp_path):
    cid = call(client, "cases.create", name="Timeline state")["id"]
    eid = add_evidence(client, cid, folder(tmp_path, "one", {"alpha.txt": "alpha"}))

    before = call(client, "timeline.list", case_id=cid)
    assert before["items"] == []
    assert states(before)[eid]["timeline"]["state"] == "NONE"

    build(client, cid, eid, "TIMELINE")
    after = call(client, "timeline.list", case_id=cid)
    assert states(after)[eid]["timeline"]["state"] == "CURRENT"
    assert call(client, "index.state", case_id=cid, evidence_id=eid)[0]["evidence_id"] == eid
