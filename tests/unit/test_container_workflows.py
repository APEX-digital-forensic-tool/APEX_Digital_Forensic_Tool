"""Real compressed E01, VHD/VHDX and NTFS fixtures also run on Windows without CLI tools."""

import base64
import gzip
import hashlib
import json
from io import BytesIO
from pathlib import Path

import pytest
from test_image_content import index_image, write_content_image
from test_image_filesystem_provider import _write_fat12_image

from apex_forensic.application.services.carving import CarvingService
from apex_forensic.application.services.file_streams import FileStreamService
from apex_forensic.domain.errors import (
    OperationCancelledError,
    UnsupportedCapabilityError,
    ValidationError,
)
from apex_forensic.jobs import CancellationToken


def fixture_image(tmp_path: Path, name: str) -> Path:
    entries = json.loads((Path(__file__).parents[1] / "fixtures/container-images.json").read_text())
    item = entries[name]
    data = gzip.decompress(base64.b64decode(item["gzip_base64"]))
    assert len(data) == item["size"]
    assert hashlib.sha256(data).hexdigest() == item["sha256"]
    path = tmp_path / name
    path.write_bytes(data)
    return path


@pytest.mark.parametrize("name", ["compressed.E01", "disk.vhd", "disk.vhdx"])
def test_container_real_file_bytes_unicode_and_original_unchanged(services, tmp_path, name):
    path = fixture_image(tmp_path, name)
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    case, evidence, nodes = index_image(services, path)
    assert evidence.metadata["reader_id"] == "apex.portable_container_reader"
    result = services.views.raw_read(
        case_id=case.case_id,
        resource_type="FILE_SYSTEM_NODE",
        resource_id=nodes["문서.txt"].node_id,
    )
    assert result.text_preview == "E01 가상 디스크의 실제 내용"
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


def test_ntfs_ads_is_separate_from_default_content_and_exports_exact_bytes(services, tmp_path):
    path = fixture_image(tmp_path, "streams.img")
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    case, _, nodes = index_image(services, path)
    node = nodes["document.txt"]
    streams = FileStreamService(services.repository, services.images)
    args = {"case_id": case.case_id, "node_id": node.node_id}
    hidden = next(s for s in streams.list(**args)["streams"] if s["name"] == "hidden")
    large = next(s for s in streams.list(**args)["streams"] if s["name"] == "large")
    assert large["size"] == 65536
    assert (
        bytes.fromhex(
            streams.read(**args, stream_id=large["id"], offset=4093, length=6000)["hex_preview"]
        )
        == ((bytes(range(256)) * 256)[4093 : 4093 + 4096])
    )
    result = streams.read(**args, stream_id=hidden["id"], offset=4, length=7)
    assert bytes.fromhex(result["hex_preview"]) == b"secret "
    exported = streams.export(**args, stream_id=hidden["id"], output_root=tmp_path / "export")
    assert Path(exported["output_path"]).read_bytes() == b"ADS secret forensic stream"
    original = services.views.raw_read(
        case_id=case.case_id, resource_type="FILE_SYSTEM_NODE", resource_id=node.node_id
    )
    assert original.text_preview == "normal file body"
    with pytest.raises(ValidationError):
        streams.read(**args, stream_id=65535)
    with pytest.raises(ValidationError):
        streams.list(case_id=services.cases.create_case(name="other").case_id, node_id=node.node_id)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


def test_deleted_file_logical_recovery_and_cancel(services, tmp_path):
    path = tmp_path / "deleted.img"
    _write_fat12_image(path)
    _, _, nodes = index_image(services, path)
    deleted = next(n for n in nodes.values() if n.is_deleted)
    output = services.images.recover_deleted_file(
        node_id=deleted.node_id, output_root=tmp_path / "recovered"
    )
    assert output["recovery_method"] == "TSK_LOGICAL_DATA_STREAM"
    assert Path(output["output_path"]).read_bytes() == b"DELETED"
    token = CancellationToken.new()
    token.cancel()
    with pytest.raises(OperationCancelledError):
        services.images.recover_deleted_file(
            node_id=deleted.node_id, output_root=tmp_path / "cancelled", cancellation_token=token
        )
    assert not (tmp_path / "cancelled").exists()


