// ייבוא תרומות מקובץ של ערוץ חיצוני (נדרים פלוס, קהילות, Charidy, CauseMatch, דף בנק) — קבצים בלבד, בלי רשת.
// מבנה הקבצים משתנה בין ערוצים ובין גרסאות, ולכן אין כאן פורמט קבוע: מזהים עמודות לפי כותרות נפוצות,
// המשתמש מאשר/מתקן את ההתאמה, וההתאמה נשמרת לכל ערוץ לפעם הבאה.
const { parseCsv } = require('./features');
const N = require('./npo');
const CMP = require('./campaigns');

const SOURCES = { nedarim: 'נדרים פלוס', kehilot: 'קהילות', charidy: 'Charidy', causematch: 'CauseMatch', bank: 'דף בנק', other: 'אחר' };
const MAX_ROWS = 5000;

// שדות היעד, וכותרות שמזהות אותם (השוואה אחרי ניקוי רווחים, גרשיים ונקודות)
const FIELDS = {
  date:            { label: 'תאריך', required: true,  hints: ['תאריך', 'תאריךתרומה', 'תאריךעסקה', 'date', 'transactiondate', 'createdat'] },
  donorName:       { label: 'שם התורם', required: true,  hints: ['שםהתורם', 'שםמלא', 'שם', 'תורם', 'name', 'fullname', 'donorname', 'donor'] },
  amount:          { label: 'סכום', required: true,  hints: ['סכום', 'סכוםהתרומה', 'סכוםבשח', 'amount', 'total', 'sum'] },
  donorId:         { label: 'ת.ז / ח.פ', required: false, hints: ['תז', 'תעודתזהות', 'מספרזהות', 'זהות', 'חפ', 'id', 'idnumber', 'teudatzehut', 'zeout'] },
  externalId:      { label: 'מספר עסקה במקור', required: false, hints: ['מספרעסקה', 'עסקה', 'מזההעסקה', 'אסמכתא', 'מספרתרומה', 'transactionid', 'transaction', 'reference', 'donationid', 'confirmation'] },
  externalReceipt: { label: 'מספר קבלה במקור', required: false, hints: ['מספרקבלה', 'קבלה', 'receipt', 'receiptnumber'] },
  donorPhone:      { label: 'טלפון', required: false, hints: ['טלפון', 'נייד', 'פלאפון', 'phone', 'mobile', 'tel'] },
  donorAddress:    { label: 'כתובת', required: false, hints: ['כתובת', 'עיר', 'address', 'city'] },
  purpose:         { label: 'ייעוד / הערה', required: false, hints: ['ייעוד', 'הערה', 'הערות', 'הקדשה', 'purpose', 'note', 'notes', 'comment', 'dedication'] }
};

