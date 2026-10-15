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
  mortgage: 'econ.mortgage',
};

// ערוצים שתמיד פתוחים, גם במערכת מושבתת: כניסה/יציאה, כדי שהמשתמש יראה את מסך הסיבה
const ALWAYS_OPEN = /^(auth|license):/;
// במצב חוב/השבתה זמנית: קריאה, ייצוא וגיבוי בלבד — הנתונים של הלקוח לא "נלקחים כבני ערובה"
const READ_ONLY_PERMS = new Set(['data.view', 'data.export', 'data.backup']);

const STATUS_TEXT = {
  pending_payment: 'המערכת ממתינה לתשלום',
  suspended: 'המערכת מושבתת זמנית',
  locked: 'המערכת נעולה',
  terminated: 'השימוש במערכת הסתיים',
};

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
    const readOnly = state.status === 'pending_payment' || state.status === 'suspended';
    if (!(readOnly && READ_ONLY_PERMS.has(permission))) return statusMessage(state);
  }
  const have = new Set(state.features || []);
  const missing = featuresForChannel(channel).filter(f => !have.has(f));
  if (missing.length) return 'התחום הזה אינו כלול ברישיון של המערכת';
  return null;
}

function moduleAllowed(state, mod) {
  if (!state || state.mode === 'unlicensed') return true;
  if (state.status === 'locked' || state.status === 'terminated') return false;
  const f = MODULE_FEATURES[mod];
  return !!f && (state.features || []).includes(f);
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

module.exports = { MODULE_FEATURES, ECON_SUB_FEATURES, featuresForChannel, checkChannel, moduleAllowed, checkUserLimit, statusMessage };
