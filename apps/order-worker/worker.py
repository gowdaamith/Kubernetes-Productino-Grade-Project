import os
import time
import json
import signal
import logging

import pika


# --------------------------------------------------
# 1. Configure logging
# --------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s"
)

logger = logging.getLogger("order-worker")


# --------------------------------------------------
# 2. Read configuration from environment variables
# --------------------------------------------------

RABBITMQ_HOST = os.getenv(
    "RABBITMQ_HOST",
    "rabbitmq.rabbitmq.svc.cluster.local"
)

RABBITMQ_PORT = int(
    os.getenv("RABBITMQ_PORT", "5672")
)

RABBITMQ_USER = os.environ["RABBITMQ_USER"]

RABBITMQ_PASSWORD = os.environ["RABBITMQ_PASSWORD"]

RABBITMQ_QUEUE = os.getenv(
    "RABBITMQ_QUEUE",
    "order-events"
)

PROCESSING_SECONDS = float(
    os.getenv("PROCESSING_SECONDS", "5")
)


# --------------------------------------------------
# 3. Track application shutdown
# --------------------------------------------------

shutdown_requested = False

connection = None
channel = None


def handle_shutdown(signum, frame):
    """
    Handle SIGTERM from Kubernetes and SIGINT from Ctrl+C.
    """

    global shutdown_requested

    if shutdown_requested:
        return

    shutdown_requested = True

    logger.info(
        "Shutdown signal received: %s",
        signum
    )

    # Schedule shutdown work on Pika's connection thread.
    if connection is not None and connection.is_open:
        try:
            connection.add_callback_threadsafe(
                stop_consuming
            )
        except Exception:
            logger.exception(
                "Could not schedule graceful shutdown"
            )


def stop_consuming():
    """
    Stop receiving new messages through the consumer.
    """

    if channel is not None and channel.is_open:
        logger.info("Stopping message consumption")

        channel.stop_consuming()


# --------------------------------------------------
# 4. Process a RabbitMQ message
# --------------------------------------------------

def process_message(ch, method, properties, body):
    """
    Process one message and acknowledge it on success.
    """

    try:
        message = json.loads(body)

        logger.info(
            "Received order event: %s",
            message
        )

        # Simulate the order-processing workload.
        time.sleep(PROCESSING_SECONDS)

        logger.info(
            "Successfully processed order event"
        )

        # Acknowledge only after successful processing.
        ch.basic_ack(
            delivery_tag=method.delivery_tag
        )

    except Exception:
        logger.exception(
            "Failed to process message"
        )

        # Temporary behavior retained for this learning stage.
        # A later improvement will add bounded retries and a
        # dead-letter queue to prevent infinite retry loops.
        try:
            ch.basic_nack(
                delivery_tag=method.delivery_tag,
                requeue=True
            )
        except Exception:
            logger.exception(
                "Could not reject message; "
                "RabbitMQ may redeliver it after disconnection"
            )


# --------------------------------------------------
# 5. Connect to RabbitMQ and consume messages
# --------------------------------------------------

def main():
    global connection, channel

    # Register Kubernetes and terminal shutdown handlers.
    signal.signal(
        signal.SIGTERM,
        handle_shutdown
    )

    signal.signal(
        signal.SIGINT,
        handle_shutdown
    )

    credentials = pika.PlainCredentials(
        RABBITMQ_USER,
        RABBITMQ_PASSWORD
    )

    parameters = pika.ConnectionParameters(
        host=RABBITMQ_HOST,
        port=RABBITMQ_PORT,
        virtual_host="/",
        credentials=credentials,
        heartbeat=60,
        blocked_connection_timeout=30
    )

    try:
        logger.info("Connecting to RabbitMQ")

        connection = pika.BlockingConnection(
            parameters
        )

        channel = connection.channel()

        # Ensure the durable queue exists.
        channel.queue_declare(
            queue=RABBITMQ_QUEUE,
            durable=True
        )


        # Limit each worker to one unacknowledged message.
        channel.basic_qos(
            prefetch_count=1
        )

        # Register the message-processing callback.
        channel.basic_consume(
            queue=RABBITMQ_QUEUE,
            on_message_callback=process_message
        )

        logger.info(
            "Waiting for messages from queue: %s",
            RABBITMQ_QUEUE
        )

        # Pika dispatches incoming messages through this loop.
        # The shutdown handler schedules stop_consuming()
        # on the connection's I/O thread.
        if not shutdown_requested:
            channel.start_consuming()

    except Exception:
        logger.exception(
            "Worker encountered an unexpected error"
        )
        raise

    finally:
        logger.info("Starting worker shutdown")

        # Close the connection so RabbitMQ can redeliver any
        # messages that were delivered but not acknowledged.
        if connection is not None and connection.is_open:
            try:
                connection.close()

                logger.info(
                    "RabbitMQ connection closed"
                )

            except Exception:
                logger.exception(
                    "Error while closing RabbitMQ connection"
                )

        logger.info("Worker shutdown complete")


# --------------------------------------------------
# 6. Start the application
# --------------------------------------------------

if __name__ == "__main__":
    main()
```
