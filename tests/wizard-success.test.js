// מסך ההצלחה של האשף: אחרי "כן, לשמור" — סימן גדול, "היום עשיתם", "עוד אחת" ו"סיימתי".
// השכבה אינה .modal ונמוכה מהטוסט, כדי ש"טעיתי, לבטל" יישאר לחיץ מעליה.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers/econ-a11y-harness');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-success-'));
let s;
test.before(async () => {
  s = await H.boot({ real: DIR, simple: true });
  await s.go('dashboard');
});
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* EBUSY ב-Windows */ } });

const textOf = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
async function saveContact(name) {
  s.run('econStartTask("contact")');
  await s.settle();
  for (const v of [name, '', '']) {
    const inp = s.doc.getElementById('wizInput');
    if (inp) inp.value = v;
    s.doc.getElementById('wizNext').click();
    await s.settle();
  }
  s.doc.getElementById('wizNext').click(); // כן, לשמור
  await s.settle(40);
}

test('אחרי שמירה: מסך הצלחה עם ספירה של היום; "סיימתי" סוגר, "עוד אחת" פותח שוב את האשף', async () => {
  await saveContact('ראובן לוי');
  let done = s.doc.querySelector('.wiz-done-layer');
  assert.ok(done, 'מסך ההצלחה מוצג');
  assert.equal(done.getAttribute('role'), 'dialog');
  assert.match(textOf(done), /זו הפעם הראשונה היום/);
  assert.ok(s.doc.getElementById('toastContainer').querySelector('.undo-toast'), '"טעיתי, לבטל" עדיין זמין');
  s.doc.getElementById('wizDoneAgain').click();
  await s.settle(40);
  assert.equal(s.doc.querySelector('.wiz-done-layer'), null, 'נסגר');
  assert.ok(s.doc.querySelector('.modal.wiz'), 'האשף נפתח שוב, ריק');
  assert.equal(s.doc.getElementById('wizInput').value, '');
  s.doc.getElementById('wizInput').value = 'שמעון כהן';
  s.doc.getElementById('wizNext').click(); await s.settle();
  s.doc.getElementById('wizNext').click(); await s.settle();
  s.doc.getElementById('wizNext').click(); await s.settle();
  s.doc.getElementById('wizNext').click(); await s.settle(40);
  done = s.doc.querySelector('.wiz-done-layer');
  assert.match(textOf(done), /היום כבר עשיתם את זה 2 פעמים/);
  s.doc.getElementById('wizDoneClose').click();
  await s.settle();
  assert.equal(s.doc.querySelector('.wiz-done-layer'), null);
});

test('הספירה היא העדפת תצוגה בלבד: קלט פגום מהאחסון מתעלמים ממנו, ויום אחר מתחיל מחדש', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/ui/wizards.js'), 'utf8');
  assert.match(src, /o\.day !== today\(\)/);
  assert.match(src, /for \(const id of GUIDED_TASK_IDS\) if \(Number\.isInteger\(o\.n\[id\]\)/);
  assert.match(src, /overlay\.className = 'wiz-done-layer'/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/styles.css'), 'utf8');
  assert.match(css, /\.wiz-done-layer \{[^}]*z-index:999/, 'מתחת לטוסט (1000)');
});
