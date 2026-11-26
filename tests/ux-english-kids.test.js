// אנגלית לילדים שלומדים לבד (תוכנית "כל אחד מסתדר", WP6 / WP3 / WP4 / WP8 / WP11): מחיקת לומד ואיפוס התקדמות
// רק אחרי תרגיל של מבוגרים, ביטול אחרי הפעולה, הוראות בעברית עם הקראה בקול מקומי בלבד, קישור ישיר ללימוד היומי.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEnglishUI } = require('./helpers/english-ui');

const DIR = path.join(__dirname, '..', 'modules', 'english');
const NOW = Date.UTC(2026, 10, 5, 10);
const solveAdult = msg => { const m = /(\d+) × (\d+)/.exec(msg); return m ? String(m[1] * m[2]) : ''; };
const TWO = () => ({
  'english:learners': JSON.stringify({ list: [{ id: 'aaaa1111', name: 'יוסי', created: 1 }, { id: 'bbbb2222', name: 'דוד', created: 1 }], active: 'aaaa1111' }),
  'english:progress:aaaa1111': JSON.stringify({ cards: {}, quiz: { t: 9, c: 7 }, days: {}, grammar: {} })
});
const learnerIds = ui => JSON.parse(ui.store.map.get('english:learners')).list.map(l => l.id);

test('מחיקת לומד — רק אחרי תרגיל של מבוגרים; תשובה שגויה לא מוחקת', async () => {
  const ui = createEnglishUI({ items: TWO(), now: NOW });
  ui.answers.prompt.push('3');
  await ui.go('settings');
  await ui.click('מחיקה');
  await ui.tick();
  assert.match(ui.log.prompts[0], /זו פעולה להורים/);
  // תרגיל של מבוגרים: שני גורמים דו-ספרתיים 13–29 (לא כפל של כיתות נמוכות)
  const [, a, b] = /(\d+) × (\d+)/.exec(ui.log.prompts[0]).map(Number);
  for (const n of [a, b]) assert.ok(n >= 13 && n <= 29 && n !== 20, String(n));
  assert.deepEqual(learnerIds(ui), ['aaaa1111', 'bbbb2222']);
  assert.match(ui.log.alerts[0], /לא נכונה/);
});

test('מחיקת לומד — אחרי התרגיל נמחק, ו"ביטול" מחזיר אותו עם ההתקדמות', async () => {
  const ui = createEnglishUI({ items: TWO(), now: NOW });
  const before = ui.store.map.get('english:progress:aaaa1111');
  ui.answers.prompt.push(solveAdult);
  await ui.go('settings');
  await ui.click('מחיקה');
  await ui.tick(); await ui.tick();
  assert.deepEqual(learnerIds(ui), ['bbbb2222']);
  assert.equal(ui.store.map.get('english:progress:aaaa1111'), undefined);
  assert.equal(ui.log.toasts.at(-1), 'נמחק: יוסי');
  await ui.click('ביטול', ui.doc.getElementById('toast'));
  assert.deepEqual(learnerIds(ui), ['aaaa1111', 'bbbb2222']);
  assert.deepEqual(JSON.parse(ui.store.map.get('english:progress:aaaa1111')), JSON.parse(before));
  assert.equal(ui.log.toasts.at(-1), 'הוחזר: יוסי');
});

test('איפוס התקדמות — אחרי התרגיל, ועם ביטול שמחזיר את ההתקדמות', async () => {
  const ui = createEnglishUI({ items: TWO(), now: NOW });
  ui.answers.prompt.push(null);
  await ui.go('settings');
  await ui.click('איפוס ההתקדמות');
  await ui.tick();
  assert.equal(JSON.parse(ui.store.map.get('english:progress:aaaa1111')).quiz.t, 9, 'ביטול התרגיל — בלי איפוס');
  ui.answers.prompt.push(solveAdult);
  await ui.click('איפוס ההתקדמות');
  await ui.tick(); await ui.tick();
  assert.equal(JSON.parse(ui.store.map.get('english:progress:aaaa1111')).quiz.t, 0);
  await ui.click('ביטול', ui.doc.getElementById('toast'));
  assert.equal(JSON.parse(ui.store.map.get('english:progress:aaaa1111')).quiz.t, 9);
  assert.equal(ui.log.toasts.at(-1), 'ההתקדמות חזרה');
});

