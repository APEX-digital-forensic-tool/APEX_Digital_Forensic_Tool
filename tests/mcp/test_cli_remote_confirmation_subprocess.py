"""A local apex-mcp checks grants through a running backend, with no database access.

Two real processes: the backend under uvicorn (login, grant API, JWKS) and apex-mcp
started with --http-confirmation-url. The analyst logs in, approves one raw read of
real evidence bytes, and the MCP server lets that read through exactly once.
"""

from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import httpx2
from cryptography.hazmat.primitives import serialization
from mcp.client import Client
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from apex_backend.auth.keys import load_private_key
from apex_backend.auth.service import hash_password
from apex_backend.database import Base
from apex_backend.models import CaseTenancy, ConfirmationGrantRow, User
from apex_forensic.config import build_services
from apex_forensic.domain.enums import AnalysisProfileType
from apex_mcp.telemetry import request_fingerprint

EVIDENCE_BYTES = b"APEX-REMOTE-GRANT" * 32
TENANT = "tenant-e2e"
EMAIL = "analyst@e2e.local"
PASSWORD = "correct horse battery staple"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_until_up(url: str, proc: subprocess.Popen[bytes], timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"{url} exited early: {proc.stderr.read().decode()[-2000:]}")
        try:
            httpx.get(url, timeout=1.0)
            return
        except httpx.TransportError:
            time.sleep(0.3)
    raise TimeoutError(f"{url} did not come up within {timeout}s")


def _stop(proc: subprocess.Popen[bytes]) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def _seed_engine(tmp_path: Path) -> dict[str, Any]:
    evidence_root = tmp_path / "evidence"
    evidence_root.mkdir()
    (evidence_root / "evidence.bin").write_bytes(EVIDENCE_BYTES)
    database_path = tmp_path / "forensics.db"
    services = build_services(database_path)
    try:
        case = services.cases.create_case(name="Remote grant E2E")
        evidence = services.evidence.register_evidence(
            case_id=case.case_id, source_path=evidence_root
        )
        services.fs.index_evidence(
            case_id=case.case_id,
            evidence_id=evidence.evidence_id,
            profile_type=AnalysisProfileType.FULL_ANALYSIS,
        )
        node = next(
            item
            for item in services.fs.list_nodes(
                evidence_id=evidence.evidence_id, all_nodes=True
            ).items
            if item.node_type.value == "FILE"
        )
        return {"database_path": database_path, "case_id": case.case_id, "node_id": node.node_id}
    finally:
        services.close()


def _seed_backend(db_path: Path, case_id: str) -> None:
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as db:
        actor_id = str(uuid.uuid4())
        db.add(User(
            id=actor_id,
            username="analyst",
            email=EMAIL,
            hashed_password=hash_password(PASSWORD),
            tenant_id=TENANT,
            created_at=datetime.now(UTC),
            is_active=True,
        ))
        # Raw reads need apex:raw, which only ADMIN carries.
        db.add(CaseTenancy(
            actor_id=actor_id, case_id=case_id, role="ADMIN", granted_at=datetime.now(UTC)
        ))
        db.commit()
    engine.dispose()


def _uses_count(db_path: Path) -> list[int]:
    engine = create_engine(f"sqlite:///{db_path}")
    with sessionmaker(engine)() as db:
        counts = [row.uses_count for row in db.query(ConfirmationGrantRow).all()]
    engine.dispose()
    return counts


def _code(result: Any) -> str:
    content = result.structured_content or {}
    errors = content.get("errors") or [{}]
    return str(errors[0].get("code") or content.get("status"))