def png_bytes():
    from PIL import Image

    buffer = BytesIO()
    with Image.new("RGB", (2, 2), (90, 30, 100)) as image:
        image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_empty_deleted_file_is_recovered_as_empty_not_unreadable(services, tmp_path):
    path = tmp_path / "empty-deleted.img"
    _write_fat12_image(path)
    image = bytearray(path.read_bytes())
    entry = image.index(b"\xe5ELETED")
    image[entry + 28:entry + 32] = bytes(4)  # Deleted entry with zero logical size.
    path.write_bytes(image)
    before = hashlib.sha256(image).hexdigest()
    _, _, nodes = index_image(services, path)
    deleted = next(n for n in nodes.values() if n.is_deleted)
    result = services.images.recover_deleted_file(
        node_id=deleted.node_id, output_root=tmp_path / "recovered-empty"
    )
    assert Path(result["output_path"]).read_bytes() == b""
    assert result["recovered_bytes"] == result["logical_size"] == 0
    assert result["sha256"] == hashlib.sha256(b"").hexdigest()
    assert result["partial"] is False
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


def test_ewf_rejects_unrelated_extra_segment_and_segment_symlink(tmp_path):
    from apex_forensic.adapters.evidence.container import ContainerImageReader

    source = fixture_image(tmp_path, "compressed.E01")
    extra = source.with_suffix(".E02")
    extra.write_bytes(source.read_bytes())
    assert not ContainerImageReader.probe(source).supported
    extra.unlink()
    try:
        extra.symlink_to(source)
    except OSError:
        pytest.skip("Creating test symlinks is unavailable on this host")
    assert not ContainerImageReader.probe(source).supported


def test_carving_free_space_excludes_allocated_file_and_preserves_offset(services, tmp_path):
    payload = png_bytes()
    path = tmp_path / "carving.img"
    write_content_image(path, {"allocated.png": payload})
    source = bytearray(path.read_bytes())
    offset = 1200000
    source[offset : offset + len(payload)] = payload
    path.write_bytes(source)
    _, evidence, _ = index_image(services, path)
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    result = CarvingService(services.images).carve(
        evidence_id=evidence.evidence_id, output_root=tmp_path / "out", formats=("PNG",)
    )
    assert [c["offset"] for c in result["candidates"]] == [offset]
    assert Path(result["candidates"][0]["output_path"]).read_bytes() == payload
    assert result["semantics"] == "CARVED_CANDIDATES_NOT_OBSERVED_FILES"
    assert Path(result["manifest_path"]).exists()
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


