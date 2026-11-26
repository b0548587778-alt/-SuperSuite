// תנאי ההפעלה בבדיקות (shell/licensing/activation.js): חיבור לשרת "לאחרונה". lastGoogle נכתב לתאימות בלבד.
// סנכרון אמיתי רושם את הזמן בשומר המוצפן (guard.lastSync ב-store.js). הקובץ הגלוי נקרא רק בשומר מגרסה קודמת
// (בלי syncV — מפתח ישן או שומר שנבנה ידנית בבדיקה), פעם אחת. מפתח שהמחסן יצר בעצמו — צריך את secret.
// הקובץ אינו *.test.js, ולכן npm test לא מריץ אותו כבדיקה.
const fs = require('fs');
const path = require('path');

const blank = () => ({ chain: null, notices: [], children: [], lastSeen: 0 });

// השומר המוצפן: secret — { read, write } (מדומה, או encryptedFileSecret עם safeStorage מדומה).
// מפתח מגרסה ישנה (בלי שומר) — אין מה לכתוב: הזמן מהקובץ מועבר אליו בכתיבה הראשונה
function markSynced(secret, at) {
  const raw = secret && secret.read();
  if (!raw) return;
  const o = JSON.parse(raw);
  if (!o || o.v !== 2) return;
  secret.write(JSON.stringify({ ...o, guard: { ...(o.guard || { lastSeen: 0, notices: [] }), lastSync: at } }));
}

// license.json בתיקייה (שולחן עבודה). at — הזמן שבו "היה חיבור"
function markActivated(dir, at, secret) {
  const file = path.join(dir, 'license.json');
  const d = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : blank();
  d.remote = { ...(d.remote || {}), lastSync: at, lastGoogle: at };
  fs.writeFileSync(file, JSON.stringify(d));
  if (secret) markSynced(secret, at);
}

// אנדרואיד: אותו מבנה ב-localStorage (והשומר — במפתח של מפתח המערכת)
function markActivatedStorage(items, at, key = 'supersuite.license') {
  const d = items.has(key) ? JSON.parse(items.get(key)) : blank();
  d.remote = { ...(d.remote || {}), lastSync: at, lastGoogle: at };
  items.set(key, JSON.stringify(d));
  const secretKey = key + '.key';
  markSynced({ read: () => (items.has(secretKey) ? items.get(secretKey) : null), write: (t) => items.set(secretKey, t) }, at);
}

// הנפקת מערכות בת דורשת תנאי הפעלה (store.assertCanIssue, סקירה 5.11.2026): בבדיקות שאינן על תנאי ההפעלה ואין בהן
// שרת עם תעודה (בדיקה חתומה) — מדלגים על הבדיקה הזו בלבד. הבדיקה עצמה — tests/review-2026-11-relay.test.js
function allowIssuing(store) { store.assertCanIssue = () => {}; return store; }

module.exports = { markActivated, markActivatedStorage, markSynced, allowIssuing };
