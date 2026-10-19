// מתקין עם אשף (PLAN.md 1.3), רישיון ואודות (5.1), ומדריך משתמש (1.6)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('מתקין: אשף בעברית, התקנה למשתמש הנוכחי (אותה תיקייה כמו 3.10.0), והסרה שלא מוחקת נתונים', () => {
  const n = pkg.build.nsis;
  assert.equal(n.oneClick, false);
  assert.equal(n.perMachine, false);
  assert.equal(n.allowToChangeInstallationDirectory, true);
  assert.equal(n.license, 'build/eula.txt');
  assert.equal(n.include, 'build/installer.nsh');
  assert.deepEqual(n.installerLanguages, ['he_IL']);
  assert.equal(n.deleteAppDataOnUninstall, false);
  assert.equal(n.runAfterFinish, true);
  const nsh = fs.readFileSync(path.join(ROOT, 'build/installer.nsh'));
  assert.deepEqual([...nsh.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'עברית ב-NSIS — UTF-8 עם BOM');
  const t = nsh.toString('utf8');
  assert.match(t, /!macro customInstallMode\s+StrCpy \$isForceCurrentInstall "1"/, 'בלי דף בחירת התקנה לכל המשתמשים');
  assert.match(t, /!macro customWelcomePage[\s\S]*MUI_PAGE_WELCOME/);
});

test('רישיון: קנייני, הסכם בעברית עם BOM, והקבצים נארזים', () => {
  assert.equal(pkg.license, 'UNLICENSED');
  const eula = fs.readFileSync(path.join(ROOT, 'build/eula.txt'));
  assert.deepEqual([...eula.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(eula.toString('utf8'), /הסכם רישיון/);
  for (const f of ['LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'build/eula.txt']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    assert.ok(pkg.build.files.includes(f), 'נקרא מ-__dirname במסך אודות: ' + f);
  }
  const extra = pkg.build.extraFiles.map(x => (typeof x === 'string' ? x : x.to));
  assert.ok(extra.includes('LICENSE.txt') && extra.includes('THIRD-PARTY-NOTICES.txt') && extra.includes('EULA.txt'));
  const notices = read('THIRD-PARTY-NOTICES.txt');
  for (const name of ['Electron', 'React', 'Recharts', 'lz-string']) assert.match(notices, new RegExp(name), name);
});

test('אודות ומדריך: הערוצים פועלים רק מהמעטפת, וחלון המדריך בלי סקריפט ובלי ניווט', () => {
  const main = read('main.js');
  for (const ch of ['shell:get-about', 'shell:open-user-guide', 'shell:save-user-guide-pdf']) {
    const i = main.indexOf(`ipcMain.handle('${ch}'`);
    assert.ok(i > 0, ch);
    assert.match(main.slice(i, i + 200), /e\.sender\.id !== win\.webContents\.id/, ch);
  }
  const g = main.slice(main.indexOf('function guideWindow'), main.indexOf('let guideWin'));
  assert.match(g, /CodeGuard\.guardPrefs\(\{[^}]*javascript: false/);
  assert.match(g, /wireDevToolsGuard/);
  assert.match(g, /will-navigate', ev => ev\.preventDefault\(\)/);
  assert.match(g, /action: 'deny'/);
  const pre = read('shell/preload.js');
  for (const fn of ['getAbout', 'openUserGuide', 'saveUserGuidePdf']) assert.match(pre, new RegExp(fn), fn);
  const html = read('shell/shell.html');
  for (const id of ['userGuideBtn', 'userGuidePdfBtn', 'aboutText', 'eulaBtn', 'noticesBtn', 'docDlg']) assert.match(html, new RegExp(`id="${id}"`), id);
});

test('מדריך המשתמש: עברית, בלי סקריפט ובלי רשת, וכל תמונה קיימת', () => {
  const g = read('shell/guide/index.html');
  assert.match(g, /<html lang="he" dir="rtl">/);
  assert.match(g, /Content-Security-Policy" content="default-src 'none'/);
  assert.doesNotMatch(g, /<script/i);
  assert.doesNotMatch(g, /(src|href)="(https?:)?\/\//, 'אין משאב חיצוני');
  assert.match(g, /href="\.\.\/design-tokens\.css"/);
  assert.doesNotMatch(g, /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/, 'צבעים רק מ-design-tokens');
  for (const id of ['install', 'login', 'receipt', 'sample', 'backup', 'recovery', 'license', 'keys', 'faq']) {
    assert.match(g, new RegExp(`id="${id}"`), id);
    assert.match(g, new RegExp(`href="#${id}"`), 'בתוכן העניינים: ' + id);
  }
  const imgs = [...g.matchAll(/<img src="([^"]+)" alt="([^"]+)"/g)];
  assert.ok(imgs.length >= 5);
  for (const [, src] of imgs) assert.ok(fs.existsSync(path.join(ROOT, 'shell/guide', src)), src);
  assert.equal(imgs.length, (g.match(/<img/g) || []).length, 'לכל תמונה alt');
});
