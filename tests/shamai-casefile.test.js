// תיק שמאות מקצועי (זהב, תכשיטים ומטלטלין): חישוב באגורות, מטבעות ושערים ידניים, אבנים וזיהוי, לקוח והיסטוריה,
// נעילה וגרסאות, ודוח בעברית ודו-לשוני. כל הנתונים בדוגמאות בדויים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DIR, loadShamai, shamaiSource } = require('./helpers/shamai-src');

const load = () => loadShamai(['core', 'calc', 'prices', 'ledger', 'report', 'purchase', 'casefile', 'case-report']);
// מחירים "עגולים": 3110.35$ לאונקיה = 100$ לגרם; דולר 4 ₪, אירו 4.5 ₪, ליש"ט 5 ₪
const D = '2026-10-19';
const meta = (keys) => Object.fromEntries(keys.map(k => [k, { date: D, source: 'manual' }]));
const PRICES = { gold: 3110.35, silver: 31.1035, platinum: 3110.35, palladium: 1555.175, usdIls: 4, eurIls: 4.5, gbpIls: 5, source: 'manual', lastUpdate: null,
  meta: meta(['gold', 'silver', 'platinum', 'palladium', 'usdIls', 'eurIls', 'gbpIls']) };
const j = (v) => JSON.parse(JSON.stringify(v));
const setup = () => { const s = load(); s.run(`var P = ${JSON.stringify(PRICES)};`); return s; };

test('פריט מורכב: מתכת + אבנים במטבעות שונים + עבודה — באגורות שלמות', () => {
  const { run } = setup();
  const v = j(run(`caseItemValue({
    metals: [{ metal: 'gold', purityPpt: 750, grams: '10' }, { metal: 'platinum', purityPpt: 950, grams: '2' }],
    stones: [
      { type: 'diamond', count: '1', carat: '0.5', pricing: 'perCarat', price: '2000', currency: 'USD', idMethod: 'lab', lab: 'GIA', certNo: '123' },
      { type: 'ruby', count: '3', carat: '0,1', pricing: 'perCarat', price: '300', currency: 'EUR', idMethod: 'observed' },
      { type: 'pearl', count: '2', pricing: 'perPiece', price: '50', currency: 'GBP', idMethod: 'assumed' } ],
    labour: '800', other: '' }, P, 1)`));
  assert.equal(v.metals[0].valueAg, 300000, '7.5 גרם טהור × 400 ₪');
  assert.equal(v.metals[1].valueAg, 76000, '1.9 גרם × 100$ × 4 ₪');
  assert.equal(v.stones[0].valueAg, 400000, '0.5 קראט × 2,000$ × 4');
  assert.equal(v.stones[1].valueAg, 40500, '3 × 0.1 × 300€ × 4.5');
  assert.equal(v.stones[2].valueAg, 50000, '2 × 50£ × 5');
  assert.equal(v.stones[0].lab, 'GIA');
  assert.equal(v.stones[1].lab, '', 'מעבדה נשמרת רק בזיהוי לפי תעודה');
  assert.equal(v.labourAg, 80000);
  assert.equal(v.computedAg, 300000 + 76000 + 400000 + 40500 + 50000 + 80000);
  assert.equal(v.valueAg, v.computedAg);
  for (const k of ['metalAg', 'stoneAg', 'computedAg', 'valueAg']) assert.ok(Number.isInteger(v[k]), k);
});

test('ערך התכה: רק המתכת, בלי אבנים ועבודה; שווי שנקבע ידנית מחייב נימוק', () => {
  const { run } = setup();
  const item = `{ metals: [{ metal: 'gold', purityPpt: 585, grams: '4' }], stones: [{ type: 'diamond', carat: '1', price: '5000', currency: 'USD' }], labour: '500' }`;
  const melt = j(run(`caseItemValue(${item}, P, 1, 'melt')`));
  assert.equal(melt.valueAg, Math.round(4 * 0.585 * 400 * 100));
  assert.throws(() => run(`caseItemValue({ metals: [], override: '9000' }, P, 2)`), /פריט 2: שווי שנקבע ידנית מחייב נימוק/);
  const o = j(run(`caseItemValue({ metals: [], other: '7000', otherLabel: 'שעון', override: '6500', overrideReason: 'פגם בזכוכית' }, P, 1)`));
  assert.equal(o.computedAg, 700000);
  assert.equal(o.valueAg, 650000);
});

