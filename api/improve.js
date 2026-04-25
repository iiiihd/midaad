module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { post, lang, code } = req.body;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const VIP_CODES = new Set(['AH80','KSH23','MDVIP80']);

  // يجب أن يكون مشتركاً
  const upperCode = code?.toUpperCase();
  if (!upperCode || upperCode === 'FREE') {
    return res.status(401).json({ error: 'SUBSCRIBE_REQUIRED' });
  }

  if (!VIP_CODES.has(upperCode)) {
    try {
      const r = await fetch(`${KV_URL}/get/${encodeURIComponent('valid_' + upperCode)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const d = await r.json();
      if (!d.result) return res.status(401).json({ error: 'SUBSCRIBE_REQUIRED' });
    } catch(e) {
      return res.status(401).json({ error: 'SUBSCRIBE_REQUIRED' });
    }
  }

  const prompt = lang === 'en' ?
    `Improve this social media post to maximize engagement. Make the hook stronger, the CTA more compelling, and increase emotional impact. Return the improved post ONLY, no explanation:
"${post}"` :
    `حسّن هذا البوست عشان يجيب أكبر قدر من التفاعل. خلّ الجذب أقوى، الدعوة للتصرف أوضح، والتأثير العاطفي أعمق. أرجع البوست المحسّن فقط بدون شرح:
"${post}"`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.7
      })
    });
    const data = await response.json();
    const improved = data.choices?.[0]?.message?.content?.trim() || '';
    return res.status(200).json({ improved });
  } catch(e) {
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
}
