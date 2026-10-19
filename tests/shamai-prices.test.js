// מחירי ייחוס בלי אינטרנט (PLAN.md 9.9): תאריך ומקור לכל מחיר, "המחיר בן X ימים", הזנה ידנית וקובץ מחירים,
// ובלי שום פנייה לרשת. כל הנתונים בדוגמאות בדויים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DIR, loadShamai, shamaiSource } = require('./helpers/shamai-src');

const load = () => loadShamai(['core', 'prices']);
const BASE = { gold: 4665, silver: 75, platinum: 1850, usdIls: 3.65, lastUpdate: null, source: 'default' };
const j = (v) => JSON.parse(JSON.stringify(v));

test('בלי תאריך — "לא עודכן"; תאריך לכל מחיר; בן כמה ימים ומצב: עדכני / ישן / ישן מאוד', () => {
  const { run } = load();
  run(`var P = ${JSON.stringify(BASE)};`);
  assert.equal(run(`priceFreshness(P, 'gold', '2026-10-19').state`), 'unknown');
  assert.equal(run(`priceAgeLabel(priceFreshness(P, 'gold', '2026-10-19'))`), 'לא עודכן — ערך ייחוס קבוע');
  run(`P.meta = { gold: { date: '2026-10-19', source: 'manual' }, silver: { date: '2026-10-17', source: 'file' }, usdIls: { date: '2026-10-10', source: 'manual' } };`);
  assert.deepEqual(j(run(`priceFreshness(P, 'gold', '2026-10-19')`)), { k: 'gold', date: '2026-10-19', days: 0, state: 'fresh', source: 'manual', note: '' });
  assert.equal(run(`priceFreshness(P, 'silver', '2026-10-19').state`), 'stale');
  assert.equal(run(`priceAgeLabel(priceFreshness(P, 'silver', '2026-10-19'))`), 'בן 2 ימים');
  assert.equal(run(`priceFreshness(P, 'usdIls', '2026-10-19').state`), 'old');
  assert.equal(run(`priceAgeLabel(priceFreshness(P, 'gold', '2026-10-20'))`), 'בן יום אחד');
  // הסיכום לפי הישן ביותר מבין זהב / כסף / דולר
  const s = j(run(`priceSummary(P, '2026-10-19')`));
  assert.equal(s.state, 'old');
  assert.equal(s.worst.k, 'usdIls');
  // נתונים מגרסה קודמת: lastUpdate ידני בלי meta — התאריך נלקח ממנו
  run(`var OLD = { gold: 4600, source: 'manual', lastUpdate: new Date(2026, 9, 15, 10).toISOString() };`);
  assert.equal(run(`priceFreshness(OLD, 'gold', '2026-10-19').date`), '2026-10-15');
  run(`OLD.source = 'default';`);
  assert.equal(run(`priceFreshness(OLD, 'gold', '2026-10-19').state`), 'unknown', 'ברירת מחדל אינה עדכון');
});

