// נתוני דוגמה להפעלה ראשונה (PLAN.md 1.5) — רק בבחירת המשתמש, ומחיקה שנוגעת רק בהם.
// כל רשומה מסומנת sample: true. תרומות דוגמה מקבלות "קבלה חיצונית" בלי מספר: לא צורכות את
// מספור הקבלות, אין להן PDF ולא נכנסות לדיווח "תרומות ישראל". בלי מספרי זהות (גם לא מומצאים).
'use strict';
const N = require('./npo');
const G = require('./gemach');
const PR = require('./pricing');
const R = require('./realty');
const DP = require('./devProject');

const KINDS = {
  npo: { label: 'עמותה — 3 תורמים ותרומות', feature: 'econ.npo' },
  gemach: { label: 'גמ"ח — הלוואה עם ערב ותשלום ראשון', feature: 'econ.gemach' },
  business: { label: 'עסק — לקוח ומחירון קצר', feature: 'econ.accounting' },
  realty: { label: 'נדל"ן ותיווך — נכס, קונה ומוכר, עסקה ופרויקט יזמי', feature: 'econ.realestate' },
};
const SAMPLE_TAG = 'נתוני דוגמה';

function addDays(ymd, days) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(ymd, months) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// התחומים שאפשר להכניס להם דוגמה: בלי רישוי — כולם; ברישוי — רק תחום שנפתח
function availableKinds(license) {
  if (!license || license.mode === 'unlicensed') return Object.keys(KINDS);
  const have = new Set(license.features || []);
  return Object.keys(KINDS).filter(k => have.has(KINDS[k].feature));
}

function contactsList(data) {
  const c = data.contacts;
  if (Array.isArray(c)) return c;
  if (c && typeof c === 'object' && Array.isArray(c.contacts)) return c.contacts;
  return [];
}

function counts(data) {
  const npo = (data.npo && Array.isArray(data.npo.donations)) ? data.npo.donations : [];
  const loans = (data.gemach && Array.isArray(data.gemach.loans)) ? data.gemach.loans : [];
  const out = {
    npo: npo.filter(d => d && d.sample === true).length,
    gemach: loans.filter(l => l && l.sample === true).length,
    business: (Array.isArray(data.products) ? data.products : []).filter(p => p && p.sample === true).length +
      contactsList(data).filter(c => c && c.sample === true).length,
  };
  const r = data.realty && typeof data.realty === 'object' ? data.realty : {};
  out.realty = ['properties', 'clients', 'deals', 'projects'].reduce((n, k) => n + (Array.isArray(r[k]) ? r[k].filter(x => x && x.sample === true).length : 0), 0);
  out.total = out.npo + out.gemach + out.business + out.realty;
  return out;
}

function buildNpo(settings, today, uuid) {
  const s = N.normalizeSettings(settings);
  const rows = [
    { donorName: 'משה כהן', amount: 360, method: 'transfer', days: -20, purpose: 'תרומה כללית' },
    { donorName: 'יעקב לוי', amount: 180, method: 'cash', days: -12, purpose: 'חלוקת מזון לחג' },
    { donorName: 'שמואל פרידמן', amount: 1000, method: 'check', days: -5, purpose: 'החזקת בית המדרש' },
    { donorName: 'משה כהן', amount: 360, method: 'transfer', days: -1, purpose: 'תרומה כללית' },
  ];
  return rows.map((r, i) => {
    const clean = N.validateDonation({ ...r, date: addDays(today, r.days) }, s, i);
    const receipt = {
      number: null, external: true, source: 'sample', externalNumber: '',
      sec46: false, sec46Number: '', sec46ValidUntil: '',
      org: { name: s.orgName || 'עמותת חסד לדוגמה', regNumber: '', address: '', phone: '', vatStatus: s.vatStatus, vatNumber: '' },
      fundName: N.GENERAL_FUND.name,
    };
    return { id: uuid(), ...clean, receipt, status: 'active', sample: true, createdAt: new Date().toISOString() };
  });
}

function buildGemach(today, uuid) {
  const issueDate = addMonths(today, -2);
  const clean = G.validateLoanInput({
    borrowerName: 'אהרן ויס', amount: 6000, installments: 12, issueDate,
    guarantors: [{ name: 'דוד ברגר', id: '', phone: '' }],
    purpose: 'הוצאות חתונה', notes: SAMPLE_TAG,
  }, 0);
  let loan = { id: uuid(), ...clean, schedule: G.buildSchedule(clean.amount, clean.installments, clean.issueDate), status: 'active', sample: true, createdAt: new Date().toISOString() };
  const first = loan.schedule[0];
  if (first && first.dueDate <= today) loan = G.recordPayment(loan, first.seq, { date: first.dueDate });
  return [loan];
}

