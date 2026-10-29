# Product Inventory Microservice

## 1. What is the Product Inventory Microservice?

Our Product Inventory microservice is responsible for **tracking and managing the available quantity of each product in the e-commerce application**.

While the Product Catalog microservice provides product information, the Product Inventory microservice tells us how many units of each product are available.

For example, a customer might see the following inventory information:

- Laptop — 100 units available
- Mobile — 50 units available
- Headphones — 75 units available

When a customer places an order, the Product Inventory microservice reduces the available quantity of the corresponding product.

For example, if a product has 100 units available and a customer orders one unit, the inventory becomes 99.

The microservice stores this information in a PostgreSQL database.

## 2. Technologies Used

| Component | Purpose |
|---|---|
| Python | Executes our application code |
| Flask | Creates REST API endpoints |
| PostgreSQL | Stores product inventory information |
| psycopg2 | Allows Python to communicate with PostgreSQL |
| ThreadedConnectionPool | Manages reusable database connections |
| Gunicorn | Runs the Flask application using a production-oriented WSGI server |
| `inventory_api.py` | Main application file |
| `requirements.txt` | Defines Python dependencies |
| Docker | Packages the application and its dependencies into a container |
| Port 3002 | Exposes the Product Inventory API |
| Kubernetes | Deploys, scales, and manages application containers |

## 3. Understanding the API Endpoints

| HTTP Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/inventory` | Returns inventory information for all products |
| GET | `/api/inventory/<product_id>` | Returns inventory information for one product |
| POST | `/api/order/<product_id>` | Attempts to reduce the inventory quantity by one |
| GET | `/health/live` | Checks whether the application is running |
| GET | `/health/ready` | Checks whether the application can communicate with PostgreSQL |

### Example 1: Retrieve all inventory

Request:

`GET /api/inventory`

Example response:

```json
[
  {
    "id": 1,
    "quantity": 100
  },
  {
    "id": 2,
    "quantity": 50
  },
  {
    "id": 3,
    "quantity": 75
  }
]
```

The response contains product IDs and their available quantities.

### Example 2: Retrieve inventory for one product

Request:

`GET /api/inventory/1`

Response:

```json
{
  "id": 1,
  "quantity": 100
}
```

### Example 3: Place an order

Request:

`POST /api/order/1`

If the order succeeds, the response might be:

```json
{
  "id": 1,
  "quantity": 99
}
```

The application decreases the quantity from 100 to 99.

If the product is out of stock, the application returns an HTTP 400 response.

If the product ID does not exist, the application returns an HTTP 404 response.

## 4. Step-by-Step Explanation

### Step 1: Customer requests inventory information

Suppose a customer opens a product page.

The frontend sends an HTTP request:

`GET /api/inventory/1`

The request asks for the available quantity of product ID 1.

### Step 2: Product Inventory receives the request

Gunicorn receives the HTTP request and passes it to our Flask application.

Flask identifies the matching API endpoint:

`/api/inventory/<product_id>`

It extracts the product ID from the URL.

### Step 3: Application obtains a database connection

The application uses `psycopg2` to communicate with PostgreSQL.

Our updated implementation uses a threaded connection pool.

Instead of creating a completely new database connection for every request, the application obtains an available connection from the pool and returns it after the operation.

### Step 4: Application queries PostgreSQL

For a request involving product ID 1, the application executes a parameterized SQL query similar to:

```sql
SELECT product_id, quantity
FROM inventory
WHERE product_id = 1;
```

This query retrieves the inventory record for that product.

### Step 5: PostgreSQL returns the result

PostgreSQL searches the `inventory` table and returns the matching record.

For example:

| product_id | quantity |
|---:|---:|
| 1 | 100 |

### Step 6: Flask generates the response

The application converts the database result into JSON:

```json
{
  "id": 1,
  "quantity": 100
}
```

Gunicorn sends the HTTP response back to the client.

### Step 7: Frontend displays the inventory

The frontend receives the JSON response and uses it to display the product's availability.

For example:

**Laptop — 100 units available**

The Product Inventory microservice therefore provides the stock information needed by the e-commerce application.

---

# 5. How the Application Starts

Our updated application follows this startup process.

```text
              START APPLICATION
                      |
                      v
          Gunicorn Starts Application
                      |
                      v
             Import inventory_api.py
                      |
                      v
          Read Environment Variables
                      |
                      v
         Configure PostgreSQL Settings
                      |
                      v
          Initialize Connection Pool
                      |
                      v
             Connect to PostgreSQL
                      |
                      v
          Create Inventory Table
          If It Does Not Already Exist
                      |
                      v
          Check Existing Inventory Data
                      |
                      v
              Is Table Empty?
                 /         \
               YES          NO
                |            |
                v            |
        Insert Initial Data  |
                |            |
                +------------+
                      |
                      v
          Gunicorn Workers Serve Requests
                      |
                      v
             Listen on Port 3002
                      |
                      v
             ACCEPT API REQUESTS
