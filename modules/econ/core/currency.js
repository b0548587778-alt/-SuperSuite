// מטבע זר בתרומות ובגמ"ח: הסכום במטבע והשער (שקלים ל-1 יחידה) מוקלדים, והרשומה נשמרת בשקלים —
// כל הסיכומים, הקבלות והדיווחים נשארים בשקלים. נשמר לתיעוד: currency, amountMinor (סנטים, שלם)
// ו-rateE4 (השער כפול 10,000, שלם). ההמרה: amountMinor × rateE4 / 10,000 = אגורות, בעיגול אחד.
// פונקציות טהורות, בלי רשת: אין שערים מובנים — המשתמש מקליד את השער מהבנק.

const CURRENCIES = { ILS: { sym: '₪', he: 'שקל' }, USD: { sym: '$', he: 'דולר' }, EUR: { sym: '€', he: 'אירו' }, GBP: { sym: '£', he: 'לירה שטרלינג' } };
const MAX_RATE = 100;
const MAX_FOREIGN = 1e8;

const toMinor = (n) => Math.round(Number(n) * 100);

// קלט מהממשק: { currency, foreignAmount, rate }. שקל (או בלי מטבע) ← null, והסכום נלקח מ-amount כרגיל
function parseForeign(input) {
  const currency = input && CURRENCIES[input.currency] ? input.currency : 'ILS';
  if (currency === 'ILS') return null;
  const label = CURRENCIES[currency].he;
  const foreignAmount = Number(input.foreignAmount);
  if (!Number.isFinite(foreignAmount) || foreignAmount <= 0 || foreignAmount > MAX_FOREIGN) throw new Error(`הסכום ב${label} אינו תקין`);
  const rate = Number(input.rate);
  const rateE4 = Math.round(rate * 10000);
  if (!Number.isFinite(rate) || rateE4 <= 0 || rate > MAX_RATE) throw new Error(`יש להזין שער ${label} תקין (כמה שקלים ל-1 ${label})`);
  const amountMinor = toMinor(foreignAmount);
  return { currency, amountMinor, rateE4, ilsAg: Math.round(amountMinor * rateE4 / 10000) };
}

// מה שנשמר ברשומה (בלי ilsAg — הסכום בשקלים נשמר בשדה הרגיל של הרשומה)
const stored = (f) => (f ? { currency: f.currency, amountMinor: f.amountMinor, rateE4: f.rateE4 } : null);

// "1,000.00 $ (שער 3.7)" — לקבלה, לייצוא ולמסך. רשומה בלי מטבע זר ← ''
function foreignLabel(f) {
  if (!f || !CURRENCIES[f.currency] || f.currency === 'ILS') return '';
  const amount = (Number(f.amountMinor) / 100).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${amount} ${CURRENCIES[f.currency].sym} (שער ${Number(f.rateE4) / 10000})`;
}

module.exports = { CURRENCIES, MAX_RATE, MAX_FOREIGN, parseForeign, stored, foreignLabel };
