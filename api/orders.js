export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const UPSTASH_URL = "https://wanted-sponge-143655.upstash.io";
  const UPSTASH_TOKEN = "gQAAAAAAAjEnAAIgcDFkYWZjZDY1YjA5MjY0ZjI5YmM3NzE3ZjdlMTQzMDFlOQ";

  try {
    const response = await fetch(`${UPSTASH_URL}/get/orders`, {
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    const data = await response.json();
    if (!data.result) {
      return res.status(200).json({ status: 'no_data', orders: [] });
    }
    const orders = JSON.parse(JSON.parse(data.result));
    return res.status(200).json({ status: 'ok', orders });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
