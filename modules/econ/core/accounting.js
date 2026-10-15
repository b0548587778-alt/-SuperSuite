// Accounting Core - לוגיקה טהורה של הנהלת חשבונות בשיטת הכפולה (ללא גישה למסד הנתונים)
// כל הסכומים מחושבים באגורות (מספרים שלמים) כדי להימנע משגיאות עיגול של נקודה צפה.

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

// מבנה תוכנית חשבונות בסיסית לעסק קטן/בינוני בישראל. ניתנת להתאמה על ידי המשתמש.
const DEFAULT_CHART = [
  { code: '1000', name: 'קופה ובנק', type: 'asset' },
  { code: '1100', name: 'לקוחות', type: 'asset' },
  { code: '1200', name: 'מלאי', type: 'asset' },
  { code: '1300', name: 'מע"מ תשומות', type: 'asset' },
  { code: '1500', name: 'רכוש קבוע', type: 'asset' },
  { code: '1590', name: 'פחת מצטבר', type: 'asset' },
  { code: '2000', name: 'ספקים', type: 'liability' },
  { code: '2100', name: 'מע"מ עסקאות', type: 'liability' },
  { code: '2200', name: 'הלוואות', type: 'liability' },
  { code: '2300', name: 'שכר לשלם', type: 'liability' },
  { code: '2400', name: 'מוסדות (ניכויים)', type: 'liability' },
  { code: '3000', name: 'הון מניות / בעלים', type: 'equity' },
  { code: '3100', name: 'עודף/גירעון שנים קודמות', type: 'equity' },
  { code: '4000', name: 'הכנסות ממכירות', type: 'revenue' },
  { code: '4100', name: 'הכנסות משירותים', type: 'revenue' },
  { code: '4900', name: 'הכנסות שונות', type: 'revenue' },
  { code: '5000', name: 'עלות המכר', type: 'expense' },
  { code: '6000', name: 'שכר ונלוות', type: 'expense' },
  { code: '6100', name: 'שכירות', type: 'expense' },
  { code: '6200', name: 'חשמל, מים וארנונה', type: 'expense' },
  { code: '6300', name: 'שיווק ופרסום', type: 'expense' },
  { code: '6400', name: 'תוכנה ותקשורת', type: 'expense' },
  { code: '6500', name: 'ביטוח', type: 'expense' },
  { code: '6600', name: 'עמלות בנק וריבית', type: 'expense' },
  { code: '6700', name: 'נסיעות ורכב', type: 'expense' },
  { code: '6800', name: 'פחת', type: 'expense' },
  { code: '6900', name: 'הוצאות שונות', type: 'expense' }
];

// קודי חשבונות מערכתיים שהמנוע משתמש בהם לרישום אוטומטי
const SYS = {
  BANK: '1000',
  AR: '1100',
  INPUT_VAT: '1300',
  OUTPUT_VAT: '2100',
  AP: '2000',
  SALES: '4000',
  SERVICES: '4100'
};

const DEFAULT_VAT_RATE = 0.18; // שיעור מע"מ נוכחי; ניתן לשינוי בהגדרות — יש לאמת מול רשות המסים

const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);

function validateAccount(account, existing = []) {
  if (!account || typeof account !== 'object') throw new Error('חשבון לא תקין');
  if (!/^\d{4,6}$/.test(String(account.code || ''))) throw new Error('קוד חשבון חייב להיות 4-6 ספרות');
  if (!account.name || typeof account.name !== 'string') throw new Error('שם חשבון חובה');
  if (account.name.length > 120) throw new Error('שם החשבון ארוך מדי');
  if (!ACCOUNT_TYPES.includes(account.type)) throw new Error('סוג חשבון לא תקין');
  if (existing.some(a => a.code === String(account.code))) throw new Error('קוד החשבון כבר קיים');
  return { code: String(account.code), name: account.name.trim(), type: account.type };
}

