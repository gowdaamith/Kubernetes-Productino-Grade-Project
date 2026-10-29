import express from 'express';

const router = express.Router();

// Internal URLs of the microservices.
const INVENTORY_API_URL =
  process.env.INVENTORY_API_URL || 'http://product-inventory:3002';

const PRODUCT_API_URL =
  process.env.PRODUCT_API_URL || 'http://product-catalog:3001';

// Forward a request and preserve the original response.
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
    console.error('Inventory request failed:', error.message);

    return res.status(502).json({
      error: 'A required microservice is unavailable',
    });
  }
}

// Retrieve product details and combine them with stock quantities.
router.get('/inventory', async (req, res) => {
  try {
    // Request inventory quantities.
    const inventoryResponse = await fetch(
      `${INVENTORY_API_URL}/api/inventory`
    );

    if (!inventoryResponse.ok) {
      const body = await inventoryResponse.text();

      return res.status(inventoryResponse.status).send(body);
    }

    const inventoryData = await inventoryResponse.json();

    // Request complete product details.
    const productsResponse = await fetch(
      `${PRODUCT_API_URL}/api/products`
    );

    if (!productsResponse.ok) {
      const body = await productsResponse.text();

      return res.status(productsResponse.status).send(body);
    }

    const productsData = await productsResponse.json();

    // Validate the response structures before combining the data.
    if (!Array.isArray(inventoryData) || !Array.isArray(productsData)) {
      console.error('Unexpected response structure from a microservice');

      return res.status(502).json({
        error: 'A microservice returned an unexpected response format',
      });
    }

    // Create a lookup table for faster inventory matching.
    const inventoryByProductId = new Map(
      inventoryData.map((item) => [String(item.id), item])
    );

    // Add each product's inventory quantity.
    const combinedData = productsData.map((product) => {
      const inventoryItem = inventoryByProductId.get(String(product.id));

      return {
        ...product,
        quantity: inventoryItem ? inventoryItem.quantity : 0,
      };
    });

    return res.status(200).json(combinedData);
  } catch (error) {
    console.error('Error combining products and inventory:', error.message);

    return res.status(502).json({
      error: 'Unable to retrieve product inventory',
    });
  }
});

// Retrieve the inventory quantity for one product.
router.get('/inventory/:id', async (req, res) => {
  const productId = encodeURIComponent(req.params.id);

  const url = `${INVENTORY_API_URL}/api/inventory/${productId}`;

  return forwardRequest(url, res);
});

export default router;
