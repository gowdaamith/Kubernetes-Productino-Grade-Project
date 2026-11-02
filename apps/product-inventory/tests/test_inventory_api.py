import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Dummy environment variables for the test process only.
os.environ["POSTGRES_HOST"] = "localhost"
os.environ["POSTGRES_PORT"] = "5432"
os.environ["POSTGRES_DB"] = "test_inventory"
os.environ["POSTGRES_USER"] = "test_user"
os.environ["POSTGRES_PASSWORD"] = "test_password"

# Make the application directory importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Prevent the application's automatic database initialization
# from creating a real PostgreSQL connection during import.
with patch("psycopg2.pool.ThreadedConnectionPool"):
    import inventory_api


@pytest.fixture
def client():
    # Disable the pool by default. Individual tests enable it
    # when testing database-dependent endpoints.
    inventory_api.db_pool = None

    return inventory_api.app.test_client()


@pytest.fixture
def mock_database(monkeypatch):
    connection = MagicMock()
    cursor = MagicMock()

    connection.cursor.return_value.__enter__.return_value = cursor

    monkeypatch.setattr(
        inventory_api,
        "get_connection",
        lambda: connection
    )

    release_mock = MagicMock()

    monkeypatch.setattr(
        inventory_api,
        "release_connection",
        release_mock
    )

    inventory_api.db_pool = MagicMock()

    return connection, cursor, release_mock


# --------------------------------------------------
# 1. Health endpoint tests
# --------------------------------------------------

def test_liveness_returns_success(client):
    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.get_json() == {
        "status": "alive",
        "service": "product-inventory"
    }


def test_readiness_returns_503_when_pool_unavailable(client):
    inventory_api.db_pool = None

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.get_json() == {
        "status": "not ready"
    }


def test_readiness_returns_success_when_database_connected(
    client,
    mock_database
):
    connection, cursor, release_mock = mock_database

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.get_json() == {
        "status": "ready",
        "database": "connected"
    }

    cursor.execute.assert_called_once_with("SELECT 1")
    connection.commit.assert_called_once()
    release_mock.assert_called_once_with(connection)


def test_readiness_returns_503_when_database_query_fails(
    client,
    mock_database
):
    connection, cursor, release_mock = mock_database

    cursor.execute.side_effect = RuntimeError(
        "Database query failed"
    )

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.get_json()["status"] == "not ready"

    connection.rollback.assert_called_once()
    release_mock.assert_called_once_with(connection)


# --------------------------------------------------
# 2. Get all inventory tests
# --------------------------------------------------

def test_get_all_inventory_success(client, mock_database):
    connection, cursor, release_mock = mock_database

    cursor.fetchall.return_value = [
        (1, 100),
        (2, 50),
        (3, 75)
    ]

    response = client.get("/api/inventory")

    assert response.status_code == 200
    assert response.get_json() == [
        {"id": 1, "quantity": 100},
        {"id": 2, "quantity": 50},
        {"id": 3, "quantity": 75}
    ]

    connection.commit.assert_called_once()
    release_mock.assert_called_once_with(connection)


def test_get_all_inventory_database_failure(client, mock_database):
    connection, cursor, release_mock = mock_database

    cursor.execute.side_effect = RuntimeError(
        "Database unavailable"
    )

    response = client.get("/api/inventory")

    assert response.status_code == 503
    assert response.get_json() == {
        "error": "Unable to retrieve inventory"
    }

    connection.rollback.assert_called_once()
    release_mock.assert_called_once_with(connection)


# --------------------------------------------------
# 3. Get individual product inventory tests
# --------------------------------------------------

def test_get_product_inventory_success(client, mock_database):
    connection, cursor, release_mock = mock_database

    cursor.fetchone.return_value = (1, 100)

    response = client.get("/api/inventory/1")

    assert response.status_code == 200
    assert response.get_json() == {
        "id": 1,
        "quantity": 100
    }

    connection.commit.assert_called_once()
    release_mock.assert_called_once_with(connection)


def test_get_product_inventory_not_found(client, mock_database):
    connection, cursor, release_mock = mock_database

    cursor.fetchone.return_value = None

    response = client.get("/api/inventory/999")

    assert response.status_code == 404
    assert response.get_json() == {
        "error": "Product not found"
    }

    release_mock.assert_called_once_with(connection)


def test_get_product_inventory_database_failure(
    client,
    mock_database
):
    connection, cursor, release_mock = mock_database

    cursor.execute.side_effect = RuntimeError(
        "Database unavailable"
    )

    response = client.get("/api/inventory/1")

    assert response.status_code == 503
    assert response.get_json() == {
        "error": "Unable to retrieve product inventory"
    }

    connection.rollback.assert_called_once()
    release_mock.assert_called_once_with(connection)


# --------------------------------------------------
# 4. Order processing tests
# --------------------------------------------------

def test_order_successfully_reduces_inventory(
    client,
    mock_database
):
    connection, cursor, release_mock = mock_database

    cursor.fetchone.return_value = (1, 99)

    response = client.post("/api/order/1")

    assert response.status_code == 200
    assert response.get_json() == {
        "id": 1,
        "quantity": 99
    }

    # Verify that the stock update is committed.
    connection.commit.assert_called_once()

    # Verify that the connection is returned.
    release_mock.assert_called_once_with(connection)

    # Verify the SQL prevents negative stock.
    update_query = cursor.execute.call_args.args[0]

    assert "quantity > 0" in update_query
    assert "RETURNING product_id, quantity" in update_query


def test_order_returns_400_when_product_is_out_of_stock(
    client,
    mock_database
):
    connection, cursor, release_mock = mock_database

    # First fetch: UPDATE returns no row.
    # Second fetch: SELECT confirms product exists.
    cursor.fetchone.side_effect = [
        None,
        (1,)
    ]

    response = client.post("/api/order/1")

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "Product is out of stock"
    }

    assert cursor.fetchone.call_count == 2

    connection.commit.assert_called_once()
    release_mock.assert_called_once_with(connection)


def test_order_returns_404_when_product_does_not_exist(
    client,
    mock_database
):
    connection, cursor, release_mock = mock_database

    # Neither UPDATE nor SELECT finds the product.
    cursor.fetchone.side_effect = [
        None,
        None
    ]

    response = client.post("/api/order/999")

    assert response.status_code == 404
    assert response.get_json() == {
        "error": "Product not found"
    }

    connection.commit.assert_called_once()
    release_mock.assert_called_once_with(connection)


def test_order_database_failure_returns_503(
    client,
    mock_database
):
    connection, cursor, release_mock = mock_database

    cursor.execute.side_effect = RuntimeError(
        "Database unavailable"
    )

    response = client.post("/api/order/1")

    assert response.status_code == 503
    assert response.get_json() == {
        "error": "Unable to process order"
    }

    connection.rollback.assert_called_once()
    release_mock.assert_called_once_with(connection)
