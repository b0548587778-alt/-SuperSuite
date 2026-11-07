// מודולי הלימוד של SuperSuite לימוד: אנגלית, חשבון וניהול מוסד — דף סטטי ב-modules/<id>/index.html (כמו ארגז הכלים).
// בדיקות משותפות (נגישות, חלון ההודעות, ספריית הרכיבים, רשת הביטחון) עוברות על המודולים שכבר קיימים בדיסק;
// tests/learn-modules-contract.test.js דורש שכולם קיימים ועומדים בחוזה.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LEARN_MODS = ['english', 'math', 'school'];
const exists = (id) => fs.existsSync(path.join(ROOT, 'modules', id, 'index.html'));
const present = () => LEARN_MODS.filter(exists);

// כל הקבצים במודול (יחסית לשורש), לפי סיומת
function moduleFiles(id, re = /\.(js|html|css)$/) {
  const out = [];
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const r = rel + '/' + e.name;
      if (e.isDirectory()) walk(r); else if (re.test(e.name)) out.push(r);
    }
  })('modules/' + id);
  return out;
}

module.exports = { LEARN_MODS, exists, present, moduleFiles };