// מאמת רשומת יומן: תאריך, שורות, חשבונות קיימים, ושוויון חובה=זכות
function validateEntry(entry, accounts) {
  if (!entry || typeof entry !== 'object') throw new Error('רשומה לא תקינה');
  if (!isDate(entry.date)) throw new Error('תאריך לא תקין (YYYY-MM-DD)');
  if (String(entry.description || '').length > 500) throw new Error('התיאור ארוך מדי');
  if (!Array.isArray(entry.lines) || entry.lines.length < 2) throw new Error('רשומה חייבת לכלול לפחות שתי שורות');
  if (entry.lines.length > 200) throw new Error('מספר השורות ברשומה חורג מהמותר');
  const codes = new Set(accounts.map(a => a.code));
  let debit = 0, credit = 0;
  const lines = entry.lines.map((l, i) => {
    if (!codes.has(String(l.account))) throw new Error(`שורה ${i + 1}: חשבון ${l.account} לא קיים`);
    const d = toAg(l.debit || 0), c = toAg(l.credit || 0);
    if (!Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0) throw new Error(`שורה ${i + 1}: סכום לא תקין`);
    if (d > 0 && c > 0) throw new Error(`שורה ${i + 1}: אי אפשר חובה וזכות באותה שורה`);
    if (d === 0 && c === 0) throw new Error(`שורה ${i + 1}: חייבת להיות חובה או זכות`);
    debit += d; credit += c;
    return { account: String(l.account), debit: fromAg(d), credit: fromAg(c), memo: String(l.memo || '') };
  });
  if (debit !== credit) throw new Error(`הרשומה לא מאוזנת: חובה ${fromAg(debit)} ≠ זכות ${fromAg(credit)}`);
  return { date: entry.date, description: String(entry.description || '').trim(), lines, total: fromAg(debit) };
}

// מחשב סכומי חשבונית: נטו, מע"מ וסה"כ (הכל באגורות)
function computeInvoice(invoice, vatRate = DEFAULT_VAT_RATE) {
  if (!Array.isArray(invoice.items) || invoice.items.length === 0) throw new Error('חשבונית חייבת לכלול פריט אחד לפחות');
  let net = 0;
  const items = invoice.items.map((it, i) => {
    const qty = Number(it.quantity ?? 1), price = Number(it.unitPrice);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`פריט ${i + 1}: כמות לא תקינה`);
    if (!Number.isFinite(price) || price < 0) throw new Error(`פריט ${i + 1}: מחיר לא תקין`);
    const lineNet = Math.round(qty * toAg(price));
    net += lineNet;
    return { description: String(it.description || '').trim() || 'שירות/מוצר', quantity: qty, unitPrice: price, lineNet: fromAg(lineNet), account: it.account ? String(it.account) : (it.kind === 'service' ? SYS.SERVICES : SYS.SALES) };
  });
  // מחיר כולל מע"מ (grossAgorot): המע"מ = הסכום הכולל פחות הנטו, כך שהסה"כ שווה בדיוק למה ששולם
  const vatAg = invoice.vatExempt ? 0 : Number.isSafeInteger(invoice.grossAgorot) ? invoice.grossAgorot - net : Math.round(net * vatRate);
  return { items, net: fromAg(net), vat: fromAg(vatAg), total: fromAg(net + vatAg), vatExempt: !!invoice.vatExempt };
}

// מייצר רשומת יומן לחשבונית מכירה: חובה לקוחות, זכות הכנסה לפי פריט, זכות מע"מ עסקאות
function invoiceToEntry(invoice, computed) {
  const lines = [{ account: SYS.AR, debit: computed.total, credit: 0, memo: `חשבונית ${invoice.number}` }];
  const byAccount = new Map();
  for (const it of computed.items) {
    byAccount.set(it.account, (byAccount.get(it.account) || 0) + toAg(it.lineNet));
  }
  for (const [account, ag] of byAccount) lines.push({ account, debit: 0, credit: fromAg(ag), memo: '' });
  if (computed.vat > 0) lines.push({ account: SYS.OUTPUT_VAT, debit: 0, credit: computed.vat, memo: 'מע"מ עסקאות' });
  return { date: invoice.date, description: `חשבונית מס ${invoice.number} — ${invoice.customer || ''}`.trim(), lines };
}

// מחיר כולל מע"מ (אגורות) ← נטו (ש"ח): עיגול של gross/(1+שיעור). המע"מ בחשבונית = gross − נטו (computeInvoice עם grossAgorot)
function netFromGross(grossAg, vatRate = DEFAULT_VAT_RATE) {
  if (!Number.isSafeInteger(grossAg) || grossAg < 0) throw new Error('סכום לא תקין');
  return fromAg(Math.round(grossAg / (1 + vatRate)));
}

// מספור רציף לחשבוניות: המספר הבא = מקסימום קיים + 1 (בלי פערים)
function nextInvoiceNumber(invoices) {
  const max = invoices.reduce((m, inv) => Math.max(m, Number(inv.number) || 0), 0);
  return max + 1;
}

