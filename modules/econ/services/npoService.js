// NPO Service - עמותות: תרומות וקבלות סעיף 46, קרנות, תמיכות ודוח שנתי.
// נשמר באוסף npo במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן הקיים.
const crypto = require('crypto');
const N = require('../core/npo');
const SO = require('../core/standingOrders');
const DI = require('../core/donationImport');
const MEM = require('../core/memorials');
const CMP = require('../core/campaigns');
const MSV = require('../core/masav');
const L = require('../core/npoLetters');

// פרטי חשבון הבנק לא יוצאים לממשק — רק מסיכה
const withoutBank = ({ bankAccount, ...o }) => ({ ...o, bankMasked: MSV.maskAccount(bankAccount) });
// "היום" המקומי (לא UTC — בין חצות ל-03:00 toISOString מחזיר את אתמול). ipc.js מעביר את היום; זו ברירת המחדל
// dayOr: ריק ← היום; תאריך שאינו קיים בלוח (2026-02-31) ← שגיאה בעברית (פעם regex בלבד קיבל אותו)
const { localDay, dayOr, isDay } = require('../core/dates');

class NpoService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  async _load() {
    const data = await this.db.load();
    const npo = data.npo && typeof data.npo === 'object' ? data.npo : {};
    data.npo = {
      settings: N.normalizeSettings(npo.settings),
      donations: Array.isArray(npo.donations) ? npo.donations : [],
      grants: Array.isArray(npo.grants) ? npo.grants : [],
      standingOrders: Array.isArray(npo.standingOrders) ? npo.standingOrders : [],
      memorials: Array.isArray(npo.memorials) ? npo.memorials : [],
      campaigns: Array.isArray(npo.campaigns) ? npo.campaigns : [],
      masav: MSV.normalizeStore(npo.masav)
    };
    return data;
  }

  /* ---------- הוראות קבע (מעקב בלבד) ---------- */
  async getStandingOrders(today) {
    const { npo } = await this._load();
    const t = dayOr(today);
    const sum = SO.summarize(npo.standingOrders.map(withoutBank), t);
    return { ...sum, masav: { configured: !!npo.masav.settings, settings: npo.masav.settings, batches: npo.masav.batches.map(MSV.batchView).reverse() } };
  }

  async saveStandingOrder(orderId, input) {
    const data = await this._load();
    const list = data.npo.standingOrders;
    const prev = orderId ? list.find(o => o.id === orderId) : null;
    if (orderId && !prev) throw new Error('הוראת הקבע לא נמצאה');
    const fundIds = N.allFunds(data.npo.settings).filter(f => !f.archived || (prev && prev.fundId === f.id)).map(f => f.id);
    const clean = SO.validateStandingOrder({ ...(prev || {}), ...input }, { fundIds, prev: prev || {}, count: list.length });
    const now = new Date().toISOString();
    const order = prev ? Object.assign(prev, clean, { updatedAt: now }) : { id: crypto.randomUUID(), ...clean, history: [], createdAt: now };
    if (!prev) list.push(order);
    await this.db.save(data);
    return withoutBank(order);
  }

  // סימון חודש: "התקבל" מפיק תרומה וקבלה רגילות (באותה שמירה), "נכשל" נרשם להיסטוריה בלבד
  async recordStandingPayment(orderId, month, status, date) {
    const data = await this._load();
    const order = data.npo.standingOrders.find(o => o.id === orderId);
    if (!order) throw new Error('הוראת הקבע לא נמצאה');
    const donation = this._recordStandingIn(data, order, month, status, date);
    await this.db.save(data);
    return { order: withoutBank(order), donation };
  }

  /* סימון בתוך נתונים שכבר נטענו (בלי שמירה) — גם לסגירת אצוות מס"ב בשמירה אחת.
     fromBatch: { amountAg } — חיוב מאצוות מס"ב: הקבלה בסכום שנכתב בקובץ (לא בסכום הנוכחי של ההוראה),
     ובלי בדיקת תקופת ההוראה (היא הסתיימה אחרי שהקובץ נשלח) */
  _recordStandingIn(data, order, month, status, date, extra = {}, fromBatch = null) {
    SO.assertCanRecord(order, month, status, { ignorePeriod: !!fromBatch });
    const entry = { month, status, at: new Date().toISOString(), ...extra };
    let donation = null;
    if (status === 'received') {
      if (!data.npo.settings.orgName) throw new Error('יש להגדיר תחילה את פרטי העמותה (כפתור "הגדרות עמותה")');
      const day = isDay(date) ? date : SO.dueDate(month, order.dayOfMonth);
      const amount = fromBatch && Number.isInteger(fromBatch.amountAg) ? fromBatch.amountAg / 100 : order.amount;
      const clean = N.validateDonation({
        date: day, donorName: order.donorName, donorId: order.donorId, amount, method: order.method,
        fundId: order.fundId, purpose: order.purpose || 'הוראת קבע', donorPhone: order.donorPhone, donorAddress: order.donorAddress
      }, data.npo.settings, data.npo.donations.length);
      const { receipt, settings } = N.issueReceipt(clean, data.npo.settings);
      donation = { id: crypto.randomUUID(), ...clean, receipt, status: 'active', standingOrderId: order.id, createdAt: entry.at };
      data.npo.donations.push(donation);
      data.npo.settings = settings;
      entry.donationId = donation.id;
    }
    order.history = [...(Array.isArray(order.history) ? order.history : []), entry];
    return donation;
  }

  /* ---------- מס"ב (PLAN.md 9.17): קובץ חיובים להוראות קבע בנקאיות וקליטת החזרות ---------- */
  async saveMasavSettings(input) {
    const data = await this._load();
    data.npo.masav.settings = MSV.validateSettings(input);
    await this.db.save(data);
    return data.npo.masav.settings;
  }

  // פרטי חשבון לחיוב (הרשאה בבנק). input ריק — הסרה. לכל הוראה אסמכתה קבועה לכל חיי ההרשאה
  async setStandingBank(orderId, input) {
    const data = await this._load();
    const order = data.npo.standingOrders.find(o => o.id === orderId);
    if (!order) throw new Error('הוראת הקבע לא נמצאה');
    if (!input) { delete order.bankAccount; await this.db.save(data); return { bankMasked: '' }; }
    if (order.method !== 'standing') throw new Error('פרטי חשבון רק להוראת קבע בנקאית');
    order.bankAccount = MSV.validateBankAccount(input);
    if (!order.masavRef) { data.npo.masav.refSeq += 1; order.masavRef = String(data.npo.masav.refSeq); }
    delete order.masavStopped;
    await this.db.save(data);
    return { bankMasked: MSV.maskAccount(order.bankAccount), masavRef: order.masavRef };
  }

  // החיובים לחודש: הוראה בנקאית עם חשבון, פעילה בחודש, שלא התקבלה ולא נמצאת כבר באצווה, ושלא נעצרה אחרי החזרה סופית
  _masavCandidates(data, month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) throw new Error('חודש לא תקין (YYYY-MM)');
    const busy = MSV.busyKeys(data.npo.masav.batches);
    const out = [];
    for (const o of data.npo.standingOrders) {
      if (o.method !== 'standing' || !o.bankAccount || o.masavStopped) continue;
      if (month < o.startMonth || (o.endMonth && month > o.endMonth)) continue;
      const last = (o.history || []).filter(h => h.month === month).pop();
      if (last && last.status === 'received') continue;
      const key = `${o.id}|${month}`;
      if (busy.has(key)) continue;
      out.push({ key, order: o });
    }
    return out;
  }

  /* אצווה: { month, chargeDate }, today. preview: true — בדיקה בלבד (בלי שמירה), כדי לא ליצור אצווה כשהמשתמש מבטל את השמירה */
  async createMasavBatch({ month, chargeDate } = {}, { today, preview = false } = {}) {
    const data = await this._load();
    const m = data.npo.masav;
    if (!m.settings) throw new Error('יש להגדיר תחילה את פרטי המוסד במס"ב');
    if (!MSV.isDay(chargeDate)) throw new Error('תאריך החיוב אינו תקין');
    if (today && chargeDate < today) throw new Error('תאריך החיוב עבר — יש לבחור תאריך עתידי');
    const cands = this._masavCandidates(data, month);
    if (!cands.length) throw new Error(`אין חיובים ל-${month}: אין הוראות בנקאיות עם פרטי חשבון שטרם חויבו`);
    const file = MSV.buildDebitFile({
      settings: m.settings, chargeDate, createdDate: today || chargeDate,
      items: cands.map(({ order: o }) => ({ ...o.bankAccount, idNumber: o.donorId, name: o.donorName, amountAg: Math.round(o.amount * 100), reference: o.masavRef, period: month }))
    });
    const fileName = `masav-${m.settings.institution}-${chargeDate}.txt`;
    if (preview) return { fileName, count: file.count, totalAg: file.totalAg };
    const batch = { id: crypto.randomUUID(), month, chargeDate, status: 'open', createdAt: new Date().toISOString(), returns: [],
      items: cands.map(({ key, order: o }) => ({ key, ref: o.masavRef, amountAg: Math.round(o.amount * 100), label: o.donorName, status: 'pending' })) };
    m.batches.push(batch);
    await this.db.save(data);
    return { fileName, text: file.text, count: file.count, totalAg: file.totalAg, batchId: batch.id };
  }

  // ביטול אצווה שלא נשלחה (או שהבנק דחה את כולה): החיובים חוזרים להיות זמינים לאצווה חדשה
  async cancelMasavBatch(batchId) {
    const data = await this._load();
    const b = data.npo.masav.batches.find(x => x.id === batchId);
    if (!b) throw new Error('האצווה לא נמצאה');
    if (b.status !== 'open' || b.items.some(i => i.status !== 'pending')) throw new Error('ניתן לבטל רק אצווה פתוחה שלא נקלטו לה החזרות');
    b.status = 'cancelled';
    b.cancelledAt = new Date().toISOString();
    await this.db.save(data);
    return MSV.batchView(b);
  }

  // קובץ החזרות: כל החזרה ← "נכשל" בהוראה (עם הסיבה). החזרה סופית (ביטול הרשאה, אין חשבון...) עוצרת חיובים נוספים
  async importMasavReturns(text) {
    const data = await this._load();
    const m = data.npo.masav;
    if (!m.settings) throw new Error('יש להגדיר תחילה את פרטי המוסד במס"ב');
    const parsed = MSV.parseReturnsFile(text);
    const r = MSV.applyReturns(m.batches, parsed, m.settings.institution);
    const manual = [];
    for (const x of r.matched) {
      const [orderId, month] = x.itemKey.split('|');
      const order = data.npo.standingOrders.find(o => o.id === orderId);
      if (!order) continue;
      const last = (order.history || []).filter(h => h.month === month).pop();
      // חודש שסומן ידנית "התקבל" (עם קבלה) והבנק החזיר — לא רושמים "נכשל" מעליו (זה היה מפיל את כל הקובץ);
      // הקבלה מבוטלת ידנית, ושאר ההחזרות בקובץ נקלטות כרגיל
      if (last && last.status === 'received') {
        const why = `סומן "התקבל" והבנק החזיר את החיוב (${x.reason}) — יש לבטל את הקבלה ידנית`;
        const it = m.batches.find(b => b.id === x.batchId).items.find(i => i.key === x.itemKey);
        it.manual = why;
        manual.push({ label: order.donorName, month, amountAg: it.amountAg, why });
      } else if (!last || last.status !== 'failed') {
        this._recordStandingIn(data, order, month, 'failed', '', { reason: x.reason, masavBatchId: x.batchId }, {});
      }
      if (x.fatal) order.masavStopped = x.reason;
    }
    // החזרה אחרי סגירת האצווה: התשלום כבר נרשם (ביטול ידני), אבל החזרה סופית עוצרת את החיובים הבאים
    for (const x of r.late) {
      const order = data.npo.standingOrders.find(o => o.id === x.itemKey.split('|')[0]);
      if (order && x.fatal) order.masavStopped = x.reason;
    }
    await this.db.save(data);
    return MSV.returnsSummary(r, parsed, manual);
  }

  // סגירת אצווה: כל חיוב שלא הוחזר ← "התקבל" וקבלה בתאריך החיוב, הכול בשמירה אחת
  async closeMasavBatch(batchId) {
    const data = await this._load();
    const b = data.npo.masav.batches.find(x => x.id === batchId);
    if (!b) throw new Error('האצווה לא נמצאה');
    if (b.status !== 'open') throw new Error('האצווה כבר סגורה או מבוטלת');
    let receipts = 0;
    const manual = [];
    for (const it of b.items.filter(i => i.status === 'pending')) {
      const [orderId, month] = it.key.split('|');
      const order = data.npo.standingOrders.find(o => o.id === orderId);
      // הוראה שנמחקה (נתונים מלפני החסימה ב-deleteStandingOrder) — לא מפילה את כל האצווה; נרשמת לטיפול ידני
      if (!order) {
        it.status = 'paid';
        it.manual = 'הוראת הקבע נמחקה — הכסף נגבה, ויש להפיק קבלה ידנית';
        manual.push({ label: it.label, amountAg: it.amountAg, why: it.manual });
        continue;
      }
      // חודש שסומן "התקבל" ידנית בינתיים — בלי קבלה נוספת. אחרת — קבלה בסכום שחויב בקובץ
      const last = (order.history || []).filter(h => h.month === month).pop();
      if (!last || last.status !== 'received') {
        this._recordStandingIn(data, order, month, 'received', b.chargeDate, { masavBatchId: b.id }, { amountAg: it.amountAg });
        receipts++;
      }
      it.status = 'paid';
    }
    b.status = 'closed';
    b.closedAt = new Date().toISOString();
    await this.db.save(data);
    return { paid: receipts, manual, batch: MSV.batchView(b) };
  }

  // הוראה שיש לה חיוב באצווה שלא בוטלה — הכסף עשוי להיגבות; מחיקה תשאיר את האצווה בלי הוראה
  _inOpenBatch(data, orderId) {
    return data.npo.masav.batches.some(b => b.status === 'open' && b.items.some(i => i.status === 'pending' && i.key.split('|')[0] === orderId));
  }

  async deleteStandingOrder(orderId) {
    const data = await this._load();
    const order = data.npo.standingOrders.find(o => o.id === orderId);
    if (!order) throw new Error('הוראת הקבע לא נמצאה');
    // הוראה שכבר הפיקה קבלות לא נמחקת — רק מסתיימת, כדי שהקשר לקבלות יישמר
    if ((order.history || []).some(h => h.status === 'received')) throw new Error('להוראה זו כבר הופקו קבלות. במקום למחוק — קבע לה חודש סיום');
    if (this._inOpenBatch(data, orderId)) throw new Error('להוראה זו יש חיוב באצוות מס"ב פתוחה. יש לסגור או לבטל את האצווה לפני המחיקה');
    data.npo.standingOrders = data.npo.standingOrders.filter(o => o.id !== orderId);
    await this.db.save(data);
    return true;
  }

  /* ---------- קמפיינים ---------- */
  async saveCampaign(campaignId, input) {
    const data = await this._load();
    const list = data.npo.campaigns;
    const prev = campaignId ? list.find(x => x.id === campaignId) : null;
    if (campaignId && !prev) throw new Error('הקמפיין לא נמצא');
    const fundIds = N.allFunds(data.npo.settings).filter(f => !f.archived || (prev && prev.fundId === f.id)).map(f => f.id);
    const usedAmbassadorIds = new Set(prev ? data.npo.donations.filter(d => d.campaignId === prev.id && d.ambassadorId).map(d => d.ambassadorId) : []);
    const clean = CMP.validateCampaign({ ...(prev || {}), ...input }, { count: prev ? 0 : list.length, fundIds, prev, usedAmbassadorIds, newId: () => crypto.randomUUID() });
    if (prev) {
      // שינוי תקופה לא יכול "להוציא" תרומות שכבר שויכו. המחאות דחויות — לפי יום הקבלה, לא לפי הפירעון
      const dayOf = d => d.receivedDate || d.date;
      const out = data.npo.donations.filter(d => d.campaignId === prev.id && d.status !== 'cancelled' && (dayOf(d) < clean.startDate || dayOf(d) > clean.endDate));
      if (out.length) throw new Error(`${out.length} תרומות משויכות לקמפיין מחוץ לתקופה החדשה — יש להרחיב את התקופה`);
    }
    const now = new Date().toISOString();
    const cmp = prev ? Object.assign(prev, clean, { updatedAt: now }) : { id: crypto.randomUUID(), ...clean, createdAt: now };
    if (!prev) list.push(cmp);
    await this.db.save(data);
    return cmp;
  }

  // קמפיין עם תרומות לא נמחק — נסגר, כדי שהשיוך בקבלות יישמר
  async deleteCampaign(campaignId) {
    const data = await this._load();
    if (!data.npo.campaigns.some(x => x.id === campaignId)) throw new Error('הקמפיין לא נמצא');
    if (data.npo.donations.some(d => d.campaignId === campaignId)) throw new Error('לקמפיין יש תרומות משויכות. במקום למחוק — סמן אותו כסגור');
    data.npo.campaigns = data.npo.campaigns.filter(x => x.id !== campaignId);
    await this.db.save(data);
    return true;
  }

  _campaignFor(data, campaignId) {
    if (!campaignId) return null;
    const c = data.npo.campaigns.find(x => x.id === campaignId);
    if (!c) throw new Error('הקמפיין לא נמצא');
    return c;
  }

  /* ---------- הנצחות ויארצייטים ---------- */
  async getMemorials(today, days) {
    const { npo } = await this._load();
    const t = dayOr(today);
    const list = [...npo.memorials].sort((a, b) => a.name.localeCompare(b.name, 'he')).map(m => ({ ...m, hebrewLabel: MEM.hebrewLabel(m) }));
    return { list, ...MEM.upcoming(npo.memorials, t, days) };
  }

  async saveMemorial(memorialId, input) {
    const data = await this._load();
    const list = data.npo.memorials;
    const prev = memorialId ? list.find(m => m.id === memorialId) : null;
    if (memorialId && !prev) throw new Error('רשומת ההנצחה לא נמצאה');
    const clean = MEM.validateMemorial({ ...(prev || {}), ...input }, { count: prev ? 0 : list.length, prev });
    const now = new Date().toISOString();
    const m = prev ? Object.assign(prev, clean, { updatedAt: now }) : { id: crypto.randomUUID(), ...clean, createdAt: now };
    if (!prev) list.push(m);
    await this.db.save(data);
    return m;
  }

  async deleteMemorial(memorialId) {
    const data = await this._load();
    if (!data.npo.memorials.some(m => m.id === memorialId)) throw new Error('רשומת ההנצחה לא נמצאה');
    data.npo.memorials = data.npo.memorials.filter(m => m.id !== memorialId);
    await this.db.save(data);
    return true;
  }

  async getMemorialsExport(today) {
    const { npo } = await this._load();
    const t = dayOr(today);
    return MEM.exportRows(npo.memorials, MEM.upcoming(npo.memorials, t, 400).rows);
  }

  /* ---------- ייבוא תרומות מקובץ של ערוץ חיצוני ---------- */
  async previewImport(csvText, source) {
    const { npo } = await this._load();
    return DI.preview(csvText, source, npo.settings);
  }

  // כל השורות התקינות נשמרות יחד בשמירה אחת. קבלות מקומיות מופקות לפי סדר התאריכים;
  // קבלה של הערוץ נשמרת כקבלה חיצונית ואינה צורכת מספר מהמספור הרץ.
  async importDonations(csvText, options = {}) {
    const data = await this._load();
    if (!data.npo.settings.orgName) throw new Error('יש להגדיר תחילה את פרטי העמותה (כפתור "הגדרות עמותה")');
    const campaign = this._campaignFor(data, options.campaignId);
    if (campaign && campaign.closed) throw new Error(`הקמפיין "${campaign.name}" סגור`);
    const { records, errors, skipped } = DI.buildRecords(csvText, { ...options, campaign }, data.npo.donations, data.npo.settings);
    if (data.npo.donations.length + records.length > N.MAX_DONATIONS) throw new Error('הייבוא יחרוג מהמספר המקסימלי של תרומות');
    const now = new Date().toISOString();
    let settings = data.npo.settings;
    const added = [];
    for (const rec of [...records].sort((a, b) => a.date.localeCompare(b.date))) {
      let receipt;
      if (rec.import.receipts === 'issue') ({ receipt, settings } = N.issueReceipt(rec, settings));
      else receipt = DI.externalReceipt(rec, settings);
      added.push({ id: crypto.randomUUID(), ...rec, receipt, status: 'active', createdAt: now });
    }
    const mappings = { ...(settings.importMappings || {}), [options.source]: Object.fromEntries(Object.keys(DI.FIELDS).filter(k => options.mapping && options.mapping[k]).map(k => [k, String(options.mapping[k])])) };
    data.npo.settings = { ...settings, importMappings: mappings };
    data.npo.donations.push(...added);
    await this.db.save(data);
    const total = added.reduce((t, d) => t + Math.round(d.amount * 100), 0) / 100;
    return { imported: added.length, total, skipped, errors };
  }

  async getOverview(year) {
    const { npo } = await this._load();
    const y = Number(year) || new Date().getFullYear();
    return {
      year: y,
      settings: npo.settings,
      funds: N.allFunds(npo.settings),
      donations: [...npo.donations].sort((a, b) => b.date.localeCompare(a.date) || N.byReceipt(b, a)).map(d => ({ ...d, taxStatus: N.taxStatus(d) })),
      grants: [...npo.grants].sort((a, b) => b.year - a.year || a.source.localeCompare(b.source, 'he')),
      // donors — כל השנים (רשימת התורמים במסך); yearDonors — רק התרומות של שנת y. עוזר ה-AI („תרומות השנה”, מכתב תודה)
      // משתמש ב-yearDonors: פעם קיבל את סכום כל השנים והציג אותו כ„בשנת y” (בדיקת קוד 23.10.2026, ממצא 46)
      donors: N.donorSummary(npo.donations),
      yearDonors: N.donorSummary(npo.donations, y),
      fundSummary: N.fundSummary(npo.donations, npo.grants, npo.settings, y),
      report: N.annualReport(npo.donations, npo.grants, npo.settings, y),
      grantAlerts: N.grantAlerts(npo.grants, localDay()),
      tax: N.taxSummary(npo.donations),
      campaigns: CMP.summarize(npo.campaigns, npo.donations, localDay())
    };
  }

  async saveSettings(input = {}) {
    const data = await this._load();
    const used = new Set([...data.npo.donations.map(d => d.fundId), ...data.npo.grants.map(g => g.fundId)]);
    data.npo.settings = N.applySettings(data.npo.settings, input, used, () => crypto.randomUUID());
    await this.db.save(data);
    return data.npo.settings;
  }

  // תרומה וקבלה נוצרות יחד, באותה שמירה — אין מצב של תרומה בלי קבלה או מספר שדולג
  async addDonation(input) {
    const data = await this._load();
    if (!data.npo.settings.orgName) throw new Error('יש להגדיר תחילה את פרטי העמותה (כפתור "הגדרות עמותה")');
    const clean = N.validateDonation(input, data.npo.settings, data.npo.donations.length);
    if (clean.campaignId) {
      const cmp = this._campaignFor(data, clean.campaignId);
      CMP.assertCanAssign(cmp, clean.date);
      if (clean.ambassadorId && !(cmp.ambassadors || []).some(a => a.id === clean.ambassadorId)) throw new Error('השגריר שנבחר אינו שייך לקמפיין');
    }
    const { receipt, settings } = N.issueReceipt(clean, data.npo.settings);
    const donation = { id: crypto.randomUUID(), ...clean, receipt, status: 'active', createdAt: new Date().toISOString() };
    data.npo.donations.push(donation);
    data.npo.settings = settings;
    await this.db.save(data);
    return donation;
  }

  // המחאות דחויות ("תרומות ישראל", סעיף 2.3.2): תרומה וקבלה לכל שנת מס, כולן באותה שמירה.
  // preview: true — החלוקה לשנים והאזהרות, בלי שמירה ובלי מספרי קבלה. אזהרה (אישור סעיף 46 שפג
  // לפני שנה מסוימת) — ההפקה רק עם confirmWarnings: true. הקמפיין נבדק מול יום קבלת ההמחאות
  // input.generate (בלי cheques) — חלוקה שווה לחודשים (N.generateCheques), כדי שהחישוב יהיה רק כאן
  async addChequeDonation(input, { preview = false } = {}) {
    const data = await this._load();
    if (!data.npo.settings.orgName) throw new Error('יש להגדיר תחילה את פרטי העמותה (כפתור "הגדרות עמותה")');
    const { donations: list, settings } = data.npo;
    const src = !Array.isArray(input.cheques) && input.generate && typeof input.generate === 'object'
      ? { ...input, cheques: N.generateCheques(input.generate) } : input;
    const plan = N.planChequeDonation(src, settings, list.length);
    if (list.length + plan.donations.length > N.MAX_DONATIONS) throw new Error('הגעת למספר המקסימלי של תרומות');
    const first = plan.donations[0];
    if (first.campaignId) {
      const cmp = this._campaignFor(data, first.campaignId);
      CMP.assertCanAssign(cmp, plan.receivedDate);
      if (first.ambassadorId && !(cmp.ambassadors || []).some(a => a.id === first.ambassadorId)) throw new Error('השגריר שנבחר אינו שייך לקמפיין');
    }
    if (preview) {
      return {
        receivedDate: plan.receivedDate, totalAg: plan.totalAg, warnings: plan.warnings,
        years: plan.donations.map(d => ({ year: Number(d.date.slice(0, 4)), date: d.date, amount: d.amount, sec46: N.sec46Eligible(settings, d.date), cheques: d.cheques }))
      };
    }
    if (plan.warnings.length && input.confirmWarnings !== true) throw new Error(plan.warnings.map(w => w.text).join('\n'));
    const chequeGroupId = crypto.randomUUID();
    const issued = N.issueChequeReceipts(plan.donations.map(d => ({ ...d, chequeGroupId })), settings);
    const now = new Date().toISOString();
    const added = issued.donations.map(d => ({ id: crypto.randomUUID(), ...d, status: 'active', createdAt: now }));
    list.push(...added);
    data.npo.settings = issued.settings;
    await this.db.save(data);
    return { chequeGroupId, donations: added };
  }

  // המחאה שחזרה: הקבלה של אותה שנה מבוטלת (המספר נשרף), וליתרת ההמחאות של השנה מופקת קבלה חדשה — בשמירה אחת
  async cancelCheque(donationId, number, bank) {
    const data = await this._load();
    const d = data.npo.donations.find(x => x.id === donationId);
    if (!d) throw new Error('התרומה לא נמצאה');
    const { bounced, replacement } = N.chequeBounce(d, number, bank);
    if (replacement && data.npo.donations.length >= N.MAX_DONATIONS) throw new Error('הגעת למספר המקסימלי של תרומות');
    const now = new Date().toISOString();
    d.status = 'cancelled';
    d.cancelledAt = now;
    d.bouncedCheque = { number: bounced.number, bank: bounced.bank, dueDate: bounced.dueDate };
    let added = null;
    if (replacement) {
      const { receipt, settings } = N.issueReceipt(replacement, data.npo.settings);
      added = { id: crypto.randomUUID(), ...replacement, receipt, status: 'active', createdAt: now };
      data.npo.donations.push(added);
      data.npo.settings = settings;
      d.replacedBy = added.id;
    }
    await this.db.save(data);
    return { cancelled: d, replacement: added };
  }

  // קבלה אינה נמחקת: ביטול משאיר את המספר "שרוף" ומסומן כמבוטל, כנדרש בתיעוד קבלות
  async cancelDonation(donationId) {
    const data = await this._load();
    const d = data.npo.donations.find(x => x.id === donationId);
    if (!d) throw new Error('התרומה לא נמצאה');
    if (d.status === 'cancelled') throw new Error('הקבלה כבר בוטלה');
    d.status = 'cancelled';
    d.cancelledAt = new Date().toISOString();
    await this.db.save(data);
    return d;
  }

  // חבילת סוף שנה: opts = { minTotal (שקלים), onlySec46 }
  async getYearEndPack(year, opts) {
    const { npo } = await this._load();
    const o = opts && typeof opts === 'object' ? opts : {};
    return N.yearEndPack(npo.donations, npo.settings, year, { minTotal: o.minTotal, onlySec46: o.onlySec46 === true });
  }

  // רשימת הדיוור לאותה חבילה (CSV)
  async getYearEndMailing(year, opts) {
    const pack = await this.getYearEndPack(year, opts);
    return { pack, table: N.yearEndMailingRows(pack) };
  }

  async getDonorStatement(donorKey, year) {
    const { npo } = await this._load();
    return N.donorAnnualStatement(npo.donations, npo.settings, donorKey, year);
  }

  // תיק תורם: הסיכום השנתי ותרומות השנה המלאות (לצירוף הקבלות לאותו קובץ)
  async getDonorFile(donorKey, year) {
    const { npo } = await this._load();
    return { statement: N.donorAnnualStatement(npo.donations, npo.settings, donorKey, year), donations: N.donorYearDonations(npo.donations, donorKey, year) };
  }

  // ---------- מכתבים ותבניות (שלב 3) — טיוטה בלבד, לא נשמרת ואינה משנה נתונים ----------
  async getThankYouLetter(donorKey, year, options) {
    const { npo } = await this._load();
    const statement = N.donorAnnualStatement(npo.donations, npo.settings, donorKey, year);
    // הזיכוי לפי סעיף 46 — רק מתרומות של תושב ישראל (תרומה של תושב חוץ / בעילום שם מסומנת sec46 בקבלה,
    // אבל אינה מזכה), כל תרומה לפי הסוג שלה ולא לפי התרומה האחרונה. מספר האישור — מאותן קבלות, לא האישור שבתוקף היום
    const rows = N.donorYearDonations(npo.donations, donorKey, year)
      .filter(d => N.donorType(d) === 'israeli' && d.receipt && d.receipt.sec46);
    const sec46Total = rows.reduce((t, d) => t + Math.round(Number(d.amount || 0) * 100), 0) / 100;
    const sec46Approvals = rows.filter(d => d.receipt.sec46Number)
      .map(d => ({ number: d.receipt.sec46Number, validUntil: d.receipt.sec46ValidUntil || '' }));
    return { letter: L.thankYouLetter({ ...statement, sec46Total, sec46Approvals }, options || {}), org: npo.settings };
  }

  // תמיכות השנה עם הסטטוס — כדי שהמכתבים לא יציגו בקשה שנדחתה או ממתינה כתמיכה שהתקבלה
  _letterReport(npo, year) {
    const y = Number(year) || new Date().getFullYear();
    const report = N.annualReport(npo.donations, npo.grants, npo.settings, y);
    const grantItems = npo.grants.filter(g => Number(g.year) === y)
      .map(g => ({ source: g.source, status: g.status || 'requested', approved: g.approved, received: g.received }));
    return { ...report, grantItems };
  }

  async getAnnualNarrative(year, options) {
    const { npo } = await this._load();
    return { letter: L.annualNarrative(this._letterReport(npo, year), options || {}), org: npo.settings };
  }

  async getGrantDraft(year, input) {
    const { npo } = await this._load();
    return { letter: L.grantDraft(this._letterReport(npo, year), input || {}), org: npo.settings };
  }

  async getDonation(donationId) {
    const { npo } = await this._load();
    const d = npo.donations.find(x => x.id === donationId);
    if (!d) throw new Error('התרומה לא נמצאה');
    return d;
  }

  async addGrant(input) {
    const data = await this._load();
    if (data.npo.grants.length >= N.MAX_GRANTS) throw new Error('הגעת למספר המקסימלי של תמיכות');
    const clean = N.validateGrant(input);
    if (!N.allFunds(data.npo.settings).some(f => f.id === clean.fundId)) throw new Error('הקרן שנבחרה אינה קיימת');
    const grant = { id: crypto.randomUUID(), ...clean, createdAt: new Date().toISOString() };
    data.npo.grants.push(grant);
    await this.db.save(data);
    return grant;
  }

  async updateGrant(grantId, input) {
    const data = await this._load();
    const i = data.npo.grants.findIndex(g => g.id === grantId);
    if (i < 0) throw new Error('התמיכה לא נמצאה');
    const clean = N.validateGrant({ ...data.npo.grants[i], ...input }, data.npo.grants[i].documents);
    if (!N.allFunds(data.npo.settings).some(f => f.id === clean.fundId)) throw new Error('הקרן שנבחרה אינה קיימת');
    data.npo.grants[i] = { ...data.npo.grants[i], ...clean, updatedAt: new Date().toISOString() };
    await this.db.save(data);
    return data.npo.grants[i];
  }

  async toggleGrantDocument(grantId, index) {
    const data = await this._load();
    const g = data.npo.grants.find(x => x.id === grantId);
    if (!g) throw new Error('התמיכה לא נמצאה');
    const docs = Array.isArray(g.documents) ? g.documents : [];
    const i = Number(index);
    if (!Number.isInteger(i) || !docs[i]) throw new Error('המסמך לא נמצא');
    docs[i] = { ...docs[i], done: !docs[i].done };
    g.documents = docs;
    await this.db.save(data);
    return g;
  }

  // מעקב דיווח ל"תרומות ישראל": מספר רישום לתרומה, או אישור שביטול דווח
  async recordTaxReport(donationId, input = {}) {
    const data = await this._load();
    const i = data.npo.donations.findIndex(x => x.id === donationId);
    if (i < 0) throw new Error('התרומה לא נמצאה');
    data.npo.donations[i] = N.recordTaxReport(data.npo.donations[i], input);
    await this.db.save(data);
    return { ...data.npo.donations[i], taxStatus: N.taxStatus(data.npo.donations[i]) };
  }

  async deleteGrant(grantId) {
    const data = await this._load();
    const before = data.npo.grants.length;
    data.npo.grants = data.npo.grants.filter(g => g.id !== grantId);
    if (data.npo.grants.length === before) throw new Error('התמיכה לא נמצאה');
    await this.db.save(data);
    return true;
  }

  async getExportData(kind, year) {
    const { npo } = await this._load();
    return N.exportTable(kind, npo.donations, npo.grants, npo.settings, Number(year) || new Date().getFullYear());
  }
}

module.exports = { NpoService: new NpoService() };
