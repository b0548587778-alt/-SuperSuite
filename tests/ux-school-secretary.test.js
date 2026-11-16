// ניהול מוסד — העבודה היומית של מזכירה (תוכנית "כל אחד מסתדר", WP7 / WP3 / WP8 / WP11): ביטול אחרי "כולם נוכחים",
// ניקוי יום ומחיקה; כפתורי נוכחות עם סמל ומילה; פרטי תשלום מקופלים; לשוניות במקלדת; קישור ישיר לפעולה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../modules/school/logic.js');
const { createSchoolUI } = require('./helpers/school-ui');

const DIR = path.join(__dirname, '..', 'modules', 'school');
function items() {
  const d = L.emptyData();
  d.settings.name = 'תלמוד תורה לדוגמה';
  d.settings.year = 'תשפ"ז';
  d.classes.push({ id: 'c1', name: 'כיתה א׳', grade: '', teacherId: '' });
  d.students.push(L.normStudent({ id: 's1', first: 'משה', last: 'כהן', classId: 'c1' }), L.normStudent({ id: 's2', first: 'יעקב', last: 'לוי', classId: 'c1' }));
  d.assessments.push({ id: 'a1', title: 'מבחן חומש', subject: 'חומש', classId: 'c1', term: d.settings.terms[0], date: '', weight: 1, max: 100, scores: { s1: 90 }, demo: false, yearId: d.yearId });
  return L.splitData(d);
}
const stored = u => L.joinData(Object.fromEntries(u.store.map));
const today = () => L.localDay();
const marks = u => ((stored(u).attendance[today()] || {}).day) || {};
const toastEl = u => u.byId.toast;

test('"כולם נוכחים" — הודעה עם "ביטול" שמחזיר את היום כמו שהיה', async () => {
  const u = createSchoolUI({ items: items() });
  await u.go('att');
  await u.click('✓ כולם נוכחים');
  assert.deepEqual(marks(u), { s1: 'P', s2: 'P' });
  assert.equal(u.log.toasts.at(-1), 'סומנו 2 נוכחים');
  await u.click('ביטול', toastEl(u));
  assert.deepEqual(marks(u), {});
  assert.equal(u.log.toasts.at(-1), 'בוטל — הנתונים חזרו כמו שהיו');
});

test('ניקוי יום — בתפריט "עוד" (לא ליד "כולם נוכחים"), ועם ביטול', async () => {
  const u = createSchoolUI({ items: items() });
  await u.go('att');
  await u.click('✓ כולם נוכחים');
  const more = u.view.querySelector('details');
  assert.ok(more, 'יש תפריט "עוד"');
  assert.ok(more.querySelectorAll('button').some(b => b.textContent === 'ניקוי הסימונים של היום'));
  await u.click('ניקוי הסימונים של היום');
  assert.match(u.log.confirms.at(-1), /אפשר לבטל ב-10 השניות הקרובות/);
  assert.deepEqual(marks(u), {});
  await u.click('ביטול', toastEl(u));
  assert.deepEqual(marks(u), { s1: 'P', s2: 'P' });
});

test('מחיקת תלמיד ומבחן — עם ביטול; ביטול אחרי שינוי נוסף נחסם (לא מוחק את השינוי)', async () => {
  const u = createSchoolUI({ items: items() });
  await u.go('students');
  await u.click('מחיקת משה כהן');
  assert.equal(stored(u).students.length, 1);
  assert.equal(u.log.toasts.at(-1), 'נמחק: משה כהן');
  await u.click('ביטול', toastEl(u));
  assert.deepEqual(stored(u).students.map(s => s.id).sort(), ['s1', 's2']);
  assert.equal(stored(u).assessments[0].scores.s1, 90, 'גם הציונים חזרו');

  await u.go('grades');
  await u.click('מחיקת מבחן חומש');
  assert.equal(stored(u).assessments.length, 0);
  // שינוי אחר בינתיים (סימון נוכחות — בלי הודעה חדשה) — הביטול לא מוחק אותו
  await u.go('att');
  u.view.querySelector('.sc-att').querySelectorAll('button')[0].click();
  await u.tick();
  await u.click('ביטול', toastEl(u));
  assert.equal(stored(u).assessments.length, 0);
  assert.match(u.log.alerts.at(-1), /אי אפשר לבטל/);
  assert.deepEqual(marks(u), { s1: 'P' });
});

