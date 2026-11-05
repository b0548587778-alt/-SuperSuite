// קבצים במבנה אחיד ("ממשק פתוח", OPEN FORMAT) לפי "הוראות להפקת קבצים במבנה אחיד" גרסה 1.31 של רשות המסים
// (PLAN.md 9.1; המקור: docs/LEGAL-REQUIREMENTS.md, סעיף 2). פונקציות טהורות — בלי Electron ובלי קבצים.
// מפיק INI.TXT ו-BKMVDATA.TXT (בקידוד ISO-8859-8, שורות CRLF), ארכיב BKMVDATA.zip, ונתוני הפלט של סעיף 2.6 ונספח 4.
// תוכנה רב-שנתית (שדה 1011 = 2): המסמכים נחתכים לפי תאריך המסמך, והיומן לפי תאריך הערך או תאריך הרישום.
const crypto = require('crypto');
const A = require('./accounting');
const { isValidIsraeliId } = require('./israeliId');
const SD = require('./salesDocs');
const { isDay } = require('./dates');

const SYSTEM_CONST = '&OF1.31&';

// פרטי התוכנה ברשומה A000. מספר תעודת הרישום ופרטי היצרן — יתמלאו אחרי רישום התוכנה ברשות המסים (החלטה ה2)
const SOFTWARE = { name: 'SuperSuite', regNumber: '', makerVatId: '', makerName: 'SuperSuite' };

// נספח 1: סוגי מסמכים. הסוגים שהתוכנה מפיקה: 100, 200, 300, 305, 320, 330, 400 (השאר — 0 בדוח של סעיף 2.6). להצעת מחיר אין קוד
const DOC_TYPES = {
  100: 'הזמנה', 200: 'תעודת משלוח', 205: 'תעודת משלוח סוכן', 210: 'תעודת החזרה', 300: 'חשבונית/חשבונית עסקה',
  305: 'חשבונית-מס', 310: 'חשבונית ריכוז', 320: 'חשבונית מס / קבלה', 330: 'חשבונית מס זיכוי', 340: 'חשבונית שריון',
  345: 'חשבונית סוכן', 400: 'קבלה', 405: 'קבלה על תרומות', 410: 'יציאה מקופה', 420: 'הפקדת בנק', 500: 'הזמנת רכש',
  600: 'תעודת משלוח רכש', 610: 'החזרת רכש', 700: 'חשבונית מס רכש', 710: 'זיכוי רכש', 800: 'יתרת פתיחה',
  810: 'כניסה כללית למלאי', 820: 'יציאה כללית מהמלאי', 830: 'העברה בין מחסנים', 840: 'עדכון בעקבות ספירה',
  900: 'דוח ייצור-כניסה', 910: 'דוח ייצור-יציאה'
};

const RECORD_LABELS = {
  A100: 'רשומת פתיחה', B100: 'תנועות בהנהלת חשבונות', B110: 'חשבון בהנהלת חשבונות', C100: 'כותרת מסמך',
  D110: 'פרטי מסמך', D120: 'פרטי קבלות', M100: 'פריטים במלאי', Z900: 'רשומת סיום'
};

