module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { pin } = req.body;
  if (pin !== 'adelh2380') return res.status(401).json({ error: 'unauthorized' });

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const PADDLE_KEY = process.env.PADDLE_API_KEY;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  async function kvGet(key) {
    try {
      const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      return (await r.json()).result;
    } catch(e) { return null; }
  }

  async function kvKeys(pattern) {
    try {
      const r = await fetch(`${KV_URL}/keys/${encodeURIComponent(pattern)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      return (await r.json()).result || [];
    } catch(e) { return []; }
  }

  const today = new Date().toISOString().slice(0, 10);

  // ===== KV DATA =====
  const [freeKeys, validKeys, dailyKeys] = await Promise.all([
    kvKeys('free_ip_*'),
    kvKeys('valid_*'),
    kvKeys(`daily_*_${today}`)
  ]);

  const freeUsers = await Promise.all(freeKeys.map(async k => ({
    ip: k.replace('free_ip_', ''),
    used: parseInt(await kvGet(k) || '0')
  })));

  const subscribers = await Promise.all(validKeys.map(async k => {
    const code = k.replace('valid_', '');
    const [expiry, daily] = await Promise.all([
      kvGet('exp_' + code).then(v => parseInt(v || '0')),
      kvGet(`daily_${code}_${today}`).then(v => parseInt(v || '0'))
    ]);
    const isActive = expiry === 0 || Date.now() < expiry;
    const daysLeft = expiry === 0 ? -1 : Math.ceil((expiry - Date.now()) / (1000*60*60*24));
    return { code, expiry, daysLeft, daily, isActive };
  }));

  let totalToday = 0;
  for (const k of dailyKeys) {
    totalToday += parseInt(await kvGet(k) || '0');
  }

  // ===== PADDLE DATA =====
  let paddleData = { transactions: [], subscriptions: [], mrr: 0, totalRevenue: 0, activeCount: 0 };
  try {
    const [txRes, subRes] = await Promise.all([
      fetch('https://api.paddle.com/transactions?per_page=50&status=completed', {
        headers: { Authorization: `Bearer ${PADDLE_KEY}` }
      }),
      fetch('https://api.paddle.com/subscriptions?per_page=50', {
        headers: { Authorization: `Bearer ${PADDLE_KEY}` }
      })
    ]);

    const txData = await txRes.json();
    const subData = await subRes.json();

    const transactions = txData.data || [];
    const subscriptions = subData.data || [];

    // حساب الإيرادات بعد عمولة Paddle (5% + $0.50 لكل معاملة)
    let grossRevenue = 0;
    let paddleFees = 0;
    transactions.forEach(tx => {
      const amount = parseFloat(tx.details?.totals?.grand_total || '0') / 100;
      const fee = amount * 0.05 + 0.50;
      grossRevenue += amount;
      paddleFees += fee;
    });

    const activeCount = subscriptions.filter(s => s.status === 'active').length;
    const mrr = activeCount * 14.99;

    paddleData = {
      transactions: transactions.slice(0, 10).map(tx => ({
        id: tx.id,
        amount: parseFloat(tx.details?.totals?.grand_total || '0') / 100,
        email: tx.customer?.email || '—',
        date: tx.created_at?.slice(0, 10) || '—',
        status: tx.status
      })),
      subscriptions: subscriptions.slice(0, 10).map(s => ({
        id: s.id,
        status: s.status,
        email: s.customer?.email || '—',
        nextBilling: s.next_billed_at?.slice(0, 10) || '—'
      })),
      grossRevenue: grossRevenue.toFixed(2),
      paddleFees: paddleFees.toFixed(2),
      netRevenue: (grossRevenue - paddleFees).toFixed(2),
      mrr: mrr.toFixed(2),
      activeCount
    };
  } catch(e) {
    paddleData.error = e.message;
  }

  // ===== OPENAI USAGE =====
  let openaiData = { balance: null, used: null, error: null };
  try {
    // جلب الاستخدام من OpenAI
    const startDate = new Date();
    startDate.setDate(1);
    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = new Date().toISOString().slice(0, 10);

    const usageRes = await fetch(
      `https://api.openai.com/v1/usage?date=${endStr}`,
      { headers: { Authorization: `Bearer ${OPENAI_KEY}` } }
    );
    const usageData = await usageRes.json();

    // حساب التكلفة التقريبية
    const totalTokens = usageData.data?.reduce((sum, d) => sum + (d.n_context_tokens_total || 0) + (d.n_generated_tokens_total || 0), 0) || 0;
    const estimatedCost = (totalTokens / 1000000 * 0.15).toFixed(4); // gpt-4o-mini

    openaiData = {
      totalTokensToday: totalTokens,
      estimatedCostToday: estimatedCost,
      model: 'gpt-4o-mini'
    };
  } catch(e) {
    openaiData.error = 'تعذر جلب بيانات OpenAI';
  }

  // ===== REVIEWS =====
  let reviews = [];
  try {
    const r = await fetch('https://midaad.vercel.app/api/reviews');
    reviews = (await r.json()).reviews || [];
  } catch(e) {}

  const activeKVCount = subscribers.filter(s => s.isActive).length;

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    freeUsers,
    subscribers,
    totalToday,
    activeCount: activeKVCount,
    reviews,
    paddle: paddleData,
    openai: openaiData
  });
}