```

**Important:** In our current implementation, database initialization happens during application import. Gunicorn imports the module in its worker processes, so each worker can attempt initialization. The table creation is protected by `IF NOT EXISTS`, and the seed function checks whether the table is empty, but this startup process should eventually be moved into a dedicated initialization or migration step for a more robust production design.

## 6. Environment Variables Required

The application requires the following environment variables:

```dotenv
PORT=3002
POSTGRES_HOST=postgresql
POSTGRES_PORT=5432
POSTGRES_DB=inventory_db
POSTGRES_USER=inventory_user
POSTGRES_PASSWORD=<stored securely>
```

| Variable | Purpose |
|---|---|
| `PORT` | Port on which Gunicorn listens |
| `POSTGRES_HOST` | PostgreSQL hostname or Kubernetes Service name |
| `POSTGRES_PORT` | PostgreSQL listening port |
| `POSTGRES_DB` | Database name |
| `POSTGRES_USER` | Database username |
| `POSTGRES_PASSWORD` | Database password |

These values are examples for our new deployment. The PostgreSQL hostname must match the Service name we create.

In Kubernetes, we will store non-sensitive configuration in a ConfigMap and the database credentials in a Secret.

---

# 7. Test the Application Using Docker

Before deploying the application to Kubernetes, we should test it locally using Docker.

The following procedure assumes PostgreSQL is running in a Docker container on the same network and that the database and user have been created.

## Step 1: Create a Docker network

```bash
docker network create ecommerce-net
```

**Purpose:** Allows the Product Inventory container and PostgreSQL container to communicate using their container names.

If the network already exists, Docker will report that it exists; you do not need to recreate it.

## Step 2: Create a persistent volume

```bash
docker volume create ecommerce-postgres-data
```

**Purpose:** Provides persistent storage for PostgreSQL database files.

When a PostgreSQL container is removed, its data can remain in this volume.

## Step 3: Start PostgreSQL

For a local development test, run:

```bash
docker run -d \
  --name ecommerce-postgres \
  --network ecommerce-net \
  -e POSTGRES_DB=inventory_db \
  -e POSTGRES_USER=inventory_user \
  -e POSTGRES_PASSWORD=local-dev-password \
  -v ecommerce-postgres-data:/var/lib/postgresql/data \
  postgres:16
