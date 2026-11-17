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
