import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Supply dummy credentials before importing worker.py.
os.environ["RABBITMQ_USER"] = "test-user"
os.environ["RABBITMQ_PASSWORD"] = "test-password"

# Add the application directory to Python's import path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import worker


@pytest.fixture
def mock_channel():
    return MagicMock()


@pytest.fixture(autouse=True)
def disable_processing_delay(monkeypatch):
    # Avoid waiting five seconds during every test.
    monkeypatch.setattr(worker.time, "sleep", lambda _: None)


def test_valid_message_is_acknowledged(mock_channel):
    method = MagicMock()
    method.delivery_tag = 101

    body = b'{"event_id": "order-101", "status": "COMPLETED"}'

    worker.process_message(
        mock_channel,
        method,
        None,
        body
    )

    mock_channel.basic_ack.assert_called_once_with(
        delivery_tag=101
    )

    mock_channel.basic_nack.assert_not_called()


def test_invalid_json_is_requeued(mock_channel):
    method = MagicMock()
    method.delivery_tag = 102

    body = b'{invalid-json'

    worker.process_message(
        mock_channel,
        method,
        None,
        body
    )

    mock_channel.basic_nack.assert_called_once_with(
        delivery_tag=102,
        requeue=True
    )

    mock_channel.basic_ack.assert_not_called()


def test_processing_exception_requeues_message(
    mock_channel,
    monkeypatch
):
    method = MagicMock()
    method.delivery_tag = 103

    def simulate_processing_failure(_):
        raise RuntimeError("Processing failed")

    monkeypatch.setattr(
        worker.time,
        "sleep",
        simulate_processing_failure
    )

    body = b'{"event_id": "order-103"}'

    worker.process_message(
        mock_channel,
        method,
        None,
        body
    )

    mock_channel.basic_nack.assert_called_once_with(
        delivery_tag=103,
        requeue=True
    )

    mock_channel.basic_ack.assert_not_called()


def test_acknowledgement_failure_attempts_requeue(
    mock_channel
):
    method = MagicMock()
    method.delivery_tag = 104

    mock_channel.basic_ack.side_effect = RuntimeError(
        "Acknowledgement failed"
    )

    body = b'{"event_id": "order-104"}'

    worker.process_message(
        mock_channel,
        method,
        None,
        body
    )

    mock_channel.basic_nack.assert_called_once_with(
        delivery_tag=104,
        requeue=True
    )


def test_requeue_failure_does_not_crash_worker(
    mock_channel
):
    method = MagicMock()
    method.delivery_tag = 105

    mock_channel.basic_nack.side_effect = RuntimeError(
        "RabbitMQ connection lost"
    )

    body = b'{invalid-json'

    # The worker logs the failure but catches the exception.
    worker.process_message(
        mock_channel,
        method,
        None,
        body
    )

    mock_channel.basic_nack.assert_called_once_with(
        delivery_tag=105,
        requeue=True
    )
