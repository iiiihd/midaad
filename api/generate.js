export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { topic, platform, contentType, tone, count, code, deviceId } = req.body;

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const VIP_CODES = new Set(['AH80','AH23','SKY77','GEM55','ADEL23','KSH23']);

  async function kvGet(key) {
    try {
      const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const d = await r.json();
      return d.result;
    } catch(e) { return null; }
  }

  // Verify code
  if (!VIP_CODES.has(code?.toUpperCase())) {
    const valid = await kvGet('valid_' + code);
    if (!valid) return res.status(401).json({ error: 'كود غير صحيح' });

    const expiry = parseInt(await kvGet('exp_' + code) || '0');
    if (expiry > 0 && Date.now() > expiry) {
      return res.status(401).json({ error: 'انتهى اشتراكك، جدد الآن' });
    }

    const savedDevice = await kvGet('dev_' + code);
    if (savedDevice && savedDevice !== deviceId) {
      return res.status(401).json({ error: 'الكود مرتبط بجهاز آخر' });
    }
  }

  if (!topic) return res.status(400).json({ error: 'أدخل موضوعك أولاً' });

  const numVersions = Math.min(parseInt(count) || 1, 3);

  const twitterNote = platform === 'تويتر' ? 'كل نسخة يجب ألا تتجاوز 280 حرف.' : '';
  const hashtagNote = contentType === 'هاشتاقات' ? 'اكتب 15-20 هاشتاق مناسبة ومتنوعة.' : '';

  const prompt = `أنت خبير محترف في كتابة المحتوى العربي لمنصات التواصل الاجتماعي.

المنصة: ${platform}
نوع المحتوى: ${contentType}
الأسلوب: ${tone}
الموضوع/المنتج: ${topic}

${twitterNote}
${hashtagNote}

اكتب ${numVersions} نسخ${numVersions > 1 ? ' مختلفة تماماً' : ''} من ${contentType} لمنصة ${platform} بأسلوب ${tone}.
${numVersions > 1 ? 'كل نسخة يجب أن تكون مميزة ومختلفة في الأسلوب والبناء.' : ''}
استخدم الإيموجي المناسبة بذكاء.
اكتب بلغة عربية سليمة وجذابة.

${numVersions > 1 ? `اكتب الإجابة هكذا بالضبط (لا تضيف أي نص آخر):
النسخة 1:
[المحتوى]

النسخة 2:
[المحتوى]
${numVersions === 3 ? '\nالنسخة 3:\n[المحتوى]' : ''}` : 'اكتب المحتوى مباشرة بدون أي عناوين أو ترقيم:'}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        temperature: 0.8
      })
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    let results = [];
    if (numVersions > 1) {
      results = text.split(/النسخة \d+:/g).filter(p => p.trim());
    } else {
      results = [text.trim()];
    }

    if (results.length === 0) results = [text];

    return res.status(200).json({ results });
  } catch(e) {
    return res.status(500).json({ error: 'خطأ في الخادم، حاول مرة أخرى' });
  }
}
