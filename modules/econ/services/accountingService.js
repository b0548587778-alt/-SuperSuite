// Accounting Service - הנהלת חשבונות בשיטת הכפולה: תוכנית חשבונות, יומן, חשבוניות, דוחות ומע"מ
const crypto = require('crypto');
const A = require('../core/accounting');
const PR = require('../core/pricing');
const F = require('../core/features');

const toAgSafe = (n) => Math.round(Number(n) * 100);
const fromAgSafe = (a) => Math.round(a) / 100;

class AccountingService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  // טוען את הנתונים; אם תוכנית החשבונות ריקה — זורע את ברירת המחדל פעם אחת
  async _load() {
    const data = await this.db.load();
    if (!Array.isArray(data.accounts) || data.accounts.length === 0) {
      data.accounts = A.DEFAULT_CHART.map(a => ({ ...a }));
      await this.db.save(data);
    }
    if (!Array.isArray(data.personal)) data.personal = [];
    return data;
  }

  // נעילת תקופה: אחרי תאריך הנעילה אי אפשר לרשום, לבטל או לגבות בתאריך כזה
  _assertOpen(data, date) {
    const lock = data.settings && data.settings.lockDate;
    if (lock && date && date <= lock) throw new Error(`התקופה נעולה עד ${lock} — לא ניתן לרשום בתאריך ${date}`);
  }

  _vatRate(data) {
    const r = Number(data.settings && data.settings.vatRate);
    return Number.isFinite(r) && r >= 0 && r < 1 ? r : A.DEFAULT_VAT_RATE;
  }

  // ---------- תוכנית חשבונות ----------
  async getChart() {
    const data = await this._load();
    return [...data.accounts].sort((a, b) => a.code.localeCompare(b.code));
  }

  async addAccount(accountData) {
    const data = await this._load();
    const account = A.validateAccount(accountData, data.accounts);
    data.accounts.push(account);
    await this.db.save(data);
    return account;
  }

  // ---------- יומן ----------
  async getJournal({ from, to } = {}) {
    const data = await this._load();
    return data.journal
      .filter(e => (!from || e.date >= from) && (!to || e.date <= to))
      .sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));
  }

  async createEntry(entryData) {
    const data = await this._load();
    const validated = A.validateEntry(entryData, data.accounts);
    this._assertOpen(data, validated.date);
    const entry = { id: crypto.randomUUID(), ...validated, createdAt: new Date().toISOString() };
    data.journal.push(entry);
    await this.db.save(data);
    return entry;
  }

  // ביטול רשומה: לא מוחקים רשומה מאושרת (דרישת שמירה על רישום), אלא רושמים רשומה הפוכה
  async reverseEntry(entryId) {
    const data = await this._load();
    const reversal = this._reverseIn(data, entryId);
    await this.db.save(data);
    return reversal;
  }

  // מבצע היפוך בתוך נתונים שכבר נטענו (בלי שמירה), כדי שפעולות מורכבות יישמרו בשמירה אחת
  _reverseIn(data, entryId, { allowPaymentEntry = false, allowInvoiceEntry = false } = {}) {
    const original = data.journal.find(e => e.id === entryId);
    if (!original) throw new Error('רשומה לא נמצאה');
    if (original.reversedBy) throw new Error('הרשומה כבר בוטלה');
    if (original.reversalOf) throw new Error('לא ניתן לבטל רשומת ביטול');
    // רשומה של חשבונית או של גבייה מבוטלת דרך הפעולה של החשבונית, כדי שסטטוס החשבונית יישאר מסונכרן
    const invoice = data.invoices.find(i => i.entryId === original.id);
    if (invoice && !allowInvoiceEntry) throw new Error(`הרשומה שייכת לחשבונית ${invoice.number} — בטל את החשבונית במקום`);
    const paid = data.invoices.find(i => i.paymentEntryId === original.id);
    if (paid && !allowPaymentEntry) throw new Error(`הרשומה היא גביית חשבונית ${paid.number} — בטל את הגבייה במקום`);
    this._assertOpen(data, original.date);
    const today = new Date().toISOString().slice(0, 10);
    const reversal = {
      id: crypto.randomUUID(),
      date: today,
      description: `ביטול: ${original.description}`,
      lines: original.lines.map(l => ({ account: l.account, debit: l.credit, credit: l.debit, memo: l.memo })),
      total: original.total,
      reversalOf: original.id,
      createdAt: new Date().toISOString()
    };
    A.validateEntry(reversal, data.accounts);
    original.reversedBy = reversal.id;
    data.journal.push(reversal);
    return reversal;
  }

  // ---------- חשבוניות מס ----------
  async getInvoices() {
    const data = await this._load();
    return [...data.invoices].sort((a, b) => b.number - a.number);
  }

  async createInvoice(invoiceData) {
    const data = await this._load();
    const rate = this._vatRate(data);
    const number = A.nextInvoiceNumber(data.invoices);
    const date = invoiceData.date || new Date().toISOString().slice(0, 10);
    this._assertOpen(data, date);
    const inv = { number, date, customer: String(invoiceData.customer || '').trim(), items: invoiceData.items, vatExempt: !!invoiceData.vatExempt };
    if (!inv.customer) throw new Error('שם לקוח חובה בחשבונית');
    if (inv.customer.length > 200) throw new Error('שם הלקוח ארוך מדי');
    if (!Array.isArray(inv.items) || inv.items.length > 200) throw new Error('מספר הפריטים בחשבונית חורג מהמותר (עד 200)');
    const computed = A.computeInvoice(inv, rate);
    const entryDraft = A.validateEntry(A.invoiceToEntry({ ...inv, number }, computed), data.accounts);
    const entry = { id: crypto.randomUUID(), ...entryDraft, createdAt: new Date().toISOString() };
    data.journal.push(entry);
    const invoice = {
      id: crypto.randomUUID(), number, date, customer: inv.customer,
      items: computed.items, net: computed.net, vat: computed.vat, total: computed.total,
      vatExempt: computed.vatExempt, status: 'open', entryId: entry.id, createdAt: new Date().toISOString()
    };
    data.invoices.push(invoice);
    await this.db.save(data);
    return invoice;
  }

  // גביית חשבונית: חובה בנק, זכות לקוחות
  async recordPayment(invoiceId, { date } = {}) {
    const data = await this._load();
    const inv = data.invoices.find(i => i.id === invoiceId);
    if (!inv) throw new Error('חשבונית לא נמצאה');
    if (inv.status === 'cancelled') throw new Error('לא ניתן לגבות חשבונית שבוטלה');
    if (inv.status === 'paid') throw new Error('החשבונית כבר שולמה');
    const payDate = date || new Date().toISOString().slice(0, 10);
    this._assertOpen(data, payDate);
    const entry = A.validateEntry({
      date: payDate,
      description: `גביית חשבונית ${inv.number} — ${inv.customer}`,
      lines: [
        { account: A.SYS.BANK, debit: inv.total, memo: `חשבונית ${inv.number}` },
        { account: A.SYS.AR, credit: inv.total, memo: `חשבונית ${inv.number}` }
      ]
    }, data.accounts);
    const payment = { id: crypto.randomUUID(), ...entry, createdAt: new Date().toISOString() };
    data.journal.push(payment);
    inv.status = 'paid';
    inv.paidAt = payDate;
    inv.paymentEntryId = payment.id;
    await this.db.save(data);
    return inv;
  }

  // ביטול גבייה: רושמים היפוך של רשומת הגבייה והחשבונית חוזרת למצב פתוח
  async unrecordPayment(invoiceId) {
    const data = await this._load();
    const inv = data.invoices.find(i => i.id === invoiceId);
    if (!inv) throw new Error('חשבונית לא נמצאה');
    if (inv.status !== 'paid' || !inv.paymentEntryId) throw new Error('החשבונית אינה משולמת');
    const reversal = this._reverseIn(data, inv.paymentEntryId, { allowPaymentEntry: true });
    inv.status = 'open';
    delete inv.paidAt;
    delete inv.paymentEntryId;
    inv.paymentReversalId = reversal.id;
    await this.db.save(data);
    return inv;
  }

  // ---------- סיכום תקופתי וניתוח חשבוניות ----------
  async getPeriodSummary({ from, to } = {}) {
    const data = await this._load();
    return F.periodSummary(data.journal, data.accounts, { from, to });
  }

  async getInvoiceAnalytics() {
    const data = await this._load();
    return F.invoiceAnalytics(data.invoices);
  }

  // ---------- הוצאות אישיות/משפחתיות: נשמרות ברשימה נפרדת ולא נכנסות ליומן או לדוחות העסקיים ----------
  async getPersonal({ from, to } = {}) {
    const data = await this._load();
    return data.personal
      .filter(e => (!from || e.date >= from) && (!to || e.date <= to))
      .sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));
  }

  async addPersonal(input) {
    const data = await this._load();
    const entry = { id: crypto.randomUUID(), ...F.validatePersonalEntry(input, data.personal.length), createdAt: new Date().toISOString() };
    data.personal.push(entry);
    await this.db.save(data);
    return entry;
  }

  async deletePersonal(entryId) {
    const data = await this._load();
    if (!data.personal.some(e => e.id === entryId)) throw new Error('רשומה לא נמצאה');
    data.personal = data.personal.filter(e => e.id !== entryId);
    await this.db.save(data);
    return true;
  }

  async getPersonalSummary({ from, to } = {}) {
    const data = await this._load();
    return F.personalSummary(data.personal, { from, to });
  }

  // ייבוא מחירון מ-CSV: שורות תקינות נשמרות, שורות שגויות מדווחות ולא נשמרות
  async importProducts(csvText) {
    const data = await this._load();
    const { products, errors } = F.parseProductsCsv(csvText);
    const now = new Date().toISOString();
    const added = products.map(p => ({ id: crypto.randomUUID(), ...p, createdAt: now }));
    data.products = [...(data.products || []), ...added];
    if (added.length) await this.db.save(data);
    return { added: added.length, errors };
  }

  // ---------- דוחות ----------
  async getReports({ from, to } = {}) {
    const data = await this._load();
    const period = { from: from || undefined, to: to || undefined };
    const asOf = to || new Date().toISOString().slice(0, 10);
    return {
      period: { from: from || null, to: asOf },
      vatRate: this._vatRate(data),
      lockDate: (data.settings && data.settings.lockDate) || '',
      trialBalance: A.trialBalance(data.journal, data.accounts, period),
      incomeStatement: A.incomeStatement(data.journal, data.accounts, period),
      balanceSheet: A.balanceSheet(data.journal, data.accounts, { asOf }),
      vat: A.vatReport(data.journal, period),
      openInvoices: data.invoices.filter(i => i.status === 'open').reduce((t, i) => t + Math.round(i.total * 100), 0) / 100,
      aged: this._aged(data, asOf)
    };
  }

  // גיול חייבים: חשבוניות פתוחות לפי מספר ימים מתאריך החשבונית
  _aged(data, asOf) {
    const buckets = [
      { label: 'עד 30 יום', min: 0, max: 30, total: 0, count: 0 },
      { label: '31–60 יום', min: 31, max: 60, total: 0, count: 0 },
      { label: '61–90 יום', min: 61, max: 90, total: 0, count: 0 },
      { label: 'מעל 90 יום', min: 91, max: Infinity, total: 0, count: 0 }
    ];
    const ref = Date.parse(asOf + 'T00:00:00Z');
    const items = [];
    for (const inv of data.invoices.filter(i => i.status === 'open')) {
      const days = Math.max(0, Math.floor((ref - Date.parse(inv.date + 'T00:00:00Z')) / 86400000));
      const b = buckets.find(x => days >= x.min && days <= x.max) || buckets[buckets.length - 1];
      b.total = fromAgSafe(toAgSafe(b.total) + toAgSafe(inv.total));
      b.count += 1;
      items.push({ number: inv.number, customer: inv.customer, date: inv.date, total: inv.total, days });
    }
    items.sort((a, b) => b.days - a.days);
    return { buckets, items };
  }

  // ביטול חשבונית: רושמים חשבונית זיכוי (היפוך של הרשומה המקורית), החשבונית נשארת ברשימה כמבוטלת
  async cancelInvoice(invoiceId) {
    const data = await this._load();
    const inv = data.invoices.find(i => i.id === invoiceId);
    if (!inv) throw new Error('חשבונית לא נמצאה');
    if (inv.status === 'cancelled') throw new Error('החשבונית כבר בוטלה');
    if (inv.status === 'paid') throw new Error('לא ניתן לבטל חשבונית ששולמה — יש לבטל קודם את הגבייה');
    // שמירה אחת: או שהכול נשמר (היפוך + סטטוס) או כלום
    const reversal = this._reverseIn(data, inv.entryId, { allowInvoiceEntry: true });
    inv.status = 'cancelled';
    inv.cancelledAt = new Date().toISOString().slice(0, 10);
    inv.reversalEntryId = reversal.id;
    await this.db.save(data);
    return inv;
  }

  async getInvoice(invoiceId) {
    const data = await this._load();
    const inv = data.invoices.find(i => i.id === invoiceId);
    if (!inv) throw new Error('חשבונית לא נמצאה');
    return inv;
  }

  // נתוני ייצוא לאקסל: יומן או מאזן בוחן
  async getExportData(kind, { from, to } = {}) {
    const data = await this._load();
    const names = Object.fromEntries(data.accounts.map(a => [a.code, a.name]));
    if (kind === 'journal') {
      const headers = ['תאריך', 'תיאור', 'קוד חשבון', 'שם חשבון', 'חובה', 'זכות', 'מזהה רשומה', 'סטטוס'];
      const rows = [];
      const entries = data.journal.filter(e => (!from || e.date >= from) && (!to || e.date <= to))
        .sort((a, b) => a.date.localeCompare(b.date));
      for (const e of entries) {
        const status = e.reversedBy ? 'בוטלה' : (e.reversalOf ? 'ביטול' : 'פעילה');
        for (const l of e.lines) rows.push([e.date, e.description, l.account, names[l.account] || '', l.debit || '', l.credit || '', e.id, status]);
      }
      return { headers, rows, name: `יומן-${from || 'הכל'}-${to || 'היום'}` };
    }
    if (kind === 'trialBalance') {
      const tb = A.trialBalance(data.journal, data.accounts, { from: from || undefined, to: to || undefined });
      const headers = ['קוד', 'שם', 'סוג', 'חובה', 'זכות', 'יתרה'];
      const rows = tb.rows.map(r => [r.code, r.name, A.ACCOUNT_TYPES.includes(r.type) ? r.type : '', r.debit, r.credit, r.balance]);
      return { headers, rows, name: `מאזן-בוחן-${to || 'היום'}` };
    }
    if (kind === 'summary') {
      const s = F.periodSummary(data.journal, data.accounts, { from: from || undefined, to: to || undefined });
      const headers = ['תקופה מ', 'תקופה עד', 'הכנסות', 'הוצאות', 'מע"מ עסקאות', 'מע"מ תשומות', 'מע"מ לתשלום', 'רווח (הפסד)'];
      const rows = [[from || '', to || '', s.income, s.expenses, s.outputVat, s.inputVat, s.vatPayable, s.profit]];
      return { headers, rows, name: `סיכום-תקופתי-${to || 'היום'}` };
    }
    if (kind === 'personal') {
      const list = await this.getPersonal({ from, to });
      const headers = ['תאריך', 'סוג', 'קטגוריה', 'סכום', 'הערה'];
      const rows = list.slice().reverse().map(e => [e.date, e.kind === 'income' ? 'הכנסה' : 'הוצאה', e.category, e.amount, e.note]);
      return { headers, rows, name: `הוצאות-אישיות-${to || 'היום'}` };
    }
    throw new Error('סוג ייצוא לא נתמך');
  }

  // ---------- מחירון ----------
  async getProducts() {
    const data = await this._load();
    const rate = this._vatRate(data);
    return (data.products || []).map(p => ({ ...p, pricing: PR.calcPrice({ cost: p.cost, markupPct: p.markupPct, vatRate: rate, vatExempt: p.vatExempt }) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async addProduct(input) {
    const data = await this._load();
    const p = { id: crypto.randomUUID(), ...PR.validateProduct(input), createdAt: new Date().toISOString() };
    data.products = [...(data.products || []), p];
    await this.db.save(data);
    return p;
  }

  async deleteProduct(productId) {
    const data = await this._load();
    if (!(data.products || []).some(p => p.id === productId)) throw new Error('מוצר לא נמצא');
    data.products = data.products.filter(p => p.id !== productId);
    await this.db.save(data);
    return true;
  }

  // מחשבון חי: מחזיר מחיר לפי הקלט ושיעור המע"מ הפעיל
  async calcPrice(input = {}) {
    const data = await this._load();
    return PR.calcPrice({ cost: input.cost, markupPct: input.markupPct, vatRate: this._vatRate(data), vatExempt: !!input.vatExempt });
  }

  async getSettings() {
    const data = await this._load();
    return {
      vatRate: this._vatRate(data),
      lockDate: (data.settings && data.settings.lockDate) || '',
      business: { name: '', taxId: '', address: '', phone: '', email: '', ...((data.settings && data.settings.business) || {}) }
    };
  }

  async saveSettings(input = {}) {
    const data = await this._load();
    const rate = input.vatRate === undefined ? this._vatRate(data) : Number(input.vatRate);
    if (!Number.isFinite(rate) || rate < 0 || rate >= 1) throw new Error('שיעור מע"מ לא תקין');
    const lockDate = String(input.lockDate || '').trim();
    if (lockDate && !/^\d{4}-\d{2}-\d{2}$/.test(lockDate)) throw new Error('תאריך נעילה לא תקין');
    const b = input.business || {};
    const business = {
      name: String(b.name || '').trim(), taxId: String(b.taxId || '').trim(),
      address: String(b.address || '').trim(), phone: String(b.phone || '').trim(), email: String(b.email || '').trim()
    };
    if (!business.name) throw new Error('שם העסק חובה');
    data.settings = { ...(data.settings || {}), vatRate: rate, lockDate, business };
    await this.db.save(data);
    return this.getSettings();
  }

  async setVatRate(rate) {
    const r = Number(rate);
    if (!Number.isFinite(r) || r < 0 || r >= 1) throw new Error('שיעור מע"מ לא תקין');
    const data = await this._load();
    data.settings = { ...(data.settings || {}), vatRate: r };
    await this.db.save(data);
    return r;
  }
}

module.exports = { AccountingService: new AccountingService() };
