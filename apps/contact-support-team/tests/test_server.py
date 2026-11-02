import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pymongo.errors import PyMongoError

# Add the application directory to Python's import path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
@pytest.fixture
def client():
    server.app.config["TESTING"] = True

    with server.app.test_client() as test_client:
        yield test_client


def test_get_contact_message(client):
    response = client.get("/api/contact-message")

    assert response.status_code == 200
    assert "message" in response.get_json()


def test_liveness(client):
    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.get_json() == {"status": "alive"}


def test_readiness_when_mongodb_is_available(client, monkeypatch):
    mock_client = MagicMock()
    monkeypatch.setattr(server, "client", mock_client)

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.get_json() == {"status": "ready"}
    mock_client.admin.command.assert_called_once_with("ping")


def test_readiness_when_mongodb_fails(client, monkeypatch):
    mock_client = MagicMock()
    mock_client.admin.command.side_effect = PyMongoError("Database unavailable")

    monkeypatch.setattr(server, "client", mock_client)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.get_json() == {"status": "not_ready"}


def test_valid_contact_submission(client, monkeypatch):
    mock_collection = MagicMock()
    mock_collection.insert_one.return_value = SimpleNamespace(
        inserted_id="test-submission-id"
    )

    monkeypatch.setattr(server, "contact_messages", mock_collection)

    payload = {
        "name": "Amith",
        "email": "amith@example.com",
        "message": "I need help with my order."
    }

    response = client.post("/api/contact-submit", json=payload)

    assert response.status_code == 201
    assert response.get_json()["status"] == "success"
    assert response.get_json()["submission_id"] == "test-submission-id"

    # Verify that cleaned input was stored in MongoDB.
    stored_document = mock_collection.insert_one.call_args.args[0]

    assert stored_document["name"] == "Amith"
    assert stored_document["email"] == "amith@example.com"
    assert stored_document["message"] == "I need help with my order."
    assert stored_document["timestamp"].tzinfo is not None


def test_submission_without_json_content_type(client):
    response = client.post(
        "/api/contact-submit",
        data="name=Amith"
    )

    assert response.status_code == 400


def test_submission_with_invalid_json(client):
    response = client.post(
        "/api/contact-submit",
        data="{invalid-json",
        content_type="application/json"
    )

    assert response.status_code == 400


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"name": "Amith", "email": "amith@example.com"},
        {"name": "Amith", "message": "Help"},
        {"email": "amith@example.com", "message": "Help"},
    ],
)
def test_submission_with_missing_fields(client, payload):
    response = client.post("/api/contact-submit", json=payload)

    assert response.status_code == 400


def test_submission_with_non_string_fields(client):
    payload = {
        "name": 123,
        "email": "amith@example.com",
        "message": "Help"
    }

    response = client.post("/api/contact-submit", json=payload)

    assert response.status_code == 400


def test_submission_with_empty_fields(client):
    payload = {
        "name": "   ",
        "email": "amith@example.com",
        "message": "Help"
    }

    response = client.post("/api/contact-submit", json=payload)

    assert response.status_code == 400


@pytest.mark.parametrize(
    "field,value",
    [
        ("name", "A" * 101),
        ("email", "a" * 255),
        ("message", "M" * 5001),
    ],
)
def test_submission_with_excessive_field_length(client, field, value):
    payload = {
        "name": "Amith",
        "email": "amith@example.com",
        "message": "Help"
    }

    payload[field] = value

    response = client.post("/api/contact-submit", json=payload)

    assert response.status_code == 400


def test_submission_when_mongodb_insert_fails(client, monkeypatch):
    mock_collection = MagicMock()
    mock_collection.insert_one.side_effect = PyMongoError(
        "Database write failed"
    )

    monkeypatch.setattr(server, "contact_messages", mock_collection)

    payload = {
        "name": "Amith",
        "email": "amith@example.com",
        "message": "I need help."
    }

    response = client.post("/api/contact-submit", json=payload)

    assert response.status_code == 503
    assert response.get_json()["status"] == "error"
