// Mortgage Advisor Service - משרד ייעוץ משכנתאות: תיקים לפי יועץ, צנרת שלבים, הצעות בנקים, השוואה, עמלה ומסמכים.
// נשמר באוסף mortgageAdvisor במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן הקיים.
// actor = { id, username, isManager } מגיע מה-IPC בכל פעולה. תיק שהמשתמש לא רשאי לראות — "לא נמצא".
const crypto = require('crypto');
const M = require('../core/mortgageAdvisor');
const R = require('../core/mortgageReport');
const DM = require('../core/dealMortgage');

const MAX_CLIENTS = 5000;
const MAX_OFFERS = 20000;
const ADVISOR_ROLES = new Set(['admin', 'editor']);
// היום המקומי (לא UTC — בין חצות ל-03:00 toISOString מחזיר את אתמול). ipc.js מעביר את היום; זו ברירת המחדל
// dayOr: ריק ← היום; תאריך שאינו קיים בלוח (2026-02-31) ← שגיאה בעברית (פעם regex בלבד קיבל אותו)
const { dayOr } = require('../core/dates');

class MortgageAdvisorService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  async _load() {
    const data = await this.db.load();
    const ma = data.mortgageAdvisor && typeof data.mortgageAdvisor === 'object' ? data.mortgageAdvisor : {};
    // רשומות ישנות בשקלים מומרות לאגורות כאן, ונשמרות כך בשמירה הבאה.
    // תיק עם תשלומים בלי מעמד מע"מ נעול — ננעל לפי ההגדרה שבתוקף עכשיו (לפני כל שינוי שלה; ראו M.caseVatRate)
    const settings = M.normalizeSettings(ma.settings);
    data.mortgageAdvisor = {
      ...ma,
      settings,
      clients: (Array.isArray(ma.clients) ? ma.clients : []).map(M.clientStored).map(c => M.lockFeeVat(c, settings.vatExempt)),
      offers: (Array.isArray(ma.offers) ? ma.offers : []).map(M.offerStored)
    };
    return data;
  }

  // שיעור המע"מ של העסק — לתיק שננעל כעוסק מורשה
  _fullVatRate(data) {
    const r = Number(data.settings && data.settings.vatRate);
    return Number.isFinite(r) && r >= 0 && r < 1 ? r : 0.18;
  }

  // השיעור לתיק בלי נעילה: המשרד עוסק פטור — עמלת הייעוץ בלי מע"מ
  _vatRate(data) {
    if (data.mortgageAdvisor && data.mortgageAdvisor.settings && data.mortgageAdvisor.settings.vatExempt) return 0;
    return this._fullVatRate(data);
  }

  // עוסק פטור לעמלה של התיק: המעמד שננעל בתיק, ובלי נעילה — ההגדרה הנוכחית
  _caseExempt(data, c) {
    return typeof c.feeVatExempt === 'boolean' ? c.feeVatExempt : !!data.mortgageAdvisor.settings.vatExempt;
  }

  // יועצים = משתמשים פעילים שיכולים לערוך (מנהל / עורך). בלי מסד משתמשים (בדיקות) — רשימה ריקה
  async _advisors() {
    if (!this.db || typeof this.db.listUsers !== 'function') return [];
    const users = await this.db.listUsers();
    return users.filter(u => u.active && ADVISOR_ROLES.has(u.role)).map(u => ({ id: u.id, name: u.username }));
  }

  _visible(data, actor) {
    const { clients, settings } = data.mortgageAdvisor;
    return clients.filter(c => M.canSee(c, actor, settings));
  }

  _findClient(data, clientId, actor) {
    const c = data.mortgageAdvisor.clients.find(x => x.id === clientId);
    if (!c || !M.canSee(c, actor, data.mortgageAdvisor.settings)) throw new Error('התיק לא נמצא');
    return c;
  }

  async getOverview(actor, opts = {}) {
    const data = await this._load();
    const { offers, settings } = data.mortgageAdvisor;
    const realty = data.realty && typeof data.realty === 'object' ? data.realty : {};
    const today = dayOr(opts.today);
    const clients = this._visible(data, actor);
    const vat = this._vatRate(data);
    const full = this._fullVatRate(data);
    const advisors = await this._advisors();
    const nameOf = (id) => (advisors.find(a => a.id === id) || {}).name || 'יועץ שאינו פעיל';
    return {
      me: actor ? { id: actor.id, isManager: !!actor.isManager } : { id: null, isManager: true },
      settings,
      // בלי הלוגו עצמו (גדול) — רק אם קיים
      brand: (() => { const b = R.normalizeBrand({}, data.mortgageAdvisor.brand || {}); const { logo, ...rest } = b; return { ...rest, hasLogo: !!logo }; })(),
      feeStates: M.FEE_STATES,
      feeMethods: M.FEE_METHODS,
      advisors,
      board: M.pipelineBoard(clients, { settings, advisorName: nameOf }),
      clients: clients.map(c => {
        const own = offers.filter(o => o.clientId === c.id);
        return {
          ...M.clientView(c),
          advisorName: c.advisorId ? nameOf(c.advisorId) : '',
          daysInStage: M.daysInStage(c, Date.now()),
          ltv: M.ltv(c),
          fee: M.advisoryFee(c, vat, full),
          feeStatus: M.feeStatus(c, vat, full),
          feeExempt: this._caseExempt(data, c),
          feePayments: (c.feePayments || []).map(p => {
            const live = this._liveInvoice(data, p);
            return { id: p.id, date: p.date, amount: p.amountAg / 100, method: p.method, note: p.note,
              invoiceNumber: live ? p.invoiceNumber || null : null, cancelledInvoice: p.invoiceId && !live ? p.invoiceNumber || null : null };
          }),
          docs: M.docsProgress(c),
          approvals: M.approvalsSummary(c, today),
          offers: own.map(o => ({ ...o, summary: M.offerSummary(o), yearly: M.yearlySchedule(o) })),
          comparison: M.compareOffers(own),
          // עסקת תיווך מקושרת — רק אם תחום הנדל"ן פתוח ברישיון (opts.realty)
          realtyDeal: opts.realty ? DM.dealForCase(c, realty.deals, realty.properties, today) : null
        };
      }).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))),
      statuses: M.CLIENT_STATUSES,
      employment: M.EMPLOYMENT,
      deals: M.DEALS,
      tracks: M.TRACKS
    };
  }

  async createClient(input, actor) {
    const data = await this._load();
    if (data.mortgageAdvisor.clients.length >= MAX_CLIENTS) throw new Error('הגעת למספר המקסימלי של תיקים');
    const ids = (await this._advisors()).map(a => a.id);
    // תיק חדש של יועץ — משויך אליו. מנהל בוחר (ברירת מחדל: עצמו)
    const requested = input && input.advisorId !== undefined && input.advisorId !== '' ? input.advisorId : (actor ? actor.id : '');
    const advisorId = M.resolveAdvisor(requested, '', actor, ids.concat(actor && actor.id ? [actor.id] : []));
    const now = new Date().toISOString();
    const base = { id: crypto.randomUUID(), ...M.validateClient(input), advisorId, docs: [], createdAt: now };
    const client = M.withStage({}, base, actor, now);
    data.mortgageAdvisor.clients.push(client);
    await this.db.save(data);
    return M.clientView(client);
  }

  // הקלט מהמסך בשקלים, ולכן ממזגים אותו עם התצוגה של הרשומה (לא עם הצורה השמורה)
  async updateClient(clientId, input, actor) {
    const data = await this._load();
    const cur = this._findClient(data, clientId, actor);
    const i = data.mortgageAdvisor.clients.indexOf(cur);
    const ids = (await this._advisors()).map(a => a.id);
    const advisorId = M.resolveAdvisor(input ? input.advisorId : undefined, cur.advisorId || '', actor, ids);
    const now = new Date().toISOString();
    const next = M.clientStored({ ...cur, ...M.validateClient({ ...M.clientView(cur), ...input }), advisorId, updatedAt: now });
    data.mortgageAdvisor.clients[i] = M.withStage(cur, next, actor, now);
    await this.db.save(data);
    return M.clientView(data.mortgageAdvisor.clients[i]);
  }

  // מחיקת תיק מוחקת גם את ההצעות שלו — אחרת נשארות הצעות יתומות שאינן מוצגות בשום מקום
  async deleteClient(clientId, actor) {
    const data = await this._load();
    const cur = this._findClient(data, clientId, actor);
    // תשלום עמלה שהופקה עליו חשבונית — לא נמחק עם התיק (כמו במחיקת תשלום ובנדל"ן; סקירת קוד 2.11.2026)
    const invoiced = (cur.feePayments || []).find(p => this._liveInvoice(data, p));
    if (invoiced) throw new Error(`בתיק יש תשלום עמלה שהופקה עליו חשבונית (מספר ${invoiced.invoiceNumber}) — אי אפשר למחוק את התיק. אפשר לסמן אותו "לא התקדם"`);
    data.mortgageAdvisor.clients = data.mortgageAdvisor.clients.filter(c => c.id !== clientId);
    data.mortgageAdvisor.offers = data.mortgageAdvisor.offers.filter(o => o.clientId !== clientId);
    // עסקת תיווך שהייתה מקושרת לתיק — הקישור מתנתק (העסקה נשארת)
    for (const d of (data.realty && data.realty.deals) || []) if (d.mortgageCaseId === clientId) delete d.mortgageCaseId;
    await this.db.save(data);
    return true;
  }

  // state: received / na / missing. בלי state — החלפה בין התקבל / חסר
  async toggleDoc(clientId, key, actor, state) {
    const data = await this._load();
    const c = this._findClient(data, clientId, actor);
    Object.assign(c, M.setDocState(c, key, state));
    c.updatedAt = new Date().toISOString();
    await this.db.save(data);
    return M.docsProgress(c);
  }

  // נוסח ללקוח עם המסמכים החסרים — להעתקה בלבד
  async getMissingDocsMessage(clientId, actor) {
    const data = await this._load();
    const c = this._findClient(data, clientId, actor);
    const office = (data.mortgageAdvisor.brand && data.mortgageAdvisor.brand.officeName) || (data.settings && data.settings.business && data.settings.business.name) || '';
    return { text: M.missingDocsMessage(c, office), missing: M.docsProgress(c).missing };
  }

  // ---------- אישורים עקרוניים ----------
  // החלפה של כל רשימת האישורים בתיק בשמירה אחת. האישור הנבחר נשמר רק אם עדיין ברשימה
  async saveApprovals(clientId, list, actor, day) {
    const data = await this._load();
    const c = this._findClient(data, clientId, actor);
    const input = Array.isArray(list) ? list : [];
    if (input.length > M.MAX_APPROVALS) throw new Error(`עד ${M.MAX_APPROVALS} אישורים בתיק`);
    const now = new Date().toISOString();
    const today = dayOr(day);
    const prev = new Map((c.approvals || []).map(a => [a.id, a]));
    c.approvals = input.map((x, i) => {
      const a = M.validateApproval(x, i);
      const old = a.id && prev.get(a.id);
      return { ...a, id: old ? a.id : crypto.randomUUID(), receivedAt: a.receivedAt || (old && old.receivedAt) || today, savedAt: now };
    });
    if (c.chosenApprovalId && !c.approvals.some(a => a.id === c.chosenApprovalId)) c.chosenApprovalId = '';
    c.updatedAt = now;
    await this.db.save(data);
    return M.approvalsSummary(c, today);
  }

  async chooseApproval(clientId, approvalId, actor, day) {
    const data = await this._load();
    const c = this._findClient(data, clientId, actor);
    const id = String(approvalId || '');
    if (id && !(c.approvals || []).some(a => a.id === id)) throw new Error('האישור לא נמצא בתיק');
    c.chosenApprovalId = id;
    c.updatedAt = new Date().toISOString();
    await this.db.save(data);
    return M.approvalsSummary(c, dayOr(day));
  }

  // הקלט להשוואה במנוע המעבדה (ה-IPC מעביר אותו ל-mlab calcApprovals)
  async approvalsInput(clientId, actor) {
    const data = await this._load();
    const c = this._findClient(data, clientId, actor);
    const input = M.approvalsForLab(c);
    if (!input.offers.length) throw new Error('אין אישורים עקרוניים בתיק');
    return input;
  }

  async addOffer(input, actor) {
    const data = await this._load();
    if (data.mortgageAdvisor.offers.length >= MAX_OFFERS) throw new Error('הגעת למספר המקסימלי של הצעות');
    const offer = { id: crypto.randomUUID(), ...M.validateOffer(input, this._visible(data, actor)), createdAt: new Date().toISOString() };
    data.mortgageAdvisor.offers.push(offer);
    await this.db.save(data);
    return { ...offer, summary: M.offerSummary(offer) };
  }

  _findOffer(data, offerId, actor) {
    const o = data.mortgageAdvisor.offers.find(x => x.id === offerId);
    const c = o && data.mortgageAdvisor.clients.find(x => x.id === o.clientId);
    if (!o || (c && !M.canSee(c, actor, data.mortgageAdvisor.settings))) throw new Error('ההצעה לא נמצאה');
    return { o, c };
  }

  async deleteOffer(offerId, actor) {
    const data = await this._load();
    this._findOffer(data, offerId, actor);
    data.mortgageAdvisor.offers = data.mortgageAdvisor.offers.filter(o => o.id !== offerId);
    await this.db.save(data);
    return true;
  }

  // מחשבון בלי שמירה: מסלולים → סיכום ולוח שנתי
  async calcTracks(input) {
    const tracks = (Array.isArray(input && input.tracks) ? input.tracks : M.tracksFromForm(input || {})).map(M.validateTrack);
    if (tracks.length === 0) throw new Error('יש להזין לפחות מסלול אחד');
    const offer = { tracks, cpi: M.validateCpi(input && input.cpi) };
    return { summary: M.offerSummary(offer), yearly: M.yearlySchedule(offer) };
  }

  async getScheduleExport(offerId, actor) {
    const data = await this._load();
    const { o, c } = this._findOffer(data, offerId, actor);
    return M.scheduleTable(o, c && c.name);
  }

  // ---------- עמלות והכנסות ----------
  async addFeePayment(clientId, input, actor) {
    const data = await this._load();
    const c = this._findClient(data, clientId, actor);
    const list = Array.isArray(c.feePayments) ? c.feePayments : [];
    if (list.length >= M.MAX_FEE_PAYMENTS) throw new Error('הגעת למספר המקסימלי של תשלומים בתיק');
    const p = { id: crypto.randomUUID(), ...M.validateFeePayment(input, M.feeStatus(c, this._vatRate(data), this._fullVatRate(data))), by: actor ? actor.id : null, createdAt: new Date().toISOString() };
    // התשלום הראשון נועל בתיק את מעמד המע"מ של המשרד (שינוי מאוחר של ההגדרה חל רק על תיקים בלי תשלומים)
    c.feeVatExempt = this._caseExempt(data, c);
    c.feePayments = [...list, p];
    c.updatedAt = p.createdAt;
    await this.db.save(data);
    return { payment: p, status: M.feeStatus(c, this._vatRate(data), this._fullVatRate(data)) };
  }

  // תשלום שהופקה לו חשבונית לא נמחק — החשבונית מבוטלת במסך החשבוניות
  async deleteFeePayment(clientId, paymentId, actor) {
    const data = await this._load();
    const c = this._findClient(data, clientId, actor);
    const p = (c.feePayments || []).find(x => x.id === paymentId);
    if (!p) throw new Error('התשלום לא נמצא');
    if (this._liveInvoice(data, p)) throw new Error(`הופקה חשבונית לתשלום הזה (מספר ${p.invoiceNumber}) — אי אפשר למחוק אותו`);
    c.feePayments = c.feePayments.filter(x => x.id !== paymentId);
    // בלי תשלומים — התיק חוזר להגדרה הנוכחית
    if (!c.feePayments.length) delete c.feeVatExempt;
    c.updatedAt = new Date().toISOString();
    await this.db.save(data);
    return M.feeStatus(c, this._vatRate(data), this._fullVatRate(data));
  }

  // פרטי התשלום להפקת חשבונית (ה-IPC מפיק בשירות הנהלת החשבונות ואז קורא ל-linkFeeInvoice)
  async feePaymentForInvoice(clientId, paymentId, actor) {
    const data = await this._load();
    const c = this._findClient(data, clientId, actor);
    const p = (c.feePayments || []).find(x => x.id === paymentId);
    if (!p) throw new Error('התשלום לא נמצא');
    if (this._liveInvoice(data, p)) throw new Error(`כבר הופקה חשבונית לתשלום הזה (מספר ${p.invoiceNumber})`);
    return { key: `madv:${c.id}:${p.id}`, customer: c.name, date: p.date, grossAgorot: p.amountAg, method: p.method, description: `עמלת ייעוץ משכנתא — ${c.name}`.slice(0, 200),
      exempt: this._caseExempt(data, c) };
  }

  // החשבונית שהופקה לתשלום — רק אם עדיין בתוקף (כמו _liveInvoice בתיווך): חשבונית שבוטלה לא חוסמת
  _liveInvoice(data, p) {
    if (!p || !p.invoiceId) return null;
    return (data.invoices || []).find(i => i.id === p.invoiceId && i.status !== 'cancelled') || null;
  }

  async linkFeeInvoice(clientId, paymentId, invoice) {
    const data = await this._load();
    const c = data.mortgageAdvisor.clients.find(x => x.id === clientId);
    const p = c && (c.feePayments || []).find(x => x.id === paymentId);
    if (!p) throw new Error('התשלום לא נמצא');
    p.invoiceId = invoice.id;
    p.invoiceNumber = invoice.number;
    await this.db.save(data);
    return p;
  }

  async getIncome(year, actor) {
    const data = await this._load();
    const clients = this._visible(data, actor);
    const advisors = await this._advisors();
    const nameOf = (id) => (advisors.find(a => a.id === id) || {}).name || 'יועץ שאינו פעיל';
    return M.officeIncome(clients, { year, vatRate: this._vatRate(data), fullVatRate: this._fullVatRate(data), advisorName: nameOf });
  }

  // ---------- מיתוג ודוח ללקוח ----------
  async saveBrand(input) {
    const data = await this._load();
    data.mortgageAdvisor.brand = R.normalizeBrand(input, data.mortgageAdvisor.brand || {});
    await this.db.save(data);
    return data.mortgageAdvisor.brand;
  }

  async setBrandLogo(dataUrl) {
    const data = await this._load();
    const brand = R.normalizeBrand({}, data.mortgageAdvisor.brand || {});
    brand.logo = R.validateLogo(dataUrl);
    data.mortgageAdvisor.brand = brand;
    await this.db.save(data);
    return { hasLogo: !!brand.logo };
  }

  // כל מה שהדוח צריך — חוץ מהחישובים של המעבדה, שה-IPC מוסיף
  async reportData(clientId, actor) {
    const data = await this._load();
    const c = this._findClient(data, clientId, actor);
    const brand = R.normalizeBrand({}, data.mortgageAdvisor.brand || {});
    if (!brand.officeName && data.settings && data.settings.business) brand.officeName = String(data.settings.business.name || '').slice(0, 120);
    const chosen = (c.approvals || []).find(a => a.id === c.chosenApprovalId) || null;
    return {
      client: M.clientView(c),
      brand,
      chosen: chosen && M.approvalView(chosen),
      approvalsInput: (c.approvals || []).length ? M.approvalsForLab(c) : null,
      missingDocs: M.docsProgress(c).missing
    };
  }

  // הגדרות המשרד (מנהל בלבד — נאכף ב-permissionFor)
  async saveSettings(input) {
    const data = await this._load();
    data.mortgageAdvisor.settings = M.normalizeSettings({ ...data.mortgageAdvisor.settings, ...(input || {}) });
    await this.db.save(data);
    return data.mortgageAdvisor.settings;
  }
}

module.exports = { MortgageAdvisorService: new MortgageAdvisorService() };
