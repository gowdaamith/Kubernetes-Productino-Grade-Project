
FROM python:3.12-slim
# Prevent Python from generating .pyc files
ENV PYTHONDONTWRITEBYTECODE=1

# Display Python logs immediately on the container logs
ENV PYTHONUNBUFFERED=1


WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY inventory_api.py .
COPY init_db.py .

RUN groupadd --system --gid 10001 appgroup \
    && useradd --system --uid 10001 --gid 10001 appuser \
    && chown -R appuser:appgroup /app
USER 10001:10001
EXPOSE 3002
CMD [  "gunicorn","--bind", "0.0.0.0:3002", "--workers", "2","--timeout", "30","inventory_api:app"]
