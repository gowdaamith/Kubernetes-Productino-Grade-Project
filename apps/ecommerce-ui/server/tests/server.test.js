import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

// Set service URLs before importing server.js and its route modules.
process.env.PROFILE_API_URL = 'http://profile.test';
process.env.PRODUCT_API_URL = 'http://products.test';
process.env.INVENTORY_API_URL = 'http://inventory.test';
process.env.ORDER_API_URL = 'http://orders.test';
process.env.SHIPPING_API_URL = 'http://shipping.test';
process.env.CONTACT_API_URL = 'http://contact.test';
process.env.PORT = '4000';

let server;
let gatewayPort;

const originalListen = express.application.listen;
const originalFetch = globalThis.fetch;

// Start the actual Express application on an automatically assigned port.
before(async () => {
  let resolveReady;

  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  express.application.listen = function (...args) {
    const callback = args.findLast(
      (argument) => typeof argument === 'function'
    );

    server = originalListen.call(this, 0, '127.0.0.1', () => {
      gatewayPort = server.address().port;
      resolveReady();

      if (callback) {
        callback();
      }
    });

    return server;
  };

  try {
    await import('../server.js');
    await ready;
  } finally {
    express.application.listen = originalListen;
  }
});

// Close the gateway after all tests finish.
after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Send requests to the local Express gateway.
function gatewayRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: gatewayPort,
        path,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (response) => {
        let body = '';

        response.setEncoding('utf8');

        response.on('data', (chunk) => {
          body += chunk;
        });

        response.on('end', () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body,
          });
        });
      }
    );

    request.on('error', reject);

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

// Create simulated downstream HTTP responses.
function mockResponse(
  body,
  status = 200,
  contentType = 'application/json'
) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
    },
  });
}

// Install a fake fetch implementation for microservice calls.
function mockFetch(handler) {
  globalThis.fetch = async (url, options = {}) => {
    return handler(String(url), options);
  };
}

// --------------------------------------------------
// Gateway health and fallback behavior
// --------------------------------------------------

test('health endpoint returns HTTP 200', async () => {
  const response = await gatewayRequest('/health/live');

  assert.equal(response.status, 200);

  assert.deepEqual(JSON.parse(response.body), {
    status: 'alive',
    service: 'ecommerce-ui',
  });
});

test('unknown API endpoint returns JSON 404', async () => {
  const response = await gatewayRequest('/api/unknown-endpoint');

  assert.equal(response.status, 404);

  assert.deepEqual(JSON.parse(response.body), {
    error: 'API endpoint not found',
  });
});

test('malformed JSON request returns HTTP 400', async () => {
  const response = await gatewayRequest('/api/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: '{"name":',
  });

  assert.equal(response.status, 400);

  assert.deepEqual(JSON.parse(response.body), {
    error: 'Invalid JSON request body',
  });
});

test('browser route serves the React application', async () => {
  const response = await gatewayRequest('/dashboard');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.body, /id="root"/);
});

// --------------------------------------------------
// Authentication proxy
// --------------------------------------------------

test('signup forwards the request and preserves downstream response', async () => {
  const payload = {
    firstName: 'Test',
    email: 'test@example.com',
  };

  mockFetch(async (url, options) => {
    assert.equal(url, 'http://profile.test/api/signup');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), payload);

    return mockResponse(
      JSON.stringify({ message: 'User registered' }),
      201
    );
  });

  const response = await gatewayRequest('/api/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 201);
  assert.match(response.headers['content-type'], /application\/json/);

  assert.deepEqual(JSON.parse(response.body), {
    message: 'User registered',
  });
});

test('profile update without authorization returns HTTP 401', async () => {
  mockFetch(() => {
    assert.fail('Downstream service should not be called');
  });

  const response = await gatewayRequest('/api/profile', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ firstName: 'Updated' }),
  });

  assert.equal(response.status, 401);

  assert.deepEqual(JSON.parse(response.body), {
    error: 'No token provided',
  });
});

// --------------------------------------------------
// Product Catalog proxy
// --------------------------------------------------

test('product lookup forwards the encoded product ID', async () => {
  mockFetch(async (url) => {
    assert.equal(url, 'http://products.test/api/products/10');

    return mockResponse(
      JSON.stringify({ id: 10, name: 'Keyboard' })
    );
  });

  const response = await gatewayRequest('/api/products/10');

  assert.equal(response.status, 200);

  assert.deepEqual(JSON.parse(response.body), {
    id: 10,
    name: 'Keyboard',
  });
});

