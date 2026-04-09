export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end();

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const BREVO_KEY = process.env.BREVO_API_KEY;

  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function generateCode() {
    let code = 'MD';
    for (let i = 0; i < 6; i++) {
      code += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return code;
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
        <div style="font-size:48px;margin-bottom:8px;">🖋️</div>
        <div style="font-size:28px;font-weight:900;color:#E8C96A;letter-spacing:3px;">مِداد</div>
        <div style="font-size:13px;color:#A8A6B8;margin-top:4px;">مولد المحتوى الذكي</div>
      </div>
      <div style="padding:32px;text-align:center;">
        <h2 style="font-size:20px;color:#F2F0EC;margin-bottom:8px;">✅ تم الدفع بنجاح!</h2>
        <p style="font-size:14px;color:#A8A6B8;margin-bottom:24px;">أهلاً ${toName}! كود دخولك جاهز 🎉</p>
        
        <div style="background:#1E1E35;border:2px solid rgba(201,168,76,0.4);border-radius:16px;padding:24px;margin-bottom:24px;">
          <div style="font-size:12px;color:#A8A6B8;margin-bottom:8px;">كود الدخول الخاص بك</div>
          <div style="font-size:32px;font-weight:900;color:#E8C96A;letter-spacing:6px;">${code}</div>
        </div>

        <a href="https://midaad.vercel.app" style="display:inline-block;background:linear-gradient(135deg,#C9A84C,#A07830);color:#080810;text-decoration:none;border-radius:12px;padding:14px 32px;font-size:15px;font-weight:800;">
          افتح مِداد الآن ←
        </a>

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

    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_KEY
      },
      body: JSON.stringify({
        sender: { name: 'مِداد', email: 'midaad.app@gmail.com' },
        to: [{ email: toEmail, name: toName || 'عزيزي العميل' }],
        subject: '🖋️ كود دخول مِداد — ابدأ الآن!',
        htmlContent: html
      })
    });
  }

  try {
    const body = req.body;
    const eventName = body?.meta?.event_name || '';
    console.log('Midaad event:', eventName);

    if (eventName === 'order_created' || eventName === 'subscription_created') {
      const userEmail = body?.data?.attributes?.user_email || '';
      const userName = body?.data?.attributes?.user_name || 'عزيزي العميل';
      const orderId = body?.data?.id || '';

      if (userEmail) {
        const oldCode = await kvGet('email_' + userEmail);
        let code;

        if (oldCode) {
          code = oldCode;
          const currentExpiry = parseInt(await kvGet('exp_' + code) || '0');
          const newExpiry = Math.max(currentExpiry, Date.now()) + 30 * 24 * 60 * 60 * 1000;
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

        if (orderId) {
          await kvSet('order_' + orderId, code);
        }

        await sendEmail(userEmail, userName, code);
        console.log('Code sent to:', userEmail, 'code:', code);
      }
    }

    if (eventName === 'subscription_payment_success') {
      const userEmail = body?.data?.attributes?.user_email || '';
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
