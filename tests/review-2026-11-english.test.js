// סקירת קוד 11.2026 — מודול האנגלית (u04): חזרה מרווחת, מסיחים ובוחן איות, תרגומים ומשפטי דוגמה,
// נגישות הכרטיסייה ומקלדת, שמירה שנכשלה (קריאה בלבד), ומספר "לחזרה היום". ממשק — app.js ב-vm עם DOM מדומה.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createEnglishUI } = require('./helpers/english-ui');

const DIR = path.join(__dirname, '..', 'modules', 'english');
const L = require(path.join(DIR, 'logic.js'));
const W = require(path.join(DIR, 'words.js'));
const G = require(path.join(DIR, 'grammar.js'));
const T = 20000;
const BY = id => W.WORDS.find(w => w.id === id);

const NOW = Date.UTC(2026, 10, 5, 10);
const TODAY = L.dayIndex(new Date(NOW));
const LEARNER = { 'english:learners': JSON.stringify({ list: [{ id: 'abcd1234', name: 'יוסי', created: 1 }], active: 'abcd1234' }) };
const withProgress = (progress, settings) => Object.assign({}, LEARNER,
  progress ? { 'english:progress:abcd1234': JSON.stringify(progress) } : {},
  settings ? { 'english:settings': JSON.stringify(settings) } : {});
const RO = { name: 'SecurityError', message: 'השינוי לא נשמר: תקופת הניסיון הסתיימה' };

// ---------- f44: חזרה שלא בזמנה ----------
test('f44: טעות בבוחן ואחריה "ידעתי" באותו יום — המרווח לא גדל מעבר למרווח הקודם', () => {
  const before = { b: 4, d: T + 8, c: 4, w: 0, s: 4, l: T };
  const prevInterval = L.INTERVALS[before.b];
  let c = L.quizAnswer(before, false, T);
  c = L.review(c, true, T);
  assert.ok(c.d - T <= prevInterval, 'מרווח ' + (c.d - T) + ' > ' + prevInterval);
  assert.ok(c.b < before.b, 'הטעות הורידה קופסה');
});

test('f44: הרצות חוזרות של "מילים קשות" באותו יום לא מקדמות קופסה ולא מרחיקות את החזרה', () => {
  let c = { b: 1, d: T + 1, c: 0, w: 2, s: 2, l: T };
  for (let i = 0; i < 5; i++) c = L.review(c, true, T);
  assert.equal(c.b, 1);
  assert.equal(c.d, T + 1);
  assert.equal(c.c, 5, 'התשובות הנכונות נספרות');
  assert.ok(c.b < L.LEARNED_BOX, 'לא מסומנת "נלמדה" בלי ריווח');
  // טעות בחזרה מוקדמת — חוזרת לקופסה 1 ולמחר כרגיל
  const wrong = L.review({ b: 4, d: T + 8, c: 4, w: 0, s: 4 }, false, T);
  assert.deepEqual([wrong.b, wrong.d], [1, T + 1]);
  // חזרה בזמנה — מתקדמת כרגיל
  const due = L.review({ b: 2, d: T, c: 2, w: 0, s: 2 }, true, T);
  assert.deepEqual([due.b, due.d], [3, T + 4]);
});

test('f44: מילה שנראתה רק בבוחן ותורגלה ב"לתרגל את הטעויות" לא נספרת כ"חדשה היום"', () => {
  const quizOnly = L.quizAnswer(undefined, false, T);
  const practised = L.review(quizOnly, true, T, { countNew: false });
  assert.equal(practised.f, undefined);
  assert.equal(L.newToday({ x: practised }, T), 0);
  // בתור היומי — נספרת כרגיל
  assert.equal(L.review(undefined, true, T).f, T);
  assert.equal(L.review(quizOnly, true, T).f, T);
});

