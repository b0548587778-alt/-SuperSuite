// התאמת בנק (PLAN.md 9.4): קליטת דף בנק מקובץ CSV שהמשתמש הוריד מאתר הבנק — בלי חיבור לבנק ובלי רשת —
// והתאמת כל תנועה לחשבונית פתוחה או לרשומת יומן קיימת בחשבון הבנק (1000).
// כל הסכומים כאן באגורות שלמות ועם סימן: חיוב (כסף יצא) שלילי, זיכוי (כסף נכנס) חיובי.
const { parseCsv } = require('./features');
const DI = require('./donationImport');

const BANK = '1000';
const MAX_ROWS = 5000;
const MAX_SUGGESTIONS = 5;
// חלון התאריכים להצעות: גבייה מגיעה בדרך כלל אחרי החשבונית; רשומת יומן — בסמוך לתנועה
const INVOICE_DAYS_BEFORE = 180;
const INVOICE_DAYS_AFTER = 7;
const ENTRY_DAYS = 10;

// בדף בנק ישראלי: "חובה" = כסף שיצא מהחשבון, "זכות" = כסף שנכנס. יש בנקים עם עמודת סכום אחת עם סימן
const FIELDS = {
  date:        { label: 'תאריך', required: true,  hints: ['תאריך', 'תאריךערך', 'תאריךפעולה', 'תאריךתנועה', 'date', 'valuedate', 'transactiondate'] },
  description: { label: 'תיאור הפעולה', required: false, hints: ['תיאור', 'תיאורהפעולה', 'פעולה', 'פרטים', 'הפעולה', 'description', 'details', 'memo', 'narrative'] },
  amount:      { label: 'סכום (עם סימן)', required: false, hints: ['סכום', 'סכוםהפעולה', 'סכוםבשח', 'amount', 'sum'] },
  debit:       { label: 'חובה (יצא)', required: false, hints: ['חובה', 'חיוב', 'משיכה', 'בחובה', 'debit', 'withdrawal'] },
  credit:      { label: 'זכות (נכנס)', required: false, hints: ['זכות', 'זיכוי', 'הפקדה', 'בזכות', 'credit', 'deposit'] },
  reference:   { label: 'אסמכתא', required: false, hints: ['אסמכתא', 'אסמכתה', 'מספראסמכתא', 'reference', 'ref', 'checknumber'] },
  balance:     { label: 'יתרה', required: false, hints: ['יתרה', 'יתרהבשח', 'יתרהבחשבון', 'balance'] }
};

