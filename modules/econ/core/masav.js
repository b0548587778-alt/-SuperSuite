// מס"ב (PLAN.md 9.17): קובץ חיובים לפי הרשאה (הוראות קבע לעמותה, החזרי הלוואות בגמ"ח) וקליטת קובץ החזרות.
// קבצים בלבד, בלי רשת: הארגון מעלה את הקובץ לבנק או לחברת הגבייה, ומוריד משם את קובץ ההחזרות.
// מקור: "מפרט טכני להצגת חיובים עפ"י הרשאה" ו"מבנה קובץ להחזרות חיובים" באתר מס"ב (מפרטי קבצים, 2025–2026).
// פונקציות טהורות. הסכומים באגורות שלמות. הקובץ מוחזר כמחרוזת שבה כל תו הוא בית אחד (0–255): נכתב ב-latin1.

const DEBIT_LEN = 128;
const RETURN_LEN = 220;
const MAX_ITEMS = 9999999; // שדה מספר התנועות — 7 ספרות
const MAX_AMOUNT_AG = 1e13 - 1; // 11 ספרות לש"ח ו-2 לאגורות

// קידוד העברית בשדות השם: המפרט קובע רק "ASCII". בפועל: "קוד ישן" 7 ביט (א = 0x60, כמו בחשבשבת) או DOS / CP862 (א = 0x80),
// בסדר חזותי (מימין לשמאל, "ערוך להדפסה"). הבנק או חברת הגבייה אומרים איזה — ולכן זו הגדרה של הארגון
const HEBREW_CODES = { oldcode: { label: 'קוד ישן (7 ביט, ברירת מחדל)', base: 0x60 }, cp862: { label: 'DOS (CP862)', base: 0x80 } };

// טבלת סיבות ההחזרה (נספח א' למפרט ההחזרות). קוד לא מוכר — מוצג עם הקוד והתיאור שבקובץ
const RETURN_REASONS = {
  1: 'אין כיסוי מספיק', 2: 'ביטול הרשאה', 3: 'אין הרשאה לחיוב זה', 4: 'אין חשבון במספר שצוין', 5: 'בעל החשבון נפטר',
  7: 'ביטול החיוב', 8: 'החשבון מעוקל', 9: 'מועד החיוב אינו תואם את ההרשאה', 10: 'סכום החיוב אינו תואם את ההרשאה',
  11: 'בעל החשבון הוצא מההסדר', 12: 'החשבון נסגר', 13: 'צו של בית משפט', 14: 'פשיטת רגל או פירוק', 15: 'כינוס נכסים',
  16: 'הקפאת הליכים', 17: 'פעולה אסורה על פי דין', 18: 'חסרים פרטי זיהוי בחשבון', 19: 'הוראת הקפאה להרשאה', 22: 'ביטול חוזר'
};
// החזרות שמשמעותן שההרשאה כבר לא תקפה — כדאי לעצור את ההוראה ולא לחייב שוב
const FATAL_REASONS = new Set([2, 3, 4, 5, 11, 12, 22]);

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const N = (v, len) => {
  const s = String(v);
  if (!/^\d*$/.test(s) || s.length > len) throw new Error(`ערך מספרי ארוך מדי לשדה (${len} ספרות): ${s}`);
  return s.padStart(len, '0');
};
const isoToYYMMDD = (iso) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
const isoToYYMM = (ym) => ym.slice(2, 4) + ym.slice(5, 7);
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const yymmddToIso = (s) => (/^\d{6}$/.test(s) && s !== '000000' ? `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}` : '');

// פרטי חשבון בנק: בנק 2 ספרות, סניף 3, חשבון עד 9. ספרת ביקורת של חשבון — לא נבדקת (שונה בכל בנק; הבנק דוחה בהחזרה, קוד 4)
function validateBankAccount(input) {
  if (!input || typeof input !== 'object') throw new Error('פרטי חשבון הבנק אינם תקינים');
  const bank = digits(input.bank), branch = digits(input.branch), account = digits(input.account);
  if (!bank || bank.length > 2 || Number(bank) === 0) throw new Error('קוד הבנק חייב להיות מספר של 1–2 ספרות');
  if (!branch || branch.length > 3) throw new Error('מספר הסניף חייב להיות מספר של 1–3 ספרות');
  if (!account || account.length > 9 || Number(account) === 0) throw new Error('מספר החשבון חייב להיות מספר של עד 9 ספרות');
  return { bank: bank.padStart(2, '0'), branch: branch.padStart(3, '0'), account: account.padStart(9, '0') };
}

