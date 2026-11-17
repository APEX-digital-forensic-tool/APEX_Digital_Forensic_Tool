import pytest
from fastapi.testclient import TestClient

import apex_desktop.app as desktop_app
from apex_desktop.app import create_app

TOKEN = "a" * 48


@pytest.fixture
def client(tmp_path):
    with TestClient(
        create_app(tmp_path / "data", TOKEN),
        base_url="http://127.0.0.1",
        headers={"Authorization": f"Bearer {TOKEN}"},
        raise_server_exceptions=False,
    ) as client:
        yield client


@pytest.mark.parametrize("error", [ValueError("boom"), TypeError("unexpected keyword")])
def test_service_internal_errors_are_not_reported_as_input_errors(client, monkeypatch, error):
    def broken(*args, **kwargs):
        raise error

    monkeypatch.setattr(desktop_app, "invoke", broken)
    response = client.post("/v1/operations/cases.list", json={})
    assert response.status_code == 500, response.text
    assert response.json()["error"]["code"] == "DESKTOP_OPERATION_FAILED"


def test_request_body_that_fails_input_validation_is_still_422(client):
    assert client.post("/v1/operations/cases.create", json={"name": ""}).status_code == 422
    assert client.post("/v1/operations/cases.create", content="not json").status_code == 422


@pytest.mark.parametrize("timezone", ["Asia/Seoul/", "America", "../etc"])
def test_malformed_timezone_is_a_409_naming_the_field(client, timezone):
    response = client.post("/v1/operations/cases.create", json={"name": "tz", "timezone": timezone})
    assert response.status_code == 409, response.text
    assert response.json()["error"]["target"] == "timezone"


@pytest.mark.parametrize("failure", [PermissionError, IsADirectoryError])
def test_windows_timezone_directory_errors_are_input_errors_but_valid_zone_io_is_not(
    client, monkeypatch, failure
):
    from apex_forensic.application.services import case_manager

    def unavailable(_key):
        raise failure("Synthetic timezone resource error")

    monkeypatch.setattr(case_manager, "ZoneInfo", unavailable)
    invalid = client.post(
        "/v1/operations/cases.create", json={"name": "bad", "timezone": "America"}
    )
    assert invalid.status_code == 409
    assert invalid.json()["error"]["target"] == "timezone"
    valid = client.post("/v1/operations/cases.create", json={"name": "good", "timezone": "UTC"})
    assert valid.status_code == 500
    assert valid.json()["error"]["code"] == "DESKTOP_OPERATION_FAILED"
