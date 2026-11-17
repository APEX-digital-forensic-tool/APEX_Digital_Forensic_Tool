"""Behaviors from the #62/#65 work that main still lacked after #74."""

import wave
from io import BytesIO

from test_local_api import call, wait
from test_local_api import client as api_client

client = api_client


def register(client, cid, root, files=True):
    eid = wait(client, cid, call(client, "evidence.register", case_id=cid, source_path=str(root)))[
        "result"
    ]["id"]
    if files:
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


def test_index_built_without_a_file_index_is_not_reported_as_current(client, tmp_path):
    root = tmp_path / "one"
    root.mkdir()
    (root / "a.txt").write_text("a", encoding="utf-8")
    cid = call(client, "cases.create", name="No input")["id"]
    eid = register(client, cid, root, files=False)
    build(client, cid, eid, "TIMELINE")
    build(client, cid, eid, "SEARCH")

    timeline = call(client, "timeline.list", case_id=cid)["index_state"][0]
    search = call(client, "search.query", case_id=cid, query_text="a")["index_state"][0]
    assert timeline["timeline"]["state"] == "NONE"
    assert search["search"]["state"] == "NONE"
    assert timeline["timeline"]["source_items"] == 0


def wav() -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8000)
        out.writeframes(b"\x00\x00" * 800)
    return buffer.getvalue()


def test_audio_with_a_misleading_name_reaches_speech_recognition(client, tmp_path):
    root = tmp_path / "audio"
    root.mkdir()
    (root / "voice.dat").write_bytes(b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00M4A mp42isom")
    (root / "memo.3ga").write_bytes(b"\x00\x00\x00\x18ftyp3ga6" + b"\x00" * 24)
    (root / "tape").write_bytes(wav())
    (root / "rec.caf").write_bytes(b"caff\x00\x01\x00\x00" + b"\x00" * 24)
    cid = call(client, "cases.create", name="Audio names")["id"]
    eid = register(client, cid, root)
    nodes = {
        n["original_name"]: n
        for n in call(client, "files.list", case_id=cid, evidence_id=eid, all_nodes=True)["items"]
    }
    for name in ("voice.dat", "memo.3ga", "tape", "rec.caf"):
        task = call(client, "machine.run", case_id=cid, node_id=nodes[name]["id"], kind="STT")
        assert task["task_id"], name


def test_text_and_random_binary_are_still_rejected_for_speech(client, tmp_path):
    root = tmp_path / "other"
    root.mkdir()
    (root / "note.dat").write_text("just text", encoding="utf-8")
    (root / "blob.dat").write_bytes(b"\xff\xe0\x00\x00" + b"\x00" * 40)
    cid = call(client, "cases.create", name="Not audio")["id"]
    eid = register(client, cid, root)
    nodes = {
        n["original_name"]: n
        for n in call(client, "files.list", case_id=cid, evidence_id=eid, all_nodes=True)["items"]
    }
    for name in ("note.dat", "blob.dat"):
        response = client.post(
            "/v1/operations/machine.run",
            json={"case_id": cid, "node_id": nodes[name]["id"], "kind": "STT"},
        )
        body = response.json()
        assert body["ok"] is False, name
        assert body["error"]["code"] == "MEDIA_AUDIO_FORMAT_UNSUPPORTED"


def test_unreadable_file_keeps_the_audio_format_refusal(client, tmp_path):
    root = tmp_path / "gone"
    root.mkdir()
    (root / "x.dat").write_text("not audio", encoding="utf-8")
    cid = call(client, "cases.create", name="Unreadable")["id"]
    eid = register(client, cid, root)
    nodes = {
        n["original_name"]: n
        for n in call(client, "files.list", case_id=cid, evidence_id=eid, all_nodes=True)["items"]
    }
    # The indexed file is gone, so its bytes cannot be read to judge it.
    (root / "x.dat").unlink()
    response = client.post(
        "/v1/operations/machine.run",
        json={"case_id": cid, "node_id": nodes["x.dat"]["id"], "kind": "STT"},
    )
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "MEDIA_AUDIO_FORMAT_UNSUPPORTED"
