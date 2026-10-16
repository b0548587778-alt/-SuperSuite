// טעינת ממשק המודול הכלכלי (modules/econ/ui/*.js) כמו בדפדפן: הקבצים לפי סדר תגי ה-script
// ב-views/index.html, כל אחד כסקריפט נפרד באותו הקשר — כך הם חולקים טווח שמות אחד.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const VIEWS = path.join(ROOT, 'modules', 'econ', 'views');

function files() {
  const html = fs.readFileSync(path.join(VIEWS, 'index.html'), 'utf8');
  const list = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => path.join(VIEWS, m[1]));
  if (!list.length) throw new Error('לא נמצאו סקריפטים ב-views/index.html');
  return list;
}

const source = () => files().map(f => fs.readFileSync(f, 'utf8')).join('\n');

function run(context) {
  for (const f of files()) vm.runInContext(fs.readFileSync(f, 'utf8'), context, { filename: path.relative(ROOT, f) });
}

module.exports = { files, source, run };
