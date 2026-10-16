// מבנה ממשק המודול הכלכלי אחרי הפיצול (modules/econ/ui/*.js): סקריפטים רגילים בטווח שמות אחד.
// המחיר של טווח משותף — כל שם ברמה העליונה הוא גלובלי. כאן נשמרים הכללים שמונעים תקלה שקטה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const EconUI = require('./helpers/econ-ui');

const UI_DIR = path.join(__dirname, '..', 'modules', 'econ', 'ui');
const loaded = EconUI.files();

// שמות שהדפדפן כבר מגדיר על window: הצהרה גלובלית בשם כזה דורסת אותו (או נכשלת בטעינה)
const BROWSER_GLOBALS = ['window', 'document', 'location', 'top', 'parent', 'self', 'frames', 'opener', 'name', 'status',
  'history', 'navigator', 'screen', 'origin', 'event', 'length', 'closed', 'close', 'open', 'stop', 'focus', 'blur', 'print',
  'alert', 'confirm', 'prompt', 'fetch', 'crypto', 'performance', 'scroll', 'find', 'postMessage', 'external', 'menubar',
  'toolbar', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'customElements', 'getSelection', 'requestAnimationFrame',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'structuredClone', 'atob', 'btoa', 'systemAPI'];

const topLevelNames = (src) => [...src.matchAll(/^(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);

test('כל קובץ בתיקיית ui נטען ב-views/index.html, ו-boot.js אחרון', () => {
  const onDisk = fs.readdirSync(UI_DIR).filter(f => f.endsWith('.js')).map(f => path.join(UI_DIR, f)).sort();
  const fromHtml = loaded.filter(f => path.dirname(f) === UI_DIR);
  assert.deepEqual([...fromHtml].sort(), onDisk, 'קובץ שלא נטען — הקוד שבו פשוט לא קיים בדפדפן');
  assert.equal(path.basename(loaded[loaded.length - 1]), 'boot.js', 'האתחול רץ רק אחרי שכל הקבצים נטענו');
  assert.equal(new Set(loaded).size, loaded.length, 'קובץ שנטען פעמיים — הצהרת const כפולה מפילה את הטעינה');
});

test('כל קובץ במצב strict, ושם ברמה העליונה מוצהר פעם אחת בלבד', () => {
  const owner = new Map();
  for (const f of loaded) {
    const src = fs.readFileSync(f, 'utf8');
    assert.match(src, /^(?:\/\/.*\r?\n)*'use strict';/, path.basename(f) + ": חסר 'use strict' בראש הקובץ");
    for (const n of topLevelNames(src)) {
      assert.ok(!owner.has(n), `"${n}" מוצהר גם ב-${owner.get(n)} וגם ב-${path.basename(f)}`);
      owner.set(n, path.basename(f));
    }
  }
  assert.ok(owner.size > 200, 'הזיהוי מצא את ההצהרות (' + owner.size + ')');
});

test('אין שם גלובלי שמתנגש במאפיין של window', () => {
  for (const f of loaded) {
    for (const n of topLevelNames(fs.readFileSync(f, 'utf8'))) {
      assert.ok(!BROWSER_GLOBALS.includes(n), `${path.basename(f)}: "${n}" דורס את window.${n}`);
    }
  }
});

test('רק boot.js מריץ קוד בזמן הטעינה מעבר להצהרות (אחרת סדר הקבצים קובע אם הוא עובד)', () => {
  // שורה ברמה העליונה שאינה הצהרה, הערה, סוגר או המשך של ביטוי — היא קוד שרץ בטעינה
  const allowed = /^(?:$|\/\/|'use strict'|(?:async\s+)?function|const |let |class |[}\])]|formSchemas\[|acctFormSchemas\[|Object\.assign\(formSchemas)/;
  for (const f of loaded) {
    if (path.basename(f) === 'boot.js') continue;
    const bad = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => !/^\s/.test(l) && !allowed.test(l));
    assert.deepEqual(bad, [], path.basename(f));
  }
});