test('עדכון: אימות טווח, תאריך לא עתידי, מחיר ישן לא דורס חדש, המקור והערה נשמרים', () => {
  const { run } = load();
  run(`var P = ${JSON.stringify(BASE)};`);
  const r = j(run(`applyPriceUpdate(P, { gold: '4,712.50', usdIls: '3.618' }, { date: '2026-10-18', source: 'manual', note: 'מחירון הבוקר', today: '2026-10-19' })`));
  assert.deepEqual(r.changed, ['gold', 'usdIls']);
  assert.equal(r.prices.gold, 4712.5);
  assert.equal(r.prices.usdIls, 3.618);
  assert.deepEqual(r.prices.meta.gold, { date: '2026-10-18', source: 'manual', note: 'מחירון הבוקר' });
  assert.equal(r.prices.silver, 75, 'מה שלא הוזן לא משתנה');
  assert.equal(r.prices.source, 'manual');
  assert.ok(r.prices.lastUpdate);
  assert.equal(run('P.meta'), undefined, 'המקור לא שונה (עותק חדש)');
  // ישן יותר מהשמור — מדולג
  run(`var Q = ${JSON.stringify(r.prices)};`);
  const older = j(run(`applyPriceUpdate(Q, { gold: 4500 }, { date: '2026-10-10', today: '2026-10-19' })`));
  assert.deepEqual(older.changed, []);
  assert.equal(older.prices.gold, 4712.5);
  assert.throws(() => run(`applyPriceUpdate(P, { gold: 4700 }, { date: '2026-10-20', today: '2026-10-19' })`), /אחרי היום/);
  assert.throws(() => run(`applyPriceUpdate(P, { gold: 4700 }, { date: '19/10/2026', today: '2026-10-19' })`), /אינו תקין/);
  assert.throws(() => run(`applyPriceUpdate(P, { gold: 4700 }, { date: '2026-02-30', today: '2026-10-19' })`), /אינו תקין/, '30 בפברואר נדחה');
  assert.throws(() => run(`applyPriceUpdate(P, {}, { today: '2026-10-19' })`), /מחיר אחד לפחות/);
  // מחיר לגרם במקום לאונקיה, דולר 36 במקום 3.6, טקסט
  assert.throws(() => run(`applyPriceUpdate(P, { gold: 150 }, { today: '2026-10-19' })`), /מחוץ לטווח/);
  assert.throws(() => run(`applyPriceUpdate(P, { usdIls: 36 }, { today: '2026-10-19' })`), /מחוץ לטווח/);
  assert.throws(() => run(`applyPriceUpdate(P, { silver: 'abc' }, { today: '2026-10-19' })`), /יש להזין מספר/);
  assert.throws(() => run(`applyPriceUpdate(P, { gold: 4700 }, { source: 'web', today: '2026-10-19' })`), /מקור/);
});

test('קובץ מחירים: CSV בעברית ובאנגלית, JSON עם prices ושטוח, תאריך ישראלי, שורות לא מוכרות, וערך שגוי פוסל את הקובץ', () => {
  const { run } = load();
  const csv = '﻿שם,מחיר\r\nתאריך,18/10/2026\r\nמקור,מחירון לדוגמה\r\nזהב,"4650.25"\r\nכסף;54.1\r\nUSD,3.62\r\nיהלום,9000\r\n';
  const p = j(run(`parsePriceFile(${JSON.stringify(csv)})`));
  assert.equal(p.date, '2026-10-18');
  assert.equal(p.note, 'מחירון לדוגמה');
  assert.deepEqual(p.values, { gold: '4650.25', silver: '54.1', usdIls: '3.62' });
  assert.deepEqual(p.unknown, ['יהלום']);
  const js = j(run(`parsePriceFile(${JSON.stringify(JSON.stringify({ date: '2026-10-19', source: 'הבורסה', prices: { XAU: 4700, xag: 55, eur: 4.1 } }))})`));
  assert.deepEqual(js.values, { gold: 4700, silver: 55, eurIls: 4.1 });
  assert.equal(js.note, 'הבורסה');
  assert.deepEqual(j(run(`parsePriceFile('{"gold": 4700}')`)).values, { gold: 4700 });
  assert.equal(run(`parsePriceFile('{"gold": 4700}').date`), null);
  assert.throws(() => run(`parsePriceFile('')`), /ריק/);
  assert.throws(() => run(`parsePriceFile('{oops')`), /JSON/);
  assert.throws(() => run(`parsePriceFile('a,b\\nc,d')`), /לא נמצאו מחירים/);
  assert.throws(() => run(`parsePriceFile('זהב,4700\\nתאריך,אתמול')`), /התאריך/);
  assert.throws(() => run(`parsePriceFile('זהב,4700\\nכסף,5000')`), /כסף.*מחוץ לטווח/);
  assert.throws(() => run(`parsePriceFile('x'.repeat(70000))`), /גדול מדי/);
});

