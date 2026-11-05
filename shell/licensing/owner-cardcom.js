// אימות תשלום של הרשמה במחשב של מנהל-העל — ישירות מול Cardcom (החלטת הבעלים 5.11.2026).
// אישור התשלום שמגיע משרת הרישוי אינו חתום (המפתח של השרת נמצא עליו), ולכן לפני חשבונית והנפקה בתשלום מנהל-העל
// שואל את Cardcom בעצמו: LowProfile/GetLpResult (API גרסה 11, כמו server/payments/cardcom-provider.js).
// פרטי המסוף (מספר מסוף ושם API) נשמרים רק אצל מנהל-העל, מוצפנים במפתח השורש (SEALED_OWNER_FILES), ולא נשלחים לשרת הרישוי.
// הפנייה — דרך fetchImpl של התהליך הראשי (net.fetch, תעודות Windows / נטפרי); אין כאן fetch ישיר.
'use strict';

const CARDCOM_BASE = 'https://secure.cardcom.solutions';
const LP_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TIMEOUT_MS = 20000;

// verified — התשלום אומת; mismatch / unpaid — אין להנפיק; unavailable — לא נבדק (רשת, שגיאה של Cardcom,
// הרשמה בלי מזהה עסקה) ← אישור ידני כמו בלי חיבור ל-Cardcom
const CHECK_STATUSES = ['verified', 'mismatch', 'unpaid', 'unavailable'];

// פרטי המסוף מהמסך — קלט לא מהימן
function normalizeCardcomCredentials(input) {
  const x = input && typeof input === 'object' ? input : {};
  const terminal = Number(String(x.terminal ?? '').trim());
  if (!Number.isSafeInteger(terminal) || terminal <= 0 || terminal > 99999999) throw new Error('מספר המסוף של Cardcom אינו תקין');
  const apiName = String(x.apiName ?? '').trim();
  if (!apiName || apiName.length > 100 || /[\u0000-\u001f\u007f]/.test(apiName)) throw new Error('שם ה-API של Cardcom אינו תקין');
  return { terminal, apiName };
}

const fmt = (ag) => '₪' + (ag / 100).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const result = (status, message, extra = {}) => ({ status, message, ...extra });

// payment — מההרשמה (מהשרת, לא מהימן): { id, checkoutId, amountAgorot, providerRef }
async function verifyCardcomPayment({ creds, payment, fetchImpl, base = CARDCOM_BASE, timeoutMs = TIMEOUT_MS }) {
  const c = normalizeCardcomCredentials(creds);
  const p = payment && typeof payment === 'object' ? payment : {};
  const want = p.amountAgorot;
  if (!Number.isSafeInteger(want) || want <= 0) return result('mismatch', 'בהרשמה אין סכום תשלום תקין — אין להנפיק');
  const lpId = String(p.checkoutId || '');
  if (!LP_ID.test(lpId)) {
    return result('unavailable', 'בהרשמה אין מזהה עסקה של Cardcom (הרשמה משרת רישוי מגרסה קודמת) — לא ניתן לאמת אוטומטית');
  }
  if (typeof fetchImpl !== 'function') return result('unavailable', 'אין במכשיר הזה חיבור לרשת לאימות מול Cardcom', { lowProfileId: lpId });
  let r;
  try {
    const res = await fetchImpl(base + '/api/v11/LowProfile/GetLpResult', { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ TerminalNumber: c.terminal, ApiName: c.apiName, LowProfileId: lpId }),
      signal: AbortSignal.timeout(timeoutMs) });
    if (!res || !res.ok) return result('unavailable', 'שרת Cardcom החזיר שגיאה' + (res && res.status ? ' (' + Number(res.status) + ')' : '') + ' — לא ניתן לאמת כעת', { lowProfileId: lpId });
    r = await res.json();
  } catch {
    return result('unavailable', 'אין חיבור לשרת Cardcom — לא ניתן לאמת כעת', { lowProfileId: lpId });
  }
  if (!r || typeof r !== 'object') return result('unavailable', 'תשובה לא תקינה מ-Cardcom — לא ניתן לאמת כעת', { lowProfileId: lpId });
  // שגיאה של Cardcom (פרטי מסוף שגויים, עסקה שלא נמצאה) — לא אומת; בדיקה ידנית במערכת Cardcom
  if (r.ResponseCode !== 0) {
    return result('unavailable', 'Cardcom לא אישרה את הבדיקה: ' + String(r.Description || r.ResponseCode).slice(0, 200) + ' — יש לבדוק את פרטי המסוף, או את התשלום ידנית', { lowProfileId: lpId });
  }
  if (Number(r.TerminalNumber) !== c.terminal || String(r.LowProfileId || '').toLowerCase() !== lpId.toLowerCase()) {
    return result('mismatch', 'תשובת Cardcom אינה של המסוף או של העסקה הזו — אין להנפיק', { lowProfileId: lpId });
  }
  // ReturnValue — מזהה התשלום שהשרת שלח ל-Cardcom ביצירת הדף: העסקה שייכת לתשלום של ההרשמה הזו
  if (p.id && String(r.ReturnValue || '') !== String(p.id)) {
    return result('mismatch', 'העסקה ב-Cardcom שייכת לתשלום אחר — אין להנפיק', { lowProfileId: lpId });
  }
  const t = r.TranzactionInfo;
  if (!t || t.ResponseCode !== 0) return result('unpaid', 'לפי Cardcom התשלום לא הושלם — אין להנפיק', { lowProfileId: lpId });
  if (t.IsRefund) return result('unpaid', 'לפי Cardcom העסקה היא זיכוי / החזר — אין להנפיק', { lowProfileId: lpId });
  if (t.CoinId != null && Number(t.CoinId) !== 1) return result('mismatch', 'לפי Cardcom התשלום לא בוצע בשקלים — אין להנפיק', { lowProfileId: lpId });
  const paid = Math.round(Number(t.Amount) * 100);
  const tranzactionId = String(t.TranzactionId || r.TranzactionId || '');
  if (!Number.isSafeInteger(paid) || paid !== want) {
    return result('mismatch', `לפי Cardcom שולמו ${Number.isSafeInteger(paid) ? fmt(paid) : 'סכום לא ידוע'} ולא ${fmt(want)} — אין להנפיק`, { lowProfileId: lpId, tranzactionId });
  }
  if (p.providerRef && tranzactionId !== String(p.providerRef)) {
    return result('mismatch', 'מספר העסקה ב-Cardcom אינו תואם לאסמכתה שבהרשמה — אין להנפיק', { lowProfileId: lpId, tranzactionId });
  }
  return result('verified', `התשלום אומת מול Cardcom: ${fmt(paid)}, עסקה ${tranzactionId || '—'}`, { lowProfileId: lpId, tranzactionId, amountAgorot: paid });
}

module.exports = { verifyCardcomPayment, normalizeCardcomCredentials, CHECK_STATUSES, CARDCOM_BASE, LP_ID };
