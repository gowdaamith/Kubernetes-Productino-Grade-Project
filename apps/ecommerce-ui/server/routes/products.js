import express from 'express';

const router = express.Router();

// Complete base URL of the Product Catalog microservice.
const PRODUCT_API_URL =
  process.env.PRODUCT_API_URL || 'http://product-catalog:3001';

// Forward the request and preserve the microservice's response.
async function forwardRequest(url, res) {
  try {
    const response = await fetch(url);
    const body = await response.text();

    res.status(response.status);

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.set('Content-Type', contentType);
    }

    return res.send(body);
  } catch (error) {
    console.error('Product Catalog request failed:', error.message);

    return res.status(502).json({
      error: 'Product Catalog service is unavailable',
    });
  }
}

// Retrieve all products.
router.get('/products', async (req, res) => {
  const url = `${PRODUCT_API_URL}/api/products`;

  return forwardRequest(url, res);
});

// Retrieve one product by its ID.
router.get('/products/:id', async (req, res) => {
  const productId = encodeURIComponent(req.params.id);
  const url = `${PRODUCT_API_URL}/api/products/${productId}`;

  return forwardRequest(url, res);
});

export default router;