test('תזכורת: אין כשהמחירים עדכניים; "המחיר בן X ימים" עם שמות המחירים; לא עודכן מעולם — אזהרה', () => {
  const { run } = load();
  run(`var P = ${JSON.stringify(BASE)};`);
  assert.equal(run(`priceReminder(P, '2026-10-19').title`), 'מחירי הזהב והכסף לא עודכנו');
  run(`P.meta = { gold: { date: '2026-10-19' }, silver: { date: '2026-10-19' }, usdIls: { date: '2026-10-19' } };`);
  assert.equal(run(`priceReminder(P, '2026-10-19')`), null);
  assert.equal(run(`priceStatusText(P, '2026-10-19').text`), 'מחירים מ-19.10.2026');
  run(`P.meta.silver.date = '2026-10-14';`);
  const r = j(run(`priceReminder(P, '2026-10-19')`));
  assert.equal(r.title, 'המחיר בן 5 ימים');
  assert.match(r.sub, /^כסף —/);
  assert.equal(r.cls, 'warn');
  assert.deepEqual(j(run(`priceStatusText(P, '2026-10-19')`)), { cls: 'warn', text: 'כסף: בן 5 ימים' });
});

test('ממשק: הלוח מציג כל מחיר עם תאריך, שמירה מעדכנת את המחסן, ואין רשת', () => {
  const { run, el } = load();
  run(`state.prices = ${JSON.stringify({ ...BASE, meta: { gold: { date: '2026-10-01', source: 'file', note: 'מחירון' } } })};
    var calls = []; renderHeader = () => calls.push('h'); renderDashboard = () => calls.push('d'); toast = (m, t) => calls.push(t + ':' + m);
    localToday = () => '2026-10-19';`);
  run('renderPricePanel()');
  const list = el('#pp-list').innerHTML;
  assert.match(list, /זהב[\s\S]*בן 18 ימים · 1\.10\.2026 · קובץ מחירים \(מחירון\)/);
  assert.match(list, /פלטינה[\s\S]*לא עודכן/);
  assert.match(el('#pp-form').innerHTML, /id="pp-gold"/);
  assert.equal(el('#pp-date').value, '2026-10-19');
  el('#pp-gold').value = '4720';
  el('#pp-date').value = '2026-10-19';
  run('savePriceForm()');
  assert.equal(run('state.prices.gold'), 4720);
  assert.equal(run('state.prices.meta.gold.date'), '2026-10-19');
  assert.equal(run(`JSON.parse(localStorage.getItem('shamai_v2_prices')).meta.gold.source`), 'manual');
  assert.ok(run('calls').some(c => c.startsWith('success:')));
  el('#pp-silver').value = '9999';
  run('savePriceForm()');
  assert.ok(run('calls').some(c => /^error:.*כסף/.test(c)));
  // אין fetch / XHR / כתובות רשת בקוד המחירים, וקוד הרענון האוטומטי הוסר
  const src = fs.readFileSync(path.join(DIR, 'src', 'prices.js'), 'utf8');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|https?:\/\//);
  assert.doesNotMatch(shamaiSource(), /fetchAllPrices|startAutoRefresh/);
});

test('חיבור: prices.js נטען אחרי core ולפני המסכים, נמצא במטמון ה-sw, וכל קריאה למחירים הוחלפה בלוח', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const idx = (f) => html.indexOf(`src="src/${f}.js"`);
  assert.ok(idx('core') < idx('prices') && idx('prices') < idx('dashboard'));
  assert.match(fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8'), /'\.\/src\/prices\.js'/);
  assert.match(html, /id="price-panel"/);
  assert.match(html, /id="price-file"[^>]*accept=/);
  const src = shamaiSource();
  assert.match(src, /attachPricePanel\(\)/);
  assert.match(src, /priceReminder\(state\.prices\)/);
  assert.match(src, /priceStatusText\(state\.prices\)/);
  assert.doesNotMatch(src, /lpb-refresh" onclick/);
});