test('קלט שגוי נדחה בעברית עם מיקום מדויק', () => {
  const { run } = setup();
  assert.throws(() => run(`caseItemValue({ metals: [{ metal: 'gold', purityPpt: 700, grams: '3' }] }, P, 4)`), /פריט 4, מתכת 1: טוהר/);
  assert.throws(() => run(`caseItemValue({ metals: [{ metal: 'tin', purityPpt: 999, grams: '3' }] }, P, 1)`), /מתכת לא מוכרת/);
  assert.throws(() => run(`caseItemValue({ stones: [{ type: 'diamond', carat: '0.3', price: '', currency: 'USD' }] }, P, 1)`), /אבן 1: יש להזין מחיר/);
  assert.throws(() => run(`caseItemValue({ stones: [{ type: 'diamond', carat: '', price: '100', currency: 'USD' }] }, P, 1)`), /יש להזין משקל בקראט/);
  assert.throws(() => run(`caseItemValue({ stones: [{ type: 'ruby', count: '1.5', carat: '1', price: '100' }] }, P, 1)`), /כמות/);
  assert.throws(() => run(`caseItemValue({ stones: [{ type: 'diamond', carat: '1', price: '100', currency: 'EUR' }] }, { usdIls: 4 }, 1)`), /חסר שער אירו/);
  assert.throws(() => run(`caseItemValue({ labour: 'abc' }, P, 1)`), /עבודה: יש להזין סכום/);
  // שורות ריקות לגמרי מדולגות
  assert.equal(j(run(`caseItemValue({ metals: [{ metal: 'gold', purityPpt: 585, grams: '' }], stones: [{ type: 'diamond', carat: '', price: '' }] }, P, 1)`)).valueAg, 0);
});

test('מטבעות: המרה לשקלים ובחזרה לפי השער שהוקלד; לירה שטרלינג נקלטת מקובץ מחירים', () => {
  const { run } = setup();
  assert.equal(run(`caseToIlsAg(10000, 'USD', P)`), 40000);
  assert.equal(run(`caseToIlsAg(10000, 'ILS', P)`), 10000);
  assert.equal(run(`caseFromIlsAg(45000, 'EUR', P)`), 10000);
  assert.equal(run(`caseFromIlsAg(100, 'GBP', {})`), null);
  assert.equal(run(`caseMoney(123456, 'GBP')`), '£1,234.56');
  const parsed = j(run(`parsePriceFile('ליש"ט,5.12\\nתאריך,19.10.2026')`));
  assert.equal(parsed.values.gbpIls, '5.12');
  assert.equal(parsed.date, D);
  assert.throws(() => run(`checkPrice('gbpIls', '55')`), /מחוץ לטווח/);
});

