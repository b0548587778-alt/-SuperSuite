// קליטת חשבונית ספק — מנתונים שהוקלדו (או שיועלו בעתיד מ-OCR) לטויוטת פקודת יומן.
// פונקציות טהורות: אין require ואין רשת (הקובץ נכלל גם בגרסת אנדרואיד).
// הכללים:
//  - החישוב באגורות (מספרים שלמים); המע"מ = סה"כ פחות נטו, כך שסה"כ תמיד שווה לסכום ששולם.
//  - אין המצאה: שדה חסר או סתירה בין הסכומים — אזהרה, לא ניחוש.
//  - הפלט הוא טיוטה בלבד. השמירה ביומן רק דרך acct:createEntry (validateEntry), לא כאן.
'use strict';

const pts = 100; // אגורות בשקל
const toAg = (n) => Math.round(Number(n) * pts);

// קודי חשבונות מערכתיים — עותק מקומי של SYS ב-core/accounting.js (הקובץ הזה טהור)
const SYS = { INPUT_VAT: '1300', AP: '2000' };

// ניקוי קלט משתמש: תווי בקרה הופכים לרווח, והטקסט נחתך
const str = (v, max) => String(v === undefined || v === null ? '' : v)
  .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 200);

// תאריך אמיתי בלבד: 2026-02-31 נדחה (Date.parse מגלגל אותו ל-3.3)
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))).toISOString().slice(0, 10) === s;

// מספר הקצאה: 9 ספרות, ונקרא כמספר (אפסים מובילים נופלים). הבדיקה מול הסף לפי תאריך
// היא באחריות core/allocation.js — כאן רק מחזירים את מה שהוקלד, בלי לפסוק
function allocationNumber(v) {
  const digits = String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 9) throw new Error('מספר ההקצאה חייב להכיל עד 9 ספרות');
  return Number(digits);
}

// מספר העוסק / ח"פ של הספק: ספרות בלבד, 5–9 ספרות (ריפוד באפסים ל-9), וספרת ביקורת —
// אותו אלגוריתם של core/israeliId.js (עותק מקומי, הקובץ טהור). ריק = '' (אזהרה בהמשך).
// לא קוטעים ולא מוותרים בשקט: 10 ספרות נקטעו בעבר ל-9, ו-8 ספרות הוציאו את החשבונית מ-PCN874 בלי אזהרה
function supplierTaxIdOf(v) {
  const digits = String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length < 5 || digits.length > 9) throw new Error('מספר העוסק / ח"פ של הספק חייב להכיל 5–9 ספרות');
  const id = digits.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(id[i]) * (i % 2 === 0 ? 1 : 2);
    if (d > 9) d -= 9;
    sum += d;
  }
  if (/^0+$/.test(id) || sum % 10 !== 0) throw new Error('מספר העוסק / ח"פ של הספק אינו תקין (ספרת ביקורת) — יש לבדוק מול החשבונית, או להשאיר ריק');
  return id;
}

// סכום בשקלים שהוקלד (או מספר) ← אגורות; ריק = null
function agOrNull(v, label) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const ag = toAg(String(v).trim().replace(/[,\s₪]/g, ''));
  if (!Number.isSafeInteger(ag) || ag < 0) throw new Error(`${label}: סכום לא תקין`);
  return ag;
}

/**
 * בונה טיוטת פקודת יומן לחשבונית ספק.
 * @param {object} input
 *   supplierName, supplierTaxId (ת"ז/ח"פ), docNumber, date (YYYY-MM-DD),
 *   gross (סה"כ כולל מע"מ — חובה), net (לפני מע"מ, רשות), vat (מע"מ, רשות),
 *   exempt (פטור ממע"מ), vatRate (0<r<1), expenseAccount (קוד 4-6 ספרות),
 *   allocation, memo
 * @param {object} options  { vatRate, expenseAccounts } — שיעור ברירת מחדל ורשימת קודי חשבונות הוצאה
 * @returns {{ entry, warnings, supplier: {name, taxId}, docNumber, allocation, totalAg }}
 */
