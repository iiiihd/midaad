module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { pin, action } = req.body;
  if (pin !== 'adelh2380') return res.status(401).json({ error: 'unauthorized' });

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

  async function kvKeys(pattern) {
    try {
      const r = await fetch(`${KV_URL}/keys/${encodeURIComponent(pattern)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const d = await r.json();
      return d.result || [];
    } catch(e) { return []; }
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    // المجانيون
    const freeKeys = await kvKeys('free_ip_*');
    const freeUsers = await Promise.all(freeKeys.map(async k => {
      const val = await kvGet(k);
      return { ip: k.replace('free_ip_', ''), used: parseInt(val || '0') };
    }));

    // المشتركون
    const validKeys = await kvKeys('valid_*');
    const subscribers = await Promise.all(validKeys.map(async k => {
      const code = k.replace('valid_', '');
      const expiry = parseInt(await kvGet('exp_' + code) || '0');
      const daily = parseInt(await kvGet(`daily_${code}_${today}`) || '0');
      const isActive = expiry === 0 || Date.now() < expiry;
      const daysLeft = expiry === 0 ? -1 : Math.ceil((expiry - Date.now()) / (1000*60*60*24));
      return { code, expiry, daysLeft, daily, isActive };
    }));

    // توليدات اليوم
    const dailyKeys = await kvKeys(`daily_*_${today}`);
    let totalToday = 0;
    for (const k of dailyKeys) {
      const val = await kvGet(k);
      totalToday += parseInt(val || '0');
    }

    // التقييمات
    let reviews = [];
    try {
      const r = await fetch('https://midaad.vercel.app/api/reviews');
      const d = await r.json();
      reviews = d.reviews || [];
    } catch(e) {}

    const activeCount = subscribers.filter(s => s.isActive).length;

    return res.status(200).json({
      freeUsers,
      subscribers,
      totalToday,
      activeCount,
      reviews,
      revenue: {
        monthly: (activeCount * 14.99).toFixed(2),
        openai: (activeCount * 2.7).toFixed(2),
        net: (activeCount * 12.29).toFixed(2)
      }
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
