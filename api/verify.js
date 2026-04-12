export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, deviceId } = req.body;
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const VIP_CODES = new Set(['AH80','KSH23','MDVIP80']);

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

  const upperCode = code?.toUpperCase();

  if (VIP_CODES.has(upperCode)) {
    return res.status(200).json({ valid: true, type: 'vip', expiry: 0 });
  }

  const valid = await kvGet('valid_' + upperCode);
  if (!valid) return res.status(200).json({ valid: false, reason: 'invalid' });

  const expiry = parseInt(await kvGet('exp_' + upperCode) || '0');
  if (expiry > 0 && Date.now() > expiry) {
    return res.status(200).json({ valid: false, reason: 'expired' });
  }

  const savedDevice = await kvGet('dev_' + upperCode);
  if (savedDevice && savedDevice !== deviceId) {
    return res.status(200).json({ valid: false, reason: 'device' });
  }

  if (!savedDevice) {
    await kvSet('dev_' + upperCode, deviceId);
  }

  return res.status(200).json({ valid: true, type: 'monthly', expiry });
}
