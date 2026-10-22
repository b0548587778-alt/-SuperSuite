'use strict';
// קוד המקור של מודול השמאי — קבצי modules/shamai/src לפי סדר התגים ב-index.html
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'modules', 'shamai');

function shamaiFiles() {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="(src\/[^"]+\.js)"><\/script>/g)].map((m) => m[1]);
}

function shamaiSource() {
  return shamaiFiles().map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
}

// טעינת קבצים נבחרים מ-src בהקשר vm עם DOM מדומה: כל בורר מחזיר אלמנט קבוע (value / checked / innerHTML / hidden)
function loadShamai(names) {
  const vm = require('vm');
  const els = new Map();
  const el = (sel) => {
    if (!els.has(sel)) els.set(sel, { value: '', checked: false, innerHTML: '', hidden: false, open: false, dataset: {}, classList: { contains: () => false, toggle() {}, add() {}, remove() {} }, addEventListener() {}, querySelectorAll: () => [] });
    return els.get(sel);
  };
  const document = { readyState: 'complete', querySelector: el, querySelectorAll: () => [], getElementById: (id) => el('#' + id), addEventListener() {} };
  const mem = {};
  const localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const ctx = vm.createContext({ document, localStorage, console, setTimeout, clearTimeout, Intl, navigator: {}, window: {} });
  ctx.window = ctx;
  for (const n of names) vm.runInContext(fs.readFileSync(path.join(DIR, 'src', n + '.js'), 'utf8'), ctx, { filename: n + '.js' });
  const run = (code) => vm.runInContext(code, ctx);
  // הזנת ערכים לשדות והרצת פונקציית חישוב; מחזיר את ה-HTML של התוצאה
  const calc = (fn, resultSel, fields) => {
    for (const [sel, v] of Object.entries(fields)) {
      if (typeof v === 'boolean') el(sel).checked = v; else el(sel).value = String(v);
    }
    run(fn + '()');
    return el(resultSel).innerHTML;
  };
  return { ctx, run, el, calc };
}

module.exports = { DIR, shamaiFiles, shamaiSource, loadShamai };
