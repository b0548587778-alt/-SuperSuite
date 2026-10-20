// שמאות מקרקעין — תיקי שומה, עסקאות השוואה ופרטי השמאי. נשמר באוסף realEstate במסד המרכזי (מוצפן ונכלל בגיבוי).
// כל החישובים ב-core/realEstateAppraisal.js. הממשק שולח קלט גולמי; השירות מאמת, מחשב ושומר.
const crypto = require('crypto');
const R = require('../core/realEstateAppraisal');

// תאריך מקומי (לא toISOString — בישראל הוא מזיז את היום בין חצות ל-03:00)
function localDay(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

class RealEstateService {
  constructor(db) { this.db = db; this.today = () => localDay(); }

  async initialize(db) { if (db) this.db = db; }

  async _load() {
    const data = await this.db.load();
    const re = data.realEstate && typeof data.realEstate === 'object' ? data.realEstate : {};
    const ph = data.realEstatePhotos && typeof data.realEstatePhotos === 'object' ? data.realEstatePhotos : {};
    data.realEstatePhotos = { photos: Array.isArray(ph.photos) ? ph.photos : [] };
    data.realEstate = {
      cases: Array.isArray(re.cases) ? re.cases : [],
      seq: Number.isSafeInteger(re.seq) && re.seq > 0 ? re.seq : 0,
      settings: R.validateSettings(re.settings || {}),
    };
    return data;
  }

  _find(data, id) {
    const c = data.realEstate.cases.find(x => x.id === id);
    if (!c) throw new Error('התיק לא נמצא');
    return c;
  }

  _summary(c) {
    let valueAg = null, warnings = 0;
    try {
      const r = c.status === 'final' && c.frozen ? c.frozen : R.computeCase(c);
      valueAg = r.final.valueAg;
      warnings = r.warnings.length;
    } catch { /* תיק שנשמר בגרסה ישנה — מוצג בלי שווי */ }
    return {
      id: c.id, no: c.no, rev: c.rev || 0, reportNo: R.reportNo(c), status: c.status,
      client: c.client.name, address: [c.property.address, c.property.city].filter(Boolean).join(', '),
      block: c.property.block, parcel: c.property.parcel, purpose: R.PURPOSES[c.purpose],
      effectiveDate: c.effectiveDate, updatedAt: c.updatedAt || c.createdAt, comps: c.comparables.length, valueAg, warnings,
    };
  }

  async getOverview() {
    const data = await this._load();
    return {
      cases: data.realEstate.cases.map(c => this._summary(c)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      settings: data.realEstate.settings,
      lists: { purposes: R.PURPOSES, types: R.PROPERTY_TYPES, rights: R.RIGHTS, conditions: R.CONDITIONS, factors: R.ADJ_FACTORS, approaches: R.APPROACHES },
    };
  }

  // יומן שומות — כל התיקים לקובץ CSV (ההגנה מנוסחאות ב-Excel — ב-toCsv)
  async getRegisterExport() {
    const data = await this._load();
    return R.registerExport(data.realEstate.cases.map(c => this._summary(c)), this.today());
  }

  // תיק מלא עם החישוב (או העותק הנעול)
  async getCase(id) {
    const data = await this._load();
    const c = this._find(data, id);
    let result = c.status === 'final' && c.frozen ? c.frozen : R.computeCase(c);
    // תיק שננעל לפני שלב 4 — בלי רגישות בעותק הנעול; מחושבת מהעותק עצמו
    if (!result.sensitivity) result = { ...result, sensitivity: R.sensitivity(c, result) };
    return { case: c, result, problems: c.status === 'final' ? [] : R.finalizeProblems(c, this.today()), photos: this._photosOf(data, id) };
  }

  async createCase(input = {}) {
    const data = await this._load();
    if (data.realEstate.cases.length >= R.MAX_CASES) throw new Error('הגעת למספר המקסימלי של תיקי שומה');
    const today = this.today();
    const v = R.validateCase(input, today);
    data.realEstate.seq += 1;
    const c = { id: crypto.randomUUID(), no: data.realEstate.seq, rev: 0, status: 'draft', history: [], createdAt: new Date().toISOString(), ...v,
      comparables: v.comparables.map(x => ({ ...x, id: x.id || crypto.randomUUID() })) };
    data.realEstate.cases.push(c);
    await this.db.save(data);
    return c;
  }

  // עדכון טיוטה: הקלט כולו עובר אימות מחדש. תיק נעול — רק דרך גרסה מתוקנת
  async updateCase(id, input = {}) {
    const data = await this._load();
    const cur = this._find(data, id);
    if (cur.status === 'final') throw new Error('התיק נעול. לשינוי — יש לפתוח גרסה מתוקנת');
    const v = R.validateCase({ ...cur, ...input }, this.today());
    Object.assign(cur, v, { comparables: v.comparables.map(x => ({ ...x, id: x.id || crypto.randomUUID() })), updatedAt: new Date().toISOString() });
    await this.db.save(data);
    return this.getCase(id);
  }

  async deleteCase(id) {
    const data = await this._load();
    const before = data.realEstate.cases.length;
    data.realEstate.cases = data.realEstate.cases.filter(c => c.id !== id);
    if (data.realEstate.cases.length === before) throw new Error('התיק לא נמצא');
    data.realEstatePhotos.photos = data.realEstatePhotos.photos.filter(p => p.caseId !== id);
    await this.db.save(data);
    return { ok: true };
  }

  // הוספת עסקאות מקובץ: מחזיר תצוגה מקדימה, ושומר רק עם apply: true
  async importComparables(id, text, { source = '', apply = false } = {}) {
    const data = await this._load();
    const c = this._find(data, id);
    if (c.status === 'final') throw new Error('התיק נעול. לשינוי — יש לפתוח גרסה מתוקנת');
    const parsed = R.parseComparablesCsv(text, { source });
    const room = R.MAX_COMPS - c.comparables.length;
    if (room <= 0) throw new Error(`בתיק כבר יש ${R.MAX_COMPS} עסקאות`);
    // כפילות: אותו תאריך, מחיר ושטח (וגוש/חלקה כשיש)
    const key = (x) => [x.date, x.priceAg, x.area, x.block, x.parcel, x.subParcel].join('|');
    const have = new Set(c.comparables.map(key));
    const fresh = parsed.rows.filter(x => !have.has(key(x)));
    const take = fresh.slice(0, room);
    const out = { found: parsed.rows.length, duplicates: parsed.rows.length - fresh.length, added: take.length,
      skipped: fresh.length - take.length, errors: parsed.errors.slice(0, 50), preview: take.slice(0, 20) };
    if (!apply) return out;
    c.comparables.push(...take.map(x => ({ ...x, id: crypto.randomUUID(), included: true })));
    c.updatedAt = new Date().toISOString();
    await this.db.save(data);
    return out;
  }

  async finalizeCase(id) {
    const data = await this._load();
    const i = data.realEstate.cases.findIndex(c => c.id === id);
    if (i < 0) throw new Error('התיק לא נמצא');
    if (data.realEstate.cases[i].status === 'final') throw new Error('התיק כבר נעול');
    data.realEstate.cases[i] = R.finalizeCase(data.realEstate.cases[i], this.today());
    await this.db.save(data);
    return this._summary(data.realEstate.cases[i]);
  }

  async reopenCase(id) {
    const data = await this._load();
    const i = data.realEstate.cases.findIndex(c => c.id === id);
    if (i < 0) throw new Error('התיק לא נמצא');
    data.realEstate.cases[i] = { ...R.reopenCase(data.realEstate.cases[i]), updatedAt: new Date().toISOString() };
    await this.db.save(data);
    return this._summary(data.realEstate.cases[i]);
  }

  _photosOf(data, caseId) {
    return data.realEstatePhotos.photos.filter(p => p.caseId === caseId).map(({ id, data: d, caption, addedAt }) => ({ id, data: d, caption, addedAt }));
  }

  // צילום לתיק: רק בטיוטה (בתיק נעול הדוח חייב להישאר זהה), עם תקרה לתיק ולסך הכול
  async addPhoto(caseId, input = {}) {
    const data = await this._load();
    const c = this._find(data, caseId);
    if (c.status === 'final') throw new Error('התיק נעול. לשינוי — יש לפתוח גרסה מתוקנת');
    const p = R.validatePhoto(input);
    const all = data.realEstatePhotos.photos;
    if (all.filter(x => x.caseId === caseId).length >= R.PHOTOS_PER_CASE) throw new Error(`עד ${R.PHOTOS_PER_CASE} צילומים בתיק`);
    const total = all.reduce((s, x) => s + String(x.data || '').length, 0);
    if (total + p.data.length > R.PHOTOS_TOTAL_CHARS) throw new Error('נגמר המקום לצילומים בכל התיקים יחד — יש למחוק צילומים מתיקים ישנים');
    const photo = { id: crypto.randomUUID(), caseId, ...p, addedAt: new Date().toISOString() };
    all.push(photo);
    await this.db.save(data);
    return { id: photo.id, caption: photo.caption };
  }

  async deletePhoto(caseId, photoId) {
    const data = await this._load();
    const c = this._find(data, caseId);
    if (c.status === 'final') throw new Error('התיק נעול. לשינוי — יש לפתוח גרסה מתוקנת');
    const before = data.realEstatePhotos.photos.length;
    data.realEstatePhotos.photos = data.realEstatePhotos.photos.filter(p => !(p.caseId === caseId && p.id === photoId));
    if (data.realEstatePhotos.photos.length === before) throw new Error('הצילום לא נמצא');
    await this.db.save(data);
    return { ok: true };
  }

  async saveSettings(input = {}) {
    const data = await this._load();
    data.realEstate.settings = R.validateSettings(input);
    await this.db.save(data);
    return data.realEstate.settings;
  }

  // HTML של הדוח (טיוטה או סופי) — לתצוגה ולהמרה ל-PDF
  async getReportHtml(id) {
    const data = await this._load();
    const c = this._find(data, id);
    return { html: R.renderReportHtml(c, data.realEstate.settings, this.today(), this._photosOf(data, id)), name: `שומה-${R.reportNo(c)}`, final: c.status === 'final' };
  }
}

module.exports = { RealEstateService: new RealEstateService(), RealEstateServiceClass: RealEstateService, localDay };
