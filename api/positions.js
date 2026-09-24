export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const UPSTASH_URL = process.env.UPSTASH_URL;
  const UPSTASH_TOKEN = process.env.UPSTASH_TOKEN;
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({ status: 'error', error: 'Missing UPSTASH_URL or UPSTASH_TOKEN environment variable in Vercel.' });
  }

  const DASHBOARD_KEY = process.env.DASHBOARD_KEY;
  if (!DASHBOARD_KEY) {
    return res.status(500).json({ status: 'error', error: 'Missing DASHBOARD_KEY environment variable in Vercel.' });
  }
  if (req.headers['x-dashboard-key'] !== DASHBOARD_KEY) {
    return res.status(401).json({ status: 'error', error: 'Unauthorized' });
  }

  try {
    const response = await fetch(`${UPSTASH_URL}/get/positions`, {
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    const data = await response.json();
    if (!data.result) {
      return res.status(200).json({ status: 'no_data', positions: [] });
    }
    const positions = JSON.parse(JSON.parse(data.result));
    return res.status(200).json({ status: 'ok', positions });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