function buildBusiness(uuid) {
  const products = [
    { name: 'כריכת ספר', kind: 'service', cost: 40, markupPct: 50 },
    { name: 'סידור תפילה מהודר', kind: 'goods', cost: 55, markupPct: 40 },
    { name: 'הדפסת הזמנות (100 יח\')', kind: 'service', cost: 120, markupPct: 35 },
  ].map(p => ({ id: uuid(), ...PR.validateProduct(p), sample: true, createdAt: new Date().toISOString() }));
  const contact = { id: uuid(), name: 'ישיבת אור התורה', phone: '', email: '', company: '', category: 'client', notes: SAMPLE_TAG, sample: true, createdAt: new Date().toISOString() };
  return { products, contact };
}

// נדל"ן: מוכר ודירה למכירה, קונה שמחפש דירה כזו, עסקה במשא ומתן ופרויקט יזמי קטן. בלי ת"ז
function buildRealty(today, uuid) {
  const now = new Date().toISOString();
  const rec = (x) => ({ id: uuid(), ...x, sample: true, createdAt: now, updatedAt: now });
  const seller = rec(R.validateClient({ name: 'שלמה רוזנברג', role: 'seller', notes: SAMPLE_TAG }));
  const buyer = rec(R.validateClient({ name: 'מנחם גולדשטיין', role: 'buyer', areas: 'בני ברק', minRooms: 4, budgetMax: 2600000, needsMortgage: 'yes', notes: SAMPLE_TAG }));
  const property = rec(R.validateProperty({ city: 'בני ברק', street: 'רחוב רבי עקיבא', type: 'apartment', rooms: 4, areaSqm: 95, floor: 2, asking: 2500000, ownerClientId: seller.id, notes: SAMPLE_TAG }));
  const deal = rec(R.withDealStage({}, R.validateDeal({ propertyId: property.id, buyerClientId: buyer.id, stage: 'negotiation', price: 2450000, signDate: addDays(today, 10), dependsOnMortgage: 'yes', notes: SAMPLE_TAG },
    {}, { properties: [property], clients: [seller, buyer] }), null, now));
  property.status = 'negotiation';
  const project = rec(DP.projectRecord({
    name: 'בניין מגורים — דוגמה', startMonth: today.slice(0, 7), months: 24, deficitRate: 6, equity: 3000000, planText: ['20, 0', '40, 4', '40, 9'].join('\n'), notes: SAMPLE_TAG,
    costs: [{ category: 'land', amount: 6000000, from: 1, spread: 1 }, { category: 'permits', amount: 400000, from: 2, spread: 4 }, { category: 'build', amount: 7200000, from: 5, spread: 18 }, { category: 'marketing', amount: 300000, from: 6, spread: 12 }],
    sales: [{ label: 'דירת 4 חדרים', units: 6, price: 2300000, month: 8 }, { label: 'דירת 5 חדרים', units: 2, price: 2900000, month: 14 }]
  }));
  return { clients: [seller, buyer], properties: [property], deals: [deal], projects: [project] };
}

// מוסיף את הדוגמה לנתונים (משנה את data). kinds — מה שהמשתמש בחר, אחרי סינון לפי הרישיון
function apply(data, kinds, { today, uuid, allowed }) {
  const want = [...new Set(Array.isArray(kinds) ? kinds : [])].filter(k => KINDS[k] && (!allowed || allowed.includes(k)));
  if (!want.length) throw new Error('לא נבחר תחום לנתוני הדוגמה');
  const now = counts(data);
  const added = {};
  for (const k of want) {
    if (now[k]) continue; // כבר יש דוגמה בתחום הזה — לא מכפילים
    if (k === 'npo') {
      data.npo = data.npo && typeof data.npo === 'object' ? data.npo : {};
      const list = Array.isArray(data.npo.donations) ? data.npo.donations : [];
      const rows = buildNpo(data.npo.settings, today, uuid);
      data.npo.donations = [...list, ...rows];
      added.npo = rows.length;
    } else if (k === 'gemach') {
      data.gemach = data.gemach && typeof data.gemach === 'object' ? data.gemach : {};
      const list = Array.isArray(data.gemach.loans) ? data.gemach.loans : [];
      const rows = buildGemach(today, uuid);
      data.gemach.loans = [...list, ...rows];
      added.gemach = rows.length;
    } else if (k === 'business') {
      const { products, contact } = buildBusiness(uuid);
      data.products = [...(Array.isArray(data.products) ? data.products : []), ...products];
      data.contacts = [...contactsList(data), contact];
      added.business = products.length + 1;
    } else if (k === 'realty') {
      data.realty = data.realty && typeof data.realty === 'object' ? data.realty : {};
      const rows = buildRealty(today, uuid);
      for (const [key, list] of Object.entries(rows)) data.realty[key] = [...(Array.isArray(data.realty[key]) ? data.realty[key] : []), ...list];
      added.realty = Object.values(rows).reduce((n, l) => n + l.length, 0);
    }
  }
  return added;
}

