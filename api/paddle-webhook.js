export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end();

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const MAILJET_KEY = process.env.MAILJET_API_KEY;
  const MAILJET_SECRET = process.env.MAILJET_SECRET_KEY;
  const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function generateCode() {
    let code = 'MD';
    for (let i = 0; i < 6; i++) {
      code += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return code;
  }

  async function getCustomerEmail(customerId) {
    try {
      const r = await fetch(`https://api.paddle.com/customers/${customerId}`, {
        headers: { Authorization: `Bearer ${PADDLE_API_KEY}` }
      });
      const d = await r.json();
      return { email: d?.data?.email || '', name: d?.data?.name || '' };
    } catch(e) { return { email: '', name: '' }; }
  }

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

  async function sendEmail(toEmail, toName, code) {
    const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#080810;color:#F2F0EC;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center;border-bottom:1px solid rgba(201,168,76,0.3);">
        <div style="font-size:28px;font-weight:900;color:#E8C96A;letter-spacing:3px;">مِداد</div>
        <div style="font-size:13px;color:#A8A6B8;margin-top:4px;">مولد المحتوى الذكي</div>
      </div>
      <div style="padding:32px;text-align:center;">
        <h2 style="font-size:20px;color:#F2F0EC;margin-bottom:8px;">✅ تم الدفع بنجاح!</h2>
        <p style="font-size:14px;color:#A8A6B8;margin-bottom:8px;">أهلاً ${toName || 'عزيزي العميل'}! كود دخولك جاهز 🎉</p>
        <p style="font-size:12px;background:#2A1A00;border:1px solid #F59E0B;border-radius:8px;padding:8px;color:#FCD34D;margin-bottom:16px;">⚠️ إذا لم تجد هذا الإيميل، تحقق من مجلد <b>البريد غير الهام / Spam</b></p>
        <div style="background:#1E1E35;border:2px solid rgba(201,168,76,0.4);border-radius:16px;padding:24px;margin-bottom:24px;">
          <div style="font-size:12px;color:#A8A6B8;margin-bottom:8px;">كود الدخول الخاص بك</div>
          <div style="font-size:32px;font-weight:900;color:#E8C96A;letter-spacing:6px;">${code}</div>
        </div>
        <a href="https://midaad.vercel.app" style="display:inline-block;background:linear-gradient(135deg,#C9A84C,#A07830);color:#080810;text-decoration:none;border-radius:12px;padding:14px 32px;font-size:15px;font-weight:800;">افتح مِداد الآن ←</a>
        <div style="margin-top:24px;padding:16px;background:#131325;border-radius:12px;text-align:right;">
          <p style="font-size:12px;color:#A8A6B8;margin-bottom:6px;">⚠️ الكود يعمل على جهاز واحد فقط</p>
          <p style="font-size:12px;color:#A8A6B8;margin-bottom:6px;">⏰ مدة الاشتراك: 30 يوم</p>
          <p style="font-size:12px;color:#A8A6B8;">📱 احفظ هذا الإيميل للرجوع إليه</p>
        </div>
      </div>
      <div style="padding:16px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);">
        <p style="font-size:11px;color:#6A6880;">مِداد — مولد المحتوى العربي الذكي</p>
      </div>
    </div>`;

    const auth = Buffer.from(`${MAILJET_KEY}:${MAILJET_SECRET}`).toString('base64');
    await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: JSON.stringify({
        Messages: [{
          From: { Email: 'midaad.app@gmail.com', Name: 'مِداد' },
          To: [{ Email: toEmail, Name: toName || 'عزيزي العميل' }],
          Subject: '🖋️ كود دخول مِداد — ابدأ الآن!',
          HTMLPart: html
        }]
      })
    });
  }

  try {
    const body = req.body;
    const eventType = body?.event_type || '';
    console.log('Paddle event:', eventType);
    console.log('Paddle data:', JSON.stringify(body?.data)?.substring(0, 500));
    console.log('Customer:', JSON.stringify(body?.data?.customer));
    console.log('Full body keys:', Object.keys(body || {}).join(','));

    if (eventType === 'subscription.created' || eventType === 'transaction.completed') {
      const customerId = body?.data?.customer_id || body?.data?.customer?.id || '';
      let userEmail = body?.data?.customer?.email || '';
      let userName = body?.data?.customer?.name || '';

      if (!userEmail && customerId) {
        const customer = await getCustomerEmail(customerId);
        userEmail = customer.email;
        userName = customer.name;
      }

      console.log('Customer ID:', customerId, 'Email:', userEmail);
      const subscriptionId = body?.data?.id || '';

      if (userEmail) {
        const oldCode = await kvGet('email_' + userEmail);
        let code;

        if (oldCode) {
          code = oldCode;
          const newExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
          await kvSet('exp_' + code, String(newExpiry));
        } else {
          code = generateCode();
          while (await kvGet('valid_' + code)) {
            code = generateCode();
          }
          const expiryTimestamp = Date.now() + 30 * 24 * 60 * 60 * 1000;
          await kvSet('valid_' + code, 'monthly');
          await kvSet('exp_' + code, String(expiryTimestamp));
          await kvSet('email_' + userEmail, code);
        }

        if (subscriptionId) {
          await kvSet('paddle_' + subscriptionId, code);
        }

        await sendEmail(userEmail, userName, code);
        console.log('Code sent to:', userEmail, 'code:', code);
      }
    }

    if (eventType === 'subscription.renewed') {
      const userEmail = body?.data?.customer?.email || '';
      if (userEmail) {
        const code = await kvGet('email_' + userEmail);
        if (code) {
          const currentExpiry = parseInt(await kvGet('exp_' + code) || '0');
          const newExpiry = Math.max(currentExpiry, Date.now()) + 30 * 24 * 60 * 60 * 1000;
          await kvSet('exp_' + code, String(newExpiry));
          await sendEmail(userEmail, '', code);
          console.log('Renewed:', code);
        }
      }
    }

  } catch(e) {
    console.log('Error:', e.message);
  }

  res.status(200).end();
}
