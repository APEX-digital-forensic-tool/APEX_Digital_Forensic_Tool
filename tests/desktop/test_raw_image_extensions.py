"""A raw disk image is parsed as a disk whatever extension the analyst's tool gave it."""

import base64
import gzip
import json
from pathlib import Path

import pytest
from test_forensic_operations import registered
from test_local_api import call
from test_local_api import client as api_client

client = api_client


@pytest.mark.parametrize("extension", [".img", ".dd", ".raw", ".001", ".IMG"])
def test_raw_image_is_parsed_as_a_file_system(client, tmp_path, extension):
    pytest.importorskip("pytsk3")
    fixture = json.loads(
        (Path(__file__).parents[1] / "fixtures/container-images.json").read_text()
    )
    image = tmp_path / f"source{extension}"
    image.write_bytes(gzip.decompress(base64.b64decode(fixture["streams.img"]["gzip_base64"])))
    cid, eid = registered(client, image)
    root = call(client, "files.roots", case_id=cid, evidence_id=eid)[0]
    volumes = call(client, "files.list", case_id=cid, evidence_id=eid, parent_node_id=root["id"])[
        "items"
    ]
    nodes = call(
        client, "files.list", case_id=cid, evidence_id=eid, parent_node_id=volumes[0]["id"]
    )["items"]
    assert "document.txt" in {node["original_name"] for node in nodes}


def _streams_image() -> bytes:
    fixture = json.loads(
        (Path(__file__).parents[1] / "fixtures/container-images.json").read_text()
    )
    return gzip.decompress(base64.b64decode(fixture["streams.img"]["gzip_base64"]))


def test_first_segment_of_a_split_image_is_refused_before_any_work(client, tmp_path):
    data = _streams_image()
    half = len(data) // 2
    (tmp_path / "split.001").write_bytes(data[:half])
    (tmp_path / "split.002").write_bytes(data[half:])
    cid = call(client, "cases.create", name="분할 이미지")["id"]
    response = client.post(
        "/v1/operations/evidence.register",
        json={"case_id": cid, "source_path": str(tmp_path / "split.001")},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SPLIT_IMAGE_UNSUPPORTED"
    assert call(client, "evidence.list", case_id=cid) == []
    assert call(client, "tasks.list", case_id=cid) == []


def test_joined_split_image_registers_like_any_raw_image(client, tmp_path):
    pytest.importorskip("pytsk3")
    data = _streams_image()
    (tmp_path / "joined.dd").write_bytes(data)
    cid, eid = registered(client, tmp_path / "joined.dd")
    assert call(client, "files.roots", case_id=cid, evidence_id=eid)


@pytest.mark.parametrize("picked", ["split.002", "split.003", "split.010"])
def test_any_later_segment_gets_the_same_split_guidance(client, tmp_path, picked):
    data = _streams_image()
    third = len(data) // 3
    for name, part in (
        ("split.001", data[:third]),
        ("split.002", data[third : 2 * third]),
        ("split.003", data[2 * third :]),
        ("split.010", b"tail"),
    ):
        (tmp_path / name).write_bytes(part)
    cid = call(client, "cases.create", name="분할 이미지")["id"]
    response = client.post(
        "/v1/operations/evidence.register",
        json={"case_id": cid, "source_path": str(tmp_path / picked)},
    )
    assert response.json()["error"]["code"] == "SPLIT_IMAGE_UNSUPPORTED"
    assert call(client, "evidence.list", case_id=cid) == []


def test_split_archive_is_told_to_extract_not_to_join(client, tmp_path):
    (tmp_path / "x.7z.001").write_bytes(b"7z\xbc\xaf\x27\x1c" + b"\0" * 64)
    (tmp_path / "x.7z.002").write_bytes(b"\0" * 64)
    cid = call(client, "cases.create", name="분할 압축")["id"]
    response = client.post(
        "/v1/operations/evidence.register",
        json={"case_id": cid, "source_path": str(tmp_path / "x.7z.001")},
    )
    assert response.json()["error"]["code"] == "ARCHIVE_REQUIRES_EXTRACTION"


def test_lone_numbered_file_is_not_treated_as_a_split_set(client, tmp_path):
    (tmp_path / "orphan.002").write_bytes(b"data")
    cid = call(client, "cases.create", name="단독 조각")["id"]
    response = client.post(
        "/v1/operations/evidence.register",
        json={"case_id": cid, "source_path": str(tmp_path / "orphan.002")},
    )
    assert response.status_code == 200, response.text