```

This starts PostgreSQL with:
- Database: `inventory_db`
- Username: `inventory_user`
- Password: `local-dev-password`
- Persistent volume: `ecommerce-postgres-data`

**Security note:** This password is for local development only. Do not use it in production.

Wait for PostgreSQL to become ready:

```bash
docker exec ecommerce-postgres pg_isready -U inventory_user -d inventory_db
```

## Step 4: Build the Product Inventory image

From the application directory:

```bash
cd ~/production-ecommerce-k8s/apps/product-inventory
```

Build the image:

```bash
docker build -t product-inventory:v1 .
```

Docker packages the Python application and its dependencies into the image.

## Step 5: Start the Product Inventory microservice

```bash
docker run -d \
  --name product-inventory \
  --network ecommerce-net \
  -p 3002:3002 \
  -e PORT=3002 \
  -e POSTGRES_HOST=ecommerce-postgres \
  -e POSTGRES_PORT=5432 \
  -e POSTGRES_DB=inventory_db \
  -e POSTGRES_USER=inventory_user \
  -e POSTGRES_PASSWORD=local-dev-password \
  product-inventory:v1
```

Here, `ecommerce-postgres` is the PostgreSQL container name. Docker's network DNS allows the application to resolve this name.

Port mapping `3002:3002` makes the API accessible on port 3002 of your local machine.

## Step 6: Check the containers

```bash
docker ps
```

You should see the PostgreSQL and Product Inventory containers running.

If the application exits, inspect its logs:

```bash
docker logs product-inventory
```

Look for successful database initialization and any startup errors.

## Step 7: Test the liveness endpoint

```bash
curl http://localhost:3002/health/live
```

Expected response:

```json
{
  "status": "alive",
  "service": "product-inventory"
}
```

This confirms that the application can respond to a health request.

## Step 8: Test the readiness endpoint

```bash
curl http://localhost:3002/health/ready
```

Expected response:

```json
{
  "status": "ready",
  "database": "connected"
}
```

This indicates that the application successfully obtained a database connection and executed a simple query.

## Step 9: Retrieve all inventory

```bash
curl http://localhost:3002/api/inventory
```

The response should contain the initial inventory records.

## Step 10: Retrieve one product's inventory

```bash
curl http://localhost:3002/api/inventory/1
```

Expected response for a fresh database:

```json
{
  "id": 1,
  "quantity": 100
}
```

## Step 11: Test an order

```bash
curl -X POST http://localhost:3002/api/order/1
```

Expected response:

```json
{
  "id": 1,
  "quantity": 99
}
```

Run the inventory request again:

```bash
curl http://localhost:3002/api/inventory/1
```

The quantity should now be 99.

If you repeat the order request, the quantity should decrease again until it reaches zero.

## Step 12: Test out-of-stock behavior

The initial inventory data gives product ID 1 a quantity of 100. Testing the out-of-stock condition would require reducing its quantity to zero, so do that only in a disposable development database or a controlled test.

When the quantity reaches zero, another order request should return:

```json
{
  "error": "Product is out of stock"
}
```

with HTTP status 400.

## Step 13: Test graceful shutdown

Stop the container:

```bash
docker stop product-inventory
```

Inspect the final logs:

```bash
docker logs --tail 20 product-inventory
```

Gunicorn should receive Docker's termination signal and shut down its workers.

Unlike our earlier Node.js Product Catalog implementation, we have not yet added an explicit Python shutdown handler to log a custom message such as `Graceful shutdown completed`. Gunicorn manages its worker shutdown, but we should implement and test database-pool cleanup explicitly before calling the service production-ready.

---

# 8. How Product Inventory Fits Into Our Kubernetes Project

Once local testing succeeds, we will deploy the microservice into our `ecommerce` namespace.

The architecture will look like this:

```text
                 E-commerce Frontend
                         |
                         v
               Product Inventory Service
                         |
                         v
               Product Inventory Pods
                    Deployment
                         |
                         v
                 PostgreSQL Service
                         |
                         v
                PostgreSQL StatefulSet
                         |
                         v
                 Persistent Volume
```

The Kubernetes Deployment will manage the application replicas. The Service will provide stable internal networking, and PostgreSQL will use persistent storage.

We will subsequently add the appropriate health probes, security settings, resource requests and limits, and autoscaling configuration.

**Important production consideration:** Application replicas must be configured with a connection-pool size that PostgreSQL can support. We also need to move database schema changes and initialization into a controlled process before scaling the service widely.
