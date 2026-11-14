// "רגע, עובד על זה": מודול שנטען בפעם הראשונה מוסתר עד שהוא מוכן, והמעטפת מציגה הודעה (shell:busy).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('main.js: מסך בטעינה ראשונה לא מוצג ריק; רשת ביטחון של זמן; ושום מסלול לא מציג מסך שעוד נטען', () => {
  const main = read('main.js');
  assert.match(main, /if \(!smoke && v\.webContents\.isLoading\(\) === true\) \{\s+loadingViews\.add\(id\);/);
  assert.match(main, /once\('did-finish-load', \(\) => viewLoaded\(id\)\)/);
  assert.match(main, /once\('did-fail-load', \(\) => viewLoaded\(id\)\)/, 'גם טעינה שנכשלה משחררת — אחרת המסך נשאר מוסתר');
  assert.match(main, /setTimeout\(\(\) => viewLoaded\(id\), VIEW_LOAD_MAX_MS\)/);
  const shows = main.split('\n').filter(l => /setVisible\(!overlay && k === (id|active)/.test(l));
  assert.equal(shows.length, 2);
  for (const l of shows) assert.match(l, /!loadingViews\.has\(k\)/);
});

test('המעטפת: ההודעה מוקראת (role=status), בעברית, ומוסתרת כברירת מחדל', () => {
  const html = read('shell/shell.html');
  assert.match(html, /<div class="busy" id="busy" role="status" aria-live="polite" hidden><\/div>/);
  assert.ok(html.includes('.busy[hidden]{display:none}'));
  assert.match(read('shell/shell.js'), /רגע, פותח את המסך…/);
  assert.match(read('shell/preload.js'), /onBusy: cb => ipcRenderer\.on\('shell:busy'/);
  assert.match(read('modules/econ/ui/core.js'), /role="status">רגע, עובד על זה…</);
  assert.match(read('modules/econ/ui/wizards.js'), /nextBtn\.textContent = 'רגע, שומר…'/);
});