const norm = (h) => String(h ?? '').replace(/^﻿/, '').toLowerCase().replace(/[\s"'`׳״.\-_:()/\\]/g, '');

// ניחוש התאמה: כותרת זהה קודם, אחר כך כותרת שמתחילה ברמז. כל עמודה משמשת שדה אחד לכל היותר
function guessMapping(headers, saved = {}) {
  const map = {};
  const used = new Set();
  const nh = headers.map(norm);
  for (const [field, def] of Object.entries(FIELDS)) {
    if (saved[field] && headers.includes(saved[field])) { map[field] = saved[field]; used.add(saved[field]); continue; }
    let idx = nh.findIndex((h, i) => !used.has(headers[i]) && def.hints.includes(h));
    if (idx < 0) idx = nh.findIndex((h, i) => !used.has(headers[i]) && def.hints.some(x => x.length >= 3 && h.startsWith(x)));
    if (idx >= 0) { map[field] = headers[idx]; used.add(headers[idx]); }
  }
  return map;
}

// תאריך: YYYY-MM-DD, DD/MM/YYYY, DD.MM.YY וכדומה (סדר ישראלי: יום ראשון). שעה אחרי התאריך מתעלמת
function parseDate(v) {
  const s = String(v ?? '').trim().split(/[ T]/)[0];
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y, mo, d;
  if (m) [, y, mo, d] = m;
  else if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/))) {
    [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
  } else return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(iso + 'T00:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === iso ? iso : null;
}

function parseAmount(v) {
  const s = String(v ?? '').replace(/[₪$,\s]|ש"ח|ש״ח|NIS|ILS/gi, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// רק ספרות; ת.ז קצרה מקבלת ריפוד באפסים בבדיקה. ערך שאינו מספרי — נזרק כריק (תורם מחו"ל)
const parseId = (v) => { const s = String(v ?? '').replace(/\D/g, ''); return /^\d{5,9}$/.test(s) ? s : ''; };

function readFile(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('הקובץ ריק או חסר שורות נתונים');
  if (rows.length - 1 > MAX_ROWS) throw new Error(`ניתן לייבא עד ${MAX_ROWS} שורות בכל פעם`);
  const headers = rows[0].map(h => String(h).replace(/^﻿/, '').trim());
  if (new Set(headers).size !== headers.length) throw new Error('בקובץ יש שתי עמודות עם אותה כותרת — יש לשנות אחת מהן');
  return { headers, rows: rows.slice(1) };
}

// תצוגה מקדימה: הכותרות, התאמה מוצעת ו-5 שורות לדוגמה
function preview(csvText, source, settings) {
  if (!SOURCES[source]) throw new Error('ערוץ לא מוכר');
  const { headers, rows } = readFile(csvText);
  const saved = (settings && settings.importMappings && settings.importMappings[source]) || {};
  return { headers, mapping: guessMapping(headers, saved), sample: rows.slice(0, 5), total: rows.length, fields: FIELDS };
}

const dupKeyOf = (d) => d.import && d.import.externalId
  ? `x|${d.import.source}|${d.import.externalId}`
  : `r|${d.date}|${String(d.donorName).trim().toLowerCase()}|${Math.round(Number(d.amount) * 100)}`;

/* המרת הקובץ לרשומות תרומה. options:
   source — הערוץ; campaign — קמפיין לשיוך (אובייקט שהשירות שלף מהנתונים); fundId — קרן לכל השורות (ברירת מחדל: כללית); mapping — {שדה: כותרת}; receipts — 'external' (הערוץ כבר הפיק קבלה) או 'issue' (להפיק כאן)
   מחזיר { records, errors, skipped } — records עדיין בלי מזהה וקבלה (השירות משלים בשמירה). */
function buildRecords(csvText, options, existing, settings) {
  const { source, mapping = {}, receipts = 'external', fundId, campaign } = options || {};
  if (!SOURCES[source]) throw new Error('ערוץ לא מוכר');
  if (receipts !== 'external' && receipts !== 'issue') throw new Error('יש לבחור מי מפיק את הקבלות');
  const { headers, rows } = readFile(csvText);
  for (const [f, def] of Object.entries(FIELDS)) {
    if (mapping[f] && !headers.includes(mapping[f])) throw new Error(`העמודה "${mapping[f]}" לא נמצאה בקובץ`);
    if (def.required && !mapping[f]) throw new Error(`יש לבחור עמודה עבור "${def.label}"`);
  }
  const col = Object.fromEntries(Object.entries(mapping).filter(([, h]) => h).map(([f, h]) => [f, headers.indexOf(h)]));
  const seen = new Set((existing || []).map(dupKeyOf));
  const records = [], errors = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const line = i + 2;
    const get = (f) => (col[f] === undefined ? '' : String(r[col[f]] ?? '').trim());
    try {
      const date = parseDate(get('date'));
      if (!date) throw new Error(`תאריך לא מזוהה: "${get('date')}"`);
      const amount = parseAmount(get('amount'));
      if (amount === null) throw new Error(`סכום לא תקין: "${get('amount')}"`);
      if (campaign) CMP.assertCanAssign(campaign, date);
      const externalId = get('externalId').slice(0, 80);
      // ת.ז שגויה מהערוץ לא חוסמת את הייבוא — נשמרת ריקה, והשורה מסומנת לבדיקה
      let donorId = parseId(get('donorId'));
      let note = '';
      if (donorId) {
        try { N.validateDonation({ donorName: 'x', donorId, amount: 1, date }, settings); }
        catch { note = `ת.ז "${donorId}" שגויה — לא נשמרה`; donorId = ''; }
      }
      const clean = N.validateDonation({
        date, amount, donorId, fundId, campaignId: campaign ? campaign.id : '', method: source === 'bank' ? 'transfer' : 'card',
        donorName: get('donorName'), donorPhone: get('donorPhone').slice(0, 30), donorAddress: get('donorAddress').slice(0, 300),
        purpose: get('purpose').slice(0, 300), reference: externalId.slice(0, 60)
      }, settings);
      const rec = {
        ...clean,
        import: { source, externalId, externalReceipt: get('externalReceipt').slice(0, 40), receipts, importedAt: new Date().toISOString(), ...(note ? { note } : {}) }
      };
      const dk = dupKeyOf(rec);
      if (seen.has(dk)) { skipped++; return; }
      seen.add(dk);
      records.push(rec);
      if (note) errors.push({ line, message: note, warning: true });
    } catch (e) {
      errors.push({ line, message: e.message });
    }
  });
  return { records, errors, skipped };
}

// קבלה חיצונית: הערוץ הפיק אותה (ובדרך כלל גם דיווח לרשות המסים). אין מספר קבלה מקומי, והמספור הרץ לא מתקדם
function externalReceipt(rec, settings) {
  const s = N.normalizeSettings(settings);
  return {
    number: null, external: true, source: rec.import.source, externalNumber: rec.import.externalReceipt || '',
    sec46: false, sec46Number: '', sec46ValidUntil: '',
    org: { name: s.orgName, regNumber: s.regNumber, address: s.address, phone: s.phone, vatStatus: s.vatStatus, vatNumber: s.vatNumber },
    fundName: (N.allFunds(s).find(f => f.id === rec.fundId) || N.GENERAL_FUND).name
  };
}

module.exports = { SOURCES, FIELDS, MAX_ROWS, guessMapping, parseDate, parseAmount, preview, buildRecords, externalReceipt, dupKeyOf };