// מסיכה לתצוגה: רק 3 הספרות האחרונות של החשבון. הפרטים המלאים יוצאים רק לקובץ החיובים
const maskAccount = (a) => (a && a.account ? `${a.bank}-${a.branch}-•••${a.account.slice(-3)}` : '');

function validateSettings(input) {
  const s = input && typeof input === 'object' ? input : {};
  const institution = digits(s.institution), sender = digits(s.sender);
  if (!/^\d{1,8}$/.test(institution) || Number(institution) === 0) throw new Error('קוד המוסד במס"ב חייב להיות מספר של עד 8 ספרות (ניתן על ידי מס"ב)');
  if (!/^\d{1,5}$/.test(sender) || Number(sender) === 0) throw new Error('קוד המוסד השולח חייב להיות מספר של עד 5 ספרות (ניתן על ידי מס"ב)');
  const name = String(s.name ?? '').trim().slice(0, 30);
  if (!name) throw new Error('שם המוסד לקובץ חובה');
  return { institution, sender, name, hebrew: HEBREW_CODES[s.hebrew] ? s.hebrew : 'oldcode' };
}

// טקסט לשדה X: ניקוד מוסר, גרשיים נמחקים, סימנים מפרידים ← רווח, עברית ← קוד לפי ההגדרה, תו אחר ← רווח.
// סדר חזותי: הסדר הלוגי מתהפך, ורצפים של ספרות ואותיות לטיניות חוזרים לסדרם. הפלט צמוד לימין
function textField(text, len, hebrew = 'oldcode') {
  const code = HEBREW_CODES[hebrew] ? hebrew : 'oldcode';
  const base = HEBREW_CODES[code].base;
  // בקוד הישן (7 ביט) הבתים 0x60–0x7A הם א–ת — אות לטינית קטנה הייתה נקראת בבנק כעברית. לכן רק אותיות גדולות
  const latin = code === 'oldcode' ? (ch) => ch.toUpperCase() : (ch) => ch;
  // מקף עברי (U+05BE) בתוך טווח הניקוד — הופך לרווח לפני הסרת הניקוד
  const clean = String(text ?? '').normalize('NFC').replace(/־/g, ' ').replace(/[֑-ׇ]/g, '').replace(/["'`״׳]/g, '')
    .replace(/[()\/_\-–]/g, ' ').replace(/\s+/g, ' ').trim();
  // כיוון נקבע לפי התו המקורי — בקוד הישן אות עברית מקודדת כאות לטינית קטנה, ואסור לבלבל ביניהן
  const out = [];
  for (const ch of clean) {
    const c = ch.codePointAt(0);
    if (c >= 0x05D0 && c <= 0x05EA) out.push({ ch: String.fromCharCode(base + c - 0x05D0), ltr: false });
    else if (/[0-9A-Za-z]/.test(ch)) out.push({ ch: latin(ch), ltr: true });
    else out.push({ ch: /[ .,:#+]/.test(ch) ? ch : ' ', ltr: false });
  }
  const hasHeb = /[א-ת]/.test(clean);
  let s;
  if (hasHeb) {
    const rev = out.reverse();
    const parts = [];
    for (let i = 0; i < rev.length;) {
      if (!rev[i].ltr) { parts.push(rev[i].ch); i++; continue; }
      let j = i;
      while (j < rev.length && rev[j].ltr) j++;
      parts.push(rev.slice(i, j).reverse().map(t => t.ch).join(''));
      i = j;
    }
    s = parts.join('');
  } else s = out.map(t => t.ch).join('');
  s = s.slice(hasHeb ? Math.max(0, s.length - len) : 0, hasHeb ? s.length : len);
  return hasHeb ? s.padStart(len, ' ') : s.padEnd(len, ' ');
}

// אסמכתה: 20 תווים, ספרות צמודות לימין עם אפסים. 6 הספרות הימניות ייחודיות להרשאה וקבועות לכל חייה
function referenceField(ref) {
  const r = digits(ref);
  if (!r || Number(r.slice(-6)) === 0) throw new Error('מספר האסמכתה להרשאה אינו תקין');
  return N(r, 20);
}

/* קובץ חיובים. input:
   settings — { institution, sender, name, hebrew }; chargeDate — YYYY-MM-DD (ערך חיוב הלקוחות); createdDate — YYYY-MM-DD;
   items — [{ bank, branch, account, idNumber, name, amountAg, reference, period: 'YYYY-MM' }]
   מחזיר { text, totalAg, count } — text: רשומת כותרת, תנועות ממוינות, סה"כ ושורת תשיעיות, כל אחת 128 תווים + CRLF */
function buildDebitFile({ settings, chargeDate, createdDate, items }) {
  const s = validateSettings(settings);
  if (!isDay(chargeDate)) throw new Error('תאריך החיוב אינו תקין');
  if (!isDay(createdDate)) throw new Error('תאריך יצירת הקובץ אינו תקין');
  if (!Array.isArray(items) || items.length === 0) throw new Error('אין חיובים לקובץ');
  if (items.length > MAX_ITEMS) throw new Error('יותר מדי חיובים בקובץ אחד');
  const inst = N(s.institution, 8);
  const head = 'K' + inst + '00' + isoToYYMMDD(chargeDate) + '0' + '001' + '0' + isoToYYMMDD(createdDate) + N(s.sender, 5) + '0'.repeat(6) +
    textField(s.name, 30, s.hebrew) + ' '.repeat(56) + 'KOT';
  const rows = items.map((it, i) => {
    const acc = validateBankAccount(it);
    const ag = Number(it.amountAg);
    if (!Number.isInteger(ag) || ag <= 0 || ag > MAX_AMOUNT_AG) throw new Error(`סכום החיוב אינו תקין (שורה ${i + 1})`);
    const id = digits(it.idNumber);
    if (id.length > 9) throw new Error(`מספר הזהות ארוך מדי (שורה ${i + 1})`);
    const period = /^\d{4}-\d{2}$/.test(String(it.period || '')) ? isoToYYMM(it.period).repeat(2) : '0'.repeat(8);
    const line = '1' + inst + '00' + '000000' + acc.bank + acc.branch + '0000' + acc.account + '0' + N(id, 9) +
      textField(it.name, 16, s.hebrew) + N(ag, 13) + referenceField(it.reference) + period + '000' + '504' + '0'.repeat(18) + '  ';
    return { line, ag, sortKey: acc.bank + acc.branch + acc.account + referenceField(it.reference) };
  }).sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  const totalAg = rows.reduce((t, r) => t + r.ag, 0);
  const total = '5' + inst + '00' + isoToYYMMDD(chargeDate) + '0' + '001' + '0'.repeat(15) + N(totalAg, 15) + '0'.repeat(7) +
    N(rows.length, 7) + ' '.repeat(63);
  const lines = [head, ...rows.map(r => r.line), total, '9'.repeat(DEBIT_LEN)];
  for (const l of lines) if (l.length !== DEBIT_LEN) throw new Error(`שגיאה פנימית: רשומה באורך ${l.length} במקום ${DEBIT_LEN}`);
  return { text: lines.join('\r\n') + '\r\n', totalAg, count: rows.length };
}

/* קובץ זיכויים (תשלומים: כסף יוצא מחשבון המוסד) — PLAN שלב 10, 10.4. מקור: "מפרט טכני לבצוע תשלומים באמצעות מס"ב".
   אותו מבנה כמו קובץ החיובים, בהבדלים: סוג התנועה 006 (במקום 504), וברשומת הסה"כ הסכום במיקום 22 (15 תווים)
   ומספר התנועות במיקום 52 (7 תווים) — הפוך מקובץ החיובים. אסמכתה — מספר התשלום אצל המוסד (ספרות, רשות).
   ⚠ לא נבדק מול סימולטור הבנק: אין שימוש אמיתי לפני בדיקה (8א.3). טעות כאן שולחת כסף לחשבון אחר.
   input: settings; paymentDate — YYYY-MM-DD (יום הזיכוי); createdDate; items — [{ bank, branch, account, idNumber, name, amountAg, reference, period }]
   מחזיר { text, totalAg, count } */
function buildCreditFile({ settings, paymentDate, createdDate, items }) {
  const s = validateSettings(settings);
  if (!isDay(paymentDate)) throw new Error('תאריך התשלום אינו תקין');
  if (!isDay(createdDate)) throw new Error('תאריך יצירת הקובץ אינו תקין');
  if (!Array.isArray(items) || items.length === 0) throw new Error('אין תשלומים לקובץ');
  if (items.length > MAX_ITEMS) throw new Error('יותר מדי תשלומים בקובץ אחד');
  const inst = N(s.institution, 8);
  const head = 'K' + inst + '00' + isoToYYMMDD(paymentDate) + '0' + '001' + '0' + isoToYYMMDD(createdDate) + N(s.sender, 5) + '0'.repeat(6) +
    textField(s.name, 30, s.hebrew) + ' '.repeat(56) + 'KOT';
  const rows = items.map((it, i) => {
    const acc = validateBankAccount(it);
    const ag = Number(it.amountAg);
    if (!Number.isInteger(ag) || ag <= 0 || ag > MAX_AMOUNT_AG) throw new Error(`סכום התשלום אינו תקין (שורה ${i + 1}) — חייב להיות חיובי`);
    const id = digits(it.idNumber);
    if (id.length > 9) throw new Error(`מספר הזהות ארוך מדי (שורה ${i + 1})`);
    if (!String(it.name ?? '').trim()) throw new Error(`שם המוטב חסר (שורה ${i + 1})`);
    const ref = digits(it.reference);
    if (ref.length > 20) throw new Error(`האסמכתה ארוכה מדי (שורה ${i + 1})`);
    const period = /^\d{4}-\d{2}$/.test(String(it.period || '')) ? isoToYYMM(it.period).repeat(2) : '0'.repeat(8);
    const line = '1' + inst + '00' + '000000' + acc.bank + acc.branch + '0000' + acc.account + '0' + N(id, 9) +
      textField(it.name, 16, s.hebrew) + N(ag, 13) + N(ref, 20) + period + '000' + '006' + '0'.repeat(18) + '  ';
    return { line, ag, sortKey: acc.bank + acc.branch + acc.account + N(ref, 20) };
  }).sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  const totalAg = rows.reduce((t, r) => t + r.ag, 0);
  if (totalAg > 1e15 - 1) throw new Error('סכום הקובץ גדול מדי');
  const total = '5' + inst + '00' + isoToYYMMDD(paymentDate) + '0' + '001' + N(totalAg, 15) + '0'.repeat(15) + N(rows.length, 7) + '0'.repeat(7) +
    ' '.repeat(63);
  const lines = [head, ...rows.map(r => r.line), total, '9'.repeat(DEBIT_LEN)];
  for (const l of lines) if (l.length !== DEBIT_LEN) throw new Error(`שגיאה פנימית: רשומה באורך ${l.length} במקום ${DEBIT_LEN}`);
  return { text: lines.join('\r\n') + '\r\n', totalAg, count: rows.length };
}

/* קליטת קובץ החזרות חיובים (220 תווים לרשומה; רווחים בסוף שורה עשויים להיחתך — משלימים).
   מחזיר { items, errors } — items: [{ institution, reasonCode, reason, reference, bank, branch, account, amountAg, chargeDate, returnDate, period }] */
function parseReturnsFile(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(Boolean);
  if (!lines.length) throw new Error('הקובץ ריק');
  if (lines.some(l => l.length > RETURN_LEN)) throw new Error('זה לא קובץ החזרות של מס"ב (רשומה ארוכה מ-220 תווים)');
  if (!lines.some(l => l[0] === 'R')) throw new Error('זה לא קובץ החזרות של מס"ב (אין רשומת כותרת R)');
  const items = [], errors = [];
  let group = null;
  const close = (lineNo) => { if (group) errors.push({ line: lineNo, message: `חסרה רשומת סה"כ למוסד ${group.institution}` }); };
  lines.forEach((raw, i) => {
    const l = raw.padEnd(RETURN_LEN, ' ');
    const lineNo = i + 1;
    const f = (pos, len) => l.slice(pos - 1, pos - 1 + len);
    if (l[0] === 'R') { close(lineNo); group = { institution: f(2, 8), date: f(12, 6), count: 0, totalAg: 0 }; return; }
    if (l[0] === '1') {
      if (!group) { errors.push({ line: lineNo, message: 'רשומת תנועה לפני רשומת כותרת' }); return; }
      const amount = f(85, 15);
      if (!/^\d{15}$/.test(amount) || !/^\d{3}$/.test(f(18, 3))) { errors.push({ line: lineNo, message: 'רשומת החזרה פגומה' }); return; }
      const reasonCode = Number(f(18, 3));
      const amountAg = Number(amount);
      group.count++; group.totalAg += amountAg;
      items.push({
        institution: f(2, 8), reasonCode,
        reason: RETURN_REASONS[reasonCode] || `סיבה ${reasonCode}: ${f(21, 10).trim()}`,
        fatal: FATAL_REASONS.has(reasonCode),
        reference: digits(f(31, 20)).replace(/^0+/, ''),
        bank: f(51, 2), branch: f(53, 3), account: f(60, 9),
        amountAg, chargeDate: yymmddToIso(f(137, 6)), returnDate: yymmddToIso(f(143, 6)), period: f(154, 8).trim()
      });
      return;
    }
    if (l[0] === '6') {
      if (!group) { errors.push({ line: lineNo, message: 'רשומת סה"כ בלי רשומת כותרת' }); return; }
      if (Number(f(18, 15)) !== group.totalAg || Number(f(33, 8)) !== group.count) {
        errors.push({ line: lineNo, message: `סכומי הביקורת של מוסד ${group.institution} לא תואמים — ייתכן שהקובץ חלקי` });
      }
      group = null;
      return;
    }
    errors.push({ line: lineNo, message: `סוג רשומה לא מוכר: "${l[0]}"` });
  });
  close(lines.length);
  return { items, errors };
}

// מפתח לזיהוי החזרה שכבר נקלטה
const returnKey = (r) => `${r.institution}|${r.reference}|${r.chargeDate}|${r.amountAg}|${r.returnDate}`;

/* אצוות חיוב — משותף לעמותה ולגמ"ח. batch: { id, chargeDate, createdAt, status: 'open'|'closed'|'cancelled',
   items: [{ key, ref, amountAg, label, status: 'pending'|'returned'|'paid', reason? }], returns: [returnKey] }.
   key = מזהה החיוב בתחום (הוראה+חודש, הלוואה+תשלום) — חיוב שנמצא באצווה פתוחה או סגורה לא נכלל באצווה נוספת */
function busyKeys(batches) {
  const busy = new Set();
  for (const b of batches || []) {
    if (b.status === 'cancelled') continue;
    for (const it of b.items || []) if (it.status !== 'returned') busy.add(it.key);
  }
  return busy;
}

/* החלת קובץ החזרות על האצוות: כל החזרה מותאמת לחיוב ממתין לפי מוסד, אסמכתה, סכום ותאריך החיוב (אם יש).
   מחזיר { matched: [{ batchId, itemKey, reason, fatal }], late, skipped, unmatched: [החזרה + סיבה] } ומעדכן את האצוות במקום.
   late — החזרה לחיוב שכבר אושר כהתקבל: התשלום לא משתנה (ביטול ידני), אבל ההחזרה נרשמת — כדי שלא תדווח שוב
   בכל קליטה, ושהחזרה סופית תעצור את החיובים הבאים */
function applyReturns(batches, parsed, institution) {
  const matched = [], unmatched = [], late = [];
  let skipped = 0;
  const inst = N(digits(institution) || '0', 8);
  for (const r of parsed.items) {
    if (r.institution !== inst) { unmatched.push({ ...r, why: `קוד מוסד אחר (${r.institution})` }); continue; }
    const key = returnKey(r);
    if ((batches || []).some(b => (b.returns || []).includes(key))) { skipped++; continue; }
    const cands = [];
    for (const b of batches || []) {
      if (b.status === 'cancelled') continue;
      if (r.chargeDate && b.chargeDate !== r.chargeDate) continue;
      for (const it of b.items) if (it.ref === r.reference && it.amountAg === r.amountAg && it.status !== 'returned') cands.push({ b, it });
    }
    if (!cands.length) { unmatched.push({ ...r, why: 'לא נמצא חיוב תואם באצוות' }); continue; }
    const { b, it } = cands.find(c => c.it.status === 'pending') || cands[0];
    if (it.status === 'paid') {
      unmatched.push({ ...r, why: `החיוב כבר אושר כהתקבל באצווה של ${b.chargeDate} — יש לבטל את התשלום ידנית` });
      it.lateReturn = r.reason;
      b.returns = [...(b.returns || []), key];
      late.push({ batchId: b.id, itemKey: it.key, reason: r.reason, fatal: r.fatal });
      continue;
    }
    it.status = 'returned';
    it.reason = r.reason;
    it.reasonCode = r.reasonCode;
    b.returns = [...(b.returns || []), key];
    matched.push({ batchId: b.id, itemKey: it.key, reason: r.reason, fatal: r.fatal });
  }
  return { matched, late, skipped, unmatched };
}

module.exports = {
  DEBIT_LEN, RETURN_LEN, HEBREW_CODES, RETURN_REASONS, FATAL_REASONS,
  validateBankAccount, maskAccount, validateSettings, textField, referenceField, buildDebitFile, buildCreditFile, parseReturnsFile,
  returnKey, busyKeys, applyReturns, isDay
};

// אחסון מס"ב בתחום (npo.masav / gemach.masav): הגדרות, אצוות ומונה אסמכתאות להרשאות
function normalizeStore(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return {
    settings: m.settings && typeof m.settings === 'object' ? m.settings : null,
    batches: Array.isArray(m.batches) ? m.batches : [],
    refSeq: Number.isInteger(m.refSeq) && m.refSeq >= 0 ? m.refSeq : 0
  };
}

// תצוגת אצווה: סיכום בלי פרטי חשבון
function batchView(b) {
  const sum = (st) => b.items.filter(i => i.status === st).reduce((t, i) => t + i.amountAg, 0);
  return {
    id: b.id, chargeDate: b.chargeDate, month: b.month || '', status: b.status, createdAt: b.createdAt, closedAt: b.closedAt || '',
    count: b.items.length, totalAg: b.items.reduce((t, i) => t + i.amountAg, 0),
    pending: b.items.filter(i => i.status === 'pending').length, pendingAg: sum('pending'),
    returned: b.items.filter(i => i.status === 'returned').map(i => ({ label: i.label, amountAg: i.amountAg, reason: i.reason || '' })),
    paid: b.items.filter(i => i.status === 'paid').length,
    // דורש טיפול ידני: הוחזר אחרי האישור, או חיוב שלא נרשם בסגירה
    manual: b.items.filter(i => i.lateReturn || i.manual).map(i => ({ label: i.label, amountAg: i.amountAg,
      why: i.manual || `הוחזר אחרי האישור (${i.lateReturn}) — יש לבטל את התשלום ידנית` }))
  };
}

// סיכום קליטת החזרות לממשק — בלי מספרי חשבון. manual — החזרות שנקלטו אבל דורשות פעולה ידנית בתחום
const returnsSummary = (r, parsed, manual = []) => ({
  returned: r.matched.length, skipped: r.skipped,
  unmatched: r.unmatched.map(u => ({ reference: u.reference, amountAg: u.amountAg, reason: u.reason, why: u.why })),
  manual,
  errors: parsed.errors
});

Object.assign(module.exports, { normalizeStore, batchView, returnsSummary });
