// תכונות נוספות של המערכת הכלכלית: סיכום תקופתי, הוצאות אישיות/משפחתיות (נפרדות מהיומן),
// ניתוח חשבוניות, ייבוא מחירון מ-CSV, וכתיבת גיבוי אוטומטי מוצפן ליעד חיצוני (כונן USB).
const fs = require('fs');
const path = require('path');
const A = require('./accounting');
const PR = require('./pricing');
const BK = require('./backupCrypto');

// תאריך אמיתי בלבד: 2026-02-31 נדחה (Date.parse מגלגל אותו ל-3.3)
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))).toISOString().slice(0, 10) === s;
const MAX_PERSONAL = 5000;
const MAX_IMPORT_ROWS = 500;

// ---------- סיכום תקופתי: הכנסות, הוצאות, מע"מ ורווח ----------
function periodSummary(entries, accounts, { from, to } = {}) {
  const period = { from: from || undefined, to: to || undefined };
  const pl = A.incomeStatement(entries, accounts, period);
  const vat = A.vatReport(entries, period);
  const income = pl.totalRevenue;
  const expenses = pl.totalExpenses;
  return {
    period: { from: from || null, to: to || null },
    income,
    expenses,
    outputVat: vat.outputVat,
    inputVat: vat.inputVat,
    vatPayable: vat.netPayable,
    profit: pl.netProfit,
    // רווח אחרי מע"מ: מע"מ אינו הכנסה ואינו הוצאה, לכן הוא לא נכלל ברווח — השדה מוצג כדי שהמשתמש יראה את הפער לתשלום
    cashAfterVat: A.fromAg(A.toAg(pl.netProfit) - A.toAg(vat.netPayable))
  };
}

// ---------- הוצאות אישיות/משפחתיות: רשימה נפרדת לגמרי מהיומן העסקי ----------
function validatePersonalEntry(input, count = 0) {
  if (!input || typeof input !== 'object') throw new Error('רשומה לא תקינה');
  if (count >= MAX_PERSONAL) throw new Error('הגעת למספר המקסימלי של רשומות אישיות');
  if (!isDate(input.date)) throw new Error('תאריך לא תקין (YYYY-MM-DD)');
  if (!['income', 'expense'].includes(input.kind)) throw new Error('סוג לא תקין (הכנסה/הוצאה)');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw new Error('סכום לא תקין');
  const category = String(input.category || '').trim();
  if (!category) throw new Error('קטגוריה חובה');
  if (category.length > 100) throw new Error('שם הקטגוריה ארוך מדי');
  const note = String(input.note || '').trim();
  if (note.length > 500) throw new Error('ההערה ארוכה מדי');
  return { date: input.date, kind: input.kind, amount: A.fromAg(A.toAg(amount)), category, note };
}

function personalSummary(entries, { from, to } = {}) {
  const rows = entries.filter(e => (!from || e.date >= from) && (!to || e.date <= to));
  let income = 0, expense = 0;
  const byCategory = new Map();
  for (const e of rows) {
    const ag = A.toAg(e.amount);
    if (e.kind === 'income') income += ag; else expense += ag;
    const key = `${e.kind}:${e.category}`;
    byCategory.set(key, (byCategory.get(key) || 0) + ag);
  }
  const categories = [...byCategory].map(([k, ag]) => {
    const [kind, category] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    return { kind, category, total: A.fromAg(ag) };
  }).sort((a, b) => b.total - a.total);
  return { income: A.fromAg(income), expense: A.fromAg(expense), balance: A.fromAg(income - expense), count: rows.length, categories };
}

// ---------- ניתוח חשבוניות: סכומים חודשיים ולקוחות חוזרים (חשבוניות שבוטלו לא נספרות) ----------
function invoiceAnalytics(invoices) {
  const live = invoices.filter(i => i.status !== 'cancelled');
  const months = new Map();
  const customers = new Map();
  for (const inv of live) {
    const month = String(inv.date || '').slice(0, 7);
    const m = months.get(month) || { month, count: 0, net: 0, vat: 0, total: 0 };
    m.count += 1; m.net += A.toAg(inv.net); m.vat += A.toAg(inv.vat); m.total += A.toAg(inv.total);
    months.set(month, m);

    const key = String(inv.customer || '').trim().toLowerCase();
    if (!key) continue;
    const c = customers.get(key) || { customer: String(inv.customer).trim(), count: 0, total: 0, lastDate: '' };
    c.count += 1; c.total += A.toAg(inv.total);
    if (inv.date > c.lastDate) { c.lastDate = inv.date; c.customer = String(inv.customer).trim(); }
    customers.set(key, c);
  }
  const monthly = [...months.values()].sort((a, b) => a.month.localeCompare(b.month))
    .map(m => ({ month: m.month, count: m.count, net: A.fromAg(m.net), vat: A.fromAg(m.vat), total: A.fromAg(m.total) }));
  const all = [...customers.values()].map(c => ({ customer: c.customer, count: c.count, total: A.fromAg(c.total), lastDate: c.lastDate }));
  const repeat = all.filter(c => c.count >= 2).sort((a, b) => b.count - a.count || b.total - a.total);
  return {
    monthly,
    customers: all.length,
    repeatCustomers: repeat,
    repeatShare: all.length ? Math.round((repeat.length / all.length) * 10000) / 100 : 0,
    totalInvoices: live.length,
    totalRevenue: A.fromAg(live.reduce((t, i) => t + A.toAg(i.total), 0))
  };
}

