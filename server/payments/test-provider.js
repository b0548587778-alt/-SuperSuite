// ספק תשלום לבדיקות בלבד — לא גובה כסף. מגיש דף "תשלום" בשרת עצמו עם שני כפתורים (הצלחה / כישלון),
// ושולח ל-webhook הודעה חתומה ב-HMAC-SHA256 — בדיוק כמו ספק אמיתי. מאפשר לבדוק את כל המסלול לפני שבוחרים חברת סליקה.
'use strict';
const crypto = require('crypto');

function createTestProvider({ publicUrl, secret = crypto.randomBytes(32).toString('hex') } = {}) {
  if (!publicUrl) throw new Error('ספק הבדיקות דורש כתובת שרת (publicUrl)');
  const checkouts = new Map(); // checkoutId → { amountAgorot, description }
  const sign = (body) => crypto.createHmac('sha256', secret).update(body).digest('hex');

  function createCheckout({ amountAgorot, description }) {
    if (!Number.isSafeInteger(amountAgorot) || amountAgorot <= 0) throw new Error('סכום לא תקין');
    const checkoutId = 'tst_' + crypto.randomBytes(12).toString('hex');
    checkouts.set(checkoutId, { amountAgorot, description: String(description || '') });
    return { checkoutId, url: `${publicUrl}/pay/test/${checkoutId}` };
  }

  function parseWebhook({ rawBody, headers }) {
    const got = String((headers && headers['x-test-signature']) || '');
    const want = sign(rawBody);
    if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) throw new Error('חתימת ה-webhook אינה תקינה');
    const j = JSON.parse(rawBody);
    if (!['paid', 'failed'].includes(j.status)) throw new Error('סטטוס לא מוכר');
    return { checkoutId: String(j.checkoutId), status: j.status, amountAgorot: Number(j.amountAgorot), providerRef: String(j.ref || '') };
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const page = (title, inner) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Arial,sans-serif;max-width:460px;margin:60px auto;padding:24px;border:1px solid #ddd;border-radius:12px;text-align:center}
.warn{background:#fff4d6;padding:8px;border-radius:8px}button{font-size:16px;padding:10px 18px;margin:6px;border-radius:8px;cursor:pointer}</style></head>
<body>${inner}</body></html>`;

  // דפי הבדיקה: GET מציג, POST "משלם" — ושולח webhook חתום לשרת עצמו
  const routes = {
    async get(id) {
      const c = checkouts.get(id);
      if (!c) return { status: 404, html: page('לא נמצא', '<p>דף התשלום לא נמצא או שפג תוקפו</p>') };
      return { status: 200, html: page('תשלום (בדיקה)', `<p class="warn">⚠ מצב בדיקה — לא מתבצע חיוב אמיתי</p>
<h2>${esc(c.description)}</h2><p>סכום: ₪${(c.amountAgorot / 100).toFixed(2)}</p>
<form method="post"><button name="result" value="paid">✔ סימולציית תשלום מוצלח</button><button name="result" value="failed">✖ סימולציית כישלון</button></form>`) };
    },
    async post(id, form, deliver) {
      const c = checkouts.get(id);
      if (!c) return { status: 404, html: page('לא נמצא', '<p>דף התשלום לא נמצא</p>') };
      const status = form.result === 'paid' ? 'paid' : 'failed';
      const rawBody = JSON.stringify({ checkoutId: id, status, amountAgorot: c.amountAgorot, ref: 'TEST-' + crypto.randomBytes(4).toString('hex') });
      await deliver({ rawBody, headers: { 'x-test-signature': sign(rawBody) } });
      checkouts.delete(id);
      return { status: 200, html: page('תשלום (בדיקה)', status === 'paid' ? '<h2>✔ התשלום התקבל (בדיקה)</h2><p>אפשר לחזור לתוכנה.</p>' : '<h2>התשלום לא הושלם</h2><p>אפשר לנסות שוב מהתוכנה.</p>') };
    },
  };

  return { name: 'test', createCheckout, parseWebhook, routes, _sign: sign };
}

module.exports = { createTestProvider };