// ---------- מבני הרשומות (סעיפים 3–4): [מספר שדה, סוג, אורך]. N = נומרי (אפסים משמאל), X = אלפאנומרי (רווחים מימין)
// S = סכום עם סימן (X9(n)v99: סימן + ספרות), נשלח כמספר שלם בשלמי היחידה הקטנה (אגורות; בכמות — 1/10000)
const LAYOUTS = {
  A000: [[1000, 'X', 4], [1001, 'X', 5], [1002, 'N', 15], [1003, 'N', 9], [1004, 'N', 15], [1005, 'X', 8], [1006, 'N', 8],
    [1007, 'X', 20], [1008, 'X', 20], [1009, 'N', 9], [1010, 'X', 20], [1011, 'N', 1], [1012, 'X', 50], [1013, 'N', 1],
    [1014, 'N', 1], [1015, 'N', 9], [1016, 'N', 9], [1017, 'X', 10], [1018, 'X', 50], [1019, 'X', 50], [1020, 'X', 10],
    [1021, 'X', 30], [1022, 'X', 8], [1023, 'N', 4], [1024, 'N', 8], [1025, 'N', 8], [1026, 'N', 8], [1027, 'N', 4],
    [1028, 'N', 1], [1029, 'N', 1], [1030, 'X', 20], [1032, 'X', 3], [1034, 'N', 1], [1035, 'X', 46]],
  SUMMARY: [[1050, 'X', 4], [1051, 'N', 15]],
  A100: [[1100, 'X', 4], [1101, 'N', 9], [1102, 'N', 9], [1103, 'N', 15], [1104, 'X', 8], [1105, 'X', 50]],
  Z900: [[1150, 'X', 4], [1151, 'N', 9], [1152, 'N', 9], [1153, 'N', 15], [1154, 'X', 8], [1155, 'N', 15], [1156, 'X', 50]],
  C100: [[1200, 'X', 4], [1201, 'N', 9], [1202, 'N', 9], [1203, 'N', 3], [1204, 'X', 20], [1205, 'N', 8], [1206, 'N', 4],
    [1207, 'X', 50], [1208, 'X', 50], [1209, 'X', 10], [1210, 'X', 30], [1211, 'X', 8], [1212, 'X', 30], [1213, 'X', 2],
    [1214, 'X', 15], [1215, 'N', 9], [1216, 'N', 8], [1217, 'S', 15], [1218, 'X', 3], [1219, 'S', 15], [1220, 'S', 15],
    [1221, 'S', 15], [1222, 'S', 15], [1223, 'S', 15], [1224, 'S', 12], [1225, 'X', 15], [1226, 'X', 10], [1228, 'X', 1],
    [1230, 'N', 8], [1231, 'X', 7], [1233, 'X', 9], [1234, 'N', 7], [1235, 'X', 13]],
  D110: [[1250, 'X', 4], [1251, 'N', 9], [1252, 'N', 9], [1253, 'N', 3], [1254, 'X', 20], [1255, 'N', 4], [1256, 'N', 3],
    [1257, 'X', 20], [1258, 'N', 1], [1259, 'X', 20], [1260, 'X', 30], [1261, 'X', 50], [1262, 'X', 30], [1263, 'X', 20],
    [1264, 'S', 17], [1265, 'S', 15], [1266, 'S', 15], [1267, 'S', 15], [1268, 'N', 4], [1270, 'X', 7], [1272, 'N', 8],
    [1273, 'N', 7], [1274, 'X', 7], [1275, 'X', 21]],
  D120: [[1300, 'X', 4], [1301, 'N', 9], [1302, 'N', 9], [1303, 'N', 3], [1304, 'X', 20], [1305, 'N', 4], [1306, 'N', 1],
    [1307, 'N', 10], [1308, 'N', 10], [1309, 'N', 15], [1310, 'N', 10], [1311, 'N', 8], [1312, 'S', 15], [1313, 'N', 1],
    [1314, 'X', 20], [1315, 'N', 1], [1320, 'X', 7], [1322, 'N', 8], [1323, 'N', 7], [1324, 'X', 60]],
  B100: [[1350, 'X', 4], [1351, 'N', 9], [1352, 'N', 9], [1353, 'N', 10], [1354, 'N', 5], [1355, 'N', 8], [1356, 'X', 15],
    [1357, 'X', 20], [1358, 'N', 3], [1359, 'X', 20], [1360, 'N', 3], [1361, 'X', 50], [1362, 'N', 8], [1363, 'N', 8],
    [1364, 'X', 15], [1365, 'X', 15], [1366, 'N', 1], [1367, 'X', 3], [1368, 'S', 15], [1369, 'S', 15], [1370, 'S', 12],
    [1371, 'X', 10], [1372, 'X', 10], [1374, 'X', 7], [1375, 'N', 8], [1376, 'X', 9], [1377, 'X', 25]],
  B110: [[1400, 'X', 4], [1401, 'N', 9], [1402, 'N', 9], [1403, 'X', 15], [1404, 'X', 50], [1405, 'X', 15], [1406, 'X', 30],
    [1407, 'X', 50], [1408, 'X', 10], [1409, 'X', 30], [1410, 'X', 8], [1411, 'X', 30], [1412, 'X', 2], [1413, 'X', 15],
    [1414, 'S', 15], [1415, 'S', 15], [1416, 'S', 15], [1417, 'N', 4], [1419, 'N', 9], [1421, 'X', 7], [1422, 'S', 15],
    [1423, 'X', 3], [1424, 'X', 16]]
};

