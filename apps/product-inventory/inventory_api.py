import os
import time
import logging

import psycopg2
from psycopg2 import OperationalError
from psycopg2.pool import ThreadedConnectionPool
from flask import Flask, jsonify
from flask_cors import CORS


# --------------------------------------------------
# 1. Application configuration
# --------------------------------------------------

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PORT = int(os.environ.get("PORT", "3002"))

POSTGRES_HOST = os.environ["POSTGRES_HOST"]
POSTGRES_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
POSTGRES_DB = os.environ["POSTGRES_DB"]
POSTGRES_USER = os.environ["POSTGRES_USER"]
POSTGRES_PASSWORD = os.environ["POSTGRES_PASSWORD"]

db_pool = None


# --------------------------------------------------
# 2. Database connection pool
# --------------------------------------------------

def initialize_database():
    """
    Create a PostgreSQL connection pool.

    IMPORTANT:
    Do not create tables or insert initial data here.
    Each Gunicorn worker calls this function independently.
    """
    global db_pool

    max_retries = 5
    retry_delay = 5

    for attempt in range(1, max_retries + 1):
        try:
            db_pool = ThreadedConnectionPool(
                minconn=1,
                maxconn=10,
                host=POSTGRES_HOST,
                port=POSTGRES_PORT,
                database=POSTGRES_DB,
                user=POSTGRES_USER,
                password=POSTGRES_PASSWORD,
                connect_timeout=5,
            )

            logger.info("Connected to PostgreSQL")
            return

        except OperationalError:
            logger.exception(
                "PostgreSQL connection attempt %s failed",
                attempt,
            )

            if db_pool is not None:
                db_pool.closeall()
                db_pool = None

            if attempt == max_retries:
                raise

            time.sleep(retry_delay)


def get_connection():
    """
    Get a PostgreSQL connection from the pool.
    """
    if db_pool is None:
        raise OperationalError("Database connection pool is unavailable")

    return db_pool.getconn()


def release_connection(conn, broken=False):
    """
    Return the PostgreSQL connection to the pool.
    """
    if db_pool is not None:
        db_pool.putconn(conn, close=broken)


# --------------------------------------------------
# 3. Database schema and initial data
# --------------------------------------------------

def create_inventory_table():
    """
    Create the inventory table if it does not exist.
    Called only by init_db.py.
    """
    conn = get_connection()

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS inventory (
                    product_id INT PRIMARY KEY,
                    quantity INT NOT NULL CHECK (quantity >= 0)
                )
                """
            )

        conn.commit()
        logger.info("Inventory table initialized")

    except Exception:
        conn.rollback()
        raise

    finally:
        release_connection(conn)


def insert_initial_data():
    """
    Insert initial inventory records without overwriting
    existing inventory quantities.
    """
    initial_data = [
        (1, 100),
        (2, 50),
        (3, 75),
        (4, 120),
        (5, 30),
        (6, 60),
        (7, 40),
        (8, 90),
        (9, 80),
        (10, 70),
        (11, 20),
        (12, 55),
    ]

    conn = get_connection()

    try:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO inventory (product_id, quantity)
                VALUES (%s, %s)
                ON CONFLICT (product_id) DO NOTHING
                """,
                initial_data,
            )

        conn.commit()
        logger.info("Initial inventory data checked")

    except Exception:
        conn.rollback()
        raise

    finally:
        release_connection(conn)


# --------------------------------------------------
# 4. Health endpoints for Kubernetes
# --------------------------------------------------

@app.get("/health/live")
def liveness():
    return jsonify({
        "status": "alive",
        "service": "product-inventory",
    }), 200


@app.get("/health/ready")
def readiness():
    if db_pool is None:
        return jsonify({"status": "not ready"}), 503

    conn = None

    try:
        conn = get_connection()

        with conn.cursor() as cur:
            cur.execute("SELECT 1")

        conn.commit()

        return jsonify({
            "status": "ready",
            "database": "connected",
        }), 200

    except Exception:
        if conn is not None:
            conn.rollback()

        logger.exception("Readiness check failed")

        return jsonify({
            "status": "not ready",
            "database": "unavailable",
        }), 503

    finally:
        if conn is not None:
            release_connection(conn)


# --------------------------------------------------
# 5. Get inventory for all products
# --------------------------------------------------

@app.get("/api/inventory")
def get_inventory():
    conn = None

    try:
        conn = get_connection()

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT product_id, quantity
                FROM inventory
                ORDER BY product_id
                """
            )

            rows = cur.fetchall()

        conn.commit()

        inventory = [
            {"id": row[0], "quantity": row[1]}
            for row in rows
        ]

        return jsonify(inventory), 200

    except Exception:
        if conn is not None:
            conn.rollback()

        logger.exception("Failed to retrieve inventory")

        return jsonify({
            "error": "Unable to retrieve inventory",
        }), 503

    finally:
        if conn is not None:
            release_connection(conn)


# --------------------------------------------------
# 6. Get inventory for one product
# --------------------------------------------------

@app.get("/api/inventory/<int:product_id>")
def get_product_inventory(product_id):
    conn = None

    try:
        conn = get_connection()

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT product_id, quantity
                FROM inventory
                WHERE product_id = %s
                """,
                (product_id,),
            )

            row = cur.fetchone()

        conn.commit()

        if row is None:
            return jsonify({"error": "Product not found"}), 404

        return jsonify({
            "id": row[0],
            "quantity": row[1],
        }), 200

    except Exception:
        if conn is not None:
            conn.rollback()

        logger.exception(
            "Failed to retrieve inventory for product %s",
            product_id,
        )

        return jsonify({
            "error": "Unable to retrieve product inventory",
        }), 503

    finally:
        if conn is not None:
            release_connection(conn)


# --------------------------------------------------
# 7. Reduce inventory when an order is placed
# --------------------------------------------------

@app.post("/api/order/<int:product_id>")
def order_product(product_id):
    conn = None

    try:
        conn = get_connection()

        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE inventory
                SET quantity = quantity - 1
                WHERE product_id = %s
                  AND quantity > 0
                RETURNING product_id, quantity
                """,
                (product_id,),
            )

            row = cur.fetchone()

            if row is not None:
                conn.commit()

                return jsonify({
                    "id": row[0],
                    "quantity": row[1],
                }), 200

            cur.execute(
                """
                SELECT 1
                FROM inventory
                WHERE product_id = %s
                """,
                (product_id,),
            )

            product_exists = cur.fetchone() is not None

        conn.commit()

        if not product_exists:
            return jsonify({"error": "Product not found"}), 404

        return jsonify({
            "error": "Product is out of stock",
        }), 400

    except Exception:
        if conn is not None:
            conn.rollback()

        logger.exception(
            "Failed to process order for product %s",
            product_id,
        )

        return jsonify({
            "error": "Unable to process order",
        }), 503

    finally:
        if conn is not None:
            release_connection(conn)


# --------------------------------------------------
# 8. Initialize connection pool for Gunicorn workers
# --------------------------------------------------

# Gunicorn imports this module separately in each worker.
# Only initialize the connection pool here.
# Database table creation and seeding happen in init_db.py.

initialize_database()