// סכום עם סימן באגורות: "1,234.50", "-1,234.50", "1,234.50-" (מינוס בסוף, נפוץ בדפי בנק), "(1,234.50)", ₪ / ש"ח.
// תא ריק = null (נבדק לפי ההקשר), טקסט שאינו מספר = NaN.
// סקירת קוד 2.11.2026: המפריד העשרוני — אותה לוגיקה כמו בייבוא התרומות (DI.parseAmount). קודם כל פסיק נמחק,
// ו-"12,5" או "1.234,56" נקראו פי 100
function parseSignedAg(v) {
  let s = String(v ?? '').replace(/[₪$\s\u200e\u200f]|ש"ח|ש״ח|NIS|ILS/gi, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (/^0+([.,]0*)?$/.test(s)) return 0; // "0", "0.00", "0,00"
  const n = DI.parseAmount(s);
  if (n === null) return NaN;
  const ag = Math.round(n * 100);
  return neg ? -ag : ag;
}

const normText = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

function readFile(csvText) {
  const rows = parseCsv(csvText).filter(r => r.some(c => String(c ?? '').trim() !== ''));
  if (rows.length < 2) throw new Error('הקובץ ריק או חסר שורות נתונים');
  if (rows.length - 1 > MAX_ROWS) throw new Error(`ניתן לקלוט עד ${MAX_ROWS} תנועות בכל פעם`);
  const headers = rows[0].map(h => String(h).replace(/^﻿/, '').trim());
  if (new Set(headers).size !== headers.length) throw new Error('בקובץ יש שתי עמודות עם אותה כותרת — יש לשנות אחת מהן');
  return { headers, rows: rows.slice(1) };
}

function guessMapping(headers, saved = {}) {
  const map = {};
  const used = new Set();
  const nh = headers.map(DI.norm);
  for (const [field, def] of Object.entries(FIELDS)) {
    if (saved[field] && headers.includes(saved[field])) { map[field] = saved[field]; used.add(saved[field]); continue; }
    let idx = nh.findIndex((h, i) => !used.has(headers[i]) && def.hints.includes(h));
    if (idx < 0) idx = nh.findIndex((h, i) => !used.has(headers[i]) && def.hints.some(x => x.length >= 3 && h.startsWith(x)));
    if (idx >= 0) { map[field] = headers[idx]; used.add(headers[idx]); }
  }
  // עמודת סכום אחת או זוג חובה/זכות — לא שתיהן (אחרת הסכום נספר פעמיים)
  if (map.amount && (map.debit || map.credit)) delete map.amount;
  return map;
}

function preview(csvText, settings) {
  const { headers, rows } = readFile(csvText);
  const saved = (settings && settings.bankMapping) || {};
  return { headers, mapping: guessMapping(headers, saved), sample: rows.slice(0, 5), total: rows.length, fields: FIELDS };
}

function assertMapping(mapping, headers) {
  for (const [f, h] of Object.entries(mapping)) {
    if (!FIELDS[f]) throw new Error('שדה לא מוכר בהתאמת העמודות');
    if (h && !headers.includes(h)) throw new Error(`העמודה "${h}" לא נמצאה בקובץ`);
  }
  if (!mapping.date) throw new Error('יש לבחור עמודה עבור "תאריך"');
  const pair = mapping.debit || mapping.credit;
  if (!mapping.amount && !pair) throw new Error('יש לבחור עמודת סכום, או עמודות חובה וזכות');
  if (mapping.amount && pair) throw new Error('יש לבחור עמודת סכום אחת או עמודות חובה וזכות — לא את שתיהן');
}

// מפתח לזיהוי כפילויות: תאריך + סכום + אסמכתא + תיאור, ומספר המופע בקובץ — כך שתי העברות זהות באותו יום
// נשמרות שתיהן, וקליטה חוזרת של אותו קובץ (או של קובץ חופף) לא מוסיפה אף אחת מהן שוב
const baseKey = (l) => `${l.date}|${l.amountAg}|${normText(l.reference)}|${normText(l.description)}`;

/* המרת הקובץ לתנועות. existing — התנועות שכבר נשמרו (לזיהוי כפילויות).
   מחזיר { lines, errors, skipped } — lines בלי מזהה (השירות משלים בשמירה). */
function buildLines(csvText, mapping = {}, existing = []) {
  const { headers, rows } = readFile(csvText);
  const clean = Object.fromEntries(Object.entries(mapping || {}).filter(([, h]) => h));
  assertMapping(clean, headers);
  const col = Object.fromEntries(Object.entries(clean).map(([f, h]) => [f, headers.indexOf(h)]));
  const seen = new Set((existing || []).map(l => l.key));
  const occ = new Map();
  const lines = [], errors = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const lineNo = r.line || i + 2;
    const get = (f) => (col[f] === undefined ? '' : String(r[col[f]] ?? '').trim());
    try {
      const date = DI.parseDate(get('date'));
      if (!date) throw new Error(`תאריך לא מזוהה: "${get('date')}"`);
      let amountAg;
      if (col.amount !== undefined) {
        amountAg = parseSignedAg(get('amount'));
        if (amountAg === null || Number.isNaN(amountAg)) throw new Error(DI.amountIssue(get('amount')));
      } else {
        const d = parseSignedAg(get('debit'));
        const c = parseSignedAg(get('credit'));
        if (Number.isNaN(d)) throw new Error(`חובה: ${DI.amountIssue(get('debit'))}`);
        if (Number.isNaN(c)) throw new Error(`זכות: ${DI.amountIssue(get('credit'))}`);
        // עמודות חובה/זכות מכילות ערכים חיוביים; ערך עם סימן מינוס בעמודה נלקח בערכו המוחלט
        amountAg = Math.abs(c || 0) - Math.abs(d || 0);
      }
      if (amountAg === 0) throw new Error('תנועה בלי סכום');
      const balanceRaw = parseSignedAg(get('balance'));
      const line = {
        date, amountAg,
        description: get('description').slice(0, 200),
        reference: get('reference').slice(0, 60),
        ...(Number.isInteger(balanceRaw) ? { balanceAg: balanceRaw } : {})
      };
      const base = baseKey(line);
      const n = (occ.get(base) || 0) + 1;
      occ.set(base, n);
      line.key = `${base}#${n}`;
      if (seen.has(line.key)) { skipped++; return; }
      seen.add(line.key);
      lines.push(line);
    } catch (e) {
      errors.push({ line: lineNo, message: e.message });
    }
  });
  return { lines, errors, skipped };
}

const dayNum = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);

// התנועה נטו של רשומה בחשבון הבנק, באגורות (חובה בבנק = כסף נכנס)
function bankNetAg(entry) {
  let ag = 0;
  for (const l of entry.lines || []) {
    if (l.account !== BANK) continue;
    ag += Math.round(Number(l.debit || 0) * 100) - Math.round(Number(l.credit || 0) * 100);
  }
  return ag;
}

// מילים משם הלקוח שמופיעות בתיאור התנועה (רק מילים של 2 אותיות ומעלה)
function nameHits(name, text) {
  const t = normText(text);
  if (!t) return 0;
  return normText(name).split(' ').filter(w => w.length >= 2 && t.includes(w)).length;
}