test('f44: בממשק — טעויות מהבוחן שתורגלו בכרטיסיות לא מקטינות את מכסת המילים החדשות', async () => {
  const ui = createEnglishUI({ items: LEARNER, now: NOW });
  await ui.go('quiz');
  ui.doc.getElementById('quizCount').value = '5';
  ui.doc.getElementById('quizCount').dispatch('change');
  await ui.click('התחלת הבוחן', ui.view('quiz'));
  for (let i = 0; i < 5; i++) {
    const shown = ui.view('quiz').querySelector('.en-word-xl').textContent.trim();
    const w = W.WORDS.find(x => x.en === shown);
    const bad = ui.view('quiz').querySelectorAll('.en-option').find(b => !b.textContent.endsWith(w.he));
    bad.click();
    ui.doc.getElementById('quizNext').click();
    await ui.tick();
  }
  await ui.click('לתרגל את הטעויות בכרטיסיות', ui.view('quiz'));
  for (let i = 0; i < 5; i++) { ui.doc.querySelector('.en-flash').click(); ui.doc.querySelector('.en-btn-yes').click(); }
  const saved = JSON.parse(ui.store.map.get('english:progress:abcd1234'));
  const practised = Object.values(saved.cards).filter(c => c.s > 0);
  assert.equal(practised.length, 5);
  assert.equal(L.newToday(saved.cards, TODAY), 0);
  await ui.go('home');
  assert.match(ui.text(ui.view('home')), /לימוד יומי \(10\)/, 'המכסה של היום נשארה מלאה');
});

// ---------- f45: מסיחים ובוחן האיות ----------
test('f45: אף מסיח לא חולק משמעות עם המילה הנשאלת (בשני הכיוונים, על כל המילון)', () => {
  const rand = L.rng(7);
  for (const dir of ['en-he', 'he-en']) {
    for (const w of W.WORDS) {
      const q = L.buildChoice(w, W.WORDS, dir, rand, 4);
      assert.equal(q.options.length, 4, w.id);
      const own = L.meanings(w.he);
      for (const o of q.options) {
        if (o === q.answer) continue;
        const other = dir === 'en-he' ? L.meanings(o) : L.meanings(W.WORDS.find(x => x.en === o).he);
        assert.ok(!L.sharesMeaning(own, other), dir + ' ' + w.en + ' ← מסיח ' + o);
      }
    }
  }
  // הדוגמה מהממצא: love ("לאהוב") ו-like ("לחבב, לאהוב")
  for (let s = 1; s < 60; s++) {
    assert.ok(!L.buildChoice(BY('love'), W.WORDS, 'he-en', L.rng(s), 4).options.includes('like'));
    assert.ok(!L.buildChoice(BY('like'), W.WORDS, 'en-he', L.rng(s), 4).options.includes('לאהוב'));
  }
  assert.deepEqual(L.meanings('על (נושא), בערך'), ['על', 'בערך']);
});

test('f45: בוחן האיות מקבל מילה נרדפת תקינה ואיות בריטי, ולא מקבל מילה שמכסה רק חלק מהמשמעות', () => {
  const ok = (id, typed) => L.checkAnswer(typed, L.spellAnswers(BY(id), W.WORDS)).correct;
  assert.ok(ok('love', 'like'));
  assert.ok(ok('hard', 'hard'));
  assert.ok(ok('learn', 'study'));
  assert.ok(ok('gray', 'grey'));
  assert.ok(ok('color', 'colour'));
  assert.ok(ok('neighbor', 'neighbour'));
  assert.ok(ok('pajamas', 'pyjamas'));
  assert.ok(!ok('wife', 'woman'), '"אישה, רעיה" — woman ("אישה") לא מכסה את שתי המשמעויות');
  assert.ok(!ok('hard', 'easy'));
  assert.deepEqual(L.validateWords(W.WORDS, W.TOPICS), []);
  assert.ok(L.validateWords([{ id: 'x', en: 'x', he: 'א', topic: 'basic', level: 1, alt: ['<b>'] }], W.TOPICS).length);
});

