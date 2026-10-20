// נדל"ן ותיווך: נכסים, לקוחות (קונים, מוכרים, שוכרים, משכירים), התאמה בין דרישות לנכסים, ועסקאות לפי שלבים.
// פונקציות טהורות. סכומים נשמרים בשלמי אגורות (*Ag); *View מחזיר שקלים לתצוגה.
// מטרת התחום — עבודה של משרד תיווך / יזם. אין כאן פסיקה משפטית: "מה חסר" בעסקה הוא רשימת עבודה בלבד.
// פרטיות (תיקון 13): ת"ז וטלפון של לקוחות — שדות רשות, נכנסים לזכות עיון ולמזעור (core/privacy.js).
const ID = require('./israeliId');

const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;
const isAg = (v) => Number.isSafeInteger(v) && v >= 0;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const str = (v, max, label) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`${label} ארוך מדי (עד ${max} תווים)`);
  return s;
};
// סכום בשקלים מהטופס ← אגורות. ריק ← 0
function money(v, label, { required = false, max = 1e10 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new Error(`${label} חובה`);
    return 0;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${label} אינו תקין`);
  return toAg(n);
}
function num(v, label, { min = 0, max = 1e6, step = null } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} אינו תקין`);
  return step ? Math.round(n / step) * step : n;
}
const pick = (map, v, def) => (Object.prototype.hasOwnProperty.call(map, v) ? v : def);

const MAX_PROPERTIES = 5000;
const MAX_CLIENTS = 10000;
const MAX_DEALS = 5000;

// ---------- נכסים ----------
const PROPERTY_TYPES = { apartment: 'דירה', garden: 'דירת גן', penthouse: 'פנטהאוז / גג', house: 'בית פרטי', duplex: 'דופלקס', land: 'מגרש', office: 'משרד', store: 'חנות', other: 'אחר' };
const LISTING = { sale: 'למכירה', rent: 'להשכרה' };
const PROPERTY_STATUS = { available: 'זמין', negotiation: 'במשא ומתן', sold: 'נמכר', rented: 'הושכר', withdrawn: 'הוסר' };
const OPEN_PROPERTY = new Set(['available', 'negotiation']);

function validateProperty(input, prev = {}) {
  if (!input || typeof input !== 'object') throw new Error('נכס לא תקין');
  const x = { ...prev, ...input };
  const city = str(x.city, 80, 'העיר');
  if (!city) throw new Error('העיר חובה');
  const out = {
    city,
    neighborhood: str(x.neighborhood, 80, 'השכונה'),
    street: str(x.street, 120, 'הרחוב'),
    type: pick(PROPERTY_TYPES, x.type, 'apartment'),
    listing: pick(LISTING, x.listing, 'sale'),
    status: pick(PROPERTY_STATUS, x.status, 'available'),
    rooms: num(x.rooms, 'מספר החדרים', { max: 50, step: 0.5 }),
    areaSqm: num(x.areaSqm, 'השטח', { max: 100000 }),
    floor: num(x.floor, 'הקומה', { min: -5, max: 200, step: 1 }),
    // מהטופס מגיע asking בשקלים; ברשומה שמורה — askingAg. עדכון בלי מחיר שומר את הקודם
    askingAg: input.asking === undefined || input.asking === '' ? (isAg(prev.askingAg) ? prev.askingAg : 0) : money(input.asking, 'המחיר המבוקש'),
    ownerClientId: str(x.ownerClientId, 80, 'הבעלים'),
    exclusiveUntil: x.exclusiveUntil ? String(x.exclusiveUntil) : '',
    features: str(x.features, 300, 'המאפיינים'),
    notes: str(x.notes, 1000, 'ההערות')
  };
  if (out.exclusiveUntil && !isDate(out.exclusiveUntil)) throw new Error('תאריך סיום הבלעדיות אינו תקין');
  if (!out.askingAg) throw new Error('המחיר המבוקש חובה');
  return out;
}

