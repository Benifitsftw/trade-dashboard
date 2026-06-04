export default async function handler(req, res) {
  // Allow CORS from any origin (your dashboard)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { endpoint } = req.query;

  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint' });
  }

  try {
    // Token refresh
    if (endpoint === 'refresh') {
      const { refresh_token } = req.body || req.query;
      if (!refresh_token) {
        return res.status(400).json({ error: 'Missing refresh_token' });
      }

      const response = await fetch(
        `https://login.questrade.com/oauth2/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh_token)}`,
        { method: 'POST' }
      );

      const data = await response.json();
      return res.status(response.status).json(data);
    }

    // Proxy any Questrade API call
    if (endpoint === 'proxy') {
      const { url } = req.query;
      const authHeader = req.headers['authorization'];

      if (!url || !authHeader) {
        return res.status(400).json({ error: 'Missing url or authorization header' });
      }

      // Security: only allow questrade domains
      if (!url.includes('.questrade.com') && !url.includes('questrade.com')) {
        return res.status(403).json({ error: 'Domain not allowed' });
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    }

    return res.status(400).json({ error: 'Unknown endpoint' });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Proxy request failed', detail: error.message });
  }
}