def _mbr_disk(path: Path, partitions: list[tuple[int, bytes]]) -> None:
    sector, lba, disk = 512, 2048, bytearray(512)
    placed = []
    for kind, data in partitions:
        placed.append((kind, lba, data))
        lba += -(-len(data) // sector) + 2048
    disk = bytearray(lba * sector)
    for index, (kind, start, data) in enumerate(placed):
        entry = bytes([0, 0xFE, 0xFF, 0xFF, kind, 0xFE, 0xFF, 0xFF])
        entry += start.to_bytes(4, "little") + (-(-len(data) // sector)).to_bytes(4, "little")
        disk[446 + 16 * index : 462 + 16 * index] = entry
        disk[start * sector : start * sector + len(data)] = data
    disk[510:512] = b"\x55\xaa"
    path.write_bytes(disk)


def test_unallocated_carving_skips_unreadable_volumes_instead_of_failing(services, tmp_path):
    payload = png_bytes()
    fat = tmp_path / "fat.img"
    write_content_image(fat, {"allocated.txt": b"kept"})
    volume = bytearray(fat.read_bytes())
    volume[1200000 : 1200000 + len(payload)] = payload
    path = tmp_path / "two-volumes.img"
    _mbr_disk(path, [(0x01, bytes(volume)), (0x83, bytes(1024 * 1024))])
    case = services.cases.create_case(name="carving volumes")
    evidence = services.evidence.register_evidence(case_id=case.case_id, source_path=path)

    result = CarvingService(services.images).carve(
        evidence_id=evidence.evidence_id, output_root=tmp_path / "out", formats=("PNG",)
    )

    assert [Path(c["output_path"]).read_bytes() for c in result["candidates"]] == [payload]
    assert any(w.startswith("VOLUME_SKIPPED") for w in result["warnings"])
    assert result["coverage_complete"] is False


def test_unallocated_carving_without_any_readable_filesystem_is_a_capability_error(
    services, tmp_path
):
    # A loose file registered as an image: no partition table, no filesystem.
    path = tmp_path / "loose.png"
    path.write_bytes(png_bytes() + bytes(4096))
    case = services.cases.create_case(name="carving blank")
    evidence = services.evidence.register_evidence(case_id=case.case_id, source_path=path)

    with pytest.raises(UnsupportedCapabilityError):
        CarvingService(services.images).carve(
            evidence_id=evidence.evidence_id, output_root=tmp_path / "out", formats=("PNG",)
        )


def test_carving_header_crosses_chunk_boundary_and_resume_is_explicit(services, tmp_path):
    payload = png_bytes()
    path = tmp_path / "boundary.img"
    data = bytearray(2 * 1024 * 1024)
    offset = 1024 * 1024 - 4
    data[offset : offset + len(payload)] = payload
    path.write_bytes(data)
    case = services.cases.create_case(name="carving raw")
    evidence = services.evidence.register_evidence(case_id=case.case_id, source_path=path)
    carver = CarvingService(services.images)
    first = carver.carve(
        evidence_id=evidence.evidence_id,
        output_root=tmp_path / "one",
        scope="IMAGE",
        formats=("PNG",),
        max_scan_bytes=1024 * 1024,
    )
    assert first["partial"] and first["next_offset"] <= offset
    resumed = carver.carve(
        evidence_id=evidence.evidence_id,
        output_root=tmp_path / "two",
        scope="IMAGE",
        formats=("PNG",),
        start_offset=first["next_offset"],
    )
    assert [c["offset"] for c in resumed["candidates"]] == [offset]


def test_exfat_timestamps_use_the_recorded_utc_offset_not_the_analyst_timezone(
    services, tmp_path, monkeypatch
):
    import time

    # The Sleuth Kit reads exFAT local times in the host timezone and ignores the
    # offset byte, so the same evidence gave different UTC times on different PCs.
    monkeypatch.setenv("TZ", "America/New_York")
    time.tzset()
    try:
        _, _, nodes = index_image(services, fixture_image(tmp_path, "exfat-times.img"))
    finally:
        monkeypatch.undo()
        time.tzset()
    assert "when.txt" in nodes, sorted(nodes)
    node = nodes["when.txt"]

    from datetime import UTC, datetime

    true_time = datetime(2024, 1, 1, 18, 4, 6, tzinfo=UTC)
    assert node.utc_timestamps["created"] == true_time.replace(microsecond=500000)
    assert node.utc_timestamps["modified"] == true_time
    assert node.utc_timestamps["accessed"] == true_time
    assert node.timestamp_sources["created"] == "EXFAT_DIRECTORY_ENTRY"
    assert nodes["volume-0"].fs_metadata["filesystem_type"] == "EXFAT"


def test_tsk_filesystem_type_names_follow_tsk_constants():
    from types import SimpleNamespace

    from apex_forensic.adapters.filesystem.pytsk import PyTskFileSystemProvider

    name = PyTskFileSystemProvider._fs_type_name
    expected = {10: "EXFAT", 128: "EXT2", 256: "EXT3", 8192: "EXT4", 4096: "HFS", 16: "FFS1"}
    for code, label in expected.items():
        assert name(SimpleNamespace(info=SimpleNamespace(ftype=code))) == label