test('לקוח והיסטוריה: מספר זהות רשות אבל נבדק; תיקים לפי לקוח', () => {
  const { run } = setup();
  assert.throws(() => run(`caseValidateClient({ name: '' })`), /שם הלקוח/);
  assert.throws(() => run(`caseValidateClient({ name: 'רחל כהן', idNumber: '123456789' })`), /מספר הזהות/);
  assert.equal(run(`caseValidateClient({ name: 'רחל כהן', idNumber: '00018' }).idNumber`), '000000018');
  assert.equal(run(`caseValidateClient({ name: 'רחל כהן' }).idNumber`), '');
  run(`var CS = [
    { id: 'a', client: { name: 'רחל כהן', idNumber: '000000018' }, created: '2026-01-01', status: 'final', frozen: { totalAg: 1000 } },
    { id: 'b', client: { name: 'רחל  כהן', idNumber: '000018' }, created: '2026-05-01', status: 'draft' },
    { id: 'c', client: { name: 'יוסף לוי', idNumber: '' }, created: '2026-03-01', status: 'final', frozen: { totalAg: 500 } },
    { id: 'd', client: { name: ' יוסף  לוי ', idNumber: '' }, created: '2026-04-01', status: 'final', frozen: { totalAg: 700 } } ];`);
  assert.deepEqual(j(run(`casesForClient(CS, caseClientKey(CS[0].client)).map(c => c.id)`)), ['a', 'b']);
  const clients = j(run('caseClients(CS)'));
  assert.equal(clients.length, 2);
  assert.equal(clients[0].count, 2);
  assert.equal(clients[0].finalAg, 1000, 'רק תיקים סופיים נספרים');
  assert.equal(clients[1].finalAg, 1200, 'בלי מספר זהות — לפי שם מנורמל');
});

const CASE = (extra = '') => `Object.assign(newCase(7, '${D}'), {
  client: { name: 'שרה לוי', idNumber: '123456782', phone: '050-0000000' }, purpose: 'insurance', basis: 'replacement', currency: 'USD', lang: 'he-en',
  items: [{ id: 'i1', category: 'jewelry', desc: 'טבעת "חותם" <b>זהב</b>', descEn: 'Gold ring', marks: '585', photos: ['ph1', 'bad'],
    metals: [{ metal: 'gold', purityPpt: 585, grams: '5' }],
    stones: [{ type: 'diamond', count: '1', carat: '0.25', pricing: 'perCarat', price: '1600', currency: 'USD', origin: 'natural', idMethod: 'observed', color: 'G', clarity: 'VS2' }],
    labour: '450', other: '', override: '', overrideReason: '' }] ${extra} })`;

test('נעילה: בדיקות חובה, עותק מחירים, הדפסה חוזרת זהה גם אחרי שינוי מחיר, וגרסה מתוקנת', () => {
  const { run } = setup();
  // חסרים: לקוח, תיאור, שווי
  const probs = j(run(`caseFinalizeProblems(Object.assign(newCase(1, '${D}'), { effectiveDate: '2026-12-01' }), P, '${D}')`));
  assert.ok(probs.includes('יש להזין את שם הלקוח'));
  assert.ok(probs.includes('המועד הקובע אחרי היום'));
  assert.ok(probs.includes('פריט 1: יש להזין תיאור'));
  assert.ok(probs.some(p => /פריט 1: אין שווי/.test(p)));
  run(`var c = ${CASE()}; var f = finalizeCase(c, P, '${D}');`);
  assert.equal(run('f.status'), 'final');
  assert.equal(run('f.reportDate'), D);
  const expected = Math.round(5 * 0.585 * 400 * 100) + 0.25 * 1600 * 100 * 4 + 45000;
  assert.equal(run('f.frozen.totalAg'), expected);
  assert.equal(run('f.frozen.reportTotal'), Math.round(expected / 4));
  assert.deepEqual(j(run('Object.keys(f.frozen.prices).sort()')), ['gold', 'usdIls']);
  assert.equal(run('f.frozen.prices.gold.date'), D);
  // המחיר השתנה אחרי הנעילה — הדוח נשאר זהה
  const before = run(`buildCaseReportHtml(f, P, {}, {}, {}, '${D}')`);
  run('P.gold = 5000; P.usdIls = 3.2;');
  assert.equal(run(`buildCaseReportHtml(f, P, {}, {}, {}, '2026-11-30')`), before);
  // גרסה מתוקנת: טיוטה, rev 1, היסטוריה, מספר דוח עם סיומת
  run('var r = reopenCase(f);');
  assert.equal(run('r.status'), 'draft');
  assert.equal(run('r.rev'), 1);
  assert.equal(run('r.frozen'), undefined);
  assert.equal(run('r.history[0].totalAg'), expected);
  assert.equal(run('caseReportNo(r)'), '7-1');
  assert.throws(() => run(`finalizeCase(newCase(2, '${D}'), P, '${D}')`), /שם הלקוח/);
});

