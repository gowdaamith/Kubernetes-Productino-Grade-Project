const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Set test environment variables before importing the application.
process.env.MYSQL_HOST = '127.0.0.1';
process.env.MYSQL_PORT = '3306';
process.env.MYSQL_USER = 'test-user';
process.env.MYSQL_PASSWORD = 'test-password';
process.env.MYSQL_DATABASE = 'test-profile-db';

// Import dependencies so we can intercept their behavior.
const express = require('express');
const mysql = require('mysql2/promise');

// Track the temporary HTTP server.
let testServer;

// Allow tests to simulate database ping failures.
let pingError = null;

// Signal when the application has completed its table initialization.
let resolveSchemaReady;

const schemaReady = new Promise(resolve => {
    resolveSchemaReady = resolve;
});

// Fake MySQL connection.
// No real database connection is created.
const fakeConnection = {
    async execute(sql, params) {
        if (sql.includes('CREATE TABLE')) {
            resolveSchemaReady();
            return [[], []];
        }

        throw new Error(`Unexpected SQL query in test: ${sql}`);
    },

    async ping() {
        if (pingError) {
            throw pingError;
        }
    },

    async end() {
        return undefined;
    },
};

// Preserve the original dependency functions.
const originalCreateConnection = mysql.createConnection;
const originalListen = express.application.listen;

// Intercept MySQL connection creation.
mysql.createConnection = async () => fakeConnection;

// Intercept Express server startup.
express.application.listen = function (...args) {
    const callback = args.find(arg => typeof arg === 'function');

    testServer = originalListen.call(
        this,
        0,
        '127.0.0.1',
        callback
    );

    return testServer;
};

// Load the actual application after installing the test interceptors.
require('../auth_api');

// Restore the original dependency functions.
mysql.createConnection = originalCreateConnection;
express.application.listen = originalListen;

// Wait until the temporary HTTP server is ready.
before(async () => {
    await schemaReady;

    if (!testServer.listening) {
        await new Promise((resolve, reject) => {
            testServer.once('listening', resolve);
            testServer.once('error', reject);
        });
    }
});

// Close the temporary HTTP server after all tests.
after(async () => {
    if (testServer && testServer.listening) {
        await new Promise((resolve, reject) => {
            testServer.close(error => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }
});

// Helper to send HTTP requests to the actual Express application.
async function sendRequest(path) {
    const address = testServer.address();

    const response = await fetch(
        `http://127.0.0.1:${address.port}${path}`
    );

    return {
        status: response.status,
        body: await response.json(),
    };
}

// Test 1: Liveness endpoint.
test('GET /health/live returns HTTP 200', async () => {
    const response = await sendRequest('/health/live');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'alive');
    assert.equal(response.body.service, 'profile-management');
});

// Test 2: Readiness endpoint when MySQL is connected.
test('GET /health/ready returns HTTP 200 when database is connected', async () => {
    pingError = null;

    const response = await sendRequest('/health/ready');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ready');
    assert.equal(response.body.database, 'connected');
});

// Test 3: Readiness endpoint when MySQL ping fails.
test('GET /health/ready returns HTTP 503 when database ping fails', async () => {
    pingError = new Error('Simulated database failure');

    const response = await sendRequest('/health/ready');

    assert.equal(response.status, 503);
    assert.equal(response.body.status, 'not ready');
    assert.equal(response.body.database, 'disconnected');

    // Restore the normal test database behavior.
    pingError = null;
});

// Simulated database query behavior for individual tests.
let executeHandler = null;

// Preserve the original fake connection implementation.
const originalExecute = fakeConnection.execute;

// Allow tests to control database query responses.
fakeConnection.execute = async function (sql, params) {
    if (executeHandler) {
        return executeHandler(sql, params);
    }

    return originalExecute.call(this, sql, params);
};

// Test 4: Successful user registration.
test('POST /api/signup registers a new user', async () => {
    let queryCount = 0;

    executeHandler = async (sql, params) => {
        queryCount++;

        if (sql.includes('SELECT * FROM users WHERE email')) {
            assert.equal(params[0], 'newuser@example.com');
            return [[], []];
        }

        if (sql.includes('INSERT INTO users')) {
            assert.deepEqual(params, [
                'Test',
                'User',
                'Bengaluru',
                '560001',
                'newuser@example.com',
                'test-password',
            ]);

            return [{ affectedRows: 1 }, []];
        }

        throw new Error(`Unexpected SQL query: ${sql}`);
    };

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/signup`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                firstName: 'Test',
                lastName: 'User',
                address: 'Bengaluru',
                postalCode: '560001',
                email: 'newuser@example.com',
                password: 'test-password',
            }),
        }
    );

    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.message, 'User registered successfully');
    assert.equal(queryCount, 2);
});

// Test 5: Duplicate email registration.
test('POST /api/signup rejects an existing email', async () => {
    executeHandler = async (sql) => {
        if (sql.includes('SELECT * FROM users WHERE email')) {
            return [[{ id: 1, email: 'existing@example.com' }], []];
        }

        throw new Error('INSERT should not execute for duplicate email');
    };

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/signup`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                firstName: 'Existing',
                lastName: 'User',
                address: 'Bengaluru',
                postalCode: '560001',
                email: 'existing@example.com',
                password: 'test-password',
            }),
        }
    );

    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.error, 'Email already exists');
});

