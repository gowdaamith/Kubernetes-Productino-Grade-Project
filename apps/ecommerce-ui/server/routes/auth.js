import express from 'express';

const router = express.Router();

// Complete base URL of the Profile Management microservice.
const PROFILE_API_URL =
  process.env.PROFILE_API_URL || 'http://profile-management:3003';

// Forward a request to Profile Management and preserve its response.
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
    console.error('Profile Management request failed:', error.message);

    return res.status(502).json({
      error: 'Profile Management service is unavailable',
    });
  }
}

// Register a new user.
router.post('/signup', async (req, res) => {
  const url = `${PROFILE_API_URL}/api/signup`;

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

// Authenticate an existing user.
router.post('/signin', async (req, res) => {
  const url = `${PROFILE_API_URL}/api/signin`;

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

// Update the authenticated user's profile.
router.put('/profile', async (req, res) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({
      error: 'No token provided',
    });
  }

  const url = `${PROFILE_API_URL}/api/update`;

  return forwardRequest(
    url,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify(req.body),
    },
    res
  );
});

export default router;