// ---------- CSV: קריאה (תומך במרכאות, BOM ושורות חדשות) ----------
function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (inQ) throw new Error('קובץ CSV לא תקין: מרכאה לא נסגרה');
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

// ייבוא מחירון: עמודות name, kind, cost, markupPct, vatExempt (כותרת בשורה הראשונה)
function parseProductsCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('הקובץ ריק או חסר שורות נתונים');
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error(`ניתן לייבא עד ${MAX_IMPORT_ROWS} שורות בכל פעם`);
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  if (col('name') < 0) throw new Error('חסרה עמודת name (שם המוצר)');
  const products = [], errors = [];
  rows.slice(1).forEach((r, idx) => {
    const get = (name) => (col(name) >= 0 ? String(r[col(name)] || '').trim() : '');
    const yes = /^(1|yes|true|כן)$/i.test(get('vatexempt'));
    try {
      products.push(PR.validateProduct({
        name: get('name'), kind: get('kind') || 'goods',
        cost: get('cost') || 0, markupPct: get('markuppct') || 0, vatExempt: yes
      }));
    } catch (e) { errors.push({ line: idx + 2, message: e.message }); }
  });
  return { products, errors };
}

// ---------- גיבוי אוטומטי מוצפן ליעד (תיקייה/כונן USB) ----------
// מחזיר {ok:false, reason} אם היעד לא זמין (למשל כונן לא מחובר). לעולם לא כותב טקסט גלוי.
// tag — סימן ההתקנה (shell/auto-backup.js → installTag): auto-YYYY-MM-DD-<tag>.ssbk. הסבב מוחק רק קבצים של
// ההתקנה הזו, וקבצים בלי סימן מלפני השדרוג שלה; גיבויים של מחשב אחר באותו יעד — מסומנים, או בלי סימן ממחשב שעוד
// לא שודרג — לא נמחקים (בדיקת קוד 23.10.2026, ממצא 38)
function writeEncryptedAutoBackup({ dir, plainText, key, keep = 14, today, tag }) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, reason: 'target-missing' };
  if (typeof key !== 'string' || key.length < BK.MIN_PASSPHRASE) return { ok: false, reason: 'no-key' };
  const day = today || new Date().toLocaleDateString('en-CA'); // תאריך מקומי YYYY-MM-DD (לא UTC)
  const own = typeof tag === 'string' && /^[0-9a-f]{8}$/.test(tag) ? tag : null;
  const name = own ? `auto-${day}-${own}.ssbk` : `auto-${day}.ssbk`;
  const legacy = /^auto-\d{4}-\d{2}-\d{2}\.(json|ssbk)$/;
  // לפי התאריך; באותו יום — הקובץ בלי הסימן (הישן) קודם, כדי שיימחק ראשון
  const byDay = (a, b) => a.slice(5, 15).localeCompare(b.slice(5, 15)) || (a.length - b.length) || a.localeCompare(b);
  const files = fs.readdirSync(dir);
  let existing;
  if (!own) existing = files.filter(f => legacy.test(f)).sort(byDay);
  else {
    const ownRe = new RegExp(`^auto-\\d{4}-\\d{2}-\\d{2}-${own}\\.ssbk$`);
    const ownFiles = files.filter(f => ownRe.test(f)).sort(byDay);
    // קובץ בלי סימן הוא של ההתקנה הזו רק אם הוא מלפני הגיבוי המסומן הראשון שלה (מלפני השדרוג), ורק עד שיש לה keep
    // גיבויים מסומנים — אז הישנים שלה כבר נמחקו (הם הוותיקים ביותר ונמחקים ראשונים). קובץ בלי סימן מאוחר יותר — של
    // מחשב אחר באותו יעד שעוד לא שודרג: לא נספר ולא נמחק. קבצים בלי סימן שהיו ביעד לפני השדרוג אי אפשר לשייך
    const since = ownFiles.length ? ownFiles[0].slice(5, 15) : day;
    const oldOwn = ownFiles.length < keep ? files.filter(f => legacy.test(f) && f.slice(5, 15) < since) : [];
    existing = oldOwn.concat(ownFiles).sort(byDay);
  }
  if (existing.includes(name)) return { ok: true, skipped: true, file: path.join(dir, name) };
  const file = path.join(dir, name);
  const tmp = file + '.tmp';
  // כונן מלא/מוגן מפני כתיבה: מנקים את הקובץ הזמני ומחזירים סיבה, במקום להשאיר שארית על הכונן.
  // fsync לפני ההחלפה ולפני מחיקת הישנים: אחרת ניתוק חשמל/USB יכול להשאיר קובץ חדש ריק אחרי שהישנים כבר נמחקו
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, BK.encryptBackup(plainText, key), null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    return { ok: false, reason: 'write-failed', error: e.code || e.message };
  }
  const all = existing.concat(name).sort(byDay);
  const removed = [];
  for (const f of all.slice(0, Math.max(0, all.length - keep))) { fs.unlinkSync(path.join(dir, f)); removed.push(f); }
  return { ok: true, file, removed };
}

module.exports = {
  periodSummary, validatePersonalEntry, personalSummary, invoiceAnalytics,
  parseCsv, parseProductsCsv, writeEncryptedAutoBackup, MAX_PERSONAL, MAX_IMPORT_ROWS
};
