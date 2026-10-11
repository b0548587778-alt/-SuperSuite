const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { canShellNavigate, canModuleOpen, EDITING_CHECK_JS } = require('../shell/nav-guard');

const MODS = ['econ', 'shamai', 'trainer', 'tools'];
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('shell:switch: רק המעטפת (מזהה החלון) רשאית לנווט', () => {
  assert.equal(canShellNavigate(1, 1), true);
  assert.equal(canShellNavigate(2, 1), false, 'תצוגת מודול לא מנווטת');
  assert.equal(canShellNavigate(1, null), false, 'אין חלון — אין ניווט');
});

test('shell:open-module: מודול קיים יכול לפתוח מודול מוכר', () => {
  assert.equal(canModuleOpen(7, [7, 8], 'shamai', MODS), true);
});

test('shell:open-module: שולח שאינו תצוגת מודול נחסם (למשל המעטפת)', () => {
  assert.equal(canModuleOpen(1, [7, 8], 'shamai', MODS), false);
});

test('shell:open-module: מזהה יעד לא מוכר נחסם', () => {
  assert.equal(canModuleOpen(7, [7], 'evil', MODS), false);
  assert.equal(canModuleOpen(7, [7], undefined, MODS), false);
});

test('shell:open-module: קלט לא תקין לא קורס ונחסם', () => {
  assert.equal(canModuleOpen(7, undefined, 'econ', MODS), false);
  assert.equal(canModuleOpen(7, [7], 'econ', undefined), false);
});

test('קיצורי Ctrl+ספרה: הבדיקה מזהה שדה עריכה', () => {
  const check = (activeElement) => vm.runInNewContext(EDITING_CHECK_JS, { document: { activeElement } });
  assert.equal(check({ tagName: 'INPUT', isContentEditable: false }), true);
  assert.equal(check({ tagName: 'TEXTAREA', isContentEditable: false }), true);
  assert.equal(check({ tagName: 'SELECT', isContentEditable: false }), true);
  assert.equal(check({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(check({ tagName: 'BUTTON', isContentEditable: false }), false);
  assert.equal(check(null), false);
});

test('הרגרסיה: ב-main.js אין עוד נתיב עוקף ב-shell:switch', () => {
  const main = read('main.js');
  const block = main.slice(main.indexOf("ipcMain.handle('shell:switch'"), main.indexOf("ipcMain.handle('shell:open-module'"));
  assert.doesNotMatch(block, /MODS\.includes/, 'shell:switch לא יכול לאשר מודול לפי מזהה בלבד');
  assert.match(block, /canShellNavigate\(e\.sender\.id, win\.webContents\.id\)/);
});

test('econ מפעיל מודולים רק דרך הערוץ החדש', () => {
  assert.match(read('modules/econ/preload.js'), /openModule: \(id\) => ipcRenderer\.invoke\('shell:open-module', id\)/);
});

test('כלל 6: שמאי לא שולח בקשות רשת לשירותים חיצוניים', () => {
  const src = read('modules/shamai/app.js');
  assert.doesNotMatch(src, /fetch\(\s*['`]https?:\/\//, 'אין fetch לכתובת חיצונית');
  assert.doesNotMatch(src, /fetch\(\s*`https?:\/\//, 'אין fetch לכתובת חיצונית (תבנית)');
});