function draftEntry(input, options = {}) {
  const data = input && typeof input === 'object' ? input : {};
  const warnings = [];

  const supplierName = str(data.supplierName, 120);
  const docNumber = str(data.docNumber, 40);
  const date = String(data.date || '').trim();

  if (!isDate(date)) throw new Error('תאריך החשבונית חסר או לא תקין (YYYY-MM-DD)');
  const supplierTaxId = supplierTaxIdOf(data.supplierTaxId);

  const grossAg = agOrNull(data.gross, 'סה"כ החשבונית');
  if (grossAg === null || grossAg <= 0) throw new Error('יש להזין את סה"כ החשבונית (כולל מע"מ)');

  const exempt = !!data.exempt;
  let rate = Number(data.vatRate !== undefined && data.vatRate !== null && data.vatRate !== ''
    ? data.vatRate : options.vatRate);
  if (!(rate > 0 && rate < 1)) rate = 0.18;

  const netAg = agOrNull(data.net, 'הסכום לפני מע"מ');
  const vatAg = agOrNull(data.vat, 'המע"מ');

  // נטו: מה שהוקלד, אחרת נגזר מהסה"כ. מע"מ: תמיד סה"כ פחות נטו — כך אין הפרש אגורה
  let net;
  if (netAg === null) {
    net = exempt ? grossAg : Math.round(grossAg / (1 + rate));
  } else {
    net = netAg;
    if (net > grossAg) throw new Error('הסכום לפני מע"מ גדול מהסה"כ — יש לבדוק את הסכומים');
  }
  let vat = grossAg - net;
  if (exempt) {
    if (vat !== 0) throw new Error('בחשבונית פטורה ממע"מ סה"כ חייב להיות שווה לסכום לפני מע"מ');
  } else if (vat <= 0) {
    throw new Error('החשבונית אינה פטורה אך אין בה מע"מ — יש לבדוק את הסכומים או לסמן "פטור ממע"מ"');
  }
  if (vatAg !== null && vatAg !== vat) {
    warnings.push(`המע"מ שהוקלד (${(vatAg / pts).toFixed(2)}) אינו שווה לסה"כ פחות נטו (${(vat / pts).toFixed(2)}) — נלקח החישוב מהסכומים`);
  }
  // הפרש של יותר מאגורה בין נטו × שיעור לבין המע"מ = הסכומים לא מתיישבים
  if (!exempt && netAg !== null && Math.abs(Math.round(net * rate) - vat) > 1) {
    warnings.push('הסכומים אינם תואמים לשיעור המע"מ — יש לבדוק את החשבונית מול המסמך');
  }

  let acc = null;
  const accCode = str(data.expenseAccount, 10);
  const allowed = Array.isArray(options.expenseAccounts) ? options.expenseAccounts.map(String) : null;
  if (accCode) {
    if (!/^\d{4,6}$/.test(accCode)) throw new Error('קוד חשבון ההוצאה חייב להיות 4-6 ספרות');
    if (allowed && !allowed.includes(accCode)) throw new Error(`חשבון ${accCode} אינו חשבון הוצאה בתוכנית החשבונות`);
    acc = accCode;
  }

  if (!acc) throw new Error('יש לבחור חשבון הוצאה לחשבונית');
  if (!supplierName) warnings.push('שם הספק חסר — הטיוטה תישמר בלי שם ספק');
  if (!supplierTaxId) warnings.push('מספר עוסק/ח"פ של הספק חסר — מספר הקצאה לא ייבדק, והדיווח במע"מ לא יזוהה');
  if (!docNumber) warnings.push('מספר החשבונית חסר');

  let allocation = null;
  try { allocation = allocationNumber(data.allocation); }
  catch (error) { warnings.push(error.message); }

  // השורות בשקלים (validateEntry ממיר לאגורות בעצמו); הסכומים כאן כבר מעוגלים באגורות
  const memo = str(data.memo, 120) || `חשבונית ${docNumber || ''}`.trim();
  const label = [supplierName, docNumber ? `מס' ${docNumber}` : ''].filter(Boolean).join(' — ').slice(0, 200);
  // בלי חשבון הוצאה אין טיוטה (נבדק למעלה) — שורה בלי חשבון הייתה נדחית ב-validateEntry אחרי שהמשתמש אישר
  const lines = [
    { account: acc, debit: net / pts, credit: 0, memo: memo.slice(0, 120) }
  ];
  if (vat > 0) lines.push({ account: SYS.INPUT_VAT, debit: vat / pts, credit: 0, memo: 'מע"מ תשומות' });
  lines.push({ account: SYS.AP, debit: 0, credit: grossAg / pts, memo: memo.slice(0, 120) });

  const entry = { date, description: label || 'חשבונית ספק', lines };
  // פרטי החשבונית לדוח המע"מ המפורט (PCN874) — בשמות של validateVatDoc (supplierTaxId / reference / docDate)
  if (/^\d{9}$/.test(supplierTaxId)) {
    entry.vatDoc = {
      supplierTaxId,
      reference: docNumber.replace(/\D/g, '').slice(-20) || undefined,
      docDate: date,
      ...(allocation ? { allocationNumber: String(allocation) } : {})
    };
  }

  // פרטי הספק כפי שהוקלדו — נשמרים גם בלי מע"מ (ספק פטור): לחסימת כפילות ולהצעת חשבון לפי שם.
  // vatDoc נשאר כמו שהוא, רק ל-PCN874 (אסמכתה בספרות בלבד)
  const supplierDoc = validateSupplierDoc({ name: supplierName, taxId: supplierTaxId, reference: docNumber, docDate: date });
  if (supplierDoc) entry.supplierDoc = supplierDoc;

  return {
    entry,
    warnings,
    complete: !!(supplierName && supplierTaxId && docNumber && acc),
    supplier: { name: supplierName, taxId: supplierTaxId },
    docNumber,
    allocation,
    amountsAg: { net, vat, gross: grossAg }
  };
}

