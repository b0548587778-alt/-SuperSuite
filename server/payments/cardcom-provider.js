// ספק תשלום: Cardcom (קארדקום) — דף תשלום מאובטח ("פרופיל נמוך"), API גרסה 11.
// לפי מפרט ה-OpenAPI הרשמי: https://secure.cardcom.solutions/swagger/v11/swagger.json
//   POST /api/v11/LowProfile/Create      — יצירת דף תשלום (מחזיר LowProfileId + Url)
//   POST /api/v11/LowProfile/GetLpResult — תוצאת העסקה לפי LowProfileId
//
// אבטחה: ה-webhook של Cardcom אינו חתום. לכן לא סומכים על תוכן ההודעה — לוקחים ממנה רק את LowProfileId,
// ושואלים את Cardcom ישירות (GetLpResult, עם שם ה-API של המסוף) מה קרה בעסקה. מי שמזייף webhook
// מקבל לכל היותר את התשובה האמיתית של Cardcom.
//
// חשבונית: Cardcom מפיקה חשבונית מס-קבלה אוטומטית (Document) — תשלום על רישיון הוא מכירה, לא תרומה.
// פרטי המסוף מגיעים ממשתני סביבה בשרת בלבד — לא בקוד ולא בקבצי הפרויקט:
//   SS_CARDCOM_TERMINAL — מספר המסוף, SS_CARDCOM_API_NAME — שם ה-API (מתוך ממשק הניהול של Cardcom)
'use strict';

const BASE = 'https://secure.cardcom.solutions';
// דף התשלום — רק בדומיין של Cardcom (f86; אותה רשימה בלקוח — PAYMENT_HOSTS ב-shell/licensing/checkin.js)
const PAY_HOSTS = ['secure.cardcom.solutions'];
function payHost(url) {
  try { const u = new URL(String(url || '')); return u.protocol === 'https:' && !u.port && PAY_HOSTS.includes(u.hostname.toLowerCase()); } catch { return false; }
}
const LP_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function createCardcomProvider({ publicUrl, env = {}, fetchImpl = globalThis.fetch, base = BASE } = {}) {
  const terminal = Number(env.SS_CARDCOM_TERMINAL);
  const apiName = String(env.SS_CARDCOM_API_NAME || '');
  if (!Number.isSafeInteger(terminal) || terminal <= 0) throw new Error('חסר מספר מסוף של Cardcom (משתנה הסביבה SS_CARDCOM_TERMINAL)');
  if (!apiName) throw new Error('חסר שם API של Cardcom (משתנה הסביבה SS_CARDCOM_API_NAME)');
  let site;
  try { site = new URL(String(publicUrl || '')); } catch { throw new Error('Cardcom דורש כתובת שרת ציבורית (--public-url https://...)'); }
  if (site.protocol !== 'https:') throw new Error('Cardcom דורש כתובת שרת ב-https://');
  const root = site.origin;

  async function call(path, body) {
    let res;
    try {
      res = await fetchImpl(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000) });
    } catch { throw new Error('אין חיבור לשרת התשלומים של Cardcom'); }
    let j = null;
    try { j = await res.json(); } catch { /* ייבדק למטה */ }
    if (!res.ok || !j) throw new Error('תשובה לא תקינה מ-Cardcom');
    return j;
  }

  // הסכום באגורות שלמות; ל-Cardcom נשלח בשקלים עם שתי ספרות
  async function createCheckout({ paymentId, amountAgorot, description, customer = {} }) {
    if (!Number.isSafeInteger(amountAgorot) || amountAgorot <= 0) throw new Error('סכום לא תקין');
    const amount = amountAgorot / 100;
    const name = String(customer.org || customer.name || 'לקוח').slice(0, 100);
    const r = await call('/api/v11/LowProfile/Create', {
      TerminalNumber: terminal, ApiName: apiName, Operation: 'ChargeOnly',
      ReturnValue: String(paymentId), Amount: amount, ISOCoinId: 1, Language: 'he',
      SuccessRedirectUrl: root + '/pay/done', FailedRedirectUrl: root + '/pay/failed', CancelRedirectUrl: root + '/pay/failed',
      WebHookUrl: root + '/pay/webhook', ProductName: String(description || '').slice(0, 200),
      Document: {
        Name: name, TaxId: String(customer.taxId || '').replace(/\D/g, '').slice(0, 9) || undefined,
        Email: customer.email || undefined, Mobile: customer.phone || undefined, IsSendByEmail: !!customer.email,
        Products: [{ Description: String(description || 'רישיון שנתי').slice(0, 200), Quantity: 1, UnitCost: amount, TotalLineCost: amount }],
      },
    });
    if (r.ResponseCode !== 0 || !LP_ID.test(String(r.LowProfileId || '')) || !payHost(r.Url)) {
      throw new Error('Cardcom לא יצר דף תשלום: ' + String(r.Description || r.ResponseCode));
    }
    return { checkoutId: r.LowProfileId, url: r.Url };
  }

  // מזהה העסקה מתוך ההודעה — JSON או טופס. שאר התוכן אינו משמש
  function lowProfileIdOf(rawBody) {
    let id = '';
    try { const j = JSON.parse(rawBody); id = j && (j.LowProfileId || j.lowprofilecode); } catch {
      const q = new URLSearchParams(String(rawBody || ''));
      id = q.get('LowProfileId') || q.get('lowprofilecode') || '';
    }
    id = String(id || '');
    if (!LP_ID.test(id)) throw new Error('הודעת התשלום אינה כוללת מזהה עסקה תקין');
    return id;
  }

  // תוצאת העסקה לפי LowProfileId — משותף ל-webhook ולהתאמה ביוזמת השרת (lookup, f15)
  async function parseWebhook({ rawBody }) { return result(lowProfileIdOf(rawBody)); }
  async function lookup({ checkoutId }) {
    const id = String(checkoutId || '');
    if (!LP_ID.test(id)) throw new Error('מזהה עסקה לא תקין');
    return result(id);
  }
  async function result(id) {
    const r = await call('/api/v11/LowProfile/GetLpResult', { TerminalNumber: terminal, ApiName: apiName, LowProfileId: id });
    if (r.ResponseCode !== 0) throw new Error('Cardcom: ' + String(r.Description || 'העסקה לא נמצאה'));
    if (Number(r.TerminalNumber) !== terminal || r.LowProfileId !== id) throw new Error('תשובת Cardcom אינה של המסוף הזה');
    const t = r.TranzactionInfo;
    // עסקה שלא הושלמה (כרטיס נדחה וכו') — הלקוח יכול לנסות שוב באותו דף, ולכן לא נועלים את התשלום
    if (!t || t.ResponseCode !== 0 || t.IsRefund) return { checkoutId: id, status: 'pending', amountAgorot: 0, providerRef: '' };
    if (t.CoinId != null && Number(t.CoinId) !== 1) throw new Error('התשלום לא בוצע בשקלים');
    return { checkoutId: id, status: 'paid', amountAgorot: Math.round(Number(t.Amount) * 100),
      providerRef: String(t.TranzactionId || r.TranzactionId || ''), paymentId: String(r.ReturnValue || '') };
  }

  return { name: 'cardcom', createCheckout, parseWebhook, lookup };
}

module.exports = { createCardcomProvider, LP_ID, PAY_HOSTS };