test('כפתורי נוכחות: סמל ומילה (לא רק צבע), וגובה של 44px לפחות', async () => {
  const u = createSchoolUI({ items: items() });
  await u.go('att');
  const texts = u.view.querySelector('.sc-att').querySelectorAll('button').map(b => b.textContent);
  assert.deepEqual(texts, ['✓נוכח', '✗נעדר', '◷איחור', '✎מוצדק']);
  const css = fs.readFileSync(path.join(DIR, 'school.css'), 'utf8');
  assert.match(css, /\.sc-att button \{ min-height: max\(44px, var\(--ss-ctl-h\)\);/);
  assert.doesNotMatch(css, /\.sc-att button \{ min-height: 30px/);
  assert.match(css, /\.ss-btn-sm, \.ss-chip \{ min-height: max\(44px, var\(--ss-ctl-h\)\); \}/);
});

test('רישום תשלום: אסמכתה והערה ב"פרטים נוספים"; בהמחאה הם נפתחים', async () => {
  const d = L.joinData(items());
  d.settings.type = 'school';
  const u = createSchoolUI({ items: L.splitData(d) });
  await u.go('tuition');
  await u.click('תשלום');
  const body = u.byId.dlgBody;
  const more = body.querySelector('details');
  assert.ok(more, 'יש "פרטים נוספים"');
  const labels = more.querySelectorAll('label').map(l => l.textContent.trim());
  assert.deepEqual(labels, ['אסמכתה / מספר המחאה', 'הערה']);
  assert.equal(more.open, false);
  const method = body.all().find(e => e.tagName === 'SELECT');
  method.value = 'check';
  method.dispatch('change');
  assert.equal(more.open, true, 'המחאה — נפתח');
  await u.submitDialog({ 'סכום (₪)': '100' }, 'רישום התשלום');
  assert.match(body.textContent, /מספר ההמחאה/);
  assert.ok(u.byId.dlg.open, 'החלון לא נסגר');
});

test('אחרי רישום תשלום — "הדפסת אישור התשלום" ככפתור ראשי', async () => {
  const u = createSchoolUI({ items: items() });
  await u.go('tuition');
  await u.click('תשלום');
  await u.submitDialog({ 'סכום (₪)': '250' }, 'רישום התשלום');
  const b = u.byId.dlgFoot.querySelectorAll('button')[0];
  assert.equal(b.textContent, '🖨 הדפסת אישור התשלום');
  assert.match(b.className, /ss-btn-primary/);
});

test('לשוניות במקלדת: חץ שמאלה — הלשונית הבאה, Home / End; רק הפעילה ב-Tab', async () => {
  const u = createSchoolUI({ items: items() });
  const tabs = u.byId.tabs;
  const key = k => tabs.dispatch('keydown', { key: k });
  const active = () => tabs.querySelectorAll('button').find(b => b.getAttribute('aria-selected') === 'true').getAttribute('data-tab');
  assert.equal(active(), 'dash');
  key('ArrowLeft');
  assert.equal(active(), 'students');
  key('End');
  assert.equal(active(), 'settings');
  key('Home');
  assert.equal(active(), 'dash');
  key('ArrowRight');
  assert.equal(active(), 'settings', 'מהראשונה ימינה — לאחרונה');
  assert.deepEqual(tabs.querySelectorAll('button').map(b => b.getAttribute('tabindex')).filter(x => x === '0'), ['0']);
});

test('קישור ישיר: נוכחות היום, תלמיד חדש, תשלום וציונים — רק מהרשימה; ה-hash נמחק ושום דבר לא נשמר', async () => {
  const u = createSchoolUI({ items: items(), hash: '#ss-action=attendance-today' });
  const before = JSON.stringify([...u.store.map].filter(([k]) => k !== 'school:ui'));
  assert.equal(u.byId.tabs.querySelector('[aria-selected=true]').getAttribute('data-tab'), 'att');
  assert.equal(u.win.location.hash, '');
  u.setHash('#ss-action=new-student');
  await u.tick();
  assert.ok(u.byId.dlg.open, 'טופס תלמיד חדש פתוח');
  assert.match(u.dialogText(), /תלמיד חדש/);
  u.byId.dlgClose.click();
  u.setHash('#ss-action=new-payment');
  await u.tick();
  assert.equal(u.log.confirms.length, 0, 'בלי טופס פתוח — בלי שאלה');
  assert.equal(u.byId.tabs.querySelector('[aria-selected=true]').getAttribute('data-tab'), 'tuition');
  assert.match(u.log.toasts.at(-1), /חפשו את התלמיד ולחצו "תשלום"/);
  u.setHash('#ss-action=grades');
  await u.tick();
  assert.equal(u.byId.tabs.querySelector('[aria-selected=true]').getAttribute('data-tab'), 'grades');
  u.setHash('#ss-action=wipe-all');
  await u.tick();
  assert.equal(u.byId.tabs.querySelector('[aria-selected=true]').getAttribute('data-tab'), 'grades', 'פעולה לא מוכרת — מתעלמים');
  assert.equal(u.win.location.hash, '');
  assert.equal(JSON.stringify([...u.store.map].filter(([k]) => k !== 'school:ui')), before, 'רק פותח מסך');
});

test('קישור ישיר כשטופס פתוח וממולא — שואלים קודם; "להמשיך למלא" משאיר את הטופס עם מה שהוקלד', async () => {
  const u = createSchoolUI({ items: items() });
  await u.go('students');
  await u.click('＋ תלמיד חדש');
  assert.ok(u.byId.dlg.open);
  const first = u.byId.dlgBody.querySelectorAll('input')[0];
  first.value = 'אברהם';
  u.answers.confirm.push(false);
  u.setHash('#ss-action=attendance-today');
  await u.tick(); await u.tick();
  assert.match(u.log.confirms.at(-1), /טופס פתוח שעוד לא נשמר/);
  assert.ok(u.byId.dlg.open, 'הטופס נשאר פתוח');
  assert.equal(first.value, 'אברהם', 'מה שהוקלד נשאר');
  assert.equal(u.byId.tabs.querySelector('[aria-selected=true]').getAttribute('data-tab'), 'students', 'הפעולה לא בוצעה');
  // "סגירה בלי שמירה" — הטופס נסגר והפעולה מתבצעת
  u.answers.confirm.push(true);
  u.setHash('#ss-action=attendance-today');
  await u.tick(); await u.tick();
  assert.equal(u.byId.dlg.open, false);
  assert.equal(u.byId.tabs.querySelector('[aria-selected=true]').getAttribute('data-tab'), 'att');
  assert.equal(stored(u).students.length, 2, 'שום דבר לא נשמר');
});

test('הודעה רגילה נשארת 6 שניות לפחות; ביטול — 10 שניות, ואחריהן ההודעה מתרוקנת (אין כפתור שקוף ב-Tab)', async () => {
  const u = createSchoolUI({ items: items() });
  await u.go('att');
  await u.click('✓ כולם נוכחים');
  assert.deepEqual(u.longTimers(), [10000]);
  u.expireLong(9999);
  assert.ok(u.hasButton('ביטול', toastEl(u)), 'עד 10 שניות — אפשר לבטל');
  u.expireLong(10000);
  assert.equal(toastEl(u).textContent, '', 'ההודעה התרוקנה');
  assert.equal(toastEl(u).querySelectorAll('button').length, 0, 'אין כפתור "ביטול" שקוף');
  assert.deepEqual(marks(u), { s1: 'P', s2: 'P' }, 'הסימון נשאר');
  // הודעה רגילה (בלי ביטול)
  await u.click('ניקוי הסימונים של היום');
  await u.click('ביטול', toastEl(u));
  assert.equal(u.log.toasts.at(-1), 'בוטל — הנתונים חזרו כמו שהיו');
  const ms = u.longTimers();
  assert.equal(ms.length, 1);
  assert.ok(ms[0] >= 6000, 'לפחות 6 שניות: ' + ms[0]);
  u.expireLong(5999);
  assert.equal(toastEl(u).textContent, 'בוטל — הנתונים חזרו כמו שהיו');
  u.expireLong();
  assert.equal(toastEl(u).textContent, '');
});

test('תפריט "עוד" בנוכחות: נסגר ב-Escape ובלחיצה מחוץ לו', async () => {
  const u = createSchoolUI({ items: items() });
  await u.go('att');
  const more = u.view.querySelector('details');
  more.open = true;
  more.querySelector('summary').dispatch('keydown', { key: 'Escape' });
  assert.equal(more.open, false, 'Escape');
  more.open = true;
  more.querySelector('summary').click();
  assert.equal(more.open, true, 'לחיצה בתוך התפריט — נשאר');
  u.view.click();
  assert.equal(more.open, false, 'לחיצה מחוץ לתפריט');
});

test('לשוניות: אזור התוכן הוא tabpanel שהלשונית הפעילה נותנת לו שם', async () => {
  const u = createSchoolUI({ items: items() });
  assert.match(fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'), /<main id="view" class="ss-stack" role="tabpanel"/);
  await u.go('att');
  const label = u.view.getAttribute('aria-labelledby');
  const tab = u.byId.tabs.querySelector('[aria-selected=true]');
  assert.equal(tab.getAttribute('id'), label);
  assert.equal(tab.getAttribute('data-tab'), 'att');
});
