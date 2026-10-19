// קניית זהב מלקוח (PLAN.md 9.18): חישוב באגורות מול ערכים ידועים, עמלה, פרטי מוכר, שטר קנייה, רישום ביומן ואזהרות.
// כל הנתונים בדוגמאות בדויים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DIR, loadShamai, shamaiSource } = require('./helpers/shamai-src');

const load = () => loadShamai(['core', 'calc', 'prices', 'ledger', 'report', 'purchase']);
// מחירים "עגולים": 3110.35$ לאונקיה = 100$ לגרם; כסף 31.1035$ = 1$ לגרם; דולר 4 ₪
const PRICES = { gold: 3110.35, silver: 31.1035, usdIls: 4, source: 'manual', lastUpdate: null,
  meta: { gold: { date: '2026-10-19', source: 'manual' }, silver: { date: '2026-10-19', source: 'manual' }, usdIls: { date: '2026-10-19', source: 'manual' } } };
const j = (v) => JSON.parse(JSON.stringify(v));

test('חישוב: 10 גרם זהב 750 + 100 גרם כסף 925, עמלה 2.5% — באגורות מדויקות', () => {
  const { run } = load();
  run(`var P = ${JSON.stringify(PRICES)};`);
  const r = j(run(`computePurchase({ prices: P, commissionBp: 250, lines: [
    { metal: 'gold', purityPpt: 750, grams: '10', desc: 'טבעת' },
    { metal: 'silver', purityPpt: 925, grams: '100' } ] })`));
  assert.equal(r.lines[0].valueAg, 300000, '7.5 גרם טהור × 400 ₪');
  assert.equal(r.lines[1].valueAg, 37000, '92.5 גרם טהור × 4 ₪');
  assert.equal(r.grossAg, 337000);
  assert.equal(r.commissionAg, 8425);
  assert.equal(r.netAg, 328575);
  assert.ok(Number.isInteger(r.grossAg) && Number.isInteger(r.commissionAg) && Number.isInteger(r.netAg));
  // מחיר "לא עגול": עיגול לכל שורה, הסכום = סכום השורות
  run(`P.gold = 2000; P.usdIls = 3.5;`);
  const r2 = j(run(`computePurchase({ prices: P, lines: [{ metal: 'gold', purityPpt: 750, grams: 10 }, { metal: 'gold', purityPpt: 583, grams: '3,2' }] })`));
  assert.equal(r2.lines[0].valueAg, Math.round(7.5 * 2000 / 31.1035 * 3.5 * 100));
  assert.equal(r2.lines[1].grams, 3.2, 'פסיק עשרוני');
  assert.equal(r2.grossAg, r2.lines[0].valueAg + r2.lines[1].valueAg);
  assert.equal(r2.netAg, r2.grossAg);
});

test('קלט שגוי נדחה בעברית: טוהר, משקל, מתכת, עמלה, בלי פריטים, ובלי מחיר', () => {
  const { run } = load();
  run(`var P = ${JSON.stringify(PRICES)};`);
  assert.throws(() => run(`computePurchase({ prices: P, lines: [] })`), /פריט אחד לפחות/);
  assert.throws(() => run(`computePurchase({ prices: P, lines: [{ metal: 'gold', purityPpt: 700, grams: 5 }] })`), /שורה 1: טוהר/);
  assert.throws(() => run(`computePurchase({ prices: P, lines: [{ metal: 'gold', purityPpt: 750, grams: 5 }, { metal: 'gold', purityPpt: 750, grams: '-1' }] })`), /שורה 2: יש להזין משקל/);
  assert.throws(() => run(`computePurchase({ prices: P, lines: [{ metal: 'platinum', purityPpt: 950, grams: 5 }] })`), /מתכת/);
  assert.throws(() => run(`computePurchase({ prices: P, commissionBp: 6000, lines: [{ metal: 'gold', purityPpt: 750, grams: 5 }] })`), /עמלה/);
  assert.throws(() => run(`computePurchase({ prices: { gold: 0, usdIls: 4 }, lines: [{ metal: 'gold', purityPpt: 750, grams: 5 }] })`), /חסר מחיר/);
  assert.equal(run(`percentToBp('2.5')`), 250);
  assert.equal(run(`percentToBp('')`), 0);
  assert.ok(Number.isNaN(run(`percentToBp('abc')`)));
  assert.equal(run(`parseAgorot('1,234.5')`), 123450);
});