// Test 6: Database error during registration.
test('POST /api/signup returns HTTP 500 on database error', async () => {
    executeHandler = async () => {
        throw new Error('Simulated database failure');
    };

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/signup`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                firstName: 'Test',
                lastName: 'User',
                address: 'Bengaluru',
                postalCode: '560001',
                email: 'error@example.com',
                password: 'test-password',
            }),
        }
    );

    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error, 'Internal server error');
});

// Test 7: Successful signin and JWT generation.
test('POST /api/signin authenticates user and returns JWT', async () => {
    executeHandler = async (sql, params) => {
        assert.ok(sql.includes('SELECT * FROM users WHERE email'));
        assert.equal(params[0], 'login@example.com');

        return [[{
            id: 42,
            firstName: 'Test',
            lastName: 'User',
            address: 'Bengaluru',
            postalCode: '560001',
            email: 'login@example.com',
            password: 'correct-password',
        }], []];
    };

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/signin`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'login@example.com',
                password: 'correct-password',
            }),
        }
    );

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.message, 'Login successful');
    assert.ok(body.token);

    assert.equal(body.user.id, 42);
    assert.equal(body.user.email, 'login@example.com');
    assert.equal('password' in body.user, false);
});

// Test 8: Incorrect password.
test('POST /api/signin rejects incorrect password', async () => {
    executeHandler = async () => [[{
        id: 42,
        email: 'login@example.com',
        password: 'correct-password',
    }], []];

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/signin`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'login@example.com',
                password: 'wrong-password',
            }),
        }
    );

    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, 'Invalid credentials');
});

// Test 9: Unknown email.
test('POST /api/signin rejects unknown email', async () => {
    executeHandler = async () => [[], []];

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/signin`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'unknown@example.com',
                password: 'some-password',
            }),
        }
    );

    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, 'Invalid credentials');
});

// Test 10: Database failure during signin.
test('POST /api/signin returns HTTP 500 on database error', async () => {
    executeHandler = async () => {
        throw new Error('Simulated signin database failure');
    };

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/signin`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'login@example.com',
                password: 'correct-password',
            }),
        }
    );

    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error, 'Internal server error');
});

// Generate a JWT for authenticated route tests.
// This uses the application's existing signing secret.
const jwt = require('jsonwebtoken');

const validToken = jwt.sign(
    { userId: 42 },
    'secret-key'
);

// Test 11: Missing JWT token.
test('GET /api/protected rejects missing authorization token', async () => {
    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/protected`
    );

    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, 'No token provided');
});