function propertyTitle(p) {
  return [PROPERTY_TYPES[p.type] || '', p.rooms ? `${p.rooms} חד׳` : '', [p.street, p.neighborhood, p.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
}

function propertyView(p) {
  const { askingAg, ...rest } = p;
  return { ...rest, asking: fromAg(askingAg || 0), title: propertyTitle(p), typeLabel: PROPERTY_TYPES[p.type], listingLabel: LISTING[p.listing], statusLabel: PROPERTY_STATUS[p.status] };
}

// ---------- לקוחות ----------
const CLIENT_ROLES = { buyer: 'קונה', seller: 'מוכר', tenant: 'שוכר', landlord: 'משכיר' };
// דרישות רלוונטיות רק למחפש נכס (קונה / שוכר)
const SEEKERS = new Set(['buyer', 'tenant']);

function validateClient(input, prev = {}) {
  if (!input || typeof input !== 'object') throw new Error('לקוח לא תקין');
  const x = { ...prev, ...input };
  const name = str(x.name, 120, 'השם');
  if (!name) throw new Error('שם הלקוח חובה');
  const idNumber = String(x.idNumber ?? '').replace(/\D/g, '');
  ID.assertIsraeliId(idNumber, 'מספר הזהות', prev.idNumber);
  const role = pick(CLIENT_ROLES, x.role, 'buyer');
  const out = { name, role, idNumber, phone: str(x.phone, 40, 'הטלפון'), email: str(x.email, 120, 'הדוא"ל'), notes: str(x.notes, 1000, 'ההערות'), active: x.active !== false && x.active !== 'false' };
  if (SEEKERS.has(role)) {
    const minRooms = num(x.minRooms, 'מספר חדרים מינימלי', { max: 50, step: 0.5 });
    const maxRooms = num(x.maxRooms, 'מספר חדרים מקסימלי', { max: 50, step: 0.5 });
    if (minRooms !== null && maxRooms !== null && minRooms > maxRooms) throw new Error('מספר החדרים המינימלי גדול מהמקסימלי');
    const budgetMinAg = x.budgetMin !== undefined ? money(x.budgetMin, 'התקציב המינימלי') : (isAg(prev.budgetMinAg) ? prev.budgetMinAg : 0);
    const budgetMaxAg = x.budgetMax !== undefined ? money(x.budgetMax, 'התקציב המקסימלי') : (isAg(prev.budgetMaxAg) ? prev.budgetMaxAg : 0);
    if (budgetMaxAg && budgetMinAg > budgetMaxAg) throw new Error('התקציב המינימלי גדול מהמקסימלי');
    const areas = (Array.isArray(x.areas) ? x.areas : String(x.areas ?? '').split(/[,،]/)).map(s => String(s).trim()).filter(Boolean).slice(0, 20);
    if (areas.some(a => a.length > 80)) throw new Error('שם אזור ארוך מדי');
    const types = (Array.isArray(x.types) ? x.types : String(x.types ?? '').split(',')).map(s => String(s).trim()).filter(t => PROPERTY_TYPES[t]);
    Object.assign(out, { areas, types, minRooms, maxRooms, budgetMinAg, budgetMaxAg, needsMortgage: x.needsMortgage === true || x.needsMortgage === 'true' || x.needsMortgage === 'yes' });
  }
  return out;
}

function clientView(c) {
  const { budgetMinAg, budgetMaxAg, ...rest } = c;
  return {
    ...rest, roleLabel: CLIENT_ROLES[c.role],
    ...(SEEKERS.has(c.role) ? { budgetMin: fromAg(budgetMinAg || 0), budgetMax: fromAg(budgetMaxAg || 0), areasText: (c.areas || []).join(', ') } : {})
  };
}

// ---------- התאמה ----------
// קונה ← נכס למכירה, שוכר ← נכס להשכרה. רק נכסים פתוחים. ציון 0–100 והסבר, בלי פסילה סמויה:
// תנאי "קשה" (סוג עסקה, נכס סגור, מחיר מעל התקציב ביותר מ-MARGIN) — פוסל; השאר מוריד ציון.
const PRICE_MARGIN = 0.05;
// גרשיים נמחקים, מקף ← רווח ("רמת-אהרן" = "רמת אהרן")
const norm = (s) => String(s || '').replace(/["'״׳]/g, '').replace(/[-־]/g, ' ').replace(/\s+/g, ' ').trim();

function matchScore(client, property) {
  if (!SEEKERS.has(client.role) || client.active === false) return null;
  if (!OPEN_PROPERTY.has(property.status)) return null;
  if ((client.role === 'buyer') !== (property.listing === 'sale')) return null;
  const reasons = [];
  const misses = [];
  let score = 100;
  const price = property.askingAg || 0;
  if (client.budgetMaxAg) {
    if (price > client.budgetMaxAg * (1 + PRICE_MARGIN)) return null;
    if (price > client.budgetMaxAg) { score -= 15; misses.push('מעט מעל התקציב'); } else reasons.push('בתקציב');
  }
  if (client.budgetMinAg && price < client.budgetMinAg) { score -= 10; misses.push('מתחת לתקציב המינימלי'); }
  if (client.areas && client.areas.length) {
    const hay = norm(`${property.city} ${property.neighborhood}`);
    if (client.areas.some(a => hay.includes(norm(a)))) reasons.push('באזור המבוקש');
    else { score -= 40; misses.push('מחוץ לאזורים המבוקשים'); }
  }
  if (property.rooms !== null && property.rooms !== undefined) {
    if (client.minRooms !== null && client.minRooms !== undefined && property.rooms < client.minRooms) { score -= 20; misses.push('פחות חדרים'); }
    else if (client.maxRooms !== null && client.maxRooms !== undefined && property.rooms > client.maxRooms) { score -= 10; misses.push('יותר חדרים'); }
    else if (client.minRooms || client.maxRooms) reasons.push('מספר חדרים מתאים');
  }
  if (client.types && client.types.length) {
    if (client.types.includes(property.type)) reasons.push('סוג הנכס המבוקש');
    else { score -= 25; misses.push('סוג נכס אחר'); }
  }
  return { score: Math.max(0, score), reasons, misses };
}

// minScore — סף להצגה; ממוין מהגבוה לנמוך
function matchesForClient(client, properties, { minScore = 50, limit = 20 } = {}) {
  return properties.map(p => ({ property: p, m: matchScore(client, p) }))
    .filter(x => x.m && x.m.score >= minScore)
    .sort((a, b) => b.m.score - a.m.score || a.property.askingAg - b.property.askingAg)
    .slice(0, limit);
}

function matchesForProperty(property, clients, { minScore = 50, limit = 20 } = {}) {
  return clients.map(c => ({ client: c, m: matchScore(c, property) }))
    .filter(x => x.m && x.m.score >= minScore)
    .sort((a, b) => b.m.score - a.m.score)
    .slice(0, limit);
}

// ---------- עסקאות ----------
const DEAL_STAGES = {
  viewing: 'הצגה', offer: 'הצעה', negotiation: 'משא ומתן', memo: 'זיכרון דברים', contract: 'חוזה נחתם', closed: 'הושלמה', lost: 'בוטלה'
};
const DEAL_KEYS = Object.keys(DEAL_STAGES);
const CLOSED_DEAL = new Set(['closed', 'lost']);
// מועדים חשובים בעסקה — רשימה פתוחה, עם תווית
const MAX_MILESTONES = 20;

function validateMilestones(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw new Error('רשימת המועדים אינה תקינה');
  if (list.length > MAX_MILESTONES) throw new Error(`עד ${MAX_MILESTONES} מועדים בעסקה`);
  return list.map(m => {
    const label = str(m && m.label, 80, 'שם המועד');
    if (!label) throw new Error('לכל מועד צריך שם');
    if (!isDate(m.date)) throw new Error(`תאריך המועד "${label}" אינו תקין`);
    return { label, date: m.date, done: m.done === true, ...(m.mortgage === true ? { mortgage: true } : {}) };
  });
}

function validateDeal(input, prev = {}, { properties = [], clients = [] } = {}) {
  if (!input || typeof input !== 'object') throw new Error('עסקה לא תקינה');
  const x = { ...prev, ...input };
  const propertyId = String(x.propertyId || '');
  const property = properties.find(p => p.id === propertyId);
  if (!property) throw new Error('יש לבחור נכס לעסקה');
  const ids = new Set(clients.map(c => c.id));
  const buyerClientId = String(x.buyerClientId || '');
  if (!buyerClientId || !ids.has(buyerClientId)) throw new Error(property.listing === 'rent' ? 'יש לבחור שוכר' : 'יש לבחור קונה');
  const sellerClientId = String(x.sellerClientId || property.ownerClientId || '');
  if (sellerClientId && !ids.has(sellerClientId)) throw new Error('המוכר שנבחר אינו ברשימת הלקוחות');
  if (sellerClientId && sellerClientId === buyerClientId) throw new Error('הקונה והמוכר הם אותו לקוח');
  const stage = pick(DEAL_STAGES, x.stage, 'viewing');
  const priceAg = input.price !== undefined && input.price !== '' ? money(input.price, 'מחיר העסקה') : (isAg(prev.priceAg) ? prev.priceAg : property.askingAg);
  const out = {
    propertyId, buyerClientId, sellerClientId, stage, priceAg,
    lostReason: stage === 'lost' ? str(x.lostReason, 200, 'הסיבה') : '',
    signDate: x.signDate ? String(x.signDate) : '',
    handoverDate: x.handoverDate ? String(x.handoverDate) : '',
    dependsOnMortgage: x.dependsOnMortgage === true || x.dependsOnMortgage === 'true' || x.dependsOnMortgage === 'yes',
    notes: str(x.notes, 1000, 'ההערות')
  };
  for (const [k, label] of [['signDate', 'תאריך החתימה'], ['handoverDate', 'תאריך המסירה']]) if (out[k] && !isDate(out[k])) throw new Error(`${label} אינו תקין`);
  const ms = validateMilestones(input.milestones);
  out.milestones = ms !== undefined ? ms : (Array.isArray(prev.milestones) ? prev.milestones : []);
  return out;
}

// היסטוריית שלבים — כמו בתיקי הייעוץ
function withDealStage(prev, next, actorId, at) {
  const hist = Array.isArray(prev.stageHistory) ? prev.stageHistory : [];
  if (hist.length && hist[hist.length - 1].stage === next.stage) return { ...next, stageHistory: hist };
  return { ...next, stageHistory: [...hist, { stage: next.stage, at, by: actorId || null }] };
}

// מועדים בשבועיים הקרובים (וגם שעברו ולא סומנו) — לתצוגה בלבד, בלי שום פעולה אוטומטית
function upcoming(deals, today, days = 14) {
  const end = new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const d of deals) {
    if (CLOSED_DEAL.has(d.stage)) continue;
    const list = [...(d.milestones || []).filter(m => !m.done).map(m => ({ ...m })),
      ...(d.signDate ? [{ label: 'חתימה', date: d.signDate }] : []), ...(d.handoverDate ? [{ label: 'מסירה', date: d.handoverDate }] : [])];
    for (const m of list) if (m.date <= end) out.push({ dealId: d.id, label: m.label, date: m.date, overdue: m.date < today, mortgage: !!m.mortgage || (d.dependsOnMortgage && m.label === 'חתימה') });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function dealView(d, { properties = [], clients = [] } = {}) {
  const { priceAg, ...rest } = d;
  const p = properties.find(x => x.id === d.propertyId);
  const name = (id) => (clients.find(c => c.id === id) || {}).name || '';
  return { ...rest, price: fromAg(priceAg || 0), stageLabel: DEAL_STAGES[d.stage], propertyTitle: p ? propertyTitle(p) : 'נכס שנמחק', listing: p ? p.listing : 'sale', buyerName: name(d.buyerClientId), sellerName: name(d.sellerClientId) };
}

function dealBoard(deals, ctx) {
  return DEAL_KEYS.map(k => ({ stage: k, label: DEAL_STAGES[k], closed: CLOSED_DEAL.has(k), cards: deals.filter(d => d.stage === k).map(d => dealView(d, ctx)) }));
}

// עסקה שנסגרה ← סטטוס הנכס (נמכר / הושכר); עסקה פעילה בשלב מתקדם ← במשא ומתן. חישוב בלבד — השירות שומר
function propertyStatusAfter(deal, property) {
  if (deal.stage === 'closed') return property.listing === 'rent' ? 'rented' : 'sold';
  if (['negotiation', 'memo', 'contract'].includes(deal.stage) && property.status === 'available') return 'negotiation';
  return property.status;
}

module.exports = {
  MAX_PROPERTIES, MAX_CLIENTS, MAX_DEALS, PRICE_MARGIN,
  PROPERTY_TYPES, LISTING, PROPERTY_STATUS, CLIENT_ROLES, DEAL_STAGES, SEEKERS,
  validateProperty, propertyView, propertyTitle, validateClient, clientView,
  matchScore, matchesForClient, matchesForProperty,
  validateDeal, validateMilestones, withDealStage, upcoming, dealView, dealBoard, propertyStatusAfter
};