test('f45: בוחן האיות לא מקבל הומונים — הסוגריים בתרגום מבדילים בין המשמעויות', () => {
  const ok = (id, typed) => L.checkAnswer(typed, L.spellAnswers(BY(id), W.WORDS)).correct;
  // הדוגמאות מהסקירה החוזרת: כולן היו מתקבלות כשהסוגריים הוסרו לפני ההשוואה
  const wrong = [['lip', 'language'], ['language', 'lip'], ['sister', 'nurse'], ['nurse', 'sister'],
    ['name', 'there'], ['there', 'name'], ['beard', 'old'], ['read', 'call'], ['ask', 'borrow'],
    ['borrow', 'ask'], ['he', 'it'], ['she', 'it'], ['ago', 'in front of'], ['ago', 'before'],
    ['before', 'ago'], ['before', 'in front of'], ['how many', 'some'], ['many', 'much'], ['much', 'many'],
    ['every', 'all'], ['on', 'about']];
  for (const [id, typed] of wrong) assert.ok(!ok(id, typed), id + ' ← ' + typed);
  // על כל המילון: התשובות הנוספות (מעבר למילה ולאיות החלופי) הן רק נרדפות אמיתיות
  const extra = [];
  for (const w of W.WORDS) {
    for (const a of L.spellAnswers(w, W.WORDS).slice(1 + (w.alt || []).length)) extra.push(w.en + '>' + a);
  }
  assert.deepEqual(extra.sort(), ['learn>study', 'love>like', 'woman>wife']);
  assert.deepEqual(L.exactMeanings('שפה (בפה),  קשה ( מסובך )'), ['שפה (בפה)', 'קשה (מסובך)']);
});

// ---------- f118 / f119 / f120 / f121 / f115: תוכן ----------
test('f118/f119/f120: תרגומים — wife, tiger / leopard, change, move; how עם דוגמה שאינה ביטוי', () => {
  assert.equal(BY('wife').he, 'אישה, רעיה');
  assert.ok(!W.WORDS.some(w => /אשת[\s־-]?איש/.test(w.he)), 'אין "אשת איש" במילון');
  assert.equal(BY('tiger').he, 'טיגריס');
  assert.equal(BY('leopard').he, 'נמר');
  assert.ok(L.meanings(BY('change').he).includes('להחליף'));
  assert.ok(L.meanings(BY('move').he).includes('להזיז'));
  assert.notEqual(BY('how').ex, 'How are you?');
});