// Test 12: Invalid JWT token.
test('GET /api/protected rejects invalid JWT token', async () => {
    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/protected`,
        {
            headers: {
                Authorization: 'invalid-token',
            },
        }
    );

    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, 'Invalid token');
});

// Test 13: Successful protected profile retrieval.
test('GET /api/protected returns authenticated user profile', async () => {
    executeHandler = async (sql, params) => {
        assert.ok(sql.includes('SELECT * FROM users WHERE id'));
        assert.deepEqual(params, [42]);

        return [[{
            id: 42,
            firstName: 'Test',
            lastName: 'User',
            address: 'Bengaluru',
            postalCode: '560001',
            email: 'test@example.com',
            password: 'test-password',
        }], []];
    };

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/protected`,
        {
            headers: {
                Authorization: validToken,
            },
        }
    );

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.message, 'Protected route accessed successfully');
    assert.equal(body.user.id, 42);
    assert.equal('password' in body.user, false);
});

// Test 14: Authenticated user does not exist.
test('GET /api/protected returns HTTP 404 when user does not exist', async () => {
    executeHandler = async () => [[], []];

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/protected`,
        {
            headers: {
                Authorization: validToken,
            },
        }
    );

    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error, 'User not found');
});

// Test 15: Database failure during protected profile retrieval.
test('GET /api/protected returns HTTP 500 on database error', async () => {
    executeHandler = async () => {
        throw new Error('Simulated protected route database failure');
    };

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/protected`,
        {
            headers: {
                Authorization: validToken,
            },
        }
    );

    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error, 'Internal server error');
});

// Test 16: Successful signout.
test('POST /api/signout succeeds with valid JWT token', async () => {
    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/signout`,
        {
            method: 'POST',
            headers: {
                Authorization: validToken,
            },
        }
    );

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.message, 'Logout successful');
});

// Test 17: Signout without JWT token.
test('POST /api/signout rejects missing authorization token', async () => {
    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/signout`,
        {
            method: 'POST',
        }
    );

    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, 'No token provided');
});

// Test 18: Successful profile update.
test('PUT /api/update updates authenticated user profile', async () => {
    let queryCount = 0;

    executeHandler = async (sql, params) => {
        queryCount++;

        if (sql.includes('SELECT * FROM users WHERE id')) {
            assert.deepEqual(params, [42]);

            return [[{
                id: 42,
                firstName: 'Old',
                lastName: 'User',
                address: 'Old Address',
                postalCode: '560000',
                email: 'test@example.com',
                password: 'test-password',
            }], []];
        }

        if (sql.includes('UPDATE users')) {
            assert.deepEqual(params, [
                'Updated',
                'User',
                'New Address',
                '560001',
                42,
            ]);

            return [{ affectedRows: 1 }, []];
        }

        if (sql.includes('SELECT id, firstName')) {
            assert.deepEqual(params, [42]);

            return [[{
                id: 42,
                firstName: 'Updated',
                lastName: 'User',
                address: 'New Address',
                postalCode: '560001',
                email: 'test@example.com',
            }], []];
        }

        throw new Error(`Unexpected SQL query: ${sql}`);
    };

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/update`,
        {
            method: 'PUT',
            headers: {
                Authorization: validToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                firstName: 'Updated',
                address: 'New Address',
                postalCode: '560001',
            }),
        }
    );

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.message, 'User updated successfully');
    assert.equal(body.user.firstName, 'Updated');
    assert.equal(body.user.address, 'New Address');
    assert.equal(body.user.email, 'test@example.com');
    assert.equal(queryCount, 3);
});

// Test 19: Profile update when user does not exist.
test('PUT /api/update returns HTTP 404 when user does not exist', async () => {
    executeHandler = async () => [[], []];

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/update`,
        {
            method: 'PUT',
            headers: {
                Authorization: validToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                firstName: 'Updated',
            }),
        }
    );

    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error, 'User not found');
});

// Test 20: Database failure during profile update.
test('PUT /api/update returns HTTP 500 on database error', async () => {
    executeHandler = async () => {
        throw new Error('Simulated profile update database failure');
    };

    const response = await fetch(
        `http://127.0.0.1:${testServer.address().port}/api/update`,
        {
            method: 'PUT',
            headers: {
                Authorization: validToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                firstName: 'Updated',
            }),
        }
    );

    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error, 'Internal server error');
});
