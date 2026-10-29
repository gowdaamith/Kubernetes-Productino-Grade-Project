"""
Database initialization script.

Run this script before starting the application.
In Kubernetes, execute it using a Job.

This script:
1. Connects to PostgreSQL.
2. Creates the inventory table if needed.
3. Inserts missing initial inventory records.
4. Preserves existing inventory quantities.
"""

import logging

import inventory_api


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    logger.info("Starting database initialization")

    # inventory_api initializes its connection pool
    # when the module is imported.

    inventory_api.create_inventory_table()

    inventory_api.insert_initial_data()

    logger.info("Database initialization completed successfully")


if __name__ == "__main__":
    main()
