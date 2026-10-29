import express from 'express';

const router = express.Router();

// Internal URL of the Contact Support microservice.
const CONTACT_API_URL =
  process.env.CONTACT_API_URL || 'http://contact-support-team:8000';

// Forward the request and preserve the downstream response.
async function forwardRequest(url, options, res) {
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
    console.error('Contact Support request failed:', error.message);

    return res.status(502).json({
      error: 'Contact Support service is unavailable',
    });
  }
}

// Retrieve the support greeting.
router.get('/contact-message', async (req, res) => {
  const url = `${CONTACT_API_URL}/api/contact-message`;

  return forwardRequest(url, {}, res);
});

// Submit a support message.
router.post('/contact-submit', async (req, res) => {
  const { name, email, message } = req.body ?? {};

  const url = `${CONTACT_API_URL}/api/contact-submit`;

  return forwardRequest(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, email, message }),
    },
    res
  );
});

export default router;
