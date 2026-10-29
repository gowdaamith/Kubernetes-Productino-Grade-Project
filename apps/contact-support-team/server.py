import logging
import os
from datetime import datetime, timezone

from flask import Flask, jsonify, request
from flask_cors import CORS
from pymongo import MongoClient
from pymongo.errors import PyMongoError

app = Flask(__name__)
CORS(app)

# Configure application logging.
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

# Read MongoDB configuration from environment variables.
MONGODB_HOST = os.getenv("MONGODB_HOST", "mongodb")
MONGODB_PORT = int(os.getenv("MONGODB_PORT", "27017"))
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "contact_support_db")

# Limit the amount of time spent waiting for MongoDB.
client = MongoClient(
    host=MONGODB_HOST,
    port=MONGODB_PORT,
    serverSelectionTimeoutMS=3000,
    connectTimeoutMS=3000,
    socketTimeoutMS=5000,
)

db = client[MONGODB_DATABASE]
contact_messages = db["contact_messages"]


@app.route("/api/contact-message", methods=["GET"])
def get_contact_message():
    return jsonify({
        "message": (
            "We're here to help! If you have any questions, concerns, "
            "or feedback, please contact our dedicated support team."
        )
    }), 200


@app.route("/api/contact-submit", methods=["POST"])
def submit_contact_form():
    # Reject missing or malformed JSON requests.
    if not request.is_json:
        return jsonify({
            "status": "error",
            "message": "Content-Type must be application/json."
        }), 400

    post_data = request.get_json(silent=True)

    if not isinstance(post_data, dict):
        return jsonify({
            "status": "error",
            "message": "A valid JSON object is required."
        }), 400

    # Extract and validate the required fields.
    name = post_data.get("name")
    email = post_data.get("email")
    message = post_data.get("message")

    if not all(isinstance(value, str) for value in (name, email, message)):
        return jsonify({
            "status": "error",
            "message": "Name, email, and message must be strings."
        }), 400

    name = name.strip()
    email = email.strip()
    message = message.strip()

    if not name or not email or not message:
        return jsonify({
            "status": "error",
            "message": "Name, email, and message are required."
        }), 400

    if len(name) > 100 or len(email) > 254 or len(message) > 5000:
        return jsonify({
            "status": "error",
            "message": "One or more fields exceed the allowed length."
        }), 400

    # Store the submission using a UTC timestamp.
    contact_document = {
        "name": name,
        "email": email,
        "message": message,
        "timestamp": datetime.now(timezone.utc),
    }

    try:
        result = contact_messages.insert_one(contact_document)

        logger.info(
            "Contact submission stored successfully: id=%s",
            result.inserted_id,
        )

        return jsonify({
            "status": "success",
            "message": "Your message has been successfully submitted.",
            "submission_id": str(result.inserted_id),
        }), 201

    except PyMongoError:
        # Do not expose internal database errors to the customer.
        logger.exception("Failed to store contact submission")

        return jsonify({
            "status": "error",
            "message": "Unable to submit your message at this time."
        }), 503


@app.route("/health/live", methods=["GET"])
def liveness():
    # Confirms that the Flask application process is responding.
    return jsonify({"status": "alive"}), 200


@app.route("/health/ready", methods=["GET"])
def readiness():
    # Confirms that MongoDB can respond to a lightweight command.
    try:
        client.admin.command("ping")
        return jsonify({"status": "ready"}), 200
    except PyMongoError:
        return jsonify({"status": "not_ready"}), 503


if __name__ == "__main__":
    # Suitable for local development only.
    # Kubernetes deployments will use a production WSGI server.
    app.run(host="0.0.0.0", port=8000)
