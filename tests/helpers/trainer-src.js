// קוד המקור של ממשק מודול האימונים (modules-src/trainer/src): App.jsx, studio.jsx, components/ ו-features/ —
// כל קבצי ה-jsx יחד, לבדיקות שקוראות את הטקסט של הממשק (אחרי הפירוק של PLAN.md 6.2 הוא כבר לא בקובץ אחד)
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'modules-src', 'trainer', 'src');

function jsxFiles(dir = SRC, out = []) {
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) jsxFiles(p, out);
    else if (n.endsWith('.jsx')) out.push(p);
  }
  return out;
}

const trainerUiSource = () => jsxFiles().map(f => fs.readFileSync(f, 'utf8')).join('\n');

module.exports = { SRC, jsxFiles, trainerUiSource };
