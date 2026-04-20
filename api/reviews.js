export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  async function kvGet(key) {
    try {
      const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const d = await r.json();
      return d.result;
    } catch(e) { return null; }
  }

  async function kvSet(key, value) {
    try {
      await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
    } catch(e) {}
  }

  // GET - جلب التقييمات
  if (req.method === 'GET') {
    try {
      const data = await kvGet('midaad_reviews');
      const reviews = data ? JSON.parse(data) : [];
      return res.status(200).json({ reviews });
    } catch(e) {
      return res.status(200).json({ reviews: [] });
    }
  }

  // POST - إضافة تقييم جديد
  if (req.method === 'POST') {
    try {
      const { rating, text, job, city } = req.body;
      if (!rating || !text || text.length < 5) {
        return res.status(400).json({ error: 'بيانات غير صحيحة' });
      }

      const data = await kvGet('midaad_reviews');
      const reviews = data ? JSON.parse(data) : [];

      reviews.push({
        rating: Math.min(5, Math.max(1, parseInt(rating))),
        text: text.substring(0, 200),
        job: job?.substring(0, 30) || '',
        city: city?.substring(0, 20) || '',
        date: new Date().toISOString().slice(0, 10)
      });

      // احتفظ بآخر 20 تقييم فقط
      const latest = reviews.slice(-20);
      await kvSet('midaad_reviews', JSON.stringify(latest));

      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }
  }

  res.status(405).end();
}