// מזהים של רשומות דוגמה שרשומה אמיתית מפנה אליהן — הן נשארות (סקירת קוד 2.11.2026):
// עסקה / הזמנת תיווך / נכס / ניתוח / תיק משכנתא אמיתיים שמפנים לנכס, ללקוח או לעסקה של הדוגמה,
// ודרישת תשלום, אצוות מס"ב או בקשת הלוואה שמפנות להלוואה או לתרומה של הדוגמה.
// רשומת דוגמה שנשארת מחזיקה גם את רשומות הדוגמה שהיא מפנה אליהן
const arr = (v) => (Array.isArray(v) ? v : []);
const isSample = (x) => !!(x && x.sample === true);
function referencedSamples(data) {
  const keep = new Set();
  const r = data.realty && typeof data.realty === 'object' ? data.realty : {};
  const realtyRefs = (x, kind) => {
    if (!x) return [];
    if (kind === 'deals') return [x.propertyId, x.buyerClientId, x.sellerClientId];
    if (kind === 'orders') return [x.clientId, x.propertyId];
    if (kind === 'properties') return [x.ownerClientId];
    if (kind === 'analyses') return [x.propertyId];
    return [];
  };
  const add = (id) => { if (id) keep.add(String(id)); };
  for (const kind of ['deals', 'orders', 'properties', 'analyses']) {
    for (const x of arr(r[kind])) if (!isSample(x)) realtyRefs(x, kind).forEach(add);
  }
  for (const c of arr(data.mortgageAdvisor && data.mortgageAdvisor.clients)) if (!isSample(c)) add(c.realtyDealId);
  for (const p of arr(data.payments)) if (p && p.target) add(p.target.id);
  for (const a of arr(data.gemach && data.gemach.applications)) if (!isSample(a)) add(a.loanId);
  for (const b of arr(data.gemach && data.gemach.masav && data.gemach.masav.batches)) for (const it of arr(b && b.items)) add(String((it && it.key) || '').split('|')[0]);
  for (const o of arr(data.npo && data.npo.standingOrders)) for (const h of arr(o && o.history)) add(h && h.donationId);
  // סגירה: רשומת דוגמה שנשארת — גם מה שהיא מפנה אליו
  for (let changed = true; changed;) {
    changed = false;
    for (const kind of ['deals', 'orders', 'properties']) {
      for (const x of arr(r[kind])) {
        if (!isSample(x) || !keep.has(String(x.id))) continue;
        for (const id of realtyRefs(x, kind)) if (id && !keep.has(String(id))) { keep.add(String(id)); changed = true; }
      }
    }
  }
  return keep;
}

// מוחק רק רשומות עם sample === true שאין אליהן הפניה. שום רשומה אחרת לא נוגעת.
// מחזיר את מספר הרשומות שנמחקו; out.kept — רשומות דוגמה שנשארו בגלל הפניה
function remove(data, out = {}) {
  const before = counts(data);
  const keep = referencedSamples(data);
  const drop = (x) => isSample(x) && !keep.has(String(x.id));
  if (data.npo && Array.isArray(data.npo.donations)) data.npo.donations = data.npo.donations.filter(d => !drop(d));
  if (data.gemach && Array.isArray(data.gemach.loans)) data.gemach.loans = data.gemach.loans.filter(l => !drop(l));
  if (Array.isArray(data.products)) data.products = data.products.filter(p => !drop(p));
  if (contactsList(data).some(drop)) data.contacts = contactsList(data).filter(c => !drop(c));
  if (data.realty && typeof data.realty === 'object') {
    for (const key of ['properties', 'clients', 'deals', 'projects']) if (Array.isArray(data.realty[key])) data.realty[key] = data.realty[key].filter(x => !drop(x));
  }
  const after = counts(data);
  out.kept = after.total;
  return before.total - after.total;
}

module.exports = { KINDS, SAMPLE_TAG, availableKinds, counts, apply, remove };
