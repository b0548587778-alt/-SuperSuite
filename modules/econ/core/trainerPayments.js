// תשלומי מנויים ממודול האימונים ← חשבונית מס/קבלה במערכת הכלכלית (PLAN.md 9.11).
// מודול האימונים לא שולח כלום: main.js קורא את המחסן המוצפן שלו (shell/secure-store.js) רק כשהמערכת הכלכלית מבקשת,
// ורק מתצוגת המודול הכלכלי. כאן — פונקציות טהורות: קריאה ובדיקה של הנתונים, ושיוך לחשבוניות שכבר הופקו.
// הנתונים מגיעים מעמוד (localStorage) — ולכן נבדקים כקלט לא מהימן: רשומה פגומה מדולגת, לא מפילה את הרשימה.

const ID = /^[A-Za-z0-9_-]{1,64}$/;
// תאריך אמיתי בלבד: 2026-02-31 נדחה (Date.parse מגלגל אותו ל-3.3)
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10))).toISOString().slice(0, 10) === v;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const MAX_AG = 100_000_000; // מיליון ₪ — כמו התקרה בגבייה

// אמצעי התשלום במודול האימונים (studio.js → PAY_METHODS) ← אמצעי התשלום בקבלה (salesDocs → PAYMENT_METHODS)
const METHODS = { cash: 'cash', transfer: 'transfer', card: 'card', check: 'check', app: 'other' };
const METHOD_LABELS = { cash: 'מזומן', transfer: 'העברה בנקאית', card: 'כרטיס אשראי', check: 'שיק', app: 'אפליקציית תשלום' };

const keyOf = (clientId, membershipId, paymentId) => `${clientId}/${membershipId}/${paymentId}`;

function parse(items, k) {
  const v = items[k];
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}

