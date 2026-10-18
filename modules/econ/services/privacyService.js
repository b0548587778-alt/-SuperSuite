// Privacy Service — מיפוי מאגרים ומזעור נזקקים לא פעילים (למנהל בלבד). המזעור רץ רק על רשימה שאושרה,
// ונבדק מחדש בשרת: מזהה שאינו עומד בתנאי התקופה ברגע הביצוע — לא ימוזער.
const crypto = require('crypto');
const PR = require('../core/privacy');
const PD = require('../core/privacyDocs');

// תאריך מקומי (לא UTC — בישראל toISOString מזיז את היום בין חצות ל-03:00)
const localDay = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

class PrivacyService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  async getMap(users) {
    const data = await this.db.load();
    const counts = {};
    for (const u of users || []) if (u.active !== false) counts[u.role] = (counts[u.role] || 0) + 1;
    const map = PR.dataMap(data, counts);
    const today = localDay();
    const requests = ((data.privacy && data.privacy.requests) || []).map(r => PR.requestView(r, today))
      .sort((a, b) => (b.status === 'open') - (a.status === 'open') || b.receivedDate.localeCompare(a.receivedDate));
    return {
      ...map, checklist: PR.INCIDENT_CHECKLIST, level: PR.suggestLevel(map), requests,
      requestTypes: PR.REQUEST_TYPES, retentionKinds: PR.RETENTION_KINDS, noticeKinds: Object.fromEntries(Object.entries(PD.NOTICE_KINDS).map(([k, v]) => [k, v.label]))
    };
  }

  // פרטי בעל המאגר למסמכים: העמותה, ואם אין — העסק
  _org(data) {
    const n = (data.npo && data.npo.settings) || {};
    const b = (data.settings && data.settings.business) || {};
    return n.orgName ? { name: n.orgName, id: n.regNumber || '', address: n.address || '' } : { name: b.name || '', id: b.taxId || '', address: b.address || '' };
  }

  async _docContext(users) {
    const data = await this.db.load();
    const map = (await this.getMap(users));
    return { data, map, level: map.level, org: this._org(data), today: localDay() };
  }

  async definitionHtml(users) {
    const c = await this._docContext(users);
    return PD.renderDefinitionHtml(c.map, c.level, c.org, c.today);
  }

  async procedureHtml(users) {
    const c = await this._docContext(users);
    return PD.renderProcedureHtml(c.map, c.level, c.org, c.today);
  }

  async noticeHtml(kind) {
    const data = await this.db.load();
    return PD.renderNoticeHtml(String(kind || ''), this._org(data), localDay());
  }

  // זכות עיון: כל המידע לפי ת"ז, רק מהתחומים הפתוחים ברישיון
  async subject(idNumber, opts) {
    const data = await this.db.load();
    const today = localDay();
    const report = PD.subjectReport(data, idNumber, { ...opts, today });
    return { report, html: PD.renderSubjectHtml(report, this._org(data), today) };
  }

  async addRequest(input) {
    const data = await this.db.load();
    const list = data.privacy.requests;
    const req = { id: crypto.randomUUID(), ...PR.validateRequest(input, list.length), createdAt: new Date().toISOString() };
    list.push(req);
    await this.db.save(data);
    return PR.requestView(req, localDay());
  }

  async closeRequest(requestId, input) {
    const data = await this.db.load();
    const i = data.privacy.requests.findIndex(r => r.id === requestId);
    if (i < 0) throw new Error('הבקשה לא נמצאה');
    data.privacy.requests[i] = { ...PR.closeRequest(data.privacy.requests[i], input), updatedAt: new Date().toISOString() };
    await this.db.save(data);
    return PR.requestView(data.privacy.requests[i], localDay());
  }

  // kind: beneficiaries (ברירת מחדל) / donors / borrowers / mortgageClients — PR.RETENTION_KINDS
  async retentionPreview(years, today, kind) {
    const data = await this.db.load();
    const t = today || localDay();
    const k = PR.RETENTION_KINDS[kind || 'beneficiaries'] ? kind || 'beneficiaries' : null;
    if (!k) throw new Error('סוג רשומות לא מוכר');
    return { kind: k, cutoff: PR.retentionCutoff(t, years), rows: PR.candidatesFor(data, k, t, years), removes: PR.RETENTION_KINDS[k].removes };
  }

  async minimize(ids, years, today, kind) {
    const data = await this.db.load();
    const t = today || localDay();
    const r = PR.applyRetention(data, kind || 'beneficiaries', ids, t, years, new Date().toISOString());
    if (r.minimized) await this.db.save(data);
    return r;
  }
}

module.exports = { PrivacyService: new PrivacyService() };