def test_local_mcp_uses_backend_grant_api_once(
    project_root: Path, tmp_path: Path, cli_env: dict[str, str]
) -> None:
    seeded = _seed_engine(tmp_path)
    backend_db = tmp_path / "backend.db"
    _seed_backend(backend_db, seeded["case_id"])

    backend_port, mcp_port = _free_port(), _free_port()
    backend_url = f"http://127.0.0.1:{backend_port}"
    mcp_url = f"http://127.0.0.1:{mcp_port}"
    private_key, kid = load_private_key()
    pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    env = {
        **cli_env,
        "APEX_RS256_PRIVATE_KEY_PEM": pem,
        "APEX_RS256_KID": kid,
        "APEX_ISSUER": backend_url,
        "APEX_MCP_RESOURCE": f"{mcp_url}/mcp",
        "APEX_DATABASE_URL": f"sqlite+aiosqlite:///{backend_db}",
    }
    for leaked in ("APEX_CONFIRMATION_DB_URL", "APEX_JWKS_URI", "APEX_LLM_UPSTREAM_API_KEY"):
        env.pop(leaked, None)

    backend = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import os, uvicorn; from apex_backend.app import create_app; "
            "uvicorn.run(create_app(os.environ['APEX_DATABASE_URL'], llm_upstream=None), "
            f"host='127.0.0.1', port={backend_port}, log_level='warning')",
        ],
        env=env,
        cwd=str(project_root),
        stderr=subprocess.PIPE,
    )
    mcp = None
    try:
        _wait_until_up(f"{backend_url}/.well-known/jwks.json", backend)
        mcp = subprocess.Popen(
            [
                sys.executable, "-m", "apex_mcp",
                "--database", str(seeded["database_path"]),
                "--schema-dir", str(project_root / "schemas" / "v1"),
                "--transport", "http",
                "--http-port", str(mcp_port),
                "--http-jwks-uri", f"{backend_url}/.well-known/jwks.json",
                "--http-confirmation-url", backend_url,
                "--http-issuer-url", backend_url,
                "--http-resource-url", f"{mcp_url}/mcp",
            ],
            env={k: v for k, v in env.items() if k != "APEX_DATABASE_URL"},
            cwd=str(project_root),
            stderr=subprocess.PIPE,
        )
        _wait_until_up(f"{mcp_url}/mcp", mcp)

        login = httpx.post(
            f"{backend_url}/auth/login",
            json={"email": EMAIL, "password": PASSWORD, "tenant_id": TENANT},
            timeout=10.0,
        )
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]

        arguments: dict[str, object] = {
            "case_id": seeded["case_id"],
            "resource_type": "FILE_SYSTEM_NODE",
            "resource_id": seeded["node_id"],
            "offset": 0,
            "length": 4096,
        }

        async def run() -> tuple[Any, Any, Any]:
            async with httpx2.AsyncClient(
                headers={"Authorization": f"Bearer {token}", "Origin": mcp_url},
                timeout=30.0,
            ) as http_client:
                transport = streamable_http_client(f"{mcp_url}/mcp", http_client=http_client)
                async with Client(transport, mode="2026-07-28") as client:
                    before = await client.call_tool("apex.view.raw_read", arguments)
                    grant = httpx.post(
                        f"{backend_url}/confirmations",
                        json={
                            "case_id": seeded["case_id"],
                            "tool_name": "apex.view.raw_read",
                            "request_fingerprint": request_fingerprint(arguments),
                            "target_ids": [seeded["node_id"]],
                        },
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=10.0,
                    )
                    assert grant.status_code == 201, grant.text
                    approved = await client.call_tool("apex.view.raw_read", arguments)
                    reused = await client.call_tool("apex.view.raw_read", arguments)
                    return before, approved, reused

        before, approved, reused = asyncio.run(run())

        assert _code(before) == "HUMAN_CONFIRMATION_REQUIRED"
        assert approved.is_error is False, approved.structured_content
        raw = approved.structured_content["data"]
        assert raw["returned_length"] == len(EVIDENCE_BYTES)
        preview = bytes.fromhex(raw["hex_preview"])
        assert preview and EVIDENCE_BYTES.startswith(preview)
        assert _code(reused) == "HUMAN_CONFIRMATION_REQUIRED"
        assert _uses_count(backend_db) == [1]
    finally:
        if mcp is not None:
            _stop(mcp)
        _stop(backend)
        if os.environ.get("APEX_E2E_DEBUG"):
            print(backend.stderr.read().decode()[-3000:])
