"""Analysis tools reject targets they cannot work on before queueing a task (#65)."""

import base64
import gzip
import json
from pathlib import Path

from test_local_api import call, wait
from test_local_api import client as api_client

client = api_client
FIXTURES = Path(__file__).parents[1] / "fixtures"


def rejected(client, op, **payload):
    response = client.post("/v1/operations/" + op, json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is False, body
    return body["error"]


def register(client, cid, path):
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


def file_named(client, cid, eid, name):
    nodes = call(client, "files.list", case_id=cid, evidence_id=eid, all_nodes=True)["items"]
    return next(n for n in nodes if n["original_name"] == name)


def test_folder_evidence_rejects_carving_and_text_ocr_before_queueing(client, tmp_path):
    root = tmp_path / "folder"
    root.mkdir()
    (root / "note.txt").write_text("plain text", encoding="utf-8")
    cid = call(client, "cases.create", name="Targets")["id"]
    eid = register(client, cid, root)
    before = len(call(client, "tasks.list", case_id=cid))

    carve = rejected(client, "evidence.carve", case_id=cid, evidence_id=eid)
    assert carve["code"] == "CARVING_REQUIRES_IMAGE"
    node = file_named(client, cid, eid, "note.txt")
    ocr = rejected(client, "machine.run", case_id=cid, node_id=node["id"], kind="OCR")
    assert ocr["code"] == "MEDIA_FORMAT_UNSUPPORTED"

    assert len(call(client, "tasks.list", case_id=cid)) == before


def test_fat_like_volume_reports_streams_are_ntfs_only(client, tmp_path):
    fixture = json.loads((FIXTURES / "container-images.json").read_text())
    image = tmp_path / "exfat.img"
    image.write_bytes(gzip.decompress(base64.b64decode(fixture["exfat-times.img"]["gzip_base64"])))
    cid = call(client, "cases.create", name="Streams")["id"]
    eid = register(client, cid, image)
    node = file_named(client, cid, eid, "when.txt")
    result = call(client, "files.streams", case_id=cid, node_id=node["id"])
    assert result["streams"] == []
    assert result["ads_supported"] is False
    assert result["filesystem_type"] == "EXFAT"