test('f121: קרבת משפחה שמשמשת כשם (בלי כינוי שייכות) — באות גדולה, במילון ובדקדוק', () => {
  const sentences = W.WORDS.filter(w => w.ex).map(w => w.ex);
  for (const l of G.LESSONS) {
    for (const r of l.rules) sentences.push(r.en);
    for (const e of l.exercises) sentences.push(e.q);
  }
  const DET = new Set(['my', 'your', 'his', 'her', 'our', 'their', 'its', 'the', 'a', 'this', 'that']);
  const bad = [];
  for (const s of sentences) {
    const toks = s.split(/\s+/);
    toks.forEach((t, i) => {
      if (/^(mother|father|grandmother|grandfather)('s)?[.,!?]*$/.test(t) && !DET.has((toks[i - 1] || '').toLowerCase())) bad.push(s);
    });
  }
  assert.deepEqual(bad, []);
});

test('f115: ההסבר של to be לא מלמד "אני הוא תלמיד"', () => {
  const lesson = G.LESSONS.find(l => l.id === 'to-be');
  assert.ok(!/אני הוא/.test(lesson.intro));
  assert.ok(/I am a student/.test(lesson.intro));
});

// ---------- f42: הכרטיסייה לקורא מסך ----------
test('f42: לכרטיס שם נגיש עם המילה, ואחרי ההפיכה — עם התשובה; הצד המוסתר aria-hidden', async () => {
  const ui = createEnglishUI({ items: LEARNER, now: NOW });
  await ui.go('cards');
  await ui.click('התחלה', ui.view('cards'));
  const card = ui.doc.querySelector('.en-flash');
  const w = BY('mother');
  assert.match(card.getAttribute('aria-label'), new RegExp(w.en));
  assert.equal(ui.doc.querySelector('.en-back').getAttribute('aria-hidden'), 'true');
  card.click();
  assert.match(card.getAttribute('aria-label'), new RegExp(w.he));
  assert.equal(ui.doc.querySelector('.en-front').getAttribute('aria-hidden'), 'true');
  assert.equal(ui.doc.querySelector('.en-back').getAttribute('aria-hidden'), null);
  assert.match(ui.doc.getElementById('cardLive').textContent, new RegExp(w.he), 'הכרזה באזור aria-live');
});

// ---------- f114: מקלדת ----------
test('f114: Enter על כפתור "סיום" מסיים את הסבב ולא הופך את הכרטיס; רווח על העמוד הופך', async () => {
  const ui = createEnglishUI({ items: LEARNER, now: NOW });
  await ui.go('cards');
  await ui.click('התחלה', ui.view('cards'));
  ui.doc.activeElement = ui.doc.body;
  ui.key(' ');
  assert.match(ui.doc.querySelector('.en-flash').className, /flipped/);
  ui.key(' ');
  ui.button('סיום', ui.view('cards')).focus();
  ui.key('Enter');
  assert.ok(!ui.doc.querySelector('.en-flash'), 'הסבב הסתיים');
  assert.match(ui.text(ui.view('cards')), /הסבב הסתיים/);
});

test('f42: Enter על כרטיס הפוך שבמיקוד (אחרי תשובה במקלדת) לא מחזיר אותו לחזית', async () => {
  const ui = createEnglishUI({ items: LEARNER, now: NOW });
  await ui.go('cards');
  await ui.click('התחלה', ui.view('cards'));
  ui.doc.activeElement = ui.doc.body;
  ui.key(' ');
  ui.key('2');
  const card = ui.doc.querySelector('.en-flash');
  assert.equal(ui.doc.activeElement, card, 'המיקוד על הכרטיס החדש');
  ui.key(' ');
  assert.match(card.className, /flipped/);
  const ev = ui.key('Enter');
  assert.ok(ev.defaultPrevented);
  assert.match(ui.doc.querySelector('.en-flash').className, /flipped/, 'הכרטיס נשאר הפוך');
  // לפני ההפיכה Enter הופך כרגיל
  ui.key('2');
  ui.key('Enter');
  assert.match(ui.doc.querySelector('.en-flash').className, /flipped/);
});

// ---------- f43: הגדרות שלא נשמרו ----------
test('f43: שמירת הגדרה שנדחתה — לא מוצג "נשמר", ההגדרה והשדה חוזרים לערך הקודם', async () => {
  const ui = createEnglishUI({ items: LEARNER, now: NOW, fail: (op, k) => (k === 'english:settings' ? RO : null) });
  await ui.go('settings');
  const input = ui.doc.getElementById('setGoal');
  ui.change(input, 30);
  assert.ok(!ui.log.toasts.includes('נשמר'), ui.log.toasts.join(' | '));
  assert.equal(ui.log.toasts.at(-1), RO.message, 'הסיבה המדויקת מהמחסן');
  assert.equal(ui.doc.getElementById('setGoal').value, '20');
  await ui.go('home');
  assert.match(ui.text(ui.view('home')), /המטרה היומית: 20 /);
});

test('f43: אחרי שמירה מוצלחת, ערך לא חוקי חוזר לערך השמור האחרון (לא לערך מזמן הציור)', async () => {
  const ui = createEnglishUI({ items: LEARNER, now: NOW });
  await ui.go('settings');
  const input = ui.doc.getElementById('setGoal');
  ui.change(input, 30);
  assert.equal(ui.log.toasts.at(-1), 'נשמר');
  ui.change(input, 500);
  assert.equal(input.value, '30');
  assert.equal(JSON.parse(ui.store.map.get('english:settings')).dailyGoal, 30);
});

// ---------- f113: קריאה בלבד ----------
test('f113: קריאה בלבד — מעבר לשונית בלי הודעה, באנר קבוע, וההתקדמות שלא נשמרה לא מוצגת', async () => {
  const ui = createEnglishUI({ items: LEARNER, now: NOW, fail: () => RO });
  await ui.go('words');
  await ui.go('cards');
  assert.deepEqual(ui.log.toasts, [], 'הלשונית האחרונה נכשלת בשקט');
  const banner = ui.doc.getElementById('roBanner');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /תקופת הניסיון הסתיימה/);
  await ui.click('התחלה', ui.view('cards'));
  ui.doc.querySelector('.en-flash').click();
  ui.doc.querySelector('.en-btn-yes').click();
  await ui.tick();
  assert.equal(ui.log.toasts.at(-1), RO.message);
  await ui.go('home');
  const home = ui.text(ui.view('home'));
  assert.match(home, /עוד 20 להיום/, 'המונה היומי לא עלה');
  assert.match(home, /לימוד יומי \(10\)/, 'הכרטיס לא יצא מהתור');
});

test('f113: שינוי שם שנדחה — השם הקודם נשאר', async () => {
  const ui = createEnglishUI({ items: LEARNER, now: NOW, fail: (op, k) => (k === 'english:learners' ? RO : null) });
  await ui.go('settings');
  ui.answers.prompt.push('דוד');
  await ui.click('שינוי שם', ui.view('settings'));
  await ui.tick();
  assert.match(ui.text(ui.view('settings')), /יוסי/);
  assert.doesNotMatch(ui.text(ui.view('settings')), /דוד/);
});

test('f113: הבאנר נעלם כשהשמירה חוזרת לעבוד — אבל לא בגלל כתיבה קטנה שהצליחה בזמן שההתקדמות עדיין נדחית', async () => {
  const QUOTA = { name: 'QuotaExceededError', message: 'השינוי לא נשמר: אין מספיק מקום' };
  const ui = createEnglishUI({ items: LEARNER, now: NOW });
  const banner = ui.doc.getElementById('roBanner');
  // כשל רגעי בכתיבה שקטה (הלשונית) — הבאנר מוצג, ונעלם בשמירה הבאה שמצליחה
  ui.store.setFail(() => RO);
  await ui.go('words');
  assert.equal(banner.hidden, false);
  ui.store.setFail(null);
  await ui.go('cards');
  assert.equal(banner.hidden, true, 'השמירה חזרה — הבאנר הוסר');
  // ההתקדמות נדחית (גדולה מדי) והלשונית נשמרת — הבאנר נשאר
  ui.store.setFail((op, k) => (k.startsWith('english:progress:') ? QUOTA : null));
  await ui.click('התחלה', ui.view('cards'));
  ui.doc.querySelector('.en-flash').click();
  ui.doc.querySelector('.en-btn-yes').click();
  await ui.tick();
  assert.equal(banner.hidden, false);
  await ui.go('home');
  await ui.go('cards');
  assert.equal(banner.hidden, false, 'הלשונית נשמרה, אבל ההתקדמות עדיין לא');
  // ההתקדמות נשמרת שוב — הבאנר נעלם
  ui.store.setFail(null);
  ui.doc.querySelector('.en-flash').click(); // הסבב עדיין פתוח — הכרטיס הבא
  ui.doc.querySelector('.en-btn-yes').click();
  await ui.tick();
  assert.equal(banner.hidden, true);
});

// ---------- f116: "לחזרה היום" ----------
test('f116: מילים לחזרה מחוץ לנושא שנבחר — רמז במסך הבית ובמסך הכרטיסיות, ופירוט במסך ההתקדמות', async () => {
  const progress = { v: 1, cards: { mother: { b: 2, d: TODAY - 1, c: 2, w: 0, s: 2 } }, days: {}, quiz: { c: 0, t: 0 }, grammar: {} };
  const ui = createEnglishUI({ items: withProgress(progress, { topic: 'animals', levels: [1] }), now: NOW });
  assert.match(ui.text(ui.view('home')), /ועוד 1 מחוץ לנושא או לרמות שנבחרו/);
  await ui.go('cards');
  assert.match(ui.text(ui.view('cards')), /עוד 1 מילים לחזרה היום מחוץ לנושא/);
  await ui.go('progress');
  assert.match(ui.text(ui.view('progress')), /1 לחזרה היום \(מהם 0 בנושא וברמות שנבחרו\)/);
});

// ---------- f41: הודעה כשאין קול ----------
test('f41: בטלפון ההודעה על היעדר הקול לא מפנה להגדרות של Windows', async () => {
  const phone = createEnglishUI({ items: LEARNER, now: NOW, userAgent: 'Mozilla/5.0 (Linux; Android 13; wv)' });
  await phone.go('settings');
  const note = phone.doc.querySelector('.en-voice-note').textContent;
  assert.doesNotMatch(note, /Windows/);
  assert.match(note, /בטלפון/);
  const pc = createEnglishUI({ items: LEARNER, now: NOW });
  await pc.go('settings');
  assert.match(pc.doc.querySelector('.en-voice-note').textContent, /Windows/);
});
