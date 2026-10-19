// שער הרישוי: האם ערוץ IPC / מודול מותרים לפי מצב הרישיון (docs/LICENSING-DESIGN.md, שלב 2).
// פונקציות טהורות — בלי Electron ובלי קבצים. ההרשאה בפועל = חיתוך של RBAC (ipc.js) עם השער הזה.

// מודולי התוכנה — כל אחד הוא תכונה ברישיון
const MODULE_FEATURES = { econ: 'econ', shamai: 'shamai', trainer: 'trainer', tools: 'tools' };

// תחומים במערכת הכלכלית שנפתחים בנפרד. תחילית ערוץ שאינה כאן דורשת רק 'econ'
const ECON_SUB_FEATURES = {
  acct: 'econ.accounting',
  npo: 'econ.npo',
  gemach: 'econ.gemach',
  chesed: 'econ.chesed',
  madv: 'econ.mortgage-advisor',
  mlab: 'econ.mortgage-lab',
  realestate: 'econ.realestate',
  mortgage: 'econ.mortgage',
};

// ערוצים שתמיד פתוחים, גם במערכת מושבתת: כניסה/יציאה, כדי שהמשתמש יראה את מסך הסיבה.
// הגדרות Google — כדי שמנהל יוכל להפעיל מערכת שנעולה עד כניסה עם Google (תנאי ההפעלה; ההרשאה עצמה: users.manage)
const ALWAYS_OPEN = /^(auth|license|owner|chat|update):|^settings:(getGoogle|saveGoogle)$/;
// במצב חוב/השבתה זמנית/סוף תקופת ניסיון: קריאה, ייצוא וגיבוי בלבד — הנתונים של הלקוח לא "נלקחים כבני ערובה"
const READ_ONLY_PERMS = new Set(['data.view', 'data.export', 'data.backup']);

const READ_ONLY_STATUS = new Set(['pending_payment', 'suspended', 'trial_ended']);

const STATUS_TEXT = {
  trial_ended: 'תקופת הניסיון הסתיימה — אפשר לצפות, לייצא ולגבות. להמשך עבודה יש להתקין רישיון',
  pending_payment: 'המערכת ממתינה לתשלום',
  suspended: 'המערכת מושבתת זמנית',
  locked: 'המערכת נעולה',
  terminated: 'השימוש במערכת הסתיים',
};

// מאגר האנשים נבנה מתחומים אחרים — הוא פתוח רק אם לפחות אחד מהם פתוח, ומציג רק את הפתוחים
const PEOPLE_SOURCES = { npo: 'econ.npo', gemach: 'econ.gemach', chesed: 'econ.chesed', trainer: 'trainer' };

// התחומים שמותר לבנות מהם את מאגר האנשים. null = בלי רישוי (הכול)
function peopleSources(state) {
  if (!state || state.mode === 'unlicensed') return null;
  const have = new Set(state.features || []);
  return Object.keys(PEOPLE_SOURCES).filter(s => have.has(PEOPLE_SOURCES[s]));
}

function featuresForChannel(channel) {
  const prefix = String(channel).split(':')[0];
  const sub = ECON_SUB_FEATURES[prefix];
  return sub ? ['econ', sub] : ['econ'];
}

function statusMessage(state) {
  const base = STATUS_TEXT[state.status] || 'המערכת אינה פעילה';
  const reason = state.reasons && state.reasons[0] && state.reasons[0].reason;
  return reason ? `${base}: ${reason}` : base;
}

// state = תוצאת store.current(): { mode: 'unlicensed' } או { mode: 'licensed', status, features, ... }.
// permission = ההרשאה שנגזרה ב-permissionFor (או null). מחזיר null אם מותר, אחרת הודעה בעברית
function checkChannel(state, channel, permission) {
  if (!state || state.mode === 'unlicensed') return null;
  if (ALWAYS_OPEN.test(channel)) return null;
  if (state.status !== 'active') {
    if (!(READ_ONLY_STATUS.has(state.status) && READ_ONLY_PERMS.has(permission))) return statusMessage(state);
  }
  const have = new Set(state.features || []);
  const missing = featuresForChannel(channel).filter(f => !have.has(f));
  if (missing.length) return 'התחום הזה אינו כלול ברישיון של המערכת';
  if (String(channel).startsWith('people:') && !peopleSources(state).length) return 'התחום הזה אינו כלול ברישיון של המערכת';
  return null;
}

function moduleAllowed(state, mod) {
  if (!state || state.mode === 'unlicensed') return true;
  if (state.status === 'locked' || state.status === 'terminated') return false;
  const f = MODULE_FEATURES[mod];
  return !!f && (state.features || []).includes(f);
}

// מסכים במערכת הכלכלית שתמיד נגישים — כדי להתקין רישיון, לקלוט עדכון סטטוס ולפנות לספק
const ALWAYS_VIEWS = new Set(['licensing', 'messages']);
function viewAllowed(state, mod, view) {
  if (mod === 'econ' && ALWAYS_VIEWS.has(view)) return true;
  return moduleAllowed(state, mod);
}

// סיכום למעטפת: רמה (ok / limited — קריאה בלבד / blocked — נעול), הודעה, ואילו מודולים פתוחים
function shellState(state) {
  const modules = {};
  for (const m of Object.keys(MODULE_FEATURES)) modules[m] = moduleAllowed(state, m);
  if (!state || state.mode === 'unlicensed') return { mode: 'unlicensed', status: 'active', level: 'ok', message: '', modules };
  const level = state.status === 'active' ? 'ok' : READ_ONLY_STATUS.has(state.status) ? 'limited' : 'blocked';
  const trial = state.trial ? { daysLeft: state.trial.daysLeft, endsAt: state.trial.endsAt, warn: !!state.trial.warn } : null;
  return { mode: 'licensed', status: state.status, level, message: level === 'ok' ? '' : statusMessage(state), graceUntil: state.graceUntil || null, trial, modules };
}

// מגבלת משתמשים פעילים. activeCount = כמה פעילים יהיו אחרי הפעולה
function checkUserLimit(state, activeCount) {
  if (!state || state.mode === 'unlicensed') return null;
  const max = state.limits && state.limits.maxUsers;
  if (Number.isSafeInteger(max) && activeCount > max) {
    return `הרישיון מתיר עד ${max} משתמשים פעילים. יש לחסום משתמש קיים או לפנות לספק להגדלת המכסה`;
  }
  return null;
}

module.exports = { MODULE_FEATURES, ECON_SUB_FEATURES, PEOPLE_SOURCES, ALWAYS_VIEWS, peopleSources, featuresForChannel, checkChannel, moduleAllowed, viewAllowed, shellState, checkUserLimit, statusMessage };