// items: מפתח ← מחרוזת JSON (כמו localStorage של מודול האימונים). מחזיר את כל התשלומים, מהחדש לישן
function readPayments(items) {
  if (!items || typeof items !== 'object') return [];
  const index = parse(items, 'clients:index');
  const ids = Array.isArray(index) ? index.filter(id => typeof id === 'string' && ID.test(id)) : [];
  const out = [];
  for (const clientId of new Set(ids)) {
    const client = parse(items, `client:${clientId}`);
    const memberships = parse(items, `memberships:${clientId}`);
    if (!client || typeof client !== 'object' || !Array.isArray(memberships)) continue;
    const clientName = clip(client.name, 120);
    if (!clientName) continue;
    for (const m of memberships) {
      if (!m || typeof m !== 'object' || !ID.test(String(m.id || '')) || !Array.isArray(m.payments)) continue;
      for (const p of m.payments) {
        if (!p || typeof p !== 'object' || !ID.test(String(p.id || ''))) continue;
        if (!Number.isSafeInteger(p.amountAg) || p.amountAg <= 0 || p.amountAg > MAX_AG || !isDate(p.date)) continue;
        out.push({
          key: keyOf(clientId, m.id, p.id), clientId, clientName, clientPhone: clip(client.phone, 30),
          membershipId: m.id, membershipName: clip(m.name, 120) || 'מנוי', cancelled: !!m.cancelledAt,
          paymentId: p.id, date: p.date, amountAg: p.amountAg,
          method: METHODS[p.method] ? p.method : 'app', methodLabel: METHOD_LABELS[p.method] || 'אחר', note: clip(p.note, 200),
        });
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key < b.key ? -1 : 1));
}

// מתאמנים למאגר האנשים (PLAN.md 6.4): שם, טלפון ומנויים — קריאה בלבד, בלי מידע רפואי או מדידות
function readClients(items, today) {
  if (!items || typeof items !== 'object') return [];
  const index = parse(items, 'clients:index');
  const ids = Array.isArray(index) ? index.filter(id => typeof id === 'string' && ID.test(id)) : [];
  const out = [];
  for (const clientId of new Set(ids)) {
    const client = parse(items, `client:${clientId}`);
    if (!client || typeof client !== 'object') continue;
    const name = clip(client.name, 120);
    if (!name) continue;
    const ms = parse(items, `memberships:${clientId}`);
    const memberships = (Array.isArray(ms) ? ms : []).filter(m => m && typeof m === 'object' && ID.test(String(m.id || ''))).map(m => {
      const paidAg = (Array.isArray(m.payments) ? m.payments : []).reduce((s, p) => s + (Number.isSafeInteger(p && p.amountAg) && p.amountAg > 0 && p.amountAg <= MAX_AG ? p.amountAg : 0), 0);
      const priceAg = Number.isSafeInteger(m.priceAg) && m.priceAg >= 0 && m.priceAg <= MAX_AG ? m.priceAg : 0;
      const start = isDate(m.start) ? m.start : '';
      const end = isDate(m.end) ? m.end : '';
      // פעיל — כמו membershipStatus במודול (studio.js): לא בוטל, בטווח התאריכים, וכרטיסייה שלא נוצלה כולה
      const sessions = Number.isSafeInteger(m.sessions) && m.sessions >= 0 ? m.sessions : null;
      const used = Array.isArray(m.uses) ? m.uses.length : 0;
      const exhausted = sessions !== null && used >= sessions;
      const active = !m.cancelledAt && !exhausted && (!start || !today || start <= today) && (!end || !today || end >= today);
      // מנוי שבוטל — בלי חוב בשורה (גם הסכום הכולל במאגר האנשים לא סופר אותו)
      const dueAg = m.cancelledAt ? 0 : Math.max(0, priceAg - paidAg);
      return { id: m.id, name: clip(m.name, 120) || 'מנוי', start, end, cancelled: !!m.cancelledAt, active, priceAg, paidAg, dueAg };
    });
    out.push({ clientId, name, phone: clip(client.phone, 30), since: isDate(String(client.createdAt || '').slice(0, 10)) ? String(client.createdAt).slice(0, 10) : '', memberships });
  }
  return out;
}

// חשבונית שהופקה לתשלום (ולא בוטלה) — לפי המפתח שנשמר בה
function receiptFor(invoices, key) {
  return (invoices || []).find(i => i.trainerPayment && i.trainerPayment.key === key && i.status !== 'cancelled') || null;
}

// חשבוניות אימונים בתוקף שהתשלום שלהן כבר לא קיים במודול (נמחק, או שוחזר גיבוי ישן) — החשבונית נשארה בתוקף
function orphanReceipts(payments, invoices) {
  const keys = new Set((payments || []).map(p => p.key));
  return (invoices || []).filter(i => i && i.trainerPayment && i.status !== 'cancelled' && !keys.has(String(i.trainerPayment.key || '')));
}

const invoiceAg = (inv) => Math.round(Number(inv.total) * 100);

// חשד לחשבונית כפולה (בדיקת קוד 20.10.2026, ממצא 3): במודול אין עריכת תשלום, ולכן מתקנים במחיקה והזנה מחדש.
// התשלום החדש מקבל מפתח חדש, וחשבונית נוספת עליו = אותו כסף פעמיים בהכנסות ובמע"מ.
// לתשלום בלי חשבונית — חשבוניות בתוקף של אותו מתאמן (clientId) ובאותו סכום:
//   orphan — התשלום של החשבונית כבר לא קיים (כל תאריך: לרוב מזינים מחדש כדי לתקן תאריך או אמצעי);
//   same-date — התשלום שלה קיים, אבל באותו תאריך (ייתכן שהתשלום הוזן פעמיים במודול).
// אזהרה בלבד — לא חוסם: ייתכנו שני תשלומים זהים אמיתיים, וההחלטה של המשתמש
function duplicateCandidates(p, payments, invoices) {
  if (!p || receiptFor(invoices, p.key)) return [];
  const byKey = new Map((payments || []).map(x => [x.key, x]));
  const out = [];
  for (const inv of invoices || []) {
    const tp = inv && inv.trainerPayment;
    if (!tp || inv.status === 'cancelled' || String(tp.clientId || '') !== p.clientId || invoiceAg(inv) !== p.amountAg) continue;
    const paid = byKey.get(String(tp.key || ''));
    const reason = !paid ? 'orphan' : (paid.key !== p.key && inv.date === p.date ? 'same-date' : null);
    if (reason) out.push({ invoiceId: inv.id, invoiceNumber: inv.number, date: inv.date, reason });
  }
  return out;
}

// נוסח האזהרה בעברית (לרשימה ולחלון האישור במסך הגבייה)
function duplicateWarning(list) {
  if (!list || !list.length) return '';
  const nums = list.map(d => d.invoiceNumber).join(', ');
  const orphan = list.some(d => d.reason === 'orphan');
  return `⚠ ייתכן שכבר הופקה חשבונית על התשלום הזה (מספר ${nums}): ` +
    (orphan ? 'נמצאה חשבונית בתוקף לאותו מתאמן ובאותו סכום, שהתשלום שלה נמחק במודול האימונים. '
      : 'נמצאה חשבונית בתוקף לאותו מתאמן, באותו תאריך ובאותו סכום. ') +
    'אם זה אותו תשלום — אין להפיק שוב; אם החשבונית הקודמת שגויה — יש לבטל אותה במסך החשבוניות.';
}

function withReceipts(payments, invoices) {
  return payments.map(p => {
    const inv = receiptFor(invoices, p.key);
    const dups = inv ? [] : duplicateCandidates(p, payments, invoices);
    return { ...p, amount: p.amountAg / 100, ...(inv ? { invoiceId: inv.id, invoiceNumber: inv.number } : {}),
      ...(dups.length ? { possibleDuplicateOf: dups, duplicateWarning: duplicateWarning(dups) } : {}) };
  });
}

// הנתונים לחשבונית מס/קבלה. הסכום כולל מע"מ (כך שולם) — המע"מ מחושב כהפרש
function invoiceInput(p) {
  return {
    customer: p.clientName, date: p.date, grossAgorot: p.amountAg,
    description: `${p.membershipName} — אימונים`,
    method: METHODS[p.method] || 'other',
    reference: p.note ? clip(p.note, 80) : '',
    trainerPayment: { key: p.key, clientId: p.clientId, membershipId: p.membershipId, paymentId: p.paymentId },
  };
}

module.exports = { METHODS, METHOD_LABELS, keyOf, readPayments, readClients, receiptFor, withReceipts, invoiceInput,
  orphanReceipts, duplicateCandidates, duplicateWarning };