// פרטי ספק ברשומת יומן (שם, ע.מ, אסמכתה מקורית, תאריך) — קלט לא מהימן. ריק = null.
// האסמכתה נשמרת כפי שהוקלדה (A-100 ו-B-100 הן שתי חשבוניות), ולא רק בספרות כמו ב-vatDoc
function validateSupplierDoc(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  const name = str(input.name, 120);
  if (name) out.name = name;
  const taxId = supplierTaxIdOf(input.taxId);
  if (taxId) out.taxId = taxId;
  const reference = str(input.reference, 40);
  if (reference) out.reference = reference;
  if (input.docDate !== undefined && input.docDate !== null && input.docDate !== '') {
    if (!isDate(String(input.docDate))) throw new Error('תאריך חשבונית הספק אינו תקין');
    out.docDate = String(input.docDate);
  }
  return Object.keys(out).length ? out : null;
}

// אסמכתה להשוואה: בלי רווחים כפולים ובלי הבדל בין אותיות גדולות לקטנות
const refKey = (v) => str(v, 40).replace(/\s+/g, ' ').toUpperCase();

// מפתח לזיהוי חשבונית ספק ברשומה: ע.מ, אסמכתה מקורית (אם נשמרה) ואסמכתה בספרות (vatDoc ישן)
function supplierDocKey(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const sd = entry.supplierDoc && typeof entry.supplierDoc === 'object' ? entry.supplierDoc : null;
  const vd = entry.vatDoc && typeof entry.vatDoc === 'object' ? entry.vatDoc : null;
  const taxId = taxIdKey((sd && sd.taxId) || (vd && vd.supplierTaxId) || '');
  const full = sd && sd.reference ? refKey(sd.reference) : '';
  const digits = (vd && vd.reference) ? String(vd.reference) : (full ? full.replace(/\D/g, '').slice(-20) : '');
  if (!taxId || (!full && !digits)) return null;
  return { taxId, full, digits };
}

// אותה חשבונית ספק: אותו ע.מ, ואותה אסמכתה מקורית כשיש לשתיהן; אחרת (רשומה ישנה) — לפי הספרות
function sameSupplierDoc(a, b) {
  if (!a || !b || a.taxId !== b.taxId) return false;
  if (a.full && b.full) return a.full === b.full;
  return !!a.digits && a.digits === b.digits;
}

// השלמת חשבון ההוצאה מההיסטוריה: ספק מאותו ת"ז/ח"פ או אותו שם — הספרה הנפוצה ביותר
// (השוויון נשבר לטובת החשבון שנבחר לאחרונה). null כשאין ההיסטוריה מספקת החלטה
// ע.מ להשוואה: 5–9 ספרות מרופדות ל-9, כמו שנשמר ב-vatDoc (‏12345674 = 012345674)
function taxIdKey(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 5 && d.length <= 9 ? d.padStart(9, '0') : d;
}

function suggestAccount(input, journal, expenseAccounts) {
  const data = input && typeof input === 'object' ? input : {};
  const taxId = taxIdKey(data.supplierTaxId);
  const name = str(data.supplierName, 120);
  if (!taxId && !name) return null;
  const allowed = Array.isArray(expenseAccounts) ? new Set(expenseAccounts.map(String)) : null;
  const counts = new Map();
  let last = null;
  for (const e of Array.isArray(journal) ? journal : []) {
    const doc = e && e.vatDoc;
    const sd = e && e.supplierDoc;
    if ((!doc && !sd) || !Array.isArray(e.lines)) continue;
    const docTaxId = (sd && sd.taxId) || (doc && doc.supplierTaxId) || '';
    const sameId = taxId && docTaxId && taxIdKey(docTaxId) === taxId;
    const sameName = name && str((sd && sd.name) || (doc && doc.supplierName), 120) === name;
    if (!sameId && !sameName) continue;
    for (const line of e.lines) {
      const code = String(line && line.account || '');
      if (!(line && line.debit > 0) || !/^\d{4,6}$/.test(code)) continue;
      if (code === SYS.INPUT_VAT) continue;
      if (allowed && !allowed.has(code)) continue;
      counts.set(code, (counts.get(code) || 0) + 1);
      last = { code, at: String(e.createdAt || e.date || ''), e };
    }
  }
  if (counts.size === 0) return null;
  let best = null;
  for (const [code, n] of counts) {
    if (!best || n > best.n || (n === best.n && last && code === last.code && best.code !== last.code)) best = { code, n };
  }
  return { account: best.code, times: best.n, candidates: counts.size };
}

// רשימת חשבונות ההוצאה לתוכנית החשבונות (מסוננת ומוודאת תקינות — קלט לא מהימן)
function expenseAccountCodes(accounts) {
  return (Array.isArray(accounts) ? accounts : [])
    .filter(a => a && a.type === 'expense' && /^\d{4,6}$/.test(String(a.code)))
    .map(a => String(a.code));
}

module.exports = { draftEntry, suggestAccount, expenseAccountCodes, allocationNumber, validateSupplierDoc, supplierDocKey, sameSupplierDoc };
