// Collect Service — גבייה מלקוחות של הארגון: דרישות תשלום עם קישור לחברת הסליקה של הארגון,
// וקליטת התשלומים מדוח החברה. תשלום שהתקבל נרשם במקומו: חשבונית ← גבייה ביומן, תרומה ← תרומה וקבלה,
// גמ"ח ← תשלום בלוח הסילוקין. נשמר באוסף payments — ולכן נכנס לגיבוי המוצפן.
// השירותים האחרים טוענים ושומרים את המסד בעצמם — לכן הקריאה אליהם תמיד לפני/אחרי _load שלנו, לא באמצע.
const crypto = require('crypto');
const P = require('../core/collect');
const { AccountingService: accounting } = require('./accountingService');
const { NpoService: npo } = require('./npoService');
const { GemachService: gemach } = require('./gemachService');

class CollectService {
  constructor(db) { this.db = db; }

  async initialize(db) { if (db) this.db = db; }

  async _load() {
    const data = await this.db.load();
    const p = data.payments && typeof data.payments === 'object' ? data.payments : {};
    data.payments = { settings: P.normalizeSettings(p.settings), requests: Array.isArray(p.requests) ? p.requests : [] };
    return data;
  }

  // visible(kind) — האם התחום של הדרישה פתוח ברישיון (ה-IPC מעביר); הסיכום מחושב רק מהדרישות שמוצגות
  async getOverview(visible = () => true) {
    const { payments } = await this._load();
    const mine = payments.requests.filter(r => visible(r.kind));
    const requests = [...mine].sort((a, b) => b.number - a.number)
      .map(r => ({ ...r, amount: P.fromAg(r.amountAg), statusLabel: P.STATUSES[r.status], kindLabel: P.KINDS[r.kind] }));
    const kinds = Object.fromEntries(Object.entries(P.KINDS).filter(([k]) => visible(k)));
    return { settings: payments.settings, requests, summary: P.summary(mine), providers: P.PROVIDERS, kinds };
  }

  async saveSettings(input) {
    const data = await this._load();
    data.payments.settings = P.validateSettings(input, data.payments.settings);
    await this.db.save(data);
    return data.payments.settings;
  }

  // היעד חייב להתקיים ולהיות פתוח לתשלום כבר ביצירת הדרישה
  async _checkTarget(input) {
    const amountAg = P.toAg(input.amount);
    if (input.kind === 'invoice') {
      const inv = await accounting.getInvoice(String(input.targetId || ''));
      if (inv.status !== 'open') throw new Error('החשבונית אינה פתוחה לתשלום');
      if (P.toAg(inv.total) !== amountAg) throw new Error(`הסכום חייב להיות סכום החשבונית (${inv.total} ₪)`);
    } else if (input.kind === 'gemach') {
      const loan = await gemach.getLoan(String(input.targetId || ''));
      if (loan.status !== 'active') throw new Error('ההלוואה אינה פעילה');
      const item = (loan.schedule || []).find(s => s.seq === Number(input.seq));
      if (!item) throw new Error('התשלום בלוח הסילוקין לא נמצא');
      if (amountAg > item.amountAg - item.paidAg) throw new Error(`הסכום גבוה מהנותר לתשלום זה (${P.fromAg(item.amountAg - item.paidAg)} ₪)`);
    }
  }

  async createRequest(input = {}) {
    await this._checkTarget(input);
    const data = await this._load();
    const open = data.payments.requests.find(r => r.status === 'open' && r.target && r.target.id && r.target.id === String(input.targetId || '')
      && (input.kind !== 'gemach' || r.target.seq === Number(input.seq)));
    if (open && input.kind !== 'donation') throw new Error(`כבר קיימת דרישה פתוחה לרשומה הזו (${open.ref})`);
    const { req, settings } = P.createRequest(input, data.payments.settings, data.payments.requests.length);
    const request = { id: crypto.randomUUID(), ...req };
    data.payments.requests.push(request);
    data.payments.settings = settings;
    await this.db.save(data);
    return request;
  }

  async getMessage(id, orgName) {
    const { payments } = await this._load();
    const r = payments.requests.find(x => x.id === id);
    if (!r) throw new Error('דרישת התשלום לא נמצאה');
    return { text: P.messageText(r, payments.settings, orgName), link: r.link, ref: r.ref };
  }

  async cancelRequest(id) {
    const data = await this._load();
    const r = data.payments.requests.find(x => x.id === id);
    if (!r) throw new Error('דרישת התשלום לא נמצאה');
    if (r.status !== 'open') throw new Error('אפשר לבטל רק דרישה שממתינה לתשלום');
    r.status = 'cancelled';
    r.cancelledAt = new Date().toISOString();
    await this.db.save(data);
    return r;
  }