// אורכי הרשומות לפי טבלת סעיף 2.5(ה) — נבדק ב-tests/uniform-file.test.js
const RECORD_LENGTHS = { A000: 466, SUMMARY: 19, A100: 95, Z900: 110, C100: 444, D110: 339, D120: 222, B100: 317, B110: 376 };

// ---------- קידוד ISO-8859-8 (עברית לוגית). תו שאין לו מקום בקידוד מוחלף בקרוב לו או ב-"?"
const SUBST = { '״': '"', '׳': "'", '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '₪': 'ש', ' ': ' ' };
function toIso8859_8(text) {
  const out = [];
  for (const ch of String(text ?? '').normalize('NFC').replace(/[֑-ׇ]/g, '')) {
    const c = (SUBST[ch] || ch).codePointAt(0);
    if (c >= 0x20 && c < 0x7f) out.push(c);
    else if (c >= 0x05d0 && c <= 0x05ea) out.push(c - 0x05d0 + 0xe0);
    else if (c === 0x0a || c === 0x0d || c === 0x09) out.push(0x20);
    else out.push(0x3f);
  }
  return out;
}

// שדה בודד → בתים באורך המדויק
function field(type, length, value) {
  if (length === 0) return [];
  if (type === 'N') {
    const s = value === undefined || value === null || value === '' ? '' : String(value);
    if (s && !/^\d+$/.test(s)) throw new Error(`שדה נומרי מכיל תווים לא חוקיים: ${s}`);
    if (s.length > length) throw new Error(`ערך ארוך מדי לשדה נומרי באורך ${length}`);
    return [...s.padStart(length, '0')].map(c => c.charCodeAt(0));
  }
  if (type === 'S') {
    const n = Math.round(Number(value) || 0);
    const digits = String(Math.abs(n)).padStart(length - 1, '0');
    if (digits.length > length - 1) throw new Error('סכום גדול מדי לשדה');
    return [...((n < 0 ? '-' : '+') + digits)].map(c => c.charCodeAt(0));
  }
  const bytes = toIso8859_8(value).slice(0, length);
  while (bytes.length < length) bytes.push(0x20);
  return bytes;
}

function record(kind, values) {
  const bytes = [];
  for (const [no, type, len] of LAYOUTS[kind]) bytes.push(...field(type, len, values[no]));
  if (bytes.length !== RECORD_LENGTHS[kind]) throw new Error(`אורך רשומה ${kind} שגוי: ${bytes.length}`);
  return bytes;
}

// ---------- עזרים
const ag = (shekels) => Math.round(Number(shekels || 0) * 100);
const ymd = (iso) => String(iso || '').slice(0, 10).replace(/-/g, '');
const pad2 = (n) => String(n).padStart(2, '0');
// תאריך ושעה מקומיים (לא UTC) מתוך חותמת זמן
function localParts(ms) {
  const d = new Date(ms);
  return { date: `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`, time: `${pad2(d.getHours())}${pad2(d.getMinutes())}`, year: d.getFullYear(), mmddhhmm: `${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}` };
}
const localDate = (iso) => (iso ? localParts(Date.parse(iso)).date : '');
const digitsOnly = (v) => String(v || '').replace(/\D/g, '');

// מזהה ראשי: 15 ספרות אקראיות, חדש בכל הפקה (סעיף 2.4(א)). הספרה הראשונה אינה 0.
// randomBytes ולא randomInt — רק הוא קיים בתחליף של אנדרואיד (android/web/node-shims.js)
function newPrimaryId() {
  const bytes = crypto.randomBytes(64);
  let s = '';
  for (const b of bytes) {
    if (b >= 250) continue; // בלי הטיה: 250 = 25 × 10
    const d = b % 10;
    if (!s && d === 0) continue;
    s += d;
    if (s.length === 15) return s;
  }
  return newPrimaryId();
}

// סוג המסמך לפי נספח 1. פטור לפני "חשבונית מס/קבלה": לעוסק פטור אין 320 (גם בנתונים ישנים שסומנו כך)
function docTypeOf(inv) {
  if (inv.vatExempt) return 300;
  if (inv.kind === 'tax-invoice-receipt') return 320;
  return 305;
}

// שיעורי המע"מ בישראל לפי תאריך — רק לחשבונית ישנה שלא נשמר בה שיעור (יש לאמת מול רשות המסים):
// 17% מ-1.10.2015, 18% מ-1.1.2025. לפני 2015-10-01 — אין שיעור לפי תאריך, רק התאמה לסכומים
const VAT_HISTORY = [{ from: '2015-10-01', rate: 0.17 }, { from: '2025-01-01', rate: 0.18 }];
const legalVatRate = (date) => {
  const d = String(date || '').slice(0, 10);
  let rate = null;
  for (const h of VAT_HISTORY) if (d >= h.from) rate = h.rate;
  return rate;
};

// שיעור המע"מ בשורה: 9(2)v99 (18% = "1800"). השיעור שנשמר בחשבונית בזמן ההפקה (vatRate) גובר.
// חשבונית ישנה בלי שיעור: שיעור מוכר (לפי התאריך, אחר כך מההגדרות, אחר כך 17%/18%) שמסביר את המע"מ עד אגורה;
// היחס מע"מ/נטו לבדו שגוי בחשבונית קטנה (מע"מ מעוגל לאגורה). אם אף שיעור לא מסביר — היחס, כמו קודם
function vatRateCode(inv, { fallbackRate } = {}) {
  if (inv.vatExempt) return 0;
  const stored = Number(inv.vatRate);
  if (inv.vatRate != null && Number.isFinite(stored) && stored > 0 && stored < 1) return Math.round(stored * 10000);
  const net = ag(inv.net);
  const vat = ag(inv.vat);
  if (!net || !vat) return 0;
  // השיעור "מסביר" את המע"מ אם המע"מ המחושב בו רחוק לכל היותר אגורה אחת (עיגול) מהמע"מ שבחשבונית
  const fits = (r) => Number.isFinite(r) && r > 0 && r < 1 && Math.abs(vat - net * r) <= 1;
  const first = [legalVatRate(inv.date), Number(fallbackRate)].find(fits);
  const nearest = VAT_HISTORY.map(h => h.rate).filter(fits).sort((a, b) => Math.abs(vat - net * a) - Math.abs(vat - net * b))[0];
  const rate = first ?? nearest;
  return rate !== undefined ? Math.round(rate * 10000) : Math.round((vat / net) * 10000);
}

// ---------- ההפקה
// data: נתוני הנהלת החשבונות (accounts, journal, invoices). business: הגדרות העסק (taxId = מספר עוסק מורשה).
// range: { from, to } (YYYY-MM-DD, כולל). now: חותמת זמן ההפקה. user: שם המשתמש שמפיק
// חשבון נגדי לשורת יומן (שדה 1365): השורה היחידה בצד השני, ואם יש כמה — הגדולה שבהן (בשוויון — הראשונה).
// כך מוסר חשבון נגדי גם בתוכנות שמייבאות "כל תנועה חד-צדדית כולל חשבון נגדי" (כמו חשבשבת)
function counterAccountOf(entry, index) {
  const lines = Array.isArray(entry && entry.lines) ? entry.lines : [];
  const me = lines[index];
  if (!me) return '';
  const mine = ag(me.debit) > 0 ? 'debit' : 'credit';
  const other = mine === 'debit' ? 'credit' : 'debit';
  let best = null;
  for (const l of lines) {
    const amt = ag(l[other]);
    if (amt > 0 && (!best || amt > best.amt)) best = { amt, account: String(l.account) };
  }
  return best ? best.account : '';
}

// פרטי חשבונית ספק ברשומת יומן (שדות 1357/1358/1363): האסמכתה המקורית, סוג 700 (חשבונית מס רכש) ותאריך החשבונית
function supplierRefOf(entry) {
  const sd = entry && entry.supplierDoc;
  const vd = entry && entry.vatDoc;
  if (!sd && !vd) return null;
  const reference = String((sd && sd.reference) || (vd && vd.reference) || '').slice(0, 20);
  const docDate = (sd && sd.docDate) || (vd && vd.docDate) || '';
  return { reference, docDate };
}

function buildUniformFile({ data, business, range, now = Date.now(), user = '', primaryId, software = SOFTWARE }) {
  const vatId = digitsOnly(business && business.taxId);
  if (vatId.length !== 9 || !isValidIsraeliId(vatId)) throw new Error('יש להזין מספר עוסק מורשה תקין (9 ספרות) בהגדרות העסק לפני הפקת קבצים במבנה אחיד');
  const from = String(range && range.from || '');
  const to = String(range && range.to || '');
  // תאריכים שקיימים בלוח בלבד — 2026-02-31 נדחה (פעם regex בלבד)
  if (!isDay(from) || !isDay(to) || from > to) throw new Error('טווח תאריכים לא תקין');
  const pid = primaryId || newPrimaryId();
  if (!/^[1-9]\d{14}$/.test(pid)) throw new Error('מזהה ראשי לא תקין');
  const stamp = localParts(now);
  const folder = { root: 'OPENFRMT', company: `${vatId.slice(0, 8)}.${String(stamp.year).slice(-2)}`, run: stamp.mmddhhmm };
  const relPath = `OPENFRMT\\${folder.company}\\${folder.run}`;
  const inRange = (d) => d >= from && d <= to;

  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const journal = Array.isArray(data.journal) ? data.journal : [];
  const invoices = Array.isArray(data.invoices) ? data.invoices : [];
  // הצעת מחיר אינה בנספח 1 — לא נכנסת לקובץ
  const salesDocs = (Array.isArray(data.salesDocs) ? data.salesDocs : []).filter(d => SD.KINDS[d.kind] && SD.KINDS[d.kind].code);
  const names = new Map(accounts.map(a => [String(a.code), a.name]));
  const fallbackRate = Number(data.settings && data.settings.vatRate);

  const lines = [];
  const counts = {};
  const push = (kind, values) => {
    const no = lines.length + 1;
    const recNoField = { A100: 1101, Z900: 1151, C100: 1201, D110: 1251, D120: 1301, B100: 1351, B110: 1401 }[kind];
    const vatField = { A100: 1102, Z900: 1152, C100: 1202, D110: 1252, D120: 1302, B100: 1352, B110: 1402 }[kind];
    const codeField = { A100: 1100, Z900: 1150, C100: 1200, D110: 1250, D120: 1300, B100: 1350, B110: 1400 }[kind];
    lines.push(record(kind, { ...values, [codeField]: kind, [recNoField]: no, [vatField]: vatId }));
    counts[kind] = (counts[kind] || 0) + 1;
  };

  push('A100', { 1103: pid, 1104: SYSTEM_CONST });

  // מסמכים (C100 + D110, ו-D120 לקבלה ולחשבונית מס/קבלה) — לפי תאריך המסמך. סכומים חיוביים גם בזיכוי (סוג המסמך קובע)
  const docs = [
    ...invoices.map(inv => ({ inv, type: docTypeOf(inv) })),
    ...salesDocs.map(d => ({ inv: d, type: SD.KINDS[d.kind].code }))
  ].filter(x => inRange(String(x.inv.date))).sort((a, b) => a.type - b.type || a.inv.number - b.inv.number);
  const docSummary = new Map();
  // מסמך הבסיס (שדות 1256/1257 ב-D110 — "חובה כאשר המסמך מבוסס על מסמך", הוראות 1.31):
  // חשבונית או מסמך שהומרו מהזמנה / תעודת משלוח, וזיכוי — לפי החשבונית שהוא מזכה. הצעת מחיר אינה בקובץ
  const invoiceById = new Map(invoices.map(i => [i.id, i]));
  const baseDocOf = (doc) => {
    const src = doc && doc.sourceDoc;
    if (src && SD.KINDS[src.kind] && SD.KINDS[src.kind].code && src.number != null) return { type: SD.KINDS[src.kind].code, number: String(src.number) };
    if (doc && doc.kind === 'credit') {
      const base = invoiceById.get(doc.invoiceId);
      if (base) return { type: docTypeOf(base), number: String(base.number) };
    }
    return null;
  };
  let link = 0;
  for (const { inv, type } of docs) {
    link += 1;
    const isReceipt = type === 400;
    // מסמך מבוטל (שדה 1228) — רק ביטול ישן בהיפוך יומן. חשבונית שבוטלה בחשבונית זיכוי היא מסמך תקף, והזיכוי (330) מקזז אותה
    const cancelled = inv.status === 'cancelled' && !inv.cancelCreditId;
    const issue = inv.createdAt ? localParts(Date.parse(inv.createdAt)) : { date: ymd(inv.date), time: '0000' };
    const total = ag(inv.total);
    const net = isReceipt ? total : ag(inv.net);
    const vat = isReceipt ? 0 : ag(inv.vat);
    const s = docSummary.get(type) || { count: 0, totalAg: 0 };
    s.count += 1;
    if (!cancelled) s.totalAg += total;
    docSummary.set(type, s);
    const custVat = digitsOnly(inv.customerTaxId);
    push('C100', {
      1203: type, 1204: String(inv.number), 1205: issue.date, 1206: issue.time,
      1207: inv.customer, 1215: custVat.length === 9 ? custVat : '', 1216: ymd(inv.date),
      1219: net, 1220: 0, 1221: net, 1222: vat, 1223: total, 1224: 0,
      1225: custVat.length === 9 ? custVat : String(inv.customer || '').slice(0, 15),
      1228: cancelled ? '1' : '', 1230: ymd(inv.date), 1233: user, 1234: link
    });
    const baseDoc = baseDocOf(inv);
    (Array.isArray(inv.items) ? inv.items : []).forEach((it, i) => push('D110', {
      1253: type, 1254: String(inv.number), 1255: i + 1,
      ...(baseDoc ? { 1256: baseDoc.type, 1257: baseDoc.number } : {}),
      1258: String(it.account) === A.SYS.SERVICES ? 1 : 2, 1260: it.description, 1263: 'יחידה',
      1264: Math.round(Number(it.quantity || 0) * 10000), 1265: ag(it.unitPrice), 1266: 0, 1267: ag(it.lineNet),
      1268: vatRateCode(inv, { fallbackRate }), 1272: ymd(inv.date), 1273: link
    }));
    if (type === 320 || isReceipt) {
      // אמצעי התשלום (שדה 1306), ומספר ההמחאה (1310) כשהאסמכתה היא מספר. חשבונית ישנה בלי אמצעי תשלום — "אחר" (9)
      const method = isReceipt ? inv.method : inv.paymentMethod;
      const ref = String((isReceipt ? inv.reference : inv.paymentRef) || '');
      push('D120', { 1303: type, 1304: String(inv.number), 1305: 1, 1306: SD.methodCode(method), 1311: ymd(inv.paidAt || inv.date),
        1312: total, 1310: SD.methodOf(method) === 'check' && /^\d{1,10}$/.test(ref) ? ref : '', 1322: ymd(inv.date), 1323: link });
    }
  }

  // תנועות יומן (B100) — לפי תאריך הערך (סעיף 2.1(ג)3). אותו תאריך קובע את יתרת הפתיחה ב-B110, כך שאין תנועה שנספרת פעמיים
  const byEntry = new Map();
  for (const inv of invoices) {
    if (inv.entryId) byEntry.set(inv.entryId, { inv, kind: 'invoice' });
    if (inv.paymentEntryId) byEntry.set(inv.paymentEntryId, { inv, kind: 'payment' });
    if (inv.reversalEntryId) byEntry.set(inv.reversalEntryId, { inv, kind: 'cancel' });
  }
  // זיכוי וקבלה — המסמך שלהם (הקבלה גוברת על "גבייה" של החשבונית)
  for (const d of salesDocs) {
    if (d.entryId) byEntry.set(d.entryId, { inv: d, kind: d.kind, type: SD.KINDS[d.kind].code });
    if (d.reversalEntryId) byEntry.set(d.reversalEntryId, { inv: d, kind: 'cancel', type: SD.KINDS[d.kind].code });
  }
  const entries = journal
    .filter(e => inRange(String(e.date)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const movement = new Map(); // חשבון → { debit, credit } בתוך הטווח
  entries.forEach((e, t) => {
    const ref = byEntry.get(e.id);
    const typeLabel = ref ? { invoice: 'חשבונית', payment: 'גבייה', cancel: 'ביטול', credit: 'זיכוי', receipt: 'קבלה' }[ref.kind] : e.reversalOf ? 'ביטול' : 'פקודת יומן';
    const sup = ref ? null : supplierRefOf(e);
    e.lines.forEach((l, i) => {
      const debit = ag(l.debit);
      const credit = ag(l.credit);
      const m = movement.get(String(l.account)) || { debit: 0, credit: 0 };
      m.debit += debit; m.credit += credit;
      movement.set(String(l.account), m);
      push('B100', {
        1353: t + 1, 1354: i + 1, 1355: 0, 1356: typeLabel,
        1357: ref ? String(ref.inv.number) : (sup ? sup.reference : ''), 1358: ref ? ref.type || docTypeOf(ref.inv) : (sup ? 700 : 0),
        1361: e.description, 1362: ymd(e.date), 1363: ymd(sup && sup.docDate ? sup.docDate : e.date), 1364: String(l.account),
        1365: counterAccountOf(e, i),
        1366: debit > 0 ? 1 : 2, 1368: debit > 0 ? debit : credit,
        1375: e.createdAt ? localDate(e.createdAt) : ymd(e.date), 1376: user
      });
    });
  });

  // חשבונות (B110): יתרה בתחילת החתך (חובה +, זכות −), וסכומי החובה והזכות בטווח
  const opening = new Map();
  for (const e of journal) {
    if (!(String(e.date) < from)) continue;
    for (const l of e.lines) opening.set(String(l.account), (opening.get(String(l.account)) || 0) + ag(l.debit) - ag(l.credit));
  }
  const TYPE_LABELS = { asset: 'נכסים', liability: 'התחייבויות', equity: 'הון', revenue: 'הכנסות', expense: 'הוצאות' };
  const used = [...new Set([...movement.keys(), ...opening.keys()])].sort();
  const accountByCode = new Map(accounts.map(a => [String(a.code), a]));
  for (const code of used) {
    const a = accountByCode.get(code) || { code, name: names.get(code) || code, type: '' };
    const m = movement.get(code) || { debit: 0, credit: 0 };
    push('B110', { 1403: code, 1404: a.name, 1405: a.type, 1406: TYPE_LABELS[a.type] || '', 1414: opening.get(code) || 0, 1415: m.debit, 1416: m.credit });
  }

  const total = lines.length + 1;
  push('Z900', { 1153: pid, 1154: SYSTEM_CONST, 1155: total });

  // INI.TXT: רשומה מובילה ורשומת סיכום לכל סוג רשומה שבקובץ (חוץ מפתיחה וסגירה)
  const ini = [record('A000', {
    1000: 'A000', 1002: total, 1003: vatId, 1004: pid, 1005: SYSTEM_CONST, 1006: digitsOnly(software.regNumber),
    1007: software.name, 1008: software.version || '', 1009: digitsOnly(software.makerVatId), 1010: software.makerName,
    1011: 2, 1012: relPath, 1013: 2, 1014: 1, 1018: business.name, 1019: business.address,
    1024: ymd(from), 1025: ymd(to), 1026: stamp.date, 1027: stamp.time, 1028: 0, 1029: 1, 1030: 'ZIP (SuperSuite)',
    1032: 'ILS', 1034: 0
  })];
  for (const kind of ['B100', 'B110', 'C100', 'D110', 'D120', 'M100']) {
    if (counts[kind]) ini.push(record('SUMMARY', { 1050: kind, 1051: counts[kind] }));
  }

  const toBuffer = (recs) => Buffer.from(recs.flatMap(r => [...r, 0x0d, 0x0a]));
  const dataTxt = toBuffer(lines);
  return {
    primaryId: pid, folder, relPath,
    iniTxt: toBuffer(ini), dataTxt, zip: zipSingle('BKMVDATA.TXT', dataTxt, now),
    report: {
      vatId, businessName: business.name || '', relPath, from, to, total,
      createdDate: `${stamp.date.slice(6, 8)}/${stamp.date.slice(4, 6)}/${stamp.date.slice(2, 4)}`,
      createdTime: `${stamp.time.slice(0, 2)}:${stamp.time.slice(2)}`,
      software: { name: software.name, regNumber: software.regNumber || '' },
      records: ['A100', 'B100', 'B110', 'C100', 'D110', 'D120', 'M100', 'Z900'].filter(k => counts[k]).map(k => ({ code: k, label: RECORD_LABELS[k], count: counts[k] })),
      // סעיף 2.6(ב): כל סוגי נספח 1, כמות וסך כספי (0 למסמך שהתוכנה לא מנהלת). מסמך מבוטל נספר, וסכומו לא
      documents: Object.entries(DOC_TYPES).map(([code, label]) => {
        const s = docSummary.get(Number(code)) || { count: 0, totalAg: 0 };
        return { code: Number(code), label, count: s.count, total: s.totalAg / 100 };
      })
    }
  };
}


// ---------- ZIP עם קובץ אחד, בלי תלות חיצונית: deflate כשיש zlib (שולחן העבודה), בלי דחיסה באנדרואיד
function deflateRaw(content) {
  try { return require('zlib').deflateRawSync(content); } catch { return null; }
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipSingle(name, content, now = Date.now()) {
  const d = new Date(now);
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const deflated = deflateRaw(content);
  const method = deflated ? 8 : 0;
  const data = deflated || content;
  const crc = crc32(content);
  const fname = Buffer.from(name, 'ascii');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(method, 8);
  local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(fname.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
  central.writeUInt16LE(method, 10); central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(fname.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + fname.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fname.length, 12); end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, fname, data, central, fname, end]);
}

module.exports = { counterAccountOf, supplierRefOf, SOFTWARE, DOC_TYPES, RECORD_LABELS, LAYOUTS, RECORD_LENGTHS, SYSTEM_CONST, toIso8859_8, field, record, newPrimaryId, docTypeOf, vatRateCode, buildUniformFile, crc32, zipSingle, VAT_HISTORY, legalVatRate };
