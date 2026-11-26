// הודעות סטטוס חתומות (hold / release / terminate) וחישוב הסטטוס האפקטיבי של צומת (docs/LICENSING-DESIGN.md).
// השבתה היא hold על צומת; היא חלה על הצומת ועל כל צאצאיו. החזרה לפעילות משחררת hold ספציפי בלבד —
// ולכן מערכת בת שהלקוח השבית בעצמה נשארת מושבתת גם אחרי שהלקוח עצמו חוזר לפעילות.
const crypto = require('crypto');
const L = require('./license');

const HOLD_KINDS = ['suspended', 'locked', 'pending_payment'];
const NOTICE_TYPES = ['hold', 'release', 'terminate'];
const SOURCES = ['owner', 'parent', 'self', 'billing'];
const ALL = '*';                                   // יעד Kill Switch — רק מפתח השורש
const SEVERITY = { active: 0, pending_payment: 1, suspended: 2, locked: 3, terminated: 4 };
const ROOT = 'root';

function cleanReason(reason) {
  const s = String(reason == null ? '' : reason).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);
  if (!s) throw new Error('חובה לציין סיבה');
  return s;
}

// יצירת הודעה. issuer = { privateJwk, license? } — בלי license זו הודעת שורש (Owner)
function createNotice(issuer, input) {
  const { type, target } = input;
  if (!NOTICE_TYPES.includes(type)) throw new Error('סוג הודעה לא מוכר');
  if (typeof target !== 'string' || !target) throw new Error('יעד ההודעה חסר');
  const issuerId = issuer.license ? issuer.license.payload.id : ROOT;
  if (issuer.license && L.keyId(issuer.privateJwk) !== issuerId) throw new Error('המפתח אינו תואם לרישיון המנפיק');
  if (target === ALL && issuerId !== ROOT) throw new Error('נעילה גלובלית שמורה למנהל-העל');
  if (!Number.isSafeInteger(input.issuedAt)) throw new Error('זמן הודעה לא תקין');
  const payload = {
    v: 1,
    id: input.id || crypto.randomUUID(),
    type,
    target,
    issuer: issuerId,
    issuedAt: input.issuedAt,
    reason: cleanReason(input.reason),
  };
  if (type === 'hold') {
    if (!HOLD_KINDS.includes(input.kind)) throw new Error('סוג השבתה לא מוכר');
    if (!SOURCES.includes(input.source)) throw new Error('מקור השבתה לא מוכר');
    payload.kind = input.kind;
    payload.source = input.source;
  }
  if (type === 'release') {
    if (typeof input.holdId !== 'string' || !input.holdId) throw new Error('חסר מזהה ההשבתה לשחרור');
    payload.holdId = input.holdId;
  }
  return { payload, sig: L.signObject(payload, issuer.privateJwk) };
}

// ההודעות שחלות על צומת: חתימה תקינה, והמנפיק הוא השורש או אב/הצומת עצמו בשרשרת.
// chain = שרשרת מאומתת (payloads), knownKeys = מפה id→publicKey של כל צמתי השרשרת
function applicableNotices(notices, chainIds, keysById, rootKeys) {
  const out = [];
  for (const n of notices || []) {
    const p = n && n.payload;
    if (!p || p.v !== 1 || !NOTICE_TYPES.includes(p.type)) continue;
    const signers = p.issuer === ROOT ? rootKeys : (keysById.has(p.issuer) ? [keysById.get(p.issuer)] : []);
    if (!signers.some(k => L.verifyObject(p, n.sig, k))) continue;
    if (p.target === ALL) { if (p.issuer === ROOT) out.push(p); continue; }
    const targetIdx = chainIds.indexOf(p.target);
    if (targetIdx < 0) continue;
    // מנפיק חייב להיות השורש או צומת שנמצא בשרשרת לפני היעד (או היעד עצמו)
    if (p.issuer !== ROOT && chainIds.indexOf(p.issuer) > targetIdx) continue;
    if (p.issuer !== ROOT && chainIds.indexOf(p.issuer) < 0) continue;
    out.push(p);
  }
  return out;
}

// חישוב הסטטוס האפקטיבי של הצומת האחרון בשרשרת.
// lastSeen — הזמן המאוחר ביותר שנצפה בעבר (הגנה מהחזרת שעון)
// noticeCap — תקרה לזמן ההנפקה של הודעה כ"זמן שנצפה" (ממצא f7): הודעה שנחתמה בשעון עתידי לא מקדמת את הזמן מעבר לה
function effectiveStatus({ chain, notices, rootKeys, now, lastSeen = 0, noticeCap = Infinity }) {
  let node;
  try { node = L.verifyChain(chain, rootKeys); }
  catch (e) { return { status: 'locked', invalid: true, reasons: [{ kind: 'locked', reason: e.message }] }; }

  const payloads = chain.map(l => l.payload);
  const chainIds = payloads.map(p => p.id);
  const keysById = new Map(payloads.map(p => [p.id, p.publicKey]));
  const valid = applicableNotices(notices, chainIds, keysById, rootKeys);

  const at = Math.max(now, lastSeen, ...valid.map(p => Math.min(p.issuedAt, noticeCap)));
  const reasons = [];
  let graceUntil = null;

  // שחרור תקף רק אם נחתם ע"י מי שיצר את ה-hold, או ע"י השורש
  const holds = new Map(valid.filter(p => p.type === 'hold').map(p => [p.id, p]));
  for (const r of valid.filter(p => p.type === 'release')) {
    const h = holds.get(r.holdId);
    if (h && (r.issuer === h.issuer || r.issuer === ROOT) && r.issuedAt >= h.issuedAt) holds.delete(r.holdId);
  }
  for (const t of valid.filter(p => p.type === 'terminate')) {
    reasons.push({ kind: 'terminated', node: t.target, reason: t.reason, issuer: t.issuer, at: t.issuedAt });
  }
  for (const h of holds.values()) {
    reasons.push({ kind: h.kind, node: h.target, reason: h.reason, source: h.source, issuer: h.issuer, at: h.issuedAt, holdId: h.id });
  }
  for (const p of payloads) {
    const v = L.validity(p, at);
    if (v.state === 'expired') reasons.push({ kind: 'pending_payment', node: p.id, reason: 'תוקף הרישיון הסתיים', source: 'billing' });
    else if (v.state === 'not-yet-valid') reasons.push({ kind: 'locked', node: p.id, reason: 'הרישיון עדיין לא בתוקף' });
    else if (v.state === 'grace') graceUntil = graceUntil == null ? v.graceUntil : Math.min(graceUntil, v.graceUntil);
  }

  const status = reasons.reduce((s, r) => (SEVERITY[r.kind] > SEVERITY[s] ? r.kind : s), 'active');
  return {
    status,
    nodeId: node.id,
    reasons: reasons.sort((a, b) => SEVERITY[b.kind] - SEVERITY[a.kind]),
    graceUntil: status === 'active' ? graceUntil : null,
    features: node.features,
    limits: node.limits,
    seenAt: at,
  };
}

module.exports = { HOLD_KINDS, SOURCES, SEVERITY, ALL, ROOT, createNotice, effectiveStatus };