test('דוח: מבנה מקצועי, דו-לשוני, escape, תמונות תקינות בלבד, וסימון טיוטה', () => {
  const { run } = setup();
  const photo = 'data:image/jpeg;base64,' + Buffer.from('jpeg').toString('base64');
  run(`var c = ${CASE()}; var f = finalizeCase(c, P, '${D}');`);
  const html = run(`buildCaseReportHtml(f, P, { name: 'אברהם שמאי', business: 'שמאות השבט', declaration: 'בדקתי' }, { name: 'Avraham Shamai', declaration: 'I examined' }, { ph1: '${photo}', bad: 'javascript:alert(1)' }, '${D}')`);
  for (const s of ['דוח שמאות', 'Appraisal Report', 'מספר דוח', 'המועד הקובע', 'Valuation date', 'מטרת השמאות', 'ביטוח', 'Insurance',
    'שווי החלפה (לביטוח)', 'Replacement value', 'היקף העבודה', 'שקילה במשקל אלקטרוני', 'הנחות ומגבלות', 'Assumptions and limiting conditions',
    'מחירים ושערים ששימשו', 'הזנה ידנית', 'בדיקת השמאי', 'Gold ring', 'Avraham Shamai', 'I examined', '19.10.2026', 'במטבע הדוח', '$']) {
    assert.ok(html.includes(s), 'חסר בדוח: ' + s);
  }
  assert.doesNotMatch(html, /<b>זהב/, 'תיאור עובר escape');
  assert.match(html, /טבעת &quot;חותם&quot;/);
  assert.equal((html.match(/<img /g) || []).length, 1, 'רק תמונה תקינה');
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /טיוטה/);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,6}\b/, 'בלי צבע hex');
  // עברית בלבד — בלי אנגלית
  run(`var he = finalizeCase(Object.assign(${CASE()}, { lang: 'he' }), P, '${D}');`);
  const heHtml = run(`buildCaseReportHtml(he, P, {}, {}, {}, '${D}')`);
  assert.doesNotMatch(heHtml, /Appraisal Report|Gold ring/);
  // טיוטה מסומנת
  assert.match(run(`buildCaseReportHtml(${CASE()}, P, {}, {}, {}, '${D}')`), /טיוטה — לא לשימוש/);
});

test('תמונות לתיק: נשמרות במחסן המוצפן (localStorage), רק data:image, עם מגבלת גודל', () => {
  const { run } = setup();
  const photo = 'data:image/png;base64,' + Buffer.from('png').toString('base64');
  run(`var id = saveCasePhoto('${photo}');`);
  assert.equal(run('loadCasePhoto(id)'), photo);
  assert.throws(() => run(`saveCasePhoto('data:text/html;base64,AAAA')`), /התמונה/);
  assert.throws(() => run(`saveCasePhoto('data:image/png;base64,' + 'A'.repeat(500 * 1024))`), /גדולה מדי/);
  run('deleteCasePhotos([id]);');
  assert.equal(run('loadCasePhoto(id)'), '');
  // מספור תיקים עולה ולא חוזר
  assert.equal(run('nextCaseNo()'), 1);
  assert.equal(run('nextCaseNo()'), 2);
});

test('חיבור למודול: קבצים ב-index.html וב-sw.js, אין רשת, אין alert/confirm', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  for (const f of ['casefile', 'case-report', 'case-ui']) {
    assert.match(html, new RegExp(`<script src="src/${f}.js"></script>`), f);
    assert.match(sw, new RegExp(`'./src/${f}.js'`), f);
    const src = fs.readFileSync(path.join(DIR, 'src', f + '.js'), 'utf8');
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|WebSocket|window\.open/, f);
    assert.doesNotMatch(src, /(^|[^.\w])(alert|confirm|prompt)\(/m, f);
  }
  assert.match(html, /data-sub="cases"/);
  assert.match(shamaiSource(), /'cases': renderCasesView/);
});
