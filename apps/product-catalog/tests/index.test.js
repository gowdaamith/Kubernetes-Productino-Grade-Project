const { test, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const mongodb = require("mongodb");
const express = require("express");

// ------------------------------------
// Mock MongoDB before importing app
// ------------------------------------

const state = {
  products: [],
  insertedProducts: null,
  pingError: null,
  findError: null,
  findOneError: null,
};

const fakeCollection = {
  countDocuments: async () => 0,

  insertMany: async (products) => {
    state.products = products;
    state.insertedProducts = products;

    return {
      insertedCount: products.length,
    };
  },

  find: () => ({
    toArray: async () => {
      if (state.findError) {
        throw state.findError;
      }

      return state.products;
    },
  }),

  findOne: async (query) => {
    if (state.findOneError) {
      throw state.findOneError;
    }

    return state.products.find(
      (product) => product.id === query.id
    ) || null;
  },
};

const fakeDatabase = {
  collection: () => fakeCollection,

  command: async () => {
    if (state.pingError) {
      throw state.pingError;
    }

    return { ok: 1 };
  },
};

class FakeMongoClient {
  constructor(uri, options) {
    this.uri = uri;
    this.options = options;
  }

  async connect() {
    return this;
  }

  db(databaseName) {
    this.databaseName = databaseName;
    return fakeDatabase;
  }

  async close() {
    return undefined;
  }
}

// MongoDB exports MongoClient through a configurable property.
Object.defineProperty(mongodb, "MongoClient", {
  configurable: true,
  enumerable: true,
  value: FakeMongoClient,
});

// ------------------------------------
// Intercept Express server startup
// ------------------------------------

const originalListen = express.application.listen;

let server;
let resolveServerStarted;

const serverStarted = new Promise((resolve) => {
  resolveServerStarted = resolve;
});

express.application.listen = function (...args) {
  // Use a free operating-system-assigned port.
  args[0] = 0;

  server = originalListen.apply(this, args);

  resolveServerStarted(server);

  return server;
};

let baseUrl;

// ------------------------------------
// Start application before tests
// ------------------------------------

before(async () => {
  // Importing index.js triggers database initialization
  // and application startup.
  require("../index");

  await serverStarted;

  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  }

  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

// ------------------------------------
// Stop application after tests
// ------------------------------------

after(async () => {
  express.application.listen = originalListen;

  if (server && server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

// Reset database errors between tests.
afterEach(() => {
  state.pingError = null;
  state.findError = null;
  state.findOneError = null;
});

// ------------------------------------
// Helper function
// ------------------------------------

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);

  return {
    response,
    body: await response.json(),
  };
}

// ------------------------------------
// Database initialization tests
// ------------------------------------

test("database initialization seeds products when collection is empty", () => {
  assert.ok(Array.isArray(state.insertedProducts));
  assert.ok(state.insertedProducts.length > 0);

  assert.equal(state.insertedProducts[0].id, 1);
  assert.equal(state.products.length, state.insertedProducts.length);
});

// ------------------------------------
// Liveness tests
// ------------------------------------

test("GET /health/live returns alive status", async () => {
  const { response, body } = await getJson("/health/live");

  assert.equal(response.status, 200);
  assert.equal(body.status, "alive");
  assert.equal(body.service, "product-catalog");
  assert.equal(body.version, "v2");
});

// ------------------------------------
// Readiness tests
// ------------------------------------

test("GET /health/ready returns ready when MongoDB responds", async () => {
  const { response, body } = await getJson("/health/ready");

  assert.equal(response.status, 200);
  assert.equal(body.status, "ready");
  assert.equal(body.database, "connected");
});

test("GET /health/ready returns 503 when MongoDB ping fails", async () => {
  state.pingError = new Error("MongoDB connection lost");

  const { response, body } = await getJson("/health/ready");

  assert.equal(response.status, 503);
  assert.equal(body.status, "not ready");
  assert.equal(body.database, "disconnected");
});

// ------------------------------------
// Product listing tests
// ------------------------------------

test("GET /api/products returns all products", async () => {
  const { response, body } = await getJson("/api/products");

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.length > 0);
  assert.equal(body[0].id, 1);
});

test("GET /api/products returns 500 when database query fails", async () => {
  state.findError = new Error("Database query failed");

  const { response, body } = await getJson("/api/products");

  assert.equal(response.status, 500);
  assert.equal(body.error, "Internal server error");
});

// ------------------------------------
// Individual product tests
// ------------------------------------

test("GET /api/products/:id returns an existing product", async () => {
  const { response, body } = await getJson("/api/products/1");

  assert.equal(response.status, 200);
  assert.equal(body.id, 1);
  assert.equal(body.name, "Wireless Bluetooth Headphones");
});

test("GET /api/products/:id returns 400 for an invalid ID", async () => {
  const { response, body } = await getJson("/api/products/abc");

  assert.equal(response.status, 400);
  assert.equal(body.error, "Invalid product ID");
});

test("GET /api/products/:id returns 400 for a decimal ID", async () => {
  const { response, body } = await getJson("/api/products/1.5");

  assert.equal(response.status, 400);
  assert.equal(body.error, "Invalid product ID");
});

test("GET /api/products/:id returns 404 when product does not exist", async () => {
  const { response, body } = await getJson("/api/products/99999");

  assert.equal(response.status, 404);
  assert.equal(body.error, "Product not found");
});

test("GET /api/products/:id returns 500 when database query fails", async () => {
  state.findOneError = new Error("Database query failed");

  const { response, body } = await getJson("/api/products/1");

  assert.equal(response.status, 500);
  assert.equal(body.error, "Internal server error");
});
