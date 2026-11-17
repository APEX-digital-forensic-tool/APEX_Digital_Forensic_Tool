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
    assert response.status_code == 409, response.text
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


def test_ntfs_streams_are_marked_supported(client, tmp_path):
    fixture = json.loads((FIXTURES / "container-images.json").read_text())
    image = tmp_path / "streams.img"
    image.write_bytes(gzip.decompress(base64.b64decode(fixture["streams.img"]["gzip_base64"])))
    cid = call(client, "cases.create", name="NTFS")["id"]
    eid = register(client, cid, image)
    node = file_named(client, cid, eid, "document.txt")
    result = call(client, "files.streams", case_id=cid, node_id=node["id"])
    assert result["ads_supported"] is True
    assert result["filesystem_type"] == "NTFS"
    assert {s["name"] for s in result["streams"]} >= {"hidden", "large"}


def test_undecodable_image_is_rejected_before_queueing(client, tmp_path):
    root = tmp_path / "folder"
    root.mkdir()
    (root / "fake.png").write_text("not really a png", encoding="utf-8")
    cid = call(client, "cases.create", name="Decode")["id"]
    eid = register(client, cid, root)
    node = file_named(client, cid, eid, "fake.png")
    before = len(call(client, "tasks.list", case_id=cid))
    error = rejected(client, "machine.run", case_id=cid, node_id=node["id"], kind="OCR")
    assert error["code"] == "MEDIA_DECODE_FAILED"
    assert len(call(client, "tasks.list", case_id=cid)) == before


def test_image_without_extension_is_accepted_by_its_bytes(client, tmp_path):
    fixture = json.loads((FIXTURES / "container-images.json").read_text())
    root = tmp_path / "folder"
    root.mkdir()
    (root / "scan").write_bytes(
        gzip.decompress(base64.b64decode(fixture["ocr.png"]["gzip_base64"]))
    )
    cid = call(client, "cases.create", name="No extension")["id"]
    eid = register(client, cid, root)
    node = file_named(client, cid, eid, "scan")
    task = call(client, "machine.run", case_id=cid, node_id=node["id"], kind="OCR")
    assert task["task_id"]


def png_bytes() -> bytes:
    fixture = json.loads((FIXTURES / "container-images.json").read_text())
    return gzip.decompress(base64.b64decode(fixture["ocr.png"]["gzip_base64"]))


def test_image_with_a_misleading_extension_is_still_accepted(client, tmp_path):
    root = tmp_path / "folder"
    root.mkdir()
    (root / "photo.dat").write_bytes(png_bytes())
    cid = call(client, "cases.create", name="Disguised")["id"]
    eid = register(client, cid, root)
    node = file_named(client, cid, eid, "photo.dat")
    task = call(client, "machine.run", case_id=cid, node_id=node["id"], kind="OCR")
    assert task["task_id"]


def test_large_jpeg_is_accepted_for_ocr(client, tmp_path):
    import random

    from PIL import Image

    root = tmp_path / "folder"
    root.mkdir()
    noise = random.Random(1).randbytes(2400 * 2400 * 3)
    path = root / "big.jpg"
    Image.frombytes("RGB", (2400, 2400), noise).save(path, "JPEG", quality=95)
    assert path.stat().st_size > 4 * 1024 * 1024
    cid = call(client, "cases.create", name="Large")["id"]
    eid = register(client, cid, root)
    node = file_named(client, cid, eid, "big.jpg")
    task = call(client, "machine.run", case_id=cid, node_id=node["id"], kind="OCR")
    assert task["task_id"]


def test_unknown_filesystem_is_not_reported_as_not_applicable(client, tmp_path, monkeypatch):
    from apex_forensic.adapters.filesystem.pytsk import PyTskFileSystemProvider

    fixture = json.loads((FIXTURES / "container-images.json").read_text())
    image = tmp_path / "streams.img"
    image.write_bytes(gzip.decompress(base64.b64decode(fixture["streams.img"]["gzip_base64"])))
    cid = call(client, "cases.create", name="Unknown fs")["id"]
    eid = register(client, cid, image)
    node = file_named(client, cid, eid, "document.txt")
    monkeypatch.setattr(PyTskFileSystemProvider, "filesystem_type", lambda *_: None)
    result = call(client, "files.streams", case_id=cid, node_id=node["id"])
    assert result["ads_supported"] is None
    assert result["filesystem_type"] is None


def test_streams_filesystem_comes_from_the_volume_not_node_names(client, tmp_path):
    root = tmp_path / "folder"
    (root / "volume-0").mkdir(parents=True)
    (root / "volume-0" / "a.txt").write_text("x", encoding="utf-8")
    fixture = json.loads((FIXTURES / "container-images.json").read_text())
    image = tmp_path / "streams.img"
    image.write_bytes(gzip.decompress(base64.b64decode(fixture["streams.img"]["gzip_base64"])))
    cid = call(client, "cases.create", name="Names")["id"]
    register(client, cid, root)
    eid = register(client, cid, image)
    node = file_named(client, cid, eid, "document.txt")
    result = call(client, "files.streams", case_id=cid, node_id=node["id"])
    assert result["filesystem_type"] == "NTFS"
    assert result["ads_supported"] is True


def wav_bytes() -> bytes:
    import io
    import wave

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8000)
        out.writeframes(b"\x00\x00" * 800)
    return buffer.getvalue()


M4A_HEADER = b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00M4A mp42isom" + b"\x00" * 16


def test_audio_with_a_misleading_name_is_accepted_for_stt(client, tmp_path):
    root = tmp_path / "folder"
    root.mkdir()
    (root / "voice.dat").write_bytes(M4A_HEADER)
    (root / "memo.3ga").write_bytes(b"\x00\x00\x00\x18ftyp3ga6" + b"\x00" * 24)
    (root / "tape").write_bytes(wav_bytes())
    cid = call(client, "cases.create", name="Audio names")["id"]
    eid = register(client, cid, root)
    for name in ("voice.dat", "memo.3ga", "tape"):
        node = file_named(client, cid, eid, name)
        task = call(client, "machine.run", case_id=cid, node_id=node["id"], kind="STT")
        assert task["task_id"], name


def test_text_file_is_still_rejected_for_stt(client, tmp_path):
    root = tmp_path / "folder"
    root.mkdir()
    (root / "note.dat").write_text("just text, not audio", encoding="utf-8")
    cid = call(client, "cases.create", name="Not audio")["id"]
    eid = register(client, cid, root)
    node = file_named(client, cid, eid, "note.dat")
    error = rejected(client, "machine.run", case_id=cid, node_id=node["id"], kind="STT")
    assert error["code"] == "MEDIA_AUDIO_FORMAT_UNSUPPORTED"
