const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json());
app.use(cors());

// ------------------------------------
// Application configuration
// ------------------------------------

const PORT = Number(process.env.PORT || 3001);

const MONGODB_HOST = process.env.MONGODB_HOST || "localhost";
const MONGODB_PORT = process.env.MONGODB_PORT || "27017";
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || "products_db";

const mongoUrl = `mongodb://${MONGODB_HOST}:${MONGODB_PORT}`;

const client = new MongoClient(mongoUrl, {
  serverSelectionTimeoutMS: 5000,
});

let db;
let server;
let shuttingDown = false;

// ------------------------------------
// Liveness endpoint
// ------------------------------------

app.get("/health/live", (req, res) => {
  res.status(200).json({
    status: "alive",
    service: "product-catalog",
    version: "v2",
  });
});

// ------------------------------------
// Readiness endpoint
// ------------------------------------

app.get("/health/ready", async (req, res) => {
  if (!db || shuttingDown) {
    return res.status(503).json({
      status: "not ready",
    });
  }

  try {
    await db.command({ ping: 1 });

    res.status(200).json({
      status: "ready",
      database: "connected",
    });
  } catch (error) {
    res.status(503).json({
      status: "not ready",
      database: "disconnected",
    });
  }
});

// ------------------------------------
// Product endpoints
// ------------------------------------

app.get("/api/products", async (req, res) => {
  if (!db) {
    return res.status(503).json({
      error: "Database unavailable",
    });
  }

  try {
    const products = await db.collection("products").find().toArray();

    res.json(products);
  } catch (error) {
    console.error("Error retrieving products:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

app.get("/api/products/:id", async (req, res) => {
  if (!db) {
    return res.status(503).json({
      error: "Database unavailable",
    });
  }

  const productId = Number(req.params.id);

  if (!Number.isSafeInteger(productId)) {
    return res.status(400).json({
      error: "Invalid product ID",
    });
  }

  try {
    const product = await db.collection("products").findOne({
      id: productId,
    });

    if (!product) {
      return res.status(404).json({
        error: "Product not found",
      });
    }

    res.json(product);
  } catch (error) {
    console.error("Error retrieving product:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

// ------------------------------------
// Database initialization
// ------------------------------------

async function initializeDatabase() {
  await client.connect();

  console.log("Connected to MongoDB");

  db = client.db(MONGODB_DATABASE);

  const productsCollection = db.collection("products");

  const count = await productsCollection.countDocuments();

  if (count === 0) {
    const productsPath = path.join(__dirname, "products.json");

    const productsData = JSON.parse(
      fs.readFileSync(productsPath, "utf8")
    );

    await productsCollection.insertMany(productsData);

    console.log("Initial products inserted");
  }
}

// ------------------------------------
// Application startup
// ------------------------------------

async function startApplication() {
  try {
    await initializeDatabase();

    server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Product Catalog running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Application startup failed:", error);

    await client.close().catch(console.error);

    process.exit(1);
  }
}

// ------------------------------------
// Graceful shutdown
// ------------------------------------

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(`Received ${signal}. Shutting down...`);

  const forceExit = setTimeout(() => {
    console.error("Shutdown timeout exceeded");
    process.exit(1);
  }, 25000);

  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    await client.close();

    clearTimeout(forceExit);

    console.log("Graceful shutdown completed");

    process.exit(0);
  } catch (error) {
    console.error("Shutdown failed:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startApplication();