/* אינדקס לפי סכום (אגורות): חשבוניות פתוחות לפי היתרה, ורשומות יומן (לא מבוטלות) לפי התנועה נטו בחשבון הבנק.
   סקירת קוד 2.11.2026: קודם כל תנועה בדף סרקה את כל החשבוניות ואת כל היומן (וחישבה את התנועה נטו מחדש) —
   O(תנועות × רשומות) בכל רינדור. עכשיו האינדקס נבנה פעם אחת לתצוגה, וכל תנועה רואה רק את מה שבאותו סכום */
function suggestIndex({ invoices = [], journal = [] } = {}) {
  const invByAg = new Map(), entByAg = new Map();
  const add = (map, k, v) => { const list = map.get(k); if (list) list.push(v); else map.set(k, [v]); };
  for (const inv of invoices) {
    if (inv.status !== 'open') continue;
    add(invByAg, Math.round(Number(inv.balance) * 100), inv);
  }
  for (const e of journal) {
    if (e.reversedBy || e.reversalOf) continue;
    add(entByAg, bankNetAg(e), e);
  }
  return { invByAg, entByAg };
}

/* הצעות התאמה לתנועה אחת. ctx:
   invoices — חשבוניות בתצוגה (עם balance אחרי זיכויים); journal — רשומות היומן;
   usedEntries — מזהי רשומות שכבר הותאמו לתנועה אחרת; index — מ-suggestIndex (אחרת נבנה כאן).
   מחזיר עד 5 הצעות, הטובה ביותר ראשונה: { type: 'invoice'|'entry', id, label, date, score } */
function suggest(line, { invoices = [], journal = [], usedEntries = new Set(), index } = {}) {
  const idx = index || suggestIndex({ invoices, journal });
  const out = [];
  const d = dayNum(line.date);
  const text = `${line.description} ${line.reference}`;
  if (line.amountAg > 0) {
    for (const inv of idx.invByAg.get(line.amountAg) || []) {
      const gap = d - dayNum(inv.date);
      if (gap > INVOICE_DAYS_BEFORE || gap < -INVOICE_DAYS_AFTER) continue;
      let score = 50 - Math.min(40, Math.floor(Math.abs(gap) / 5));
      score += 20 * Math.min(2, nameHits(inv.customer, text));
      if (new RegExp(`(^|\\D)${inv.number}(\\D|$)`).test(text)) score += 30;
      out.push({ type: 'invoice', id: inv.id, date: inv.date, score,
        label: `חשבונית ${inv.number} — ${inv.customer}` });
    }
  }
  for (const e of idx.entByAg.get(line.amountAg) || []) {
    if (usedEntries.has(e.id)) continue;
    const gap = Math.abs(d - dayNum(e.date));
    if (gap > ENTRY_DAYS) continue;
    // רשומה קיימת באותו סכום ובסמוך — סביר יותר מחשבונית פתוחה (התשלום כבר נרשם)
    const score = 80 - gap * 3 + 10 * Math.min(2, nameHits(e.description, text));
    out.push({ type: 'entry', id: e.id, date: e.date, score, label: `רשומת יומן ${e.date} — ${e.description}` });
  }
  return out.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date)).slice(0, MAX_SUGGESTIONS);
}

// מצב התנועה: הותאמה (לרשומה שלא בוטלה), סומנה "לא לרישום", או פתוחה.
// אם רשומת ההתאמה בוטלה אחר כך (למשל ביטול גבייה) — התנועה חוזרת להיות פתוחה
function lineStatus(line, journalById) {
  if (!line.match) return 'open';
  if (line.match.type === 'ignored') return 'ignored';
  const e = journalById.get(line.match.entryId);
  return e && !e.reversedBy ? 'matched' : 'open';
}

/* תצוגת התנועות: כל תנועה עם מצבה, והצעות לפתוחות. מחזיר גם סיכום */
function view(data, invoiceViews) {
  const journal = data.journal || [];
  const byId = new Map(journal.map(e => [e.id, e]));
  const lines = [...(data.bankLines || [])].sort((a, b) => b.date.localeCompare(a.date) || (b.importedAt || '').localeCompare(a.importedAt || ''));
  const usedEntries = new Set();
  for (const l of lines) if (lineStatus(l, byId) === 'matched') usedEntries.add(l.match.entryId);
  const summary = { total: lines.length, open: 0, matched: 0, ignored: 0, inAg: 0, outAg: 0 };
  const index = suggestIndex({ invoices: invoiceViews, journal });
  const rows = lines.map(l => {
    const status = lineStatus(l, byId);
    summary[status]++;
    if (l.amountAg > 0) summary.inAg += l.amountAg; else summary.outAg -= l.amountAg;
    return { ...l, status, suggestions: status === 'open' ? suggest(l, { usedEntries, index }) : [] };
  });
  return { lines: rows, summary };
}

module.exports = { BANK, FIELDS, MAX_ROWS, parseSignedAg, readFile, guessMapping, preview, buildLines, baseKey, bankNetAg, suggestIndex, suggest, lineStatus, view };
