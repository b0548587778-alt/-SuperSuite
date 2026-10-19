// נתוני דוגמה להפעלה ראשונה (PLAN.md 1.5) — רק בבחירת המשתמש, ומחיקה שנוגעת רק בהם.
// כל רשומה מסומנת sample: true. תרומות דוגמה מקבלות "קבלה חיצונית" בלי מספר: לא צורכות את
// מספור הקבלות, אין להן PDF ולא נכנסות לדיווח "תרומות ישראל". בלי מספרי זהות (גם לא מומצאים).
'use strict';
const N = require('./npo');
const G = require('./gemach');
const PR = require('./pricing');

const KINDS = {
  npo: { label: 'עמותה — 3 תורמים ותרומות', feature: 'econ.npo' },
  gemach: { label: 'גמ"ח — הלוואה עם ערב ותשלום ראשון', feature: 'econ.gemach' },
  business: { label: 'עסק — לקוח ומחירון קצר', feature: 'econ.accounting' },
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
  out.total = out.npo + out.gemach + out.business;
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
    }
  }
  return added;
}

// מוחק רק רשומות עם sample === true. שום רשומה אחרת לא נוגעת
function remove(data) {
  const before = counts(data);
  if (data.npo && Array.isArray(data.npo.donations)) data.npo.donations = data.npo.donations.filter(d => !(d && d.sample === true));
  if (data.gemach && Array.isArray(data.gemach.loans)) data.gemach.loans = data.gemach.loans.filter(l => !(l && l.sample === true));
  if (Array.isArray(data.products)) data.products = data.products.filter(p => !(p && p.sample === true));
  if (contactsList(data).some(c => c && c.sample === true)) data.contacts = contactsList(data).filter(c => !(c && c.sample === true));
  return before.total;
}

module.exports = { KINDS, SAMPLE_TAG, availableKinds, counts, apply, remove };
