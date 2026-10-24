'use strict';
// בדיקת קוד 20.10.2026: מסך אנשי הקשר בשמאי. בלי טלפון, המזהה של איש הקשר הוא שם המוכר כפי שהוקלד —
// והוא נכנס למאפיין data-contact בלי escape. שם עם מירכאות פרץ מהמאפיין והוסיף מאפיינים / תגיות לעמוד.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DIR, loadShamai } = require('./helpers/shamai-src');

// פונקציה ברמה העליונה מקובץ מקור — עד הסוגר שבתחילת שורה (שאר הקבצים רצים בטעינה ותלויים במסך)
function topLevel(file, name) {
  const src = fs.readFileSync(path.join(DIR, 'src', file), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' לא נמצאה ב-' + file);
  return src.slice(start, src.indexOf('\n}\n', start) + 3);
}

test('אנשי קשר: שם מוכר עם מירכאות ותגיות לא פורץ מהמאפיין', () => {
  const s = loadShamai(['core']);
  s.run(topLevel('opp-extras.js', 'detectPhone'));
  s.run(topLevel('contacts.js', 'contactKeyOf'));
  s.run(topLevel('contacts.js', 'getContactsFromOpps'));
  s.run(topLevel('contacts.js', 'renderContactsView'));
  s.ctx.__opps = [
    { id: 'o1', name: 'טבעת זהב', status: 'open', asking: 1200, created: '2026-10-01', seller: 'משה" onmouseover="x()' },
    { id: 'o2', name: 'שעון כסף', status: 'open', asking: 800, created: '2026-10-02', seller: '<img src=x>לוי' },
  ];
  s.run('state.opportunities = __opps; renderContactsView();');
  const html = s.el('#contacts-view').innerHTML;
  assert.ok(html.includes('contact-card'), 'המסך נבנה');
  assert.doesNotMatch(html, /onmouseover="x\(\)"/, 'המירכאות בשם לא סוגרות את המאפיין');
  assert.doesNotMatch(html, /<img src=x>/, 'תגית בשם לא נכנסת לעמוד');
  assert.match(html, /data-contact="משה&quot; onmouseover=&quot;x\(\)">/, 'השם כולו בתוך המאפיין, מקודד');
});
