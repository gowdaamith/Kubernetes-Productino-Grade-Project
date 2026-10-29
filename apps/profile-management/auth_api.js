const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const app = express();

app.use(bodyParser.json());
app.use(cors());

// Existing JWT secret.
// Replace with a Kubernetes Secret before production use.
const secretKey = 'secret-key';

let connection;

// MySQL connection details from environment variables.
const dbConfig = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
};

// Connect to MySQL with retry.
async function connectToMySQL() {
  const maxRetries = 5;
  const retryDelay = 5000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      connection = await mysql.createConnection(dbConfig);

      console.log('Connected to MySQL');

      // Create the users table after connecting.
      await createUsersTable();

      return;
    } catch (error) {
      console.error(
        `Error connecting to MySQL (attempt ${i + 1}):`,
        error.message
      );

      if (connection) {
        try {
          await connection.end();
        } catch (closeError) {
          console.error(
            'Error closing MySQL connection:',
            closeError.message
          );
        }

        connection = null;
      }

      if (i === maxRetries - 1) {
        console.error('Maximum MySQL connection retries reached.');
        process.exit(1);
      }

      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

// Create the users table if it does not exist.
async function createUsersTable() {
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        firstName VARCHAR(255) NOT NULL,
        lastName VARCHAR(255) NOT NULL,
        address VARCHAR(255) NOT NULL,
        postalCode VARCHAR(10) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL
      )
    `);

    console.log('Users table created or already exists');
  } catch (error) {
    console.error('Error creating users table:', error.message);
    process.exit(1);
  }
}

// Initialize the MySQL connection.
connectToMySQL();

// Middleware to authenticate JWT tokens.
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({
      error: 'No token provided',
    });
  }

  jwt.verify(token, secretKey, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        error: 'Invalid token',
      });
    }

    req.userId = decoded.userId;
    next();
  });
};

// Register a new user.
app.post('/api/signup', async (req, res) => {
  const {
    firstName,
    lastName,
    address,
    postalCode,
    email,
    password,
  } = req.body;

  try {
    const [rows] = await connection.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (rows.length > 0) {
      return res.status(409).json({
        error: 'Email already exists',
      });
    }

    await connection.execute(
      `INSERT INTO users
       (firstName, lastName, address, postalCode, email, password)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [firstName, lastName, address, postalCode, email, password]
    );

    res.status(201).json({
      message: 'User registered successfully',
    });
  } catch (error) {
    console.error('Error signing up:', error.message);

    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// Sign in an existing user.
app.post('/api/signin', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await connection.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    const user = rows[0];

    if (!user || user.password !== password) {
      return res.status(401).json({
        error: 'Invalid credentials',
      });
    }

    // Generate a JWT for the authenticated user.
    const token = jwt.sign(
      { userId: user.id },
      secretKey
    );

    // Do not return the password in the API response.
    const { password: storedPassword, ...safeUser } = user;

    res.json({
      message: 'Login successful',
      token,
      user: safeUser,
    });
  } catch (error) {
    console.error('Error signing in:', error.message);

    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// Sign out an authenticated user.
app.post('/api/signout', authenticateToken, (req, res) => {
  res.json({
    message: 'Logout successful',
  });
});

// Retrieve the authenticated user's profile.
app.get('/api/protected', authenticateToken, async (req, res) => {
  try {
    const [rows] = await connection.execute(
      'SELECT * FROM users WHERE id = ?',
      [req.userId]
    );

    const user = rows[0];

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    // Exclude the password from the response.
    const { password: storedPassword, ...safeUser } = user;

    res.json({
      message: 'Protected route accessed successfully',
      user: safeUser,
    });
  } catch (error) {
    console.error('Error accessing protected route:', error.message);

    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// Update the authenticated user's profile.
app.put('/api/update', authenticateToken, async (req, res) => {
  const {
    firstName,
    lastName,
    address,
    postalCode,
  } = req.body;

  try {
    const [rows] = await connection.execute(
      'SELECT * FROM users WHERE id = ?',
      [req.userId]
    );

    const user = rows[0];

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    await connection.execute(
      `UPDATE users
       SET firstName = ?,
           lastName = ?,
           address = ?,
           postalCode = ?
       WHERE id = ?`,
      [
        firstName ?? user.firstName,
        lastName ?? user.lastName,
        address ?? user.address,
        postalCode ?? user.postalCode,
        req.userId,
      ]
    );

    const [updatedRows] = await connection.execute(
      `SELECT id, firstName, lastName, address, postalCode, email
       FROM users
       WHERE id = ?`,
      [req.userId]
    );

    res.json({
      message: 'User updated successfully',
      user: updatedRows[0],
    });
  } catch (error) {
    console.error('Error updating user:', error.message);

    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// Kubernetes liveness probe.
// Checks whether the application is responding.
app.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    service: 'profile-management',
  });
});

// Kubernetes readiness probe.
// Checks whether the application can communicate with MySQL.
app.get('/health/ready', async (req, res) => {
  try {
    if (!connection) {
      return res.status(503).json({
        status: 'not ready',
        database: 'disconnected',
      });
    }

    await connection.ping();

    res.status(200).json({
      status: 'ready',
      database: 'connected',
    });
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      database: 'disconnected',
    });
  }
});

// Start the HTTP server.
// PORT can be configured through Docker or Kubernetes.
const port = Number(process.env.PORT || 3003);

app.listen(port, () => {
  console.log(`Profile Management API running on port ${port}`);
});
