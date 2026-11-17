import pytest
from fastapi.testclient import TestClient

from apex_desktop.app import create_app

TOKEN = "a" * 48


@pytest.fixture
def client(tmp_path):
    with TestClient(
        create_app(tmp_path / "data", TOKEN),
        base_url="http://127.0.0.1",
        headers={"Authorization": f"Bearer {TOKEN}"},
    ) as client:
        yield client


@pytest.fixture
def case_id(client):
    response = client.post("/v1/operations/cases.create", json={"name": "limit"})
    return response.json()["data"]["id"]


@pytest.mark.parametrize(("limit", "status"), [(500, 409), (501, 422), (1000, 422)])
def test_files_list_rejects_over_service_cap_at_the_input_model(client, case_id, limit, status):
    response = client.post(
        "/v1/operations/files.list",
        json={"case_id": case_id, "evidence_id": "missing", "limit": limit},
    )
    assert response.status_code == status, response.text
    if status == 422:
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_other_lists_keep_the_gateway_cap_of_1000(client, case_id):
    response = client.post(
        "/v1/operations/artifacts.list", json={"case_id": case_id, "limit": 1000}
    )
    assert response.status_code != 422, response.text
