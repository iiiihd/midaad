module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { topic, platform, contentType, tone, count, code, deviceId, lang } = req.body;
  const language = lang || 'ar';

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const VIP_CODES = new Set(['AH80','KSH23','MDVIP80']);
  const DAILY_LIMIT = 50;

  async function kvGet(key) {
    try {
      const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const d = await r.json();
      return d.result;
    } catch(e) { return null; }
  }

  async function kvSet(key, value, expirySeconds) {
    try {
      let url = `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`;
      if (expirySeconds) url += `/ex/${expirySeconds}`;
      await fetch(url, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
    } catch(e) {}
  }

  const upperCode = code?.toUpperCase();
  const isVIP = VIP_CODES.has(upperCode);
  const numVersions = Math.min(parseInt(count) || 1, 3);
  let isSubscribed = false;
  let showAnalysis = false;

  if (!upperCode || upperCode === 'FREE') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.socket?.remoteAddress
      || deviceId;

    const freeKey = `free_ip_${ip}`;
    const freeUsed = parseInt(await kvGet(freeKey) || '0');
    if (freeUsed >= 3) {
      return res.status(401).json({ error: 'FREE_LIMIT' });
    }
    await kvSet(freeKey, String(freeUsed + 1));
    showAnalysis = freeUsed === 0; // أول توليد فقط
    isSubscribed = false;
  } else {
    if (!isVIP) {
      const valid = await kvGet('valid_' + upperCode);
      if (!valid) return res.status(401).json({ error: 'كود غير صحيح' });

      const expiry = parseInt(await kvGet('exp_' + upperCode) || '0');
      if (expiry > 0 && Date.now() > expiry) {
        return res.status(401).json({ error: 'انتهى اشتراكك، جدد الآن' });
      }

      const savedDevice = await kvGet('dev_' + upperCode);
      if (savedDevice && savedDevice !== deviceId) {
        return res.status(401).json({ error: 'الكود مرتبط بجهاز آخر' });
      }
    }

    const today = new Date().toISOString().slice(0,10);
    const dailyKey = `daily_${upperCode}_${today}`;
    const dailyCount = parseInt(await kvGet(dailyKey) || '0');
    const limit = isVIP ? DAILY_LIMIT : 30;
    if (dailyCount + numVersions > limit) {
      return res.status(429).json({ error: `⏰ وصلت للحد اليومي (${limit} توليد). عد غداً!` });
    }
    await kvSet(dailyKey, String(dailyCount + numVersions), 86400);
    isSubscribed = true;
    showAnalysis = true;
  }

  if (!topic) return res.status(400).json({ error: 'أدخل موضوعك أولاً' });

  const twitterNote = (platform === 'Twitter' || platform === 'تويتر') ? 'كل نسخة يجب ألا تتجاوز 280 حرف.' : '';
  const hashtagNote = (contentType === 'Hashtags' || contentType === 'هاشتاقات') ? 'اكتب 15-20 هاشتاق مناسبة ومتنوعة.' : '';

  const prompt = language === 'en' ?
    `You are a professional social media content writer. Write ALL content in ENGLISH ONLY.
Platform: ${platform} | Type: ${contentType} | Tone: ${tone}
Topic: ${topic}
Write ${numVersions} ${numVersions > 1 ? 'different versions' : 'version'} of ${contentType} for ${platform} in ${tone} tone. Use emojis.
${numVersions > 1 ? `Format:\nVersion 1:\n[content]\nVersion 2:\n[content]${numVersions === 3 ? '\nVersion 3:\n[content]' : ''}` : 'Write content directly:'}` :
    `أنت خبير محترف في كتابة المحتوى لمنصات التواصل الاجتماعي.
المنصة: ${platform} | نوع المحتوى: ${contentType} | الأسلوب: ${tone}
الموضوع: ${topic}
${twitterNote}${hashtagNote}اكتب بلغة عربية سليمة وجذابة.
اكتب ${numVersions} نسخ${numVersions > 1 ? ' مختلفة تماماً' : ''} من ${contentType} لمنصة ${platform} بأسلوب ${tone}. استخدم الإيموجي.
${numVersions > 1 ? `اكتب هكذا:\nالنسخة 1:\n[المحتوى]\nالنسخة 2:\n[المحتوى]${numVersions === 3 ? '\nالنسخة 3:\n[المحتوى]' : ''}` : 'اكتب المحتوى مباشرة:'}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
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
      results = text.split(/(?:النسخة|Version)\s*\d+:/g).filter(p => p.trim());
    } else {
      results = [text.trim()];
    }
    if (results.length === 0) results = [text];

    // Viral Score
    let analysis = null;
    if (showAnalysis && results[0]) {
      const analysisPrompt = language === 'en' ?
        `Analyze this social media post. Return ONLY valid JSON, no markdown:
Post: "${results[0].substring(0, 500)}"
{"score":<0-100>,"hook":"<weak|medium|strong>","engagement":"<low|medium|high>","cta":"<weak|medium|strong>","suggestions":["tip1","tip2","tip3"]}` :
        `حلل هذا البوست. أرجع JSON صحيح فقط بدون markdown:
البوست: "${results[0].substring(0, 500)}"
{"score":<0-100>,"hook":"<ضعيف|متوسط|قوي>","engagement":"<منخفض|متوسط|عالي>","cta":"<ضعيف|متوسط|قوي>","suggestions":["نصيحة1","نصيحة2","نصيحة3"]}`;

      try {
        const aRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: analysisPrompt }],
            max_tokens: 300,
            temperature: 0.3
          })
        });
        const aData = await aRes.json();
        const aText = aData.choices?.[0]?.message?.content || '';
        analysis = JSON.parse(aText.replace(/```json|```/g, '').trim());
      } catch(e) { analysis = null; }
    }

    return res.status(200).json({ results, isSubscribed, showAnalysis, analysis });

  } catch(e) {
    return res.status(500).json({ error: 'خطأ في الخادم، حاول مرة أخرى' });
  }
}