// --------------------------------------------------
// Inventory aggregation
// --------------------------------------------------

test('inventory endpoint combines products and quantities', async () => {
  mockFetch(async (url) => {
    if (url === 'http://inventory.test/api/inventory') {
      return mockResponse(JSON.stringify([
        { id: 1, quantity: 15 },
        { id: 2, quantity: 8 },
      ]));
    }

    if (url === 'http://products.test/api/products') {
      return mockResponse(JSON.stringify([
        { id: 1, name: 'Laptop' },
        { id: 2, name: 'Mouse' },
        { id: 3, name: 'Monitor' },
      ]));
    }

    assert.fail(`Unexpected downstream URL: ${url}`);
  });

  const response = await gatewayRequest('/api/inventory');

  assert.equal(response.status, 200);

  assert.deepEqual(JSON.parse(response.body), [
    { id: 1, name: 'Laptop', quantity: 15 },
    { id: 2, name: 'Mouse', quantity: 8 },
    { id: 3, name: 'Monitor', quantity: 0 },
  ]);
});

test('inventory endpoint rejects unexpected response structures', async () => {
  mockFetch(async (url) => {
    if (url === 'http://inventory.test/api/inventory') {
      return mockResponse(JSON.stringify({ invalid: true }));
    }

    // Return a valid product response so the gateway reaches
    // its response-structure validation logic.
    if (url === 'http://products.test/api/products') {
      return mockResponse(JSON.stringify([
        { id: 1, name: 'Laptop' },
      ]));
    }

    assert.fail(`Unexpected downstream URL: ${url}`);
  });

  const response = await gatewayRequest('/api/inventory');

  assert.equal(response.status, 502);

  assert.deepEqual(JSON.parse(response.body), {
    error: 'A microservice returned an unexpected response format',
  });
});

// --------------------------------------------------
// Order Management proxy
// --------------------------------------------------

test('adding an item to cart forwards the user ID and payload', async () => {
  const payload = {
    id: 10,
    name: 'Keyboard',
    price: 50,
  };

  mockFetch(async (url, options) => {
    assert.equal(url, 'http://orders.test/api/orders/25/cart');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), payload);

    return mockResponse(
      JSON.stringify({ message: 'Added to cart' }),
      201
    );
  });

  const response = await gatewayRequest('/api/orders/25/cart', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 201);

  assert.deepEqual(JSON.parse(response.body), {
    message: 'Added to cart',
  });
});

// --------------------------------------------------
// Shipping proxy
// --------------------------------------------------

test('shipping explanation forwards the request', async () => {
  mockFetch(async (url) => {
    assert.equal(
      url,
      'http://shipping.test/shipping-explanation'
    );

    return mockResponse(
      JSON.stringify({ explanation: 'Standard shipping' })
    );
  });

  const response = await gatewayRequest('/api/shipping-explanation');

  assert.equal(response.status, 200);

  assert.deepEqual(JSON.parse(response.body), {
    explanation: 'Standard shipping',
  });
});

// --------------------------------------------------
// Contact Support proxy
// --------------------------------------------------

test('contact submission forwards only the expected fields', async () => {
  const payload = {
    name: 'Test User',
    email: 'test@example.com',
    message: 'Need assistance',
    unexpectedField: 'should not be forwarded',
  };

  mockFetch(async (url, options) => {
    assert.equal(url, 'http://contact.test/api/contact-submit');
    assert.equal(options.method, 'POST');

    assert.deepEqual(JSON.parse(options.body), {
      name: payload.name,
      email: payload.email,
      message: payload.message,
    });

    return mockResponse(
      JSON.stringify({ message: 'Message submitted' }),
      201
    );
  });

  const response = await gatewayRequest('/api/contact-submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 201);

  assert.deepEqual(JSON.parse(response.body), {
    message: 'Message submitted',
  });
});

// --------------------------------------------------
// Downstream failure handling
// --------------------------------------------------

test('product service network failure returns HTTP 502', async () => {
  mockFetch(async () => {
    throw new Error('Simulated network failure');
  });

  const response = await gatewayRequest('/api/products');

  assert.equal(response.status, 502);

  assert.deepEqual(JSON.parse(response.body), {
    error: 'Product Catalog service is unavailable',
  });
});