  // רישום התשלום במקומו. מחזיר תיאור קצר של מה שנרשם
  async _applyPayment(r, { date, txId }) {
    const t = r.target || {};
    if (r.kind === 'invoice') {
      const inv = await accounting.recordPayment(t.id, { date });
      return { invoiceNumber: inv.number };
    }
    if (r.kind === 'gemach') {
      await gemach.recordPayment(t.id, t.seq, { amount: P.fromAg(r.amountAg), date });
      return { loanId: t.id, seq: t.seq };
    }
    if (r.kind === 'donation') {
      const d = await npo.addDonation({ date, amount: P.fromAg(r.amountAg), donorName: r.payerName, donorId: t.donorId || '',
        donorPhone: r.payerPhone, fundId: t.fundId || undefined, campaignId: t.campaignId || '', method: 'card',
        purpose: r.description, reference: (txId || r.ref).slice(0, 60) });
      return { donationId: d.id, receiptNumber: d.receipt && d.receipt.number };
    }
    return {};
  }

  // סימון ידני כ"שולם" (למשל: הלקוח שילם וראיתם את זה באתר חברת הסליקה)
  async markPaid(id, input = {}) {
    const { payments } = await this._load();
    const r = payments.requests.find(x => x.id === id);
    if (!r) throw new Error('דרישת התשלום לא נמצאה');
    if (r.status !== 'open') throw new Error('הדרישה אינה ממתינה לתשלום');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? input.date : new Date().toISOString().slice(0, 10);
    const txId = String(input.txId || '').trim().slice(0, 80);
    const applied = await this._applyPayment(r, { date, txId });
    return this._setPaid(id, { date, txId, source: 'manual', applied });
  }

  // ---------- תשלום מערכת בת להורה שלה ----------
  // מצב התשלום של מערכת בת: הדרישה האחרונה שלה. paid + בלי usedAt = תשלום שעוד לא נוצל לבקשת רישיון
  async licensePayment(childId) {
    const { payments } = await this._load();
    const mine = payments.requests.filter(r => r.kind === 'license' && r.target && r.target.id === childId && r.status !== 'cancelled');
    const unused = mine.find(r => r.status === 'paid' && !r.usedAt);
    const open = mine.find(r => r.status === 'open');
    const r = unused || open || null;
    return r && { id: r.id, ref: r.ref, status: r.status, amount: P.fromAg(r.amountAg), months: r.target.months, link: r.link, ready: r === unused };
  }

  // תשלום משמש לבקשת רישיון אחת בלבד — חידוש שנתי דורש תשלום חדש
  async useLicensePayment(id, info = {}) {
    const data = await this._load();
    const r = data.payments.requests.find(x => x.id === id);
    if (!r || r.kind !== 'license' || r.status !== 'paid' || r.usedAt) throw new Error('התשלום על הרישיון לא נמצא או שכבר נוצל');
    r.usedAt = new Date().toISOString();
    r.usedFor = { childId: String(info.childId || '').slice(0, 64) };
    await this.db.save(data);
    return r;
  }

  async _setPaid(id, payment) {
    const data = await this._load();
    const r = data.payments.requests.find(x => x.id === id);
    r.status = 'paid';
    r.payment = { ...payment, recordedAt: new Date().toISOString() };
    await this.db.save(data);
    return r;
  }

  // התצוגה המקדימה מציגה התאמות רק לדרישות של תחומים פתוחים (visible — כמו ב-getOverview)
  async previewImport(csvText, visible = () => true) {
    const { payments } = await this._load();
    const p = P.previewImport(csvText, payments.settings);
    return { ...p, match: this._safeMatch(csvText, p.mapping, payments.requests.filter(r => visible(r.kind))) };
  }
  _safeMatch(csvText, mapping, requests) {
    try { return P.matchReport(csvText, mapping, requests); } catch (e) { return { error: e.message }; }
  }

  // קליטת הדוח: ההתאמה מחושבת שוב כאן (לא סומכים על מה שהממשק שלח), וכל תשלום נרשם בנפרד —
  // תשלום שנכשל ברישום (למשל חשבונית שבוטלה בינתיים) לא עוצר את השאר
  async importReport(csvText, mapping = {}) {
    let data = await this._load();
    const { matched, unmatched, errors, skipped } = P.matchReport(csvText, mapping, data.payments.requests);
    data.payments.settings = { ...data.payments.settings, importMapping: mapping };
    await this.db.save(data);
    const recorded = [];
    const failed = [];
    for (const m of matched) {
      data = await this._load();
      const r = data.payments.requests.find(x => x.ref === m.ref);
      if (!r || r.status !== 'open') continue;
      try {
        const applied = await this._applyPayment(r, { date: m.date, txId: m.txId });
        await this._setPaid(r.id, { date: m.date, txId: m.txId, source: 'report', how: m.how, name: m.name, applied });
        recorded.push({ ref: m.ref, payerName: r.payerName, amount: P.fromAg(r.amountAg), how: m.how });
      } catch (e) {
        failed.push({ ref: m.ref, line: m.line, message: e.message });
      }
    }
    return { recorded, failed, unmatched, errors, skipped };
  }
}

module.exports = { CollectService: new CollectService() };
