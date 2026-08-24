export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const UPSTASH_URL = "https://wanted-sponge-143655.upstash.io";
  const UPSTASH_TOKEN = "gQAAAAAAAjEnAAIgcDFkYWZjZDY1YjA5MjY0ZjI5YmM3NzE3ZjdlMTQzMDFlOQ";

  try {
    // Get current positions from Redis
    const posRes = await fetch(`${UPSTASH_URL}/get/positions`, {
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    const posData = await posRes.json();
    
    if (!posData.result) {
      return res.status(200).json({ status: 'no_positions', items: [] });
    }

    const positions = JSON.parse(JSON.parse(posData.result));
    
    // Extract clean symbols - strip option contract details
    // e.g. BABA17Jul26C140.00 -> BABA, XEG26Jun26C28.00.MX -> XEG.TO
    const symbols = [...new Set(positions.map(p => {
      const sym = p.symbol;
      // Extract base ticker - letters before the date digits
      const match = sym.match(/^([A-Z]+)/);
      if (!match) return null;
      let base = match[1];
      // Map Canadian tickers
      if (sym.includes('.MX') || sym.includes('.TO')) base = base + '.TO';
      return base;
    }).filter(Boolean))];

    // Fetch Yahoo Finance RSS for each symbol
    const newsItems = [];
    const seen = new Set();

    await Promise.all(symbols.map(async sym => {
      try {
        const yahooSym = sym.replace('.TO', '.TO'); // Yahoo uses .TO for TSX
        const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${yahooSym}&region=US&lang=en-US`;
        
        const rssRes = await fetch(rssUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (!rssRes.ok) return;
        
        const xml = await rssRes.text();
        
        // Parse RSS items
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        
        items.slice(0, 3).forEach(item => {
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || 
                        item.match(/<title>(.*?)<\/title>/))?.[1] || '';
          let link = (item.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/) ||
                      item.match(/<link>(.*?)<\/link>/) ||
                      item.match(/<guid[^>]*>(.*?)<\/guid>/))?.[1] || '';
          link = link.replace(/&amp;/g, '&').trim();
          if (link && !/^https?:\/\//.test(link)) link = '';
          const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/))?.[1] || '';
          const description = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                              item.match(/<description>(.*?)<\/description>/))?.[1] || '';

          if (!title || seen.has(title)) return;
          seen.add(title);

          // Quick rule-based sentiment
          const text = (title + ' ' + description).toLowerCase();
          let sentiment = 'neutral';
          const bullish = ['upgrade', 'buy', 'outperform', 'beats', 'raises', 'strong', 'growth', 'positive', 'bullish', 'record', 'exceed', 'above', 'higher', 'rally', 'surge', 'gain', 'profit'];
          const bearish = ['downgrade', 'sell', 'underperform', 'misses', 'cuts', 'weak', 'decline', 'negative', 'bearish', 'below', 'lower', 'drop', 'fall', 'loss', 'concern', 'risk', 'slump'];
          
          const bullScore = bullish.filter(w => text.includes(w)).length;
          const bearScore = bearish.filter(w => text.includes(w)).length;
          
          if (bullScore > bearScore) sentiment = 'bullish';
          else if (bearScore > bullScore) sentiment = 'bearish';

          // Parse date
          const date = pubDate ? new Date(pubDate) : new Date();
          
          newsItems.push({
            symbol: sym.replace('.TO', ''),
            title: title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
            sentiment,
            timestamp: date.toISOString(),
            age: Math.round((Date.now() - date.getTime()) / 60000), // minutes ago
            link
          });
        });

        // SEC EDGAR for US tickers
        if (!sym.includes('.TO')) {
          const edgarUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${sym}%22&dateRange=custom&startdt=${new Date(Date.now()-86400000).toISOString().split('T')[0]}&enddt=${new Date().toISOString().split('T')[0]}&forms=8-K`;
          try {
            const edgarRes = await fetch(edgarUrl, {
              headers: { 'User-Agent': 'trading-dashboard admin@example.com' }
            });
            if (edgarRes.ok) {
              const edgarData = await edgarRes.json();
              const hits = edgarData.hits?.hits || [];
              hits.slice(0, 2).forEach(hit => {
                const src = hit._source;
                const title = `SEC 8-K: ${src.display_names?.[0]?.name || sym} — ${src.form_type || '8-K'}`;
                if (seen.has(title)) return;
                seen.add(title);
                newsItems.push({
                  symbol: sym,
                  title,
                  sentiment: 'neutral',
                  timestamp: src.file_date ? new Date(src.file_date).toISOString() : new Date().toISOString(),
                  age: 0,
                  link: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${sym}&type=8-K&dateb=&owner=include&count=10`
                });
              });
            }
          } catch(e) {}
        }

      } catch(e) {
        console.error(`Error fetching news for ${sym}:`, e.message);
      }
    }));

    // Sort by most recent first
    newsItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Cache in Redis for 90 seconds
    await fetch(`${UPSTASH_URL}/setex/news/90`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(newsItems))
    });

    return res.status(200).json({ 
      status: 'ok', 
      symbols,
      items: newsItems.slice(0, 20)
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
