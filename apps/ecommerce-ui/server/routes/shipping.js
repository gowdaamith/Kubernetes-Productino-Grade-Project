import express from 'express';

const router = express.Router();

// Internal URL of the Shipping and Handling microservice.
const SHIPPING_API_URL =
  process.env.SHIPPING_API_URL || 'http://shipping-and-handling:8080';

// Forward the request and preserve the downstream response.
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
    console.error('Shipping service request failed:', error.message);

    return res.status(502).json({
      error: 'Shipping and Handling service is unavailable',
    });
  }
}

// Retrieve the shipping explanation.
router.get('/shipping-explanation', async (req, res) => {
  const url = `${SHIPPING_API_URL}/shipping-explanation`;

  return forwardRequest(url, res);
});

// Retrieve shipping fees for all products.
router.get('/all-shipping-fees', async (req, res) => {
  const url = `${SHIPPING_API_URL}/all-shipping-fees`;

  return forwardRequest(url, res);
});

export default router;
