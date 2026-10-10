// Pricing - חישוב מחיר מכירה לפי עלות ואחוז רווח. כל החישובים באגורות כדי למנוע שגיאות עיגול.
const { toAg, fromAg } = require('./accounting');

function calcPrice({ cost, markupPct, vatRate, vatExempt = false }) {
  const c = Number(cost);
  const m = Number(markupPct);
  const r = Number(vatRate);
  if (!Number.isFinite(c) || c < 0) throw new Error('עלות לא תקינה');
  if (!Number.isFinite(m) || m < 0 || m >= 10000) throw new Error('אחוז רווח לא תקין');
  if (!Number.isFinite(r) || r < 0 || r >= 1) throw new Error('שיעור מע"מ לא תקין');
  const costAg = toAg(c);
  const priceExAg = Math.round(costAg * (1 + m / 100));
  const vatAg = vatExempt ? 0 : Math.round(priceExAg * r);
  return {
    cost: fromAg(costAg),
    priceEx: fromAg(priceExAg),
    vat: fromAg(vatAg),
    priceInc: fromAg(priceExAg + vatAg),
    profit: fromAg(priceExAg - costAg),
    // רווח כאחוז ממחיר המכירה (לא מהעלות), כפי שנהוג בדוחות
    marginPct: priceExAg === 0 ? 0 : Math.round(((priceExAg - costAg) / priceExAg) * 10000) / 100,
    vatExempt: !!vatExempt
  };
}

function validateProduct(p) {
  if (!p || typeof p !== 'object') throw new Error('מוצר לא תקין');
  const name = String(p.name || '').trim();
  if (!name) throw new Error('שם מוצר/שירות חובה');
  if (name.length > 200) throw new Error('שם המוצר ארוך מדי');
  if (!['goods', 'service'].includes(p.kind || 'goods')) throw new Error('סוג לא תקין');
  const cost = Number(p.cost ?? 0), markup = Number(p.markupPct ?? 0);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('עלות לא תקינה');
  if (!Number.isFinite(markup) || markup < 0 || markup >= 10000) throw new Error('אחוז רווח לא תקין');
  return { name, kind: p.kind || 'goods', cost, markupPct: markup, vatExempt: !!p.vatExempt };
}

module.exports = { calcPrice, validateProduct };
