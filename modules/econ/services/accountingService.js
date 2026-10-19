// Accounting Service - הנהלת חשבונות בשיטת הכפולה: תוכנית חשבונות, יומן, חשבוניות, דוחות ומע"מ
const crypto = require('crypto');
const A = require('../core/accounting');
const PR = require('../core/pricing');
const F = require('../core/features');
const AL = require('../core/allocation');
const SD = require('../core/salesDocs');
const UF = require('../core/uniformFile');
const PCN = require('../core/pcn874');
const RC = require('../core/recurring');
const BR = require('../core/bankReconcile');
const BZ = require('../core/bizReports');
const { assertIsraeliId } = require('../core/israeliId');

const toAgSafe = (n) => Math.round(Number(n) * 100);
// היום לפי השעון המקומי — לא toISOString (UTC), שמזיז את התאריך בין חצות ל-03:00
const localDay = (ms = Date.now()) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
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
    if (!Array.isArray(data.salesDocs)) data.salesDocs = [];
    if (!Array.isArray(data.recurringInvoices)) data.recurringInvoices = [];
    if (!Array.isArray(data.bankLines)) data.bankLines = [];
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
    // פרטי חשבונית הספק לדוח המע"מ המפורט (PCN874): רק ברשומה שיש בה מע"מ תשומות
    const vatDoc = PCN.validateVatDoc(entryData && entryData.vatDoc);
    const entry = { id: crypto.randomUUID(), ...validated, ...(vatDoc && validated.lines.some(l => l.account === A.SYS.INPUT_VAT) ? { vatDoc } : {}), createdAt: new Date().toISOString() };
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
    const doc = (data.salesDocs || []).find(d => d.entryId === original.id && d.kind === 'credit');
    if (doc) throw new Error(`הרשומה שייכת לחשבונית זיכוי ${doc.number} — לא ניתן לבטל אותה ידנית`);
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
    // allocation: מצב מספר ההקצאה לתצוגה — מחושב ולא נשמר (הסף תלוי בתאריך)
    return [...data.invoices].sort((a, b) => b.number - a.number).map(i => this._invoiceView(data, i));
  }

  _invoiceView(data, i) {
    const credited = SD.creditedAg(data.salesDocs, i.id);
    const receipt = data.salesDocs.find(d => d.kind === 'receipt' && d.invoiceId === i.id && d.status !== 'cancelled');
    return { ...i, allocation: AL.allocationState(i), credited: A.fromAg(credited), balance: A.fromAg(A.toAg(i.total) - credited),
      ...(receipt ? { receiptNumber: receipt.number, receiptId: receipt.id } : {}) };
  }

  // paidNow: { method, reference } — חשבונית מס/קבלה: החשבונית והגבייה בשמירה אחת, בלי קבלה נפרדת
  async createInvoice(invoiceData) {
    const data = await this._load();
    const invoice = this._createInvoiceIn(data, invoiceData);
    if (invoiceData && invoiceData.paidNow) {
      this._payIn(data, invoice, { date: invoice.date, ...SD.validatePayment(invoiceData.paidNow), issueReceipt: false });
      invoice.kind = 'tax-invoice-receipt';
    }
    await this.db.save(data);
    return invoice;
  }

  _createInvoiceIn(data, invoiceData) {
    const rate = this._vatRate(data);
    data.settings = data.settings || {};
    const number = A.nextInvoiceNumber(data.invoices, data.settings.invoiceSeq);
    const date = invoiceData.date || new Date().toISOString().slice(0, 10);
    this._assertOpen(data, date);
    const inv = { number, date, customer: String(invoiceData.customer || '').trim(), items: invoiceData.items, vatExempt: !!invoiceData.vatExempt };
    // מחיר כולל מע"מ — רק לשורה אחת (מנוי), כדי שהמע"מ יחושב כהפרש
    if (Number.isSafeInteger(invoiceData.grossAgorot) && Array.isArray(inv.items) && inv.items.length === 1) inv.grossAgorot = invoiceData.grossAgorot;
    if (!inv.customer) throw new Error('שם לקוח חובה בחשבונית');
    if (inv.customer.length > 200) throw new Error('שם הלקוח ארוך מדי');
    if (!Array.isArray(inv.items) || inv.items.length > 200) throw new Error('מספר הפריטים בחשבונית חורג מהמותר (עד 200)');
    // מספר העוסק של הלקוח — נדרש בבקשה למספר הקצאה
    const customerTaxId = String(invoiceData.customerTaxId || '').trim();
    assertIsraeliId(customerTaxId, 'מספר העוסק של הלקוח');
    const computed = A.computeInvoice(inv, rate);
    const entryDraft = A.validateEntry(A.invoiceToEntry({ ...inv, number }, computed), data.accounts);
    const entry = { id: crypto.randomUUID(), ...entryDraft, createdAt: new Date().toISOString() };
    data.journal.push(entry);
    const invoice = {
      id: crypto.randomUUID(), number, date, customer: inv.customer,
      items: computed.items, net: computed.net, vat: computed.vat, total: computed.total,
      vatExempt: computed.vatExempt, status: 'open', entryId: entry.id, createdAt: new Date().toISOString()
    };
    if (customerTaxId) invoice.customerTaxId = customerTaxId;
    if (invoiceData.sourceDoc) invoice.sourceDoc = invoiceData.sourceDoc;
    if (invoiceData.recurring) invoice.recurring = invoiceData.recurring;
    data.invoices.push(invoice);
    data.settings.invoiceSeq = number;
    return invoice;
  }

  // חשבונית מס/קבלה למנוי ששולם: הסכום כולל מע"מ ונקבע מראש (אגורות). יוצרת חשבונית ומסמנת אותה כשולמה —
  // שתי רשומות יומן (מכירה וגבייה) בשמירה אחת. ref = אסמכתת התשלום מחברת הסליקה
  async createPaidInvoice({ customer, customerTaxId, description, grossAgorot, date, ref }) {
    if (!Number.isSafeInteger(grossAgorot) || grossAgorot <= 0) throw new Error('סכום החשבונית אינו תקין');
    const data = await this._load();
    const rate = this._vatRate(data);
    const unitPrice = A.netFromGross(grossAgorot, rate);
    const stored = this._createInvoiceIn(data, { customer, date, grossAgorot, items: [{ description, quantity: 1, unitPrice, kind: 'service' }] });
    if (Math.round(stored.total * 100) !== grossAgorot) throw new Error('סכום החשבונית אינו תואם לסכום ששולם');
    this._payIn(data, stored, { date: stored.date, method: 'card', issueReceipt: false });
    stored.kind = 'tax-invoice-receipt';
    if (customerTaxId) stored.customerTaxId = String(customerTaxId).slice(0, 12);
    if (ref) stored.paymentRef = String(ref).slice(0, 80);
    await this.db.save(data);
    return stored;
  }

  // תשלום מנוי ממודול האימונים (core/trainerPayments.js → invoiceInput) ← חשבונית מס/קבלה, פעם אחת לכל תשלום.
  // הבדיקה שאין כבר חשבונית לאותו תשלום — באותה טעינה של המסד שבה נשמרת החדשה
  async createTrainerReceipt({ customer, date, grossAgorot, description, method, reference, trainerPayment }) {
    if (!Number.isSafeInteger(grossAgorot) || grossAgorot <= 0) throw new Error('סכום החשבונית אינו תקין');
    const key = trainerPayment && String(trainerPayment.key || '');
    if (!key) throw new Error('חסר שיוך לתשלום במודול האימונים');
    const data = await this._load();
    const prev = data.invoices.find(i => i.trainerPayment && i.trainerPayment.key === key && i.status !== 'cancelled');
    if (prev) throw new Error(`כבר הופקה חשבונית לתשלום הזה (מספר ${prev.number})`);
    const rate = this._vatRate(data);
    const unitPrice = A.netFromGross(grossAgorot, rate);
    const stored = this._createInvoiceIn(data, { customer, date, grossAgorot, items: [{ description, quantity: 1, unitPrice, kind: 'service' }] });
    if (Math.round(stored.total * 100) !== grossAgorot) throw new Error('סכום החשבונית אינו תואם לסכום ששולם');
    this._payIn(data, stored, { date: stored.date, ...SD.validatePayment({ method, reference }), issueReceipt: false });
    stored.kind = 'tax-invoice-receipt';
    stored.trainerPayment = { key, clientId: String(trainerPayment.clientId || '').slice(0, 64),
      membershipId: String(trainerPayment.membershipId || '').slice(0, 64), paymentId: String(trainerPayment.paymentId || '').slice(0, 64) };
    await this.db.save(data);
    return stored;
  }

  // גביית חשבונית: חובה בנק, זכות לקוחות — על היתרה אחרי זיכויים. מופקת קבלה (סוג 400) עם מספר משלה
  async recordPayment(invoiceId, { date, method, reference } = {}) {
    const data = await this._load();
    const inv = data.invoices.find(i => i.id === invoiceId);
    if (!inv) throw new Error('חשבונית לא נמצאה');
    this._payIn(data, inv, { date: date || new Date().toISOString().slice(0, 10), ...SD.validatePayment({ method, reference }), issueReceipt: true });
    await this.db.save(data);
    return inv;
  }

  _payIn(data, inv, { date, method, reference, issueReceipt }) {
    if (inv.status === 'cancelled') throw new Error('לא ניתן לגבות חשבונית שבוטלה');
    if (inv.status === 'paid') throw new Error('החשבונית כבר שולמה');
    this._assertOpen(data, date);
    const amount = A.fromAg(A.toAg(inv.total) - SD.creditedAg(data.salesDocs, inv.id));
    if (!(amount > 0)) throw new Error('החשבונית זוכתה במלואה — אין יתרה לגבייה');
    const entry = A.validateEntry({
      date,
      description: `גביית חשבונית ${inv.number} — ${inv.customer}`,
      lines: [
        { account: A.SYS.BANK, debit: amount, memo: `חשבונית ${inv.number}` },
        { account: A.SYS.AR, credit: amount, memo: `חשבונית ${inv.number}` }
      ]
    }, data.accounts);
    const payment = { id: crypto.randomUUID(), ...entry, createdAt: new Date().toISOString() };
    data.journal.push(payment);
    inv.status = 'paid';
    inv.paidAt = date;
    inv.paymentEntryId = payment.id;
    inv.paymentMethod = method;
    if (reference) inv.paymentRef = reference;
    if (issueReceipt) {
      data.settings = data.settings || {};
      const seqs = data.settings.docSeq || {};
      const number = SD.nextNumber(data.salesDocs, 'receipt', seqs);
      data.salesDocs.push({ id: crypto.randomUUID(), kind: 'receipt', number, date, customer: inv.customer,
        ...(inv.customerTaxId ? { customerTaxId: inv.customerTaxId } : {}), invoiceId: inv.id, invoiceNumber: inv.number,
        total: amount, method, ...(reference ? { reference } : {}), status: 'open', entryId: payment.id, createdAt: new Date().toISOString() });
      data.settings.docSeq = { ...seqs, receipt: number };
    }
  }

  // ביטול גבייה: רושמים היפוך של רשומת הגבייה והחשבונית חוזרת למצב פתוח
  async unrecordPayment(invoiceId) {
    const data = await this._load();
    const inv = data.invoices.find(i => i.id === invoiceId);
    if (!inv) throw new Error('חשבונית לא נמצאה');
    if (inv.status !== 'paid' || !inv.paymentEntryId) throw new Error('החשבונית אינה משולמת');
    const reversal = this._reverseIn(data, inv.paymentEntryId, { allowPaymentEntry: true });
    inv.status = 'open';
    const receipt = data.salesDocs.find(d => d.kind === 'receipt' && d.entryId === inv.paymentEntryId && d.status !== 'cancelled');
    if (receipt) { receipt.status = 'cancelled'; receipt.cancelledAt = reversal.date; receipt.reversalEntryId = reversal.id; }
    delete inv.paidAt;
    delete inv.paymentEntryId;
    delete inv.paymentMethod;
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
    if (SD.creditedAg(data.salesDocs, inv.id)) throw new Error('לחשבונית יש חשבונית זיכוי — המשך הטיפול בחשבונית זיכוי נוספת');
    // שמירה אחת: או שהכול נשמר (היפוך + סטטוס) או כלום
    const reversal = this._reverseIn(data, inv.entryId, { allowInvoiceEntry: true });
    inv.status = 'cancelled';
    inv.cancelledAt = new Date().toISOString().slice(0, 10);
    inv.reversalEntryId = reversal.id;
    await this.db.save(data);
    return inv;
  }

  // לוגו למסמכים: PNG / JPEG עד 200KB, נשמר כ-data URL. בלי קובץ — הסרה
  async setLogo(bytes, ext) {
    const data = await this._load();
    data.settings = data.settings || {};
    const business = { ...((data.settings && data.settings.business) || {}) };
    if (!bytes) delete business.logo;
    else {
      const type = /^jpe?g$/i.test(ext) ? 'jpeg' : /^png$/i.test(ext) ? 'png' : '';
      if (!type) throw new Error('הלוגו חייב להיות קובץ PNG או JPEG');
      if (bytes.length > 200 * 1024) throw new Error('קובץ הלוגו גדול מדי (עד 200KB)');
      const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
      if (type === 'png' ? !png : !jpg) throw new Error('הקובץ אינו תמונה תקינה');
      business.logo = `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
    }
    data.settings.business = business;
    await this.db.save(data);
    return { logo: !!business.logo };
  }

  // ---------- חשבונית חוזרת (PLAN.md 9.6): תבניות, וטיוטות שמחושבות בכל קריאה — בלי הפקה אוטומטית ----------
  async getRecurring({ today } = {}) {
    const data = await this._load();
    const day = today || localDay();
    return { templates: data.recurringInvoices, drafts: RC.drafts(data.recurringInvoices, day, this._vatRate(data)) };
  }

  async saveRecurring(input = {}, templateId = null) {
    const data = await this._load();
    const t = RC.validateTemplate(input, this._vatRate(data));
    if (templateId) {
      const cur = data.recurringInvoices.find(x => x.id === templateId);
      if (!cur) throw new Error('התבנית לא נמצאה');
      // חודשים שכבר הופקו נשארים; אי אפשר להזיז את ההתחלה אחרי חודש שהופק
      const issuedMonths = Object.keys(cur.issued || {}).sort();
      if (issuedMonths.length && t.startMonth > issuedMonths[0]) throw new Error(`כבר הופקה חשבונית לחודש ${issuedMonths[0]} — חודש ההתחלה לא יכול להיות אחריו`);
      Object.assign(cur, t, { paused: !!input.paused, updatedAt: new Date().toISOString() });
      if (!input.endMonth) delete cur.endMonth;
      if (!t.customerTaxId) delete cur.customerTaxId;
      if (!t.notes) delete cur.notes;
      await this.db.save(data);
      return cur;
    }
    const stored = { id: crypto.randomUUID(), ...t, issued: {}, skipped: [], createdAt: new Date().toISOString() };
    data.recurringInvoices.push(stored);
    await this.db.save(data);
    return stored;
  }

  // תבנית שהופקו ממנה חשבוניות לא נמחקת — רק נעצרת (חודש סיום), כמו הוראת קבע
  async deleteRecurring(templateId) {
    const data = await this._load();
    const t = data.recurringInvoices.find(x => x.id === templateId);
    if (!t) throw new Error('התבנית לא נמצאה');
    if (Object.keys(t.issued || {}).length) throw new Error('הופקו כבר חשבוניות מהתבנית — אפשר לעצור אותה או לקבוע חודש סיום');
    data.recurringInvoices = data.recurringInvoices.filter(x => x.id !== templateId);
    await this.db.save(data);
    return true;
  }

  // אישור טיוטה = הפקת חשבונית רגילה, וסימון החודש — באותה שמירה
  async issueRecurring(templateId, month, { today } = {}) {
    const data = await this._load();
    const t = data.recurringInvoices.find(x => x.id === templateId);
    RC.assertPending(t, month, today || localDay());
    const invoice = this._createInvoiceIn(data, RC.invoiceInput(t, month));
    t.issued = { ...(t.issued || {}), [month]: invoice.id };
    await this.db.save(data);
    return invoice;
  }

  async skipRecurring(templateId, month, { today } = {}) {
    const data = await this._load();
    const t = data.recurringInvoices.find(x => x.id === templateId);
    RC.assertPending(t, month, today || localDay());
    t.skipped = [...(t.skipped || []), month];
    await this.db.save(data);
    return t;
  }

  // ---------- עבודה מהירה: השלמת לקוחות, שכפול, חיפוש ----------
  async getCustomerDirectory() {
    const data = await this._load();
    return RC.customerDirectory(data);
  }

  async searchDocuments(query) {
    const data = await this._load();
    return RC.searchDocuments(data, query);
  }

  // שכפול: הקלט של המסמך (לקוח ופריטים) לטופס חדש — המשתמש בוחר תאריך ושומר
  async getDuplicateInput(kind, id) {
    const data = await this._load();
    const src = kind === 'invoice' ? data.invoices.find(i => i.id === id) : data.salesDocs.find(d => d.id === id && SD.DRAFT_KINDS.includes(d.kind));
    if (!src) throw new Error('המסמך לא נמצא');
    return { kind: kind === 'invoice' ? 'invoice' : src.kind, customer: src.customer, customerTaxId: src.customerTaxId || '', vatExempt: !!src.vatExempt,
      items: src.items.map(it => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, account: it.account })) };
  }

  // ---------- מסמכי מכירה (PLAN.md 9.3): הצעת מחיר, הזמנה, תעודת משלוח, זיכוי, קבלה ----------
  async getSalesDocs() {
    const data = await this._load();
    return [...data.salesDocs].sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt))).map(SD.docView);
  }

  async getSalesDoc(docId) {
    const data = await this._load();
    const d = data.salesDocs.find(x => x.id === docId);
    if (!d) throw new Error('המסמך לא נמצא');
    return SD.docView(d);
  }

  _pushDoc(data, doc) {
    data.settings = data.settings || {};
    const seqs = data.settings.docSeq || {};
    const number = SD.nextNumber(data.salesDocs, doc.kind, seqs);
    const stored = { id: crypto.randomUUID(), ...doc, number, status: 'open', createdAt: new Date().toISOString() };
    data.salesDocs.push(stored);
    data.settings.docSeq = { ...seqs, [doc.kind]: number };
    return stored;
  }

  // הצעה / הזמנה / תעודת משלוח — לא נרשמות ביומן, ולכן מותרות גם בתקופה נעולה
  async createSalesDoc(kind, input) {
    const data = await this._load();
    const doc = this._pushDoc(data, SD.validateDraft(kind, input, this._vatRate(data)));
    await this.db.save(data);
    return SD.docView(doc);
  }

  // המרה בלחיצה: הפריטים עוברים כמו שהם. to = order / delivery / invoice
  async convertSalesDoc(docId, to, { date } = {}) {
    const data = await this._load();
    const src = data.salesDocs.find(d => d.id === docId);
    SD.assertConvertible(src, to);
    const day = date || new Date().toISOString().slice(0, 10);
    if (day < src.date) throw new Error('תאריך המסמך החדש לפני תאריך המקור');
    const input = SD.conversionInput(src, day);
    let target;
    if (to === 'invoice') {
      const inv = this._createInvoiceIn(data, { ...input, sourceDoc: { kind: src.kind, id: src.id, number: src.number } });
      target = { kind: 'invoice', id: inv.id, number: inv.number };
    } else {
      const doc = this._pushDoc(data, { ...SD.validateDraft(to, input, this._vatRate(data)), sourceDoc: { kind: src.kind, id: src.id, number: src.number } });
      target = { kind: to, id: doc.id, number: doc.number };
    }
    src.status = 'converted';
    src.convertedTo = target;
    src.convertedAt = day;
    await this.db.save(data);
    return target;
  }

  async cancelSalesDoc(docId) {
    const data = await this._load();
    const d = data.salesDocs.find(x => x.id === docId);
    if (!d) throw new Error('המסמך לא נמצא');
    if (!SD.DRAFT_KINDS.includes(d.kind)) throw new Error('קבלה וזיכוי מבוטלים דרך החשבונית');
    if (d.status !== 'open') throw new Error('המסמך כבר הומר או בוטל');
    d.status = 'cancelled';
    d.cancelledAt = new Date().toISOString().slice(0, 10);
    await this.db.save(data);
    return SD.docView(d);
  }

  // חשבונית זיכוי עצמאית: מלאה (בלי פריטים) או חלקית. חובה הכנסות ומע"מ, זכות לקוחות
  async createCreditNote(invoiceId, input = {}) {
    const data = await this._load();
    const inv = data.invoices.find(i => i.id === invoiceId);
    const credit = SD.validateCredit(inv, input, data.salesDocs);
    this._assertOpen(data, credit.date);
    data.settings = data.settings || {};
    const number = SD.nextNumber(data.salesDocs, 'credit', data.settings.docSeq || {});
    const entry = { id: crypto.randomUUID(), ...A.validateEntry(SD.creditToEntry(credit, number), data.accounts), createdAt: new Date().toISOString() };
    data.journal.push(entry);
    const doc = this._pushDoc(data, { ...credit, entryId: entry.id });
    await this.db.save(data);
    return SD.docView(doc);
  }

  // ---------- מספר הקצאה (חשבוניות ישראל, נתיב ידני — PLAN.md 9.2א) ----------
  // המספר מתקבל בשירות של רשות המסים ומוקלד כאן. לא נוגע ביומן, ולכן מותר גם בתקופה נעולה
  async setAllocation(invoiceId, { number } = {}) {
    const data = await this._load();
    const inv = data.invoices.find(i => i.id === invoiceId);
    if (!inv) throw new Error('חשבונית לא נמצאה');
    if (inv.status === 'cancelled') throw new Error('החשבונית בוטלה — אין צורך במספר הקצאה');
    const n = AL.normalizeAllocationNumber(number);
    const dup = data.invoices.find(i => i.id !== inv.id && i.allocationNumber === n);
    if (dup) throw new Error(`מספר ההקצאה כבר רשום בחשבונית ${dup.number}`);
    const previous = inv.allocationNumber || null;
    inv.allocationNumber = n;
    inv.allocationAt = new Date().toISOString();
    delete inv.allocationWaived;
    await this.db.save(data);
    return { invoice: inv, previous };
  }

  // סימון "לא נדרש": הלקוח אינו עוסק מורשה או לא דרש מספר
  async waiveAllocation(invoiceId, { reason = 'customer' } = {}) {
    const data = await this._load();
    const inv = data.invoices.find(i => i.id === invoiceId);
    if (!inv) throw new Error('חשבונית לא נמצאה');
    if (!AL.WAIVE_REASONS[reason]) throw new Error('סיבה לא מוכרת');
    if (inv.allocationNumber) throw new Error('לחשבונית כבר יש מספר הקצאה');
    if (AL.allocationState(inv) !== 'pending') throw new Error('החשבונית אינה דורשת מספר הקצאה');
    inv.allocationWaived = { reason, at: new Date().toISOString() };
    await this.db.save(data);
    return inv;
  }

  async getInvoice(invoiceId) {
    const data = await this._load();
    const inv = data.invoices.find(i => i.id === invoiceId);
    if (!inv) throw new Error('חשבונית לא נמצאה');
    return this._invoiceView(data, inv);
  }

  // קבצים במבנה אחיד (PLAN.md 9.1): INI.TXT, BKMVDATA.zip ונתוני דוח ההפקה. קריאה בלבד
  async getUniformFile({ from, to } = {}, { user = '', now = Date.now(), version = '' } = {}) {
    const data = await this._load();
    const business = { name: '', taxId: '', address: '', ...((data.settings && data.settings.business) || {}) };
    const software = { ...UF.SOFTWARE, version };
    return UF.buildUniformFile({ data, business, range: { from, to }, now, user, software });
  }

  // דוח מע"מ מפורט (PCN874, PLAN.md 9.16) לחודש או לחודשיים. קריאה בלבד
  async getPcn874({ month, months = 1 } = {}, { now = Date.now() } = {}) {
    const data = await this._load();
    const business = (data.settings && data.settings.business) || {};
    return PCN.buildPcn874({ data, business, month, months: Number(months) || 1, now });
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
    // מיתוג המסמכים (PLAN.md 9.3): צבע, חתימה, ולוגו — נשמר רק דרך setLogo (קובץ שנבחר), לא מהטופס
    const prev = (data.settings && data.settings.business) || {};
    const color = String(b.brandColor || '').trim();
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('צבע המסמכים אינו תקין (למשל #1d4ed8)');
    if (color) business.brandColor = color;
    const signature = String(b.signature || '').trim().slice(0, 120);
    if (signature) business.signature = signature;
    if (prev.logo) business.logo = prev.logo;
    // invoiceSeq נשמר כמו שהוא (...data.settings) — שמירת הגדרות לא מאפסת את המונה
    data.settings = { ...(data.settings || {}), vatRate: rate, lockDate, business };
    await this.db.save(data);
    return this.getSettings();
  }

  // ---------- דוחות לעסק (PLAN.md 9.5): כרטסת לקוח, תזרים צפוי, מקדמות ולוח בקרה — קריאה בלבד ----------
  _reportSettings(data) { return BZ.normalizeSettings(data.settings && data.settings.reports); }

  async getBizSettings() {
    const data = await this._load();
    return this._reportSettings(data);
  }

  // תנאי תשלום, תקופת דיווח ושיעור מקדמה — לא נוגע ביומן, ולכן מותר גם בתקופה נעולה
  async saveBizSettings(input) {
    const data = await this._load();
    const reports = BZ.validateSettings(input);
    data.settings = { ...(data.settings || {}), reports };
    await this.db.save(data);
    return reports;
  }

  async getCustomerBalances({ today } = {}) {
    const data = await this._load();
    return BZ.customerBalances(data, today || localDay());
  }

  async getCustomerLedger(customer, { from, to } = {}) {
    const data = await this._load();
    return BZ.customerLedger(data, customer, { from: from || undefined, to: to || undefined });
  }

  async getCashForecast({ today, months, includeExpenses } = {}) {
    const data = await this._load();
    return BZ.cashForecast(data, { today: today || localDay(), months, includeExpenses: includeExpenses !== false,
      settings: this._reportSettings(data), vatRate: this._vatRate(data) });
  }

  async getAdvancesReport({ year, today } = {}) {
    const data = await this._load();
    const day = today || localDay();
    return BZ.advancesReport(data, { year: year || Number(day.slice(0, 4)), today: day, settings: this._reportSettings(data) });
  }

  async getBizDashboard({ today } = {}) {
    const data = await this._load();
    return BZ.dashboardSummary(data, { today: today || localDay(), settings: this._reportSettings(data), vatRate: this._vatRate(data) });
  }

  // ---------- התאמת בנק (PLAN.md 9.4): קליטת דף בנק מקובץ והתאמה לחשבוניות ולרשומות ----------
  async getBankLines() {
    const data = await this._load();
    return BR.view(data, data.invoices.map(i => this._invoiceView(data, i)));
  }

  async previewBankFile(csvText) {
    const data = await this._load();
    return BR.preview(String(csvText || ''), data.settings);
  }

  // קליטה: תנועה שכבר נקלטה (אותו תאריך, סכום, אסמכתא ותיאור) מדולגת. התאמת העמודות נשמרת לפעם הבאה
  async importBankFile(csvText, mapping = {}) {
    const data = await this._load();
    const r = BR.buildLines(String(csvText || ''), mapping, data.bankLines);
    const importedAt = new Date().toISOString();
    const batch = crypto.randomUUID();
    for (const l of r.lines) data.bankLines.push({ id: crypto.randomUUID(), ...l, batch, importedAt });
    data.settings = { ...(data.settings || {}), bankMapping: Object.fromEntries(Object.entries(mapping).filter(([f, h]) => BR.FIELDS[f] && h)) };
    await this.db.save(data);
    return { added: r.lines.length, skipped: r.skipped, errors: r.errors };
  }

  _openBankLine(data, lineId) {
    const line = data.bankLines.find(l => l.id === lineId);
    if (!line) throw new Error('התנועה לא נמצאה');
    const byId = new Map(data.journal.map(e => [e.id, e]));
    if (BR.lineStatus(line, byId) !== 'open') throw new Error('התנועה כבר הותאמה — יש לבטל את ההתאמה קודם');
    return line;
  }

  /* התאמת תנועה. target: { type: 'invoice', id } — גביית החשבונית בתאריך התנועה (קבלה, העברה בנקאית) בשמירה אחת;
     { type: 'entry', id } — רשומה קיימת שכבר רשמה את התנועה בבנק; { type: 'ignored', note } — לא לרישום */
  async matchBankLine(lineId, target = {}) {
    const data = await this._load();
    const line = this._openBankLine(data, lineId);
    const at = new Date().toISOString();
    if (target.type === 'invoice') {
      const inv = data.invoices.find(i => i.id === target.id);
      if (!inv) throw new Error('חשבונית לא נמצאה');
      if (!(line.amountAg > 0)) throw new Error('רק תנועת זכות (כסף שנכנס) יכולה לגבות חשבונית');
      const balanceAg = A.toAg(inv.total) - SD.creditedAg(data.salesDocs, inv.id);
      if (inv.status === 'open' && balanceAg !== line.amountAg) throw new Error(`סכום התנועה (${A.fromAg(line.amountAg)}) שונה מיתרת החשבונית (${A.fromAg(balanceAg)}) — גבייה חלקית אינה נתמכת`);
      this._payIn(data, inv, { date: line.date, ...SD.validatePayment({ method: 'transfer', reference: line.reference }), issueReceipt: true });
      line.match = { type: 'invoice', entryId: inv.paymentEntryId, invoiceId: inv.id, at };
    } else if (target.type === 'entry') {
      const e = data.journal.find(x => x.id === target.id);
      if (!e || e.reversedBy || e.reversalOf) throw new Error('הרשומה לא נמצאה או שבוטלה');
      if (BR.bankNetAg(e) !== line.amountAg) throw new Error('סכום הרשומה בחשבון הבנק שונה מסכום התנועה');
      const byId = new Map(data.journal.map(x => [x.id, x]));
      if (data.bankLines.some(l => l.id !== line.id && l.match && l.match.entryId === e.id && BR.lineStatus(l, byId) === 'matched')) throw new Error('הרשומה כבר הותאמה לתנועה אחרת');
      line.match = { type: 'entry', entryId: e.id, at };
    } else if (target.type === 'ignored') {
      line.match = { type: 'ignored', note: String(target.note || '').trim().slice(0, 200), at };
    } else throw new Error('סוג התאמה לא מוכר');
    await this.db.save(data);
    return line;
  }

  // רשומה חדשה מתנועה (עמלת בנק, הוראת קבע וכו'): בנק מול החשבון שנבחר, בתאריך התנועה ובסכומה
  async createEntryFromBankLine(lineId, { account, description } = {}) {
    const data = await this._load();
    const line = this._openBankLine(data, lineId);
    const acc = data.accounts.find(a => a.code === String(account || ''));
    if (!acc) throw new Error('יש לבחור חשבון מתוכנית החשבונות');
    if (acc.code === BR.BANK) throw new Error('יש לבחור חשבון שאינו חשבון הבנק');
    this._assertOpen(data, line.date);
    const amount = A.fromAg(Math.abs(line.amountAg));
    const memo = line.reference ? `אסמכתא ${line.reference}` : '';
    const validated = A.validateEntry({
      date: line.date,
      description: String(description || line.description || 'תנועת בנק').trim().slice(0, 200),
      lines: line.amountAg > 0
        ? [{ account: BR.BANK, debit: amount, memo }, { account: acc.code, credit: amount, memo }]
        : [{ account: acc.code, debit: amount, memo }, { account: BR.BANK, credit: amount, memo }]
    }, data.accounts);
    const entry = { id: crypto.randomUUID(), ...validated, bankLineId: line.id, createdAt: new Date().toISOString() };
    data.journal.push(entry);
    line.match = { type: 'entry', entryId: entry.id, created: true, at: entry.createdAt };
    await this.db.save(data);
    return entry;
  }

  // ביטול התאמה: רק הקישור מוסר. גבייה או רשומה שנוצרו בהתאמה נשארות — מבטלים אותן במקומן (ביטול גבייה / היפוך רשומה)
  async unmatchBankLine(lineId) {
    const data = await this._load();
    const line = data.bankLines.find(l => l.id === lineId);
    if (!line) throw new Error('התנועה לא נמצאה');
    if (!line.match) throw new Error('התנועה אינה מותאמת');
    delete line.match;
    await this.db.save(data);
    return line;
  }

  // מחיקת תנועה שנקלטה בטעות — רק תנועה פתוחה (לא מותאמת)
  async deleteBankLine(lineId) {
    const data = await this._load();
    const line = data.bankLines.find(l => l.id === lineId);
    if (!line) throw new Error('התנועה לא נמצאה');
    if (line.match) throw new Error('לא ניתן למחוק תנועה מותאמת — יש לבטל את ההתאמה קודם');
    data.bankLines = data.bankLines.filter(l => l.id !== lineId);
    await this.db.save(data);
    return true;
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
