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

  const api = { groupShoppingList, shoppingListText, powerCost, dateDiff, addDays, compoundInterest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ToolsCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
