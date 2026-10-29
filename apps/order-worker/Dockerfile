# Use a lightweight Python runtime.
FROM python:3.12-slim

# Prevent Python from creating .pyc files.
ENV PYTHONDONTWRITEBYTECODE=1

# Display Python logs immediately.
ENV PYTHONUNBUFFERED=1

# Set the application working directory.
WORKDIR /app

# Copy dependency definitions.
COPY requirements.txt .

# Install Python dependencies.
RUN pip install --no-cache-dir -r requirements.txt

# Copy the worker application.
COPY worker.py .

# Create a non-root user.
RUN groupadd --gid 10001 appgroup \
    && useradd \
       --uid 10001 \
       --gid 10001 \
       --create-home \
       --shell /usr/sbin/nologin \
       appuser \
    && chown -R appuser:appgroup /app

# Run the application as a non-root user.
USER 10001:10001

# Start the RabbitMQ worker.
CMD ["python", "worker.py"]