test('מוכר: שם חובה ומספר זהות עם ספרת ביקורת', () => {
  const { run } = load();
  assert.equal(run(`isValidIsraeliIdNumber('123456782')`), true);
  assert.equal(run(`isValidIsraeliIdNumber('18')`), false, 'קצר מדי');
  assert.equal(run(`isValidIsraeliIdNumber('00018')`), true);
  assert.equal(run(`isValidIsraeliIdNumber('123456789')`), false);
  assert.equal(run(`isValidIsraeliIdNumber('000000000')`), false);
  assert.throws(() => run(`validateSeller({ name: '', idNumber: '123456782' })`), /שם המוכר/);
  assert.throws(() => run(`validateSeller({ name: 'יעקב לוי', idNumber: '123456789' })`), /מספר הזהות/);
  assert.equal(run(`validateSeller({ name: ' יעקב לוי ', idNumber: '00018' }).idNumber`), '000000018');
});

test('שטר: עותק המחירים ותאריכם, HTML מוגן, הצהרת המוכר והסכומים', () => {
  const { run } = load();
  run(`var P = ${JSON.stringify(PRICES)};
    var p = createPurchase({ seller: { name: 'משה <b>כהן</b>', idNumber: '123456782', phone: '050-0000000' }, commissionBp: 250, payMethod: 'transfer', notes: 'שרשרת ישנה',
      lines: [{ metal: 'gold', purityPpt: 750, grams: '10', desc: 'טבעת "חותם"' }] }, { no: 7, prices: P, today: '2026-10-19' });`);
  assert.equal(run('p.no'), 7);
  assert.equal(run('p.netAg'), 292500);
  assert.equal(run('p.prices.gold.date'), '2026-10-19');
  assert.equal(run('p.payMethod'), 'transfer');
  const html = run(`buildPurchaseHtml(p, { name: 'אברהם שמאי', business: 'זהב השבט' })`);
  assert.match(html, /שטר קנייה/);
  assert.match(html, /מספר שטר:<\/span> <span class="value ">7/);
  assert.match(html, /₪2,925\.00/);
  assert.match(html, /עמלה \(2\.50%\)/);
  assert.match(html, /העברה בנקאית/);
  assert.match(html, /אינם משועבדים ואינם גנובים/);
  assert.match(html, /19\.10\.2026/);
  assert.doesNotMatch(html, /<b>כהן/, 'שם המוכר עובר escape');
  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(html, /<script/i);
  // מחיר כסף לא מוצג כשאין כסף בשטר
  assert.doesNotMatch(html, /מחיר כסף/);
});

test('רישום ביומן: פריט "נקנה" בקטגוריית זהב, בשקלים, עם פרטי השורות', () => {
  const { run } = load();
  run(`var P = ${JSON.stringify(PRICES)};
    var p = createPurchase({ seller: { name: 'שרה לוי', idNumber: '123456782' }, lines: [{ metal: 'gold', purityPpt: 583, grams: '4' }, { metal: 'silver', purityPpt: 925, grams: '20' }] }, { no: 3, prices: P, today: '2026-10-19' });
    var o = purchaseToOpp(p);`);
  assert.equal(run('o.status'), 'bought');
  assert.equal(run('o.category'), 'gold');
  assert.equal(run('o.purchasePrice'), run('p.netAg') / 100);
  assert.equal(run('o.purchaseId'), run('p.id'));
  assert.match(run('o.name'), /זהב וכסף 24\.0 גרם — שטר קנייה 3/);
  assert.equal(run('o.details.length'), 2);
});

