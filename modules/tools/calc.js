// לוגיקה טהורה לכלי הנוספים בארגז הכלים (בלי DOM) — נבדקת בבדיקות Node
(function (root) {
  'use strict';

  // רשימת קניות: שורה = "שם, כמות, קטגוריה" (כמות וקטגוריה אופציונליים). מחזיר קבוצות לפי קטגוריה.
  function groupShoppingList(text, defaultCategory = 'שונות') {
    const groups = new Map();
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 300);
    for (const line of lines) {
      const [rawName, rawQty, rawCat] = line.split(',').map(s => s.trim());
      if (!rawName) continue;
      const qty = rawQty && /^\d+(\.\d+)?$/.test(rawQty) ? Number(rawQty) : 1;
      const name = rawName.slice(0, 100);
      const cat = (rawCat || (rawQty && !/^\d+(\.\d+)?$/.test(rawQty) ? rawQty : '') || defaultCategory).slice(0, 40);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push({ name, qty });
    }
    return [...groups].map(([category, items]) => ({ category, items }));
  }

  function shoppingListText(groups) {
    return groups.map(g => `${g.category}:\n` + g.items.map(i => `  ☐ ${i.name}${i.qty !== 1 ? ` (×${i.qty})` : ''}`).join('\n')).join('\n\n');
  }

  // עלות חשמל: הספק בוואט, שעות ביום, מחיר לקוט"ש (kWh)
  function powerCost({ watts, hoursPerDay, pricePerKwh, days = 30 }) {
    const w = Number(watts), h = Number(hoursPerDay), p = Number(pricePerKwh), d = Number(days);
    if (![w, h, p, d].every(Number.isFinite) || w < 0 || h < 0 || h > 24 || p < 0 || d < 0) throw new Error('נתונים לא תקינים');
    const kwhDay = (w * h) / 1000;
    const kwh = kwhDay * d;
    return { kwhPerDay: round(kwhDay, 3), kwhPeriod: round(kwh, 2), costPeriod: round(kwh * p, 2), costPerDay: round(kwhDay * p, 2) };
  }

  // הפרש בין שני תאריכים (YYYY-MM-DD): ימים, שבועות וחודשים מלאים בקירוב
  function dateDiff(from, to) {
    const a = parseDay(from), b = parseDay(to);
    const days = Math.round((b - a) / 86400000);
    let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    if (b.getUTCDate() < a.getUTCDate()) months -= 1;
    return { days, weeks: Math.floor(Math.abs(days) / 7), months: Math.max(0, months) };
  }

  function addDays(date, n) {
    const d = parseDay(date);
    const k = Number(n);
    if (!Number.isInteger(k)) throw new Error('מספר ימים לא תקין');
    d.setUTCDate(d.getUTCDate() + k);
    return d.toISOString().slice(0, 10);
  }

  // ריבית דריבית עם הפקדה חודשית קבועה (ריבית שנתית נומינלית, הצטברות חודשית)
  function compoundInterest({ principal = 0, annualRate, years, monthlyDeposit = 0 }) {
    const P = Number(principal), r = Number(annualRate) / 100 / 12, n = Math.round(Number(years) * 12), M = Number(monthlyDeposit);
    if (![P, r, n, M].every(Number.isFinite) || P < 0 || n < 0 || n > 1200 || M < 0 || Number(annualRate) < 0) throw new Error('נתונים לא תקינים');
    let balance = P;
    for (let i = 0; i < n; i++) balance = balance * (1 + r) + M;
    const deposited = P + M * n;
    return { final: round(balance, 2), deposited: round(deposited, 2), interest: round(balance - deposited, 2), months: n };
  }

  function parseDay(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error('תאריך לא תקין (YYYY-MM-DD)');
    const d = new Date(s + 'T00:00:00Z');
    if (isNaN(d)) throw new Error('תאריך לא תקין');
    return d;
  }
  const round = (n, digits) => Math.round(n * 10 ** digits) / 10 ** digits;

  // ─── כלים לקהל היעד (PLAN.md 9.12). כסף באגורות שלמות ───

  // שקלים מהקלדה ← אגורות שלמות (עד 2 ספרות אחרי הנקודה), או null
  function toAg(raw) {
    const s = String(raw ?? '').trim().replace(/[,\s₪]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    const [a, b = ''] = s.split('.');
    return Number(a) * 100 + Number((b + '00').slice(0, 2));
  }

  // טבלת שכר: מדרגות חודשיות (בשקלים) ושיעורים באחוזים, ביטוח לאומי ובריאות לעובד. verified=false ← אזהרה בממשק
  const SALARY_TABLE_DEFAULT = {
    year: 2026,
    note: 'מדרגות ושווי נקודת זיכוי של 2025 (שהוקפאו) — לא אומתו מול רשות המסים. יש לעדכן מקובץ לפני הסתמכות.',
    verified: false,
    creditPoint: 242,
    brackets: [[7010, 10], [10060, 14], [16150, 20], [22440, 31], [46690, 35], [60130, 47], [null, 50]],
    social: { threshold: 7522, ceiling: 50695, reduced: [1.04, 3.23], full: [7, 5.17] },
  };

  // טבלה מקובץ (JSON) — בדיקה מלאה, אחרת שגיאה בעברית
  function parseSalaryTable(text) {
    let t;
    try { t = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('קובץ הטבלה אינו JSON תקין'); }
    const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
    if (!t || !num(t.year, 2020, 2100)) throw new Error('בטבלה חסרה שנת תוקף');
    if (!num(t.creditPoint, 100, 1000)) throw new Error('שווי נקודת זיכוי אינו תקין');
    const b = t.brackets;
    if (!Array.isArray(b) || b.length < 2 || b.length > 12) throw new Error('מדרגות המס אינן תקינות');
    let prev = 0;
    b.forEach(([top, rate], i) => {
      const last = i === b.length - 1;
      if (!num(rate, 0, 60)) throw new Error(`שיעור לא תקין במדרגה ${i + 1}`);
      if (last ? top !== null : !(num(top, 1, 1e7) && top > prev)) throw new Error(`תקרה לא תקינה במדרגה ${i + 1}`);
      if (!last) prev = top;
    });
    const s = t.social;
    if (!s || !num(s.threshold, 1, 1e6) || !num(s.ceiling, s.threshold, 1e7) || ![...(s.reduced || []), ...(s.full || [])].every(v => num(v, 0, 30)) || s.reduced.length !== 2 || s.full.length !== 2) throw new Error('נתוני ביטוח לאומי ובריאות אינם תקינים');
    return { year: t.year, note: String(t.note || '').slice(0, 200), verified: t.verified === true, creditPoint: t.creditPoint, brackets: b.map(([top, rate]) => [top, rate]), social: { threshold: s.threshold, ceiling: s.ceiling, reduced: [...s.reduced], full: [...s.full] } };
  }

  // אגורות × אחוז (עד 2 ספרות) בלי נקודה צפה במצטבר: עיגול לכל רכיב
  const pctOf = (ag, pct) => Math.round(ag * Math.round(pct * 100) / 10000);

  // ברוטו ← נטו (חודשי). הערכה: בלי זיכוי בגין הפקדה לפנסיה, בלי שווי, בלי החזרי מס
  function netSalary({ gross, creditPoints = 2.25, pensionPct = 6, table = SALARY_TABLE_DEFAULT }) {
    const g = toAg(gross);
    if (g === null || g <= 0 || g > 100000000) throw new Error('יש להזין שכר ברוטו');
    const cp = Number(creditPoints), pp = Number(pensionPct);
    if (!(cp >= 0 && cp <= 20)) throw new Error('מספר נקודות הזיכוי אינו תקין');
    if (!(pp >= 0 && pp <= 10)) throw new Error('שיעור ההפרשה לפנסיה אינו תקין');
    let taxAg = 0, from = 0;
    const steps = [];
    for (const [top, rate] of table.brackets) {
      const topAg = top === null ? Infinity : top * 100;
      if (g <= from) break;
      const part = Math.min(g, topAg) - from;
      const t = pctOf(part, rate);
      steps.push({ rate, partAg: part, taxAg: t });
      taxAg += t;
      from = topAg;
    }
    const creditAg = Math.round(cp * table.creditPoint * 100);
    const incomeTaxAg = Math.max(0, taxAg - creditAg);
    const s = table.social;
    const lowAg = Math.min(g, s.threshold * 100);
    const highAg = Math.max(0, Math.min(g, s.ceiling * 100) - s.threshold * 100);
    const bituachAg = pctOf(lowAg, s.reduced[0]) + pctOf(highAg, s.full[0]);
    const healthAg = pctOf(lowAg, s.reduced[1]) + pctOf(highAg, s.full[1]);
    const pensionAg = pctOf(g, pp);
    const netAg = g - incomeTaxAg - bituachAg - healthAg - pensionAg;
    return { grossAg: g, taxBeforeCreditAg: taxAg, creditAg, incomeTaxAg, bituachAg, healthAg, pensionAg, netAg, steps, year: table.year, verified: table.verified };
  }

  // שנה עברית של תאריך (YYYY-MM-DD) — לפי לוח השנה המובנה; null בלי תמיכה
  function hebrewYearOf(day) {
    try {
      const d = parseDay(day);
      const parts = new Intl.DateTimeFormat('he-u-ca-hebrew', { year: 'numeric', timeZone: 'UTC' }).formatToParts(d);
      const y = parts.find(p => p.type === 'year');
      return y ? y.value : null;
    } catch { return null; }
  }

  // מעשרות: הכנסות מול נתינה, לפי אחוז שהמשתמש בוחר. חישוב בלבד — לא פוסק מה נחשב הכנסה או נתינה
  function maaserSummary(entries, ratePct = 10) {
    const rate = Number(ratePct);
    if (![10, 20].includes(rate)) throw new Error('יש לבחור 10% או 20%');
    const years = new Map();
    let incomeAg = 0, givenAg = 0;
    for (const e of Array.isArray(entries) ? entries : []) {
      const amt = Number(e && e.amountAg);
      if (!Number.isInteger(amt) || amt <= 0 || !['income', 'given'].includes(e.kind)) continue;
      const y = hebrewYearOf(e.date) || 'ללא תאריך';
      if (!years.has(y)) years.set(y, { year: y, incomeAg: 0, givenAg: 0 });
      years.get(y)[e.kind === 'income' ? 'incomeAg' : 'givenAg'] += amt;
      if (e.kind === 'income') incomeAg += amt; else givenAg += amt;
    }
    const dueAg = Math.round(incomeAg * rate / 100);
    const list = [...years.values()].map(y => ({ ...y, dueAg: Math.round(y.incomeAg * rate / 100) }));
    return { rate, incomeAg, givenAg, dueAg, balanceAg: dueAg - givenAg, years: list };
  }

  function newMaaserEntry({ kind, amount, date, note }) {
    if (!['income', 'given'].includes(kind)) throw new Error('סוג רשומה לא מוכר');
    const amountAg = toAg(amount);
    if (!amountAg) throw new Error('יש להזין סכום');
    parseDay(date);
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), kind, amountAg, date, note: String(note || '').trim().slice(0, 80) };
  }

  // הצמדה למדד: סכום × מדד חדש / מדד בסיס. floor — בלי ירידה מתחת לסכום המקורי
  function indexLinkage({ amount, baseIndex, currentIndex, floor = false }) {
    const a = toAg(amount), b = Number(baseIndex), c = Number(currentIndex);
    if (!a) throw new Error('יש להזין סכום');
    if (!(b > 0) || !(c > 0)) throw new Error('יש להזין מדד בסיס ומדד חדש');
    let linkedAg = Math.round(a * c / b);
    if (floor && linkedAg < a) linkedAg = a;
    return { amountAg: a, linkedAg, diffAg: linkedAg - a, changePct: Math.round((c / b - 1) * 10000) / 100 };
  }

  // גימטריה: ערכים רגילים; finals=true — סופיות 500–900 (מספר גדול). ניקוד וסימנים אחרים מדולגים
  const GEMATRIA = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400, 'ך': 20, 'ם': 40, 'ן': 50, 'ף': 80, 'ץ': 90 };
  const FINALS_BIG = { 'ך': 500, 'ם': 600, 'ן': 700, 'ף': 800, 'ץ': 900 };
  function gematria(text, { finals = false } = {}) {
    let total = 0, letters = 0;
    const words = [];
    for (const w of String(text || '').slice(0, 5000).split(/\s+/)) {
      let v = 0;
      for (const ch of w) {
        const n = finals && FINALS_BIG[ch] ? FINALS_BIG[ch] : GEMATRIA[ch];
        if (n) { v += n; letters++; }
      }
      if (v) { words.push({ word: w.replace(/[^א-ת]/g, ''), value: v }); total += v; }
    }
    return { total, letters, words };
  }

  // מספר ← אותיות (כמו בתאריך עברי): 15/16 = ט״ו / ט״ז, גרשיים לפני האות האחרונה
  function numberToHebrew(n) {
    let x = Number(n);
    if (!Number.isInteger(x) || x <= 0 || x >= 10000) throw new Error('מספר בין 1 ל-9999');
    let out = '';
    if (x >= 1000) { out += numberToHebrew(Math.floor(x / 1000)).replace(/[׳״]/g, '') + '׳'; x %= 1000; if (!x) return out; }
    const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'], tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'], hund = ['', 'ק', 'ר', 'ש', 'ת'];
    let s = '';
    let h = Math.floor(x / 100); x %= 100;
    while (h > 4) { s += 'ת'; h -= 4; }
    s += hund[h];
    if (x === 15) s += 'טו'; else if (x === 16) s += 'טז'; else s += tens[Math.floor(x / 10)] + ones[x % 10];
    s = s.length === 1 ? s + '׳' : s.slice(0, -1) + '״' + s.slice(-1);
    return out + s;
  }

  // דמי הבראה (מגזר פרטי): ימים לפי ותק, × שווי יום × היקף משרה. רק אחרי שנה מלאה. שווי היום — מהמשתמש
  const HAVRAA_DAYS = [[1, 5], [3, 6], [10, 7], [15, 8], [19, 9], [Infinity, 10]];
  function havraa({ years, dayRate = 418, jobPct = 100 }) {
    const y = Number(years), pct = Number(jobPct), rateAg = toAg(dayRate);
    if (!(y >= 0 && y <= 60)) throw new Error('ותק לא תקין');
    if (!(pct > 0 && pct <= 100)) throw new Error('היקף משרה בין 1% ל-100%');
    if (!rateAg) throw new Error('יש להזין שווי יום הבראה');
    if (y < 1) return { days: 0, amountAg: 0, eligible: false };
    const seniority = Math.ceil(y);
    const days = HAVRAA_DAYS.find(([max]) => seniority <= max)[1];
    return { days, amountAg: Math.round(days * rateAg * pct / 100), eligible: true };
  }

  // פיצויי פיטורים: שכר אחרון × שנות ותק — חודשים מלאים / 12, ועוד שארית הימים / 365
  function severance({ salary, from, to }) {
    const s = toAg(salary);
    if (!s) throw new Error('יש להזין שכר חודשי אחרון');
    const { days, months } = dateDiff(from, to);
    if (days <= 0) throw new Error('תאריך הסיום צריך להיות אחרי תאריך ההתחלה');
    const anchor = parseDay(from);
    anchor.setUTCMonth(anchor.getUTCMonth() + months);
    const rest = Math.max(0, Math.round((parseDay(to) - anchor) / 86400000));
    const years = months / 12 + rest / 365;
    return { days, years: Math.round(years * 100) / 100, amountAg: Math.round(s * years), eligible: days >= 365 };
  }

  const api = { groupShoppingList, shoppingListText, powerCost, dateDiff, addDays, compoundInterest,
    toAg, SALARY_TABLE_DEFAULT, parseSalaryTable, netSalary, hebrewYearOf, maaserSummary, newMaaserEntry,
    indexLinkage, gematria, numberToHebrew, havraa, severance };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ToolsCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
