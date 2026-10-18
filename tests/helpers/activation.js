// תנאי ההפעלה בבדיקות (shell/licensing/activation.js): חיבור לשרת "לאחרונה". lastGoogle נכתב לתאימות בלבד.
// כותבים את הזמן לקובץ הרישוי — כמו שהסנכרון עושה — בלי מסלול עוקף בקוד.
// הקובץ אינו *.test.js, ולכן npm test לא מריץ אותו כבדיקה.
const fs = require('fs');
const path = require('path');

const blank = () => ({ chain: null, notices: [], children: [], lastSeen: 0 });

// license.json בתיקייה (שולחן עבודה). at — הזמן שבו "היה חיבור"
function markActivated(dir, at) {
  const file = path.join(dir, 'license.json');
  const d = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : blank();
  d.remote = { ...(d.remote || {}), lastSync: at, lastGoogle: at };
  fs.writeFileSync(file, JSON.stringify(d));
}

// אנדרואיד: אותו מבנה ב-localStorage
function markActivatedStorage(items, at, key = 'supersuite.license') {
  const d = items.has(key) ? JSON.parse(items.get(key)) : blank();
  d.remote = { ...(d.remote || {}), lastSync: at, lastGoogle: at };
  items.set(key, JSON.stringify(d));
}

module.exports = { markActivated, markActivatedStorage };