test('הודעה רגילה נשארת 6 שניות לפחות; ביטול — 10 שניות, ואחריהן ההודעה מתרוקנת (אין כפתור שקוף ב-Tab)', async () => {
  const ui = createEnglishUI({ items: TWO(), now: NOW });
  const toast = ui.doc.getElementById('toast');
  ui.answers.prompt.push(solveAdult);
  await ui.go('settings');
  await ui.click('מחיקה');
  await ui.tick(); await ui.tick();
  assert.equal(ui.log.toasts.at(-1), 'נמחק: יוסי');
  assert.ok(ui.longTimers().includes(10000), ui.longTimers().join());
  ui.expireLong(9999);
  assert.equal(toast.querySelectorAll('button').length, 1, 'עד 10 שניות — "ביטול" זמין');
  ui.expireLong(10000);
  assert.equal(toast.textContent, '', 'ההודעה התרוקנה');
  assert.equal(toast.querySelectorAll('button').length, 0, 'אין כפתור "ביטול" שקוף');
  assert.deepEqual(learnerIds(ui), ['bbbb2222'], 'המחיקה נשארה');
  // הודעה רגילה: לפחות 6 שניות
  const ui2 = createEnglishUI({ items: TWO(), now: NOW });
  ui2.answers.prompt.push(solveAdult);
  await ui2.go('settings');
  await ui2.click('מחיקה');
  await ui2.tick(); await ui2.tick();
  await ui2.click('ביטול', ui2.doc.getElementById('toast'));
  assert.equal(ui2.log.toasts.at(-1), 'הוחזר: יוסי');
  assert.ok(ui2.longTimers().length >= 1 && ui2.longTimers().every(ms => ms >= 6000), ui2.longTimers().join());
  ui2.expireLong(5999);
  assert.equal(ui2.doc.getElementById('toast').textContent, 'הוחזר: יוסי');
  ui2.expireLong();
  assert.equal(ui2.doc.getElementById('toast').textContent, '');
  const src = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
  assert.match(src, /const SAVE_FAILED = 'לא נשמר\. אם זה חוזר — קראו למנהל התוכנה\.';/);
});

test('בוחן: הוראה בעברית בכל שאלה; הקראה רק בקול עברי מקומי', async () => {
  const noHe = createEnglishUI({ items: TWO(), now: NOW, voices: [{ lang: 'en-US', localService: true }, { lang: 'he-IL', localService: false }] });
  assert.equal(noHe.doc.body.classList.contains('en-no-he-voice'), true, 'קול ברשת — לא נחשב');
  const ui = createEnglishUI({ items: TWO(), now: NOW, voices: [{ lang: 'he-IL', localService: true }] });
  assert.equal(ui.doc.body.classList.contains('en-no-he-voice'), false);
  await ui.go('quiz');
  await ui.click('התחלת הבוחן');
  const v = ui.view('quiz');
  assert.match(ui.text(v), /בחרו את התרגום הנכון/);
  await ui.click('🔊 הקראת ההוראה', v);
  assert.equal(ui.log.spoken.length, 1);
  assert.match(ui.log.spoken[0].text, /בחרו את התרגום/);
  assert.equal(ui.log.spoken[0].lang, 'he-IL');
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  assert.match(html, /<body class="en-no-he-voice">/);
  assert.match(fs.readFileSync(path.join(DIR, 'style.css'), 'utf8'), /\.en-no-he-voice \.en-say\{display:none !important\}/);
});

test('קישור ישיר: #ss-action=practice-today פותח את הלימוד היומי ומוחק את ה-hash; פעולה אחרת — מתעלמים', async () => {
  const ui = createEnglishUI({ items: TWO(), now: NOW, hash: '#ss-action=practice-today' });
  await ui.tick();
  assert.equal(ui.view('cards').hidden, false);
  assert.ok(ui.view('cards').querySelector('.en-flash'), 'כרטיס ראשון פתוח');
  assert.equal(ui.win.location.hash, '');
  const other = createEnglishUI({ items: TWO(), now: NOW });
  other.setHash('#ss-action=reset-progress');
  assert.equal(other.view('home').hidden, false);
  assert.equal(other.win.location.hash, '');
  assert.equal(JSON.parse(other.store.map.get('english:progress:aaaa1111')).quiz.t, 9);
});

test('כפתור הוספת לומד במילים; 44px לכפתורים קטנים; לשוניות עם Home / End', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  assert.match(html, /id="learnerAdd">\+ לומד חדש<\/button>/);
  const css = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
  assert.match(css, /\.ss-btn-sm,\.ss-chip\{min-height:max\(44px,var\(--ss-ctl-h\)\)\}/);
  const src = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
  assert.match(src, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
});