// מאזן בוחן: לכל חשבון סך חובה, סך זכות ויתרה
function trialBalance(entries, accounts, { from, to } = {}) {
  const sums = new Map(accounts.map(a => [a.code, { debit: 0, credit: 0 }]));
  for (const e of entries) {
    if (!inRange(e.date, from, to)) continue;
    for (const l of e.lines) {
      const s = sums.get(String(l.account));
      if (!s) continue;
      s.debit += toAg(l.debit || 0); s.credit += toAg(l.credit || 0);
    }
  }
  const rows = accounts.map(a => {
    const s = sums.get(a.code);
    const net = s.debit - s.credit;
    return { code: a.code, name: a.name, type: a.type, debit: fromAg(s.debit), credit: fromAg(s.credit), balance: fromAg(net) };
  }).filter(r => r.debit !== 0 || r.credit !== 0);
  const totalDebit = rows.reduce((t, r) => t + toAg(r.debit), 0);
  const totalCredit = rows.reduce((t, r) => t + toAg(r.credit), 0);
  return { rows, totalDebit: fromAg(totalDebit), totalCredit: fromAg(totalCredit), balanced: totalDebit === totalCredit };
}

// רווח והפסד לתקופה
function incomeStatement(entries, accounts, { from, to } = {}) {
  const tb = trialBalance(entries, accounts, { from, to });
  const pick = type => tb.rows.filter(r => r.type === type).map(r => ({ code: r.code, name: r.name, amount: fromAg(-toAg(r.balance)) }));
  const revenue = pick('revenue');
  const expenses = tb.rows.filter(r => r.type === 'expense').map(r => ({ code: r.code, name: r.name, amount: r.balance }));
  const totalRevenue = revenue.reduce((t, r) => t + toAg(r.amount), 0);
  const totalExpenses = expenses.reduce((t, r) => t + toAg(r.amount), 0);
  return { revenue, expenses, totalRevenue: fromAg(totalRevenue), totalExpenses: fromAg(totalExpenses), netProfit: fromAg(totalRevenue - totalExpenses) };
}

// מאזן לתאריך מסוים. רווח השנה מתווסף להון כדי שהמאזן יאזן
function balanceSheet(entries, accounts, { asOf } = {}) {
  const tb = trialBalance(entries, accounts, { to: asOf });
  const group = type => tb.rows.filter(r => r.type === type).map(r => {
    const sign = type === 'asset' ? 1 : -1;
    return { code: r.code, name: r.name, amount: fromAg(sign * toAg(r.balance)) };
  });
  const assets = group('asset');
  const liabilities = group('liability');
  const equityAccounts = group('equity');
  const profit = incomeStatement(entries, accounts, { to: asOf }).netProfit;
  const sum = list => list.reduce((t, r) => t + toAg(r.amount), 0);
  const totalAssets = sum(assets);
  const totalLiab = sum(liabilities);
  const totalEquity = sum(equityAccounts) + toAg(profit);
  return {
    assets, liabilities, equity: [...equityAccounts, { code: '', name: 'רווח (הפסד) לתקופה', amount: profit }],
    totalAssets: fromAg(totalAssets), totalLiabilities: fromAg(totalLiab), totalEquity: fromAg(totalEquity),
    balanced: totalAssets === totalLiab + totalEquity
  };
}

// דוח מע"מ לתקופה: מע"מ עסקאות (לתשלום) מול מע"מ תשומות (זיכוי)
function vatReport(entries, { from, to } = {}) {
  let output = 0, input = 0;
  for (const e of entries) {
    if (!inRange(e.date, from, to)) continue;
    for (const l of e.lines) {
      if (String(l.account) === SYS.OUTPUT_VAT) output += toAg(l.credit || 0) - toAg(l.debit || 0);
      if (String(l.account) === SYS.INPUT_VAT) input += toAg(l.debit || 0) - toAg(l.credit || 0);
    }
  }
  return { outputVat: fromAg(output), inputVat: fromAg(input), netPayable: fromAg(output - input) };
}

module.exports = {
  ACCOUNT_TYPES, DEFAULT_CHART, DEFAULT_VAT_RATE, SYS,
  validateAccount, validateEntry, computeInvoice, invoiceToEntry, nextInvoiceNumber, netFromGross,
  trialBalance, incomeStatement, balanceSheet, vatReport, toAg, fromAg
};
