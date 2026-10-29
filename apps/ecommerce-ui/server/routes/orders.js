import express from 'express';

const router = express.Router();

// Internal URL of the Order Management microservice.
const ORDER_API_URL =
  process.env.ORDER_API_URL || 'http://order-management:9090';

// Forward a request and preserve the downstream response.
async function forwardRequest(url, options = {}, res) {
  try {
    const response = await fetch(url, options);
    const body = await response.text();

    res.status(response.status);

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.set('Content-Type', contentType);
    }

    return res.send(body);
  } catch (error) {
    console.error('Order Management request failed:', error.message);

    return res.status(502).json({
      error: 'Order Management service is unavailable',
    });
  }
}

// Add an item to a user's cart.
router.post('/orders/:userId/cart', async (req, res) => {
  const userId = encodeURIComponent(req.params.userId);
  const url = `${ORDER_API_URL}/api/orders/${userId}/cart`;

  return forwardRequest(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    },
    res
  );
});

// Retrieve a user's cart.
router.get('/orders/:userId/cart', async (req, res) => {
  const userId = encodeURIComponent(req.params.userId);
  const url = `${ORDER_API_URL}/api/orders/${userId}/cart`;

  return forwardRequest(url, {}, res);
});

// Retrieve the cart subtotal.
router.get('/orders/:userId/cart/subtotal', async (req, res) => {
  const userId = encodeURIComponent(req.params.userId);
  const url = `${ORDER_API_URL}/api/orders/${userId}/cart/subtotal`;

  return forwardRequest(url, {}, res);
});

// Retrieve the cart shipping cost.
router.get('/orders/:userId/cart/shipping', async (req, res) => {
  const userId = encodeURIComponent(req.params.userId);
  const url = `${ORDER_API_URL}/api/orders/${userId}/cart/shipping`;

  return forwardRequest(url, {}, res);
});

// Calculate the cart total.
router.get('/orders/:userId/cart/total', async (req, res) => {
  const userId = encodeURIComponent(req.params.userId);
  const url = `${ORDER_API_URL}/api/orders/${userId}/cart/total`;

  return forwardRequest(url, {}, res);
});

// Place an order.
router.post('/orders/:userId/purchase', async (req, res) => {
  const userId = encodeURIComponent(req.params.userId);
  const url = `${ORDER_API_URL}/api/orders/${userId}/purchase`;

  return forwardRequest(
    url,
    {
      method: 'POST',
    },
    res
  );
});

// Retrieve a user's order history.
router.get('/orders/:userId/history', async (req, res) => {
  const userId = encodeURIComponent(req.params.userId);
  const url = `${ORDER_API_URL}/api/orders/${userId}/history`;

  return forwardRequest(url, {}, res);
});

export default router;
