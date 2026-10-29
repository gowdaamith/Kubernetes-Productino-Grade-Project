import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import inventoryRoutes from './routes/inventory.js';
import orderRoutes from './routes/orders.js';
import shippingRoutes from './routes/shipping.js';
import contactRoutes from './routes/contact.js';

const app = express();

// Resolve the directory containing this file.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse incoming JSON requests.
app.use(express.json({ limit: '1mb' }));

// API routes.
app.use('/api', authRoutes);
app.use('/api', productRoutes);
app.use('/api', inventoryRoutes);
app.use('/api', orderRoutes);
app.use('/api', shippingRoutes);
app.use('/api', contactRoutes);

// Location of the compiled React application.
const clientBuildPath = path.resolve(__dirname, '../client/build');

// Serve static frontend files.
app.use(express.static(clientBuildPath));

// Health endpoint for checking whether the gateway process is responding.
app.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    service: 'ecommerce-ui',
  });
});

// Return the React application for browser routes.
// Do not send index.html for unknown API endpoints.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  res.sendFile(
    path.join(clientBuildPath, 'index.html'),
    (error) => {
      if (error) {
        console.error('Unable to serve React application:', error.message);

        if (!res.headersSent) {
          res.status(503).json({
            error: 'Frontend build is not available',
          });
        }
      }
    }
  );
});

// Return JSON for unmatched API endpoints.
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'API endpoint not found',
  });
});

// Handle unexpected application errors.
app.use((error, req, res, next) => {
  console.error('Unhandled server error:', error.message);

  if (res.headersSent) {
    return next(error);
  }

  res.status(error.status || 500).json({
    error: error.status === 400
      ? 'Invalid JSON request body'
      : 'Internal server error',
  });
});

const port = Number(process.env.PORT) || 4000;

app.listen(port, '0.0.0.0', () => {
  console.log(`Ecommerce gateway listening on port ${port}`);
});
