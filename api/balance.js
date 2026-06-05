export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const REDIS_URL = process.env.STORAGE_URL || process.env.REDIS_URL;
  
  if (!REDIS_URL) {
    return res.status(500).json({ error: 'Redis not configured' });
  }

  try {
    // Parse Redis URL
    const url = new URL(REDIS_URL.replace('redis://', 'http://').replace('rediss://', 'https://'));
    const password = url.password;
    const host = url.hostname;
    const port = url.port || 6379;
    const tls = REDIS_URL.startsWith('rediss://');

    // Use Upstash REST API if available, otherwise raw Redis
    // Upstash provides a REST API at the same host on port 443
    const restUrl = `https://${host}`;
    
    const response = await fetch(`${restUrl}/get/balance`, {
      headers: {
        'Authorization': `Bearer ${password}`
      }
    });

    if (!response.ok) {
      throw new Error(`Redis REST error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.result) {
      return res.status(200).json({ 
        status: 'no_data',
        message: 'Python sync not running yet'
      });
    }

    const balance = JSON.parse(data.result);
    return res.status(200).json({ status: 'ok', ...balance });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