test('אזהרות: מחיר ישן או לא מעודכן, ומזומן מעל התקרה', () => {
  const { run } = load();
  run(`var P = ${JSON.stringify(PRICES)}; P.meta.gold.date = '2026-10-10';
    var r = computePurchase({ prices: P, lines: [{ metal: 'gold', purityPpt: 999, grams: 30 }] });`);
  const w = j(run(`purchaseWarnings(r, 'cash', P, '2026-10-19')`));
  assert.ok(w.some(x => /^זהב: בן 9 ימים/.test(x)));
  assert.ok(w.some(x => /מזומן/.test(x)), '30 גרם זהב טהור ≈ ₪12,000 במזומן');
  assert.ok(!w.some(x => /^כסף/.test(x)), 'כסף לא בשימוש');
  assert.deepEqual(j(run(`purchaseWarnings(r, 'transfer', ${JSON.stringify(PRICES)}, '2026-10-19')`)), []);
});

test('ממשק: הפקה רק אחרי אישור, מספור עולה, שמירה ביומן ובשטרות, וביטול לא צורך מספר', () => {
  const { run, el } = load();
  run(`state.prices = ${JSON.stringify(PRICES)}; state.opportunities = [];
    localToday = () => '2026-10-19';
    var answers = [false, true]; var asked = []; confirm = (m) => { asked.push(m); return answers.shift(); };
    var printed = []; openPrintPreview = (h) => printed.push(h);
    var toasts = []; toast = (m, t) => toasts.push(t + ':' + m);
    renderPurchaseView();`);
  el('#pu-name').value = 'יוסף אברהמי';
  el('#pu-id').value = '123456782';
  el('#pu-commission').value = '1';
  el('#pu-pay').value = 'cash';
  run(`state.purchase.lines[0].grams = '5'; state.purchase.lines[0].purityPpt = '750';`);
  run('recalcPurchase()');
  assert.match(el('#pu-result').innerHTML, /לתשלום למוכר/);
  // ביטול — לא נשמר ולא נצרך מספר
  run('savePurchase()');
  assert.equal(run(`Storage.load('purchaseSeq', 0)`), 0);
  assert.equal(run('state.opportunities.length'), 0);
  assert.match(run('asked[0]'), /יוסף אברהמי על סך ₪1,485\.00/);
  // אישור — נשמר, ממוספר, נרשם ביומן ונפתחת הדפסה
  el('#pu-name').value = 'יוסף אברהמי';
  el('#pu-id').value = '123456782';
  run('savePurchase()');
  assert.equal(run(`Storage.load('purchaseSeq', 0)`), 1);
  assert.equal(run(`Storage.load('purchases', [])[0].netAg`), 148500);
  assert.equal(run(`JSON.parse(localStorage.getItem('shamai_v2_opportunities'))[0].status`), 'bought');
  assert.equal(run('printed.length'), 1);
  assert.ok(run('toasts').some(t => /^success:שטר קנייה 1/.test(t)));
  // מספר זהות שגוי — הודעת שגיאה, בלי חלון אישור
  el('#pu-name').value = 'דוד';
  el('#pu-id').value = '111';
  run(`state.purchase.lines[0].grams = '2';`);
  run('savePurchase()');
  assert.equal(run('asked.length'), 2);
  assert.ok(run('toasts').some(t => /^error:מספר הזהות/.test(t)));
});

test('חיבור: purchase.js נטען אחרי report ו-prices, במטמון ה-sw, כרטיס ומסך בתפריט השמאות, ובלי רשת', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const idx = (f) => html.indexOf(`src="src/${f}.js"`);
  assert.ok(idx('prices') < idx('purchase') && idx('report') < idx('purchase'));
  assert.match(fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8'), /'\.\/src\/purchase\.js'/);
  assert.match(html, /class="hub-card" data-sub="purchase"/);
  assert.match(html, /class="sub-view" data-sub="purchase"/);
  for (const id of ['pu-name', 'pu-id', 'pu-lines', 'pu-commission', 'pu-pay', 'pu-result', 'pu-save', 'pu-list']) assert.match(html, new RegExp(`id="${id}"`), id);
  const src = shamaiSource();
  assert.match(src, /attachPurchase\(\)/);
  assert.match(src, /'purchase': renderPurchaseView/);
  assert.doesNotMatch(fs.readFileSync(path.join(DIR, 'src', 'purchase.js'), 'utf8'), /fetch\(|XMLHttpRequest|https?:\/\/|window\.open/);
});
