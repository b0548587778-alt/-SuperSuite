// מאגר אנשים מאוחד — תצוגה בלבד: מצרף רשומות קיימות מעמותה, הוראות קבע, הנצחות, גמ"ח וחסד לכרטיס אחד לכל אדם.
// אין כאן אוסף חדש ואין עריכה: כל רשומה נשארת במודול שלה, והכרטיס נבנה מחדש בכל קריאה.
// שיוך שמרני: לפי ת.ז. רשומה בלי ת.ז משויכת לפי שם רק אם יש בדיוק אדם אחד עם ת.ז באותו שם;
// אחרת היא מקבלת כרטיס משלה, מסומן "לפי שם בלבד". נזקק חסוי מוצג רק למי שמורשה לראות חסויים.
const { normalizeId } = require('./israeliId');
const G = require('./gemach');

const ROLES = {
  donor: 'תורם', standing: 'הוראת קבע', memorial: 'קרוב משפחה (הנצחה)', borrower: 'לווה בגמ"ח',
  guarantor: 'ערב בגמ"ח', depositor: 'מפקיד בגמ"ח', itemBorrower: 'שואל חפץ בגמ"ח', beneficiary: 'נתמך', volunteer: 'מתנדב'
};
const MAX_RESULTS = 200;

const normName = (s) => String(s ?? '').replace(/["'׳״]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
// גם מספר עם ספרת ביקורת שגויה (נתונים ישנים) משמש לשיוך — הוא עדיין מזהה את אותו אדם בעקביות
const idKey = (raw) => {
  const n = normalizeId(String(raw ?? '').replace(/\D/g, ''));
  return n && !/^0+$/.test(n) ? n : '';
};
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const toAg = (n) => Math.round(Number(n || 0) * 100);

// כל ה"הופעות" של אנשים בנתונים, בצורה אחידה
function collect(data, { canSeeConfidential = false, today } = {}) {
  const out = [];
  const add = (role, name, id, phone, ref) => { if (normName(name)) out.push({ role, name: String(name).replace(/\s+/g, ' ').trim(), id: idKey(id), phone: String(phone || '').trim(), ref }); };
  const npo = data.npo || {};
  for (const d of npo.donations || []) {
    add('donor', d.donorName, d.donorId, d.donorPhone, { kind: 'donation', id: d.id, date: d.date, amount: d.amount, cancelled: d.status === 'cancelled', receipt: d.receipt && (Number.isInteger(d.receipt.number) ? d.receipt.number : d.receipt.externalNumber || 'חיצונית') });
  }
  for (const o of npo.standingOrders || []) add('standing', o.donorName, o.donorId, o.donorPhone, { kind: 'standing', id: o.id, amount: o.amount, startMonth: o.startMonth, endMonth: o.endMonth || '' });
  for (const m of npo.memorials || []) add('memorial', m.contactName, m.contactId, m.contactPhone, { kind: 'memorial', id: m.id, deceased: m.name });
  const gm = data.gemach || {};
  const asOf = today || new Date().toISOString().slice(0, 10);
  for (const l of gm.loans || []) {
    const s = G.loanSummary(l, asOf);
    const ref = { kind: 'loan', id: l.id, borrower: l.borrowerName, amount: l.amount, status: s.statusLabel, active: l.status === 'active', outstanding: s.outstanding, lateCount: s.lateCount, issueDate: l.issueDate };
    add('borrower', l.borrowerName, l.borrowerId, l.borrowerPhone, ref);
    for (const g of l.guarantors || []) add('guarantor', g.name, g.id, g.phone, ref);
  }
  const itemName = Object.fromEntries((gm.items || []).map(it => [it.id, it.name]));
  for (const l of gm.lendings || []) add('itemBorrower', l.borrowerName, l.borrowerId, l.borrowerPhone, { kind: 'lending', id: l.id, item: itemName[l.itemId] || 'פריט', date: l.date, dueDate: l.dueDate || '', returned: !!l.returnedAt, overdue: !l.returnedAt && !!l.dueDate && l.dueDate < asOf });
  for (const d of gm.deposits || []) add('depositor', d.depositorName, '', '', { kind: 'deposit', id: d.id, date: d.date, amount: d.amount });
  const ch = data.chesed || {};
  for (const b of ch.beneficiaries || []) {
    if (b.tier === 'confidential' && !canSeeConfidential) continue;
    add('beneficiary', b.headName || b.familyName, b.idNumber, b.phone, { kind: 'beneficiary', id: b.id, family: b.familyName, active: b.active !== false, confidential: b.tier === 'confidential' });
  }
  for (const v of ch.volunteers || []) add('volunteer', v.name, '', v.phone, { kind: 'volunteer', id: v.id, area: v.area || '', active: v.active !== false });
  return out;
}

function group(hits) {
  const people = new Map();
  const byNameWithId = new Map(); // שם → קבוצת מפתחות ת.ז
  for (const h of hits) if (h.id) {
    const k = 'id:' + h.id;
    if (!people.has(k)) people.set(k, { key: k, idNumber: h.id, names: new Set(), phones: new Set(), hits: [], nameOnly: false });
    const p = people.get(k);
    p.names.add(h.name); if (h.phone) p.phones.add(h.phone); p.hits.push(h);
    const n = normName(h.name);
    if (!byNameWithId.has(n)) byNameWithId.set(n, new Set());
    byNameWithId.get(n).add(k);
  }
  for (const h of hits) if (!h.id) {
    const n = normName(h.name);
    const ids = byNameWithId.get(n);
    let k;
    if (ids && ids.size === 1) { k = [...ids][0]; h.byName = true; }
    else {
      k = 'name:' + n;
      if (!people.has(k)) people.set(k, { key: k, idNumber: '', names: new Set(), phones: new Set(), hits: [], nameOnly: true, ambiguous: !!(ids && ids.size > 1) });
    }
    const p = people.get(k);
    p.names.add(h.name); if (h.phone) p.phones.add(h.phone); p.hits.push(h);
  }
  return [...people.values()];
}

function summarize(p) {
  const roles = [...new Set(p.hits.map(h => h.role))];
  const donations = p.hits.filter(h => h.role === 'donor' && !h.ref.cancelled);
  const loans = p.hits.filter(h => h.role === 'borrower' && h.ref.active);
  const guarantees = p.hits.filter(h => h.role === 'guarantor' && h.ref.active);
  const name = [...p.names].sort((a, b) => b.length - a.length)[0];
  return {
    key: p.key, name, otherNames: [...p.names].filter(n => n !== name), idNumber: p.idNumber, phones: [...p.phones],
    nameOnly: p.nameOnly, ambiguous: !!p.ambiguous, roles, roleLabels: roles.map(r => ROLES[r]),
    donationsTotal: donations.reduce((t, h) => t + toAg(h.ref.amount), 0) / 100,
    donationsCount: donations.length,
    lastDonation: donations.map(h => h.ref.date).sort().pop() || '',
    activeLoansOutstanding: loans.reduce((t, h) => t + toAg(h.ref.outstanding), 0) / 100,
    activeGuarantees: guarantees.length,
    late: loans.some(h => h.ref.lateCount > 0) || guarantees.some(h => h.ref.lateCount > 0),
    itemsOut: p.hits.filter(h => h.role === 'itemBorrower' && !h.ref.returned).length
  };
}

function search(data, query, opts = {}) {
  const q = normName(query);
  const qd = digits(query);
  const all = group(collect(data, opts)).map(p => ({ p, s: summarize(p) }));
  const match = ({ p, s }) => !q
    || [...p.names].some(n => normName(n).includes(q))
    || (qd.length >= 3 && (s.idNumber.includes(qd) || s.phones.some(ph => digits(ph).includes(qd))));
  const rows = all.filter(match).map(x => x.s)
    .sort((a, b) => b.roles.length - a.roles.length || a.name.localeCompare(b.name, 'he'));
  return { total: rows.length, rows: rows.slice(0, MAX_RESULTS), truncated: rows.length > MAX_RESULTS, roles: ROLES };
}

function card(data, key, opts = {}) {
  const p = group(collect(data, opts)).find(x => x.key === String(key || ''));
  if (!p) throw new Error('האדם לא נמצא');
  const by = (role) => p.hits.filter(h => h.role === role).map(h => ({ ...h.ref, byName: !!h.byName }));
  return {
    ...summarize(p),
    donations: by('donor').sort((a, b) => b.date.localeCompare(a.date)),
    standing: by('standing'), memorials: by('memorial'),
    loans: by('borrower'), guarantees: by('guarantor'), deposits: by('depositor').sort((a, b) => b.date.localeCompare(a.date)),
    lendings: by('itemBorrower').sort((a, b) => b.date.localeCompare(a.date)),
    beneficiary: by('beneficiary'), volunteer: by('volunteer')
  };
}

module.exports = { ROLES, MAX_RESULTS, collect, group, search, card, normName };
