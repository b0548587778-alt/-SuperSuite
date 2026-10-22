'use strict';
// שמאות — דוח שמאות מקצועי, פרטי השמאי, מיקוד התחומים ופיצול הקוד (PLAN.md 9.7–9.8)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DIR, shamaiFiles, loadShamai } = require('./helpers/shamai-src');

const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

function fresh() {
  const s = loadShamai(['core', 'calc', 'explain', 'appraise-metals', 'appraise-gems', 'appraise-judaica', 'ledger', 'report']);
  s.run("state.prices = { ...state.prices, gold: 3110.35, silver: 31.1035, usdIls: 4 }; var toast = () => {};");
  return s;
}

test('פיצול: index.html טוען את כל קבצי src, כל אחד פעם אחת, ואין app.js', () => {
  const listed = shamaiFiles();
  const onDisk = fs.readdirSync(path.join(DIR, 'src')).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f);
  assert.deepEqual([...listed].sort(), onDisk.sort());
  assert.equal(new Set(listed).size, listed.length);
  assert.equal(listed[0], 'src/core.js');
  assert.ok(listed.indexOf('src/calc.js') < listed.indexOf('src/appraise-metals.js'));
  assert.ok(!fs.existsSync(path.join(DIR, 'app.js')));
  assert.doesNotMatch(html, /src="app\.js"/);
  const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  for (const f of listed) assert.ok(sw.includes(`'./${f}'`), `sw.js: ${f}`);
  for (const f of listed) assert.match(fs.readFileSync(path.join(DIR, f), 'utf8'), /^(\/\/[^\n]*\n)?'use strict';/, f);
});

test('פיצול: אין const/let/class כפולים ברמה העליונה בין הקבצים', () => {
  const seen = new Map();
  for (const f of shamaiFiles()) {
    for (const m of fs.readFileSync(path.join(DIR, f), 'utf8').matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      assert.ok(!seen.has(m[1]), `${m[1]} מוגדר גם ב-${seen.get(m[1])} וגם ב-${f}`);
      seen.set(m[1], f);
    }
  }
});

// פונקציה בשם זהה בשני קבצים לא נכשלת בטעינה — האחרונה דורסת בשקט. כך importJSON מ-navigation.js
// (החלפה של כל הפריטים בלי אישור) דרסה את הגרסה עם האישור ב-tools.js
test('פיצול: אין function באותו שם פעמיים — לא בשני קבצים ולא באותו קובץ', () => {
  const seen = new Map();
  for (const f of shamaiFiles()) {
    for (const m of fs.readFileSync(path.join(DIR, f), 'utf8').matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
      assert.ok(!seen.has(m[1]), `${m[1]} מוגדרת גם ב-${seen.get(m[1])} וגם ב-${f}`);
      seen.set(m[1], f);
    }
  }
});

test('שחזור מ-QR: מחירים רק דרך prices.js — מחוץ לטווח נדחה, תאריך עתידי לא נלקח', () => {
  const s = loadShamai(['core', 'prices']);
  const today = '2026-10-23';
  s.run(`var R = restorePrices({ gold: 4000, meta: { gold: { date: '2026-10-01', source: 'manual' } } },
    { gold: 99999, silver: 'abc', usdIls: 3.7, meta: { usdIls: { date: '2027-01-01' } } }, { today: '${today}' });`);
  assert.equal(s.run('R.prices.gold'), 4000, 'זהב מחוץ לטווח — לא נכתב');
  assert.deepEqual(JSON.parse(s.run('JSON.stringify(R.skipped)')).sort(), ['gold', 'silver']);
  assert.equal(s.run('R.prices.usdIls'), 3.7);
  assert.equal(s.run('R.prices.meta.usdIls.date'), today, 'תאריך עתידי מהגיבוי — לא "עודכן ב-2027"');
  const misc = fs.readFileSync(path.join(DIR, 'src', 'misc.js'), 'utf8');
  assert.doesNotMatch(misc, /state\.prices = \{ \.\.\.state\.prices, \.\.\.data\.prices \}/);
});

test('שמאי: שדות מיובאים ושגיאות עוברים escapeHtml לפני innerHTML', () => {
  const ledger = fs.readFileSync(path.join(DIR, 'src', 'ledger.js'), 'utf8');
  const analytics = fs.readFileSync(path.join(DIR, 'src', 'analytics.js'), 'utf8');
  const misc = fs.readFileSync(path.join(DIR, 'src', 'misc.js'), 'utf8');
  assert.doesNotMatch(ledger, /\$\{o\.(status|id)\}/);
  assert.doesNotMatch(analytics, /\$\{o\.id\}|bar-name">\$\{name\}/);
  assert.doesNotMatch(misc, /\$\{e\.message\}/);
});

test('ייבוא JSON בשמאי שואל לפני החלפה, ולא דורס בלי אישור', () => {
  const nav = fs.readFileSync(path.join(DIR, 'src', 'navigation.js'), 'utf8');
  const body = nav.slice(nav.indexOf('function importJSON'), nav.indexOf('\n}\n', nav.indexOf('function importJSON')));
  assert.match(body, /ssDialog\.choose/);
  assert.match(body, /ssDialog\.confirm/);
  assert.ok(body.indexOf('ssDialog.confirm') < body.indexOf('state.opportunities = items'));
});

test('מיקוד: תיק שמאות, זהב, קניית זהב מלקוח, יהלומים, שעונים, יודאיקה, מטבעות וספרים ראשונים; השאר תחת "תחומים נוספים"', () => {
  const main = html.slice(html.indexOf('id="hub-main"'), html.indexOf('id="hub-more"'));
  const subs = [...main.matchAll(/data-sub="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(subs, ['cases', 'gold', 'purchase', 'diamond', 'watch', 'antique', 'coin', 'book']);
  const more = html.slice(html.indexOf('id="hub-more"'), html.indexOf('</details>', html.indexOf('id="hub-more"')));
  for (const k of ['realestate', 'vehicle', 'phone', 'scrap', 'wine']) assert.match(more, new RegExp(`data-sub="${k}"`));
});

test('פרטי שמאי: שמירה וטעינה, הצהרה ריקה = ברירת המחדל, אורך מוגבל', () => {
  const s = fresh();
  s.el('#ap-name').value = 'יעקב כהן';
  s.el('#ap-business').value = 'זהב וכסף כהן';
  s.el('#ap-license').value = '512345678';
  s.el('#ap-declaration').value = '';
  s.run('saveAppraiserSettings()');
  const a = s.run('loadAppraiser()');
  assert.equal(a.name, 'יעקב כהן');
  assert.equal(a.license, '512345678');
  assert.equal(a.declaration, s.run('DEFAULT_DECLARATION'));
  s.run("Storage.save('appraiser', { name: 'x'.repeat(500), declaration: 7 })");
  assert.equal(s.run('loadAppraiser()').name.length, 200);
  assert.equal(s.run('loadAppraiser()').declaration, s.run('DEFAULT_DECLARATION'));
});

test('שמירה ליומן: פרטי השמאות נשמרים עם הפריט, והשווי מחושב כמו במסך', () => {
  const s = fresh();
  s.run("state.gold.metal = 'gold'; state.gold.purity = 0.750; state.gold.asking = 2500");
  s.el('#g-weight').value = '10';
  s.el('#g-unit').value = 'g';
  s.run("var renderHeader = () => {}; var renderDashboard = () => {}; saveCurrentAsOpp('gold')");
  const opp = s.run('state.opportunities[0]');
  assert.equal(Math.round(opp.estimate), 3000);
  const d = Object.fromEntries(opp.details);
  assert.equal(d['טוהר'], '750/1000');
  assert.equal(d['מתכת טהורה'], '7.50 גרם');
  assert.equal(d['שווי התכה'], '₪3,000');

  s.run("Object.assign(state.diamond, { origin: 'natural', shape: 'round', color: 'G', clarity: 'VS2', cut: 'Excellent', fluor: 'None', cert: 'GIA', asking: 10000, currency: 'ILS' })");
  s.el('#d-carat').value = '1.2';
  s.run("saveCurrentAsOpp('diamond')");
  const dia = s.run('state.opportunities[0]');
  assert.equal(Math.round(dia.estimate), 15721);
  assert.equal(Object.fromEntries(dia.details)['תעודה'], 'GIA');
});

test('דוח: מספר דוח, פרטי שמאי, פרטי שמאות, הצהרה ותמונה — הכול מוברח', () => {
  const s = fresh();
  s.run("Storage.save('appraiser', { name: 'יעקב <כהן>', license: '512345678', declaration: 'הצהרה <b>שלי</b>' })");
  const opp = { id: 'o1', category: 'gold', name: 'טבעת <זהב>', estimate: 3000, asking: 2500, details: [['טוהר', '750/1000'], ['משקל', '<10>']] };
  s.ctx.__opp = opp;
  const out = s.run("buildReportHtml(__opp, loadAppraiser(), 'data:image/png;base64,AAAA', '01/01/2026', 7)");
  assert.match(out, /מספר דוח:<\/span> <span class="value ">7</);
  assert.match(out, /יעקב &lt;כהן&gt;/);
  assert.match(out, /512345678/);
  assert.match(out, /טבעת &lt;זהב&gt;/);
  assert.match(out, /&lt;10&gt;/);
  assert.match(out, /הצהרה &lt;b&gt;שלי&lt;\/b&gt;/);
  assert.match(out, /<img class="opp-photo" src="data:image\/png;base64,AAAA"/);
  assert.match(out, /\+₪500/);
  assert.doesNotMatch(out, /<script|onclick=/);
  // תמונה שאינה data:image — לא נכנסת
  const bad = s.run("buildReportHtml(__opp, loadAppraiser(), 'javascript:alert(1)', '01/01/2026', 7)");
  assert.doesNotMatch(bad, /<img/);
  // בלי פרטי שמאי — אזהרה בדוח
  s.run("Storage.save('appraiser', {})");
  assert.match(s.run("buildReportHtml(__opp, loadAppraiser(), '', '01/01/2026', 1)"), /לא הוזנו פרטי שמאי/);
});

test('דוח: מספר הדוח נקבע פעם אחת לפריט ועולה בין פריטים', () => {
  const s = fresh();
  s.run("state.opportunities = [{ id: 'a' }, { id: 'b' }]");
  assert.equal(s.run('reportNumberFor(state.opportunities[0])'), 1);
  assert.equal(s.run('reportNumberFor(state.opportunities[0])'), 1);
  assert.equal(s.run('reportNumberFor(state.opportunities[1])'), 2);
  assert.equal(s.run("Storage.load('opportunities')[0].reportNo"), 1);
});

test('דוח וקטלוג: נפתחים בתצוגה בתוך העמוד, לא ב-window.open (חסום במעטפת)', () => {
  const report = fs.readFileSync(path.join(DIR, 'src/report.js'), 'utf8');
  const inventory = fs.readFileSync(path.join(DIR, 'src/inventory.js'), 'utf8');
  assert.doesNotMatch(report, /window\.open\(/);
  assert.match(inventory, /openPrintPreview\(html\)/);
  assert.doesNotMatch(inventory, /window\.open\('', '_blank'\)/);
  // המסגרת בלי allow-scripts
  assert.match(report, /setAttribute\('sandbox', 'allow-same-origin allow-modals'\)/);
  assert.match(html, /id="ap-save"/);
});

test('מבנה: כל מסך שמאות בתוך ה-section שלו (תג סוגר עודף הוציא את כל מסכי השמאות מחוץ ל-section, והלחיצה על תחום לא פתחה כלום)', () => {
  const sections = [...html.matchAll(/<section class="view" data-view="(\w+)">([\s\S]*?)<\/section>/g)];
  assert.deepEqual(sections.map((m) => m[1]), ['dashboard', 'appraisal', 'ledger', 'tools']);
  for (const [, view, body] of sections) {
    const open = (body.match(/<div\b/g) || []).length, close = (body.match(/<\/div>/g) || []).length;
    assert.equal(close, open, `section ${view}: ${open} פתיחות div מול ${close} סגירות`);
  }
  const appraisal = sections.find((m) => m[1] === 'appraisal')[2];
  for (const sub of ['cases', 'gold', 'purchase', 'diamond', 'watch', 'antique', 'coin', 'book', 'realestate']) {
    assert.match(appraisal, new RegExp(`class="sub-view" data-sub="${sub}"`), sub);
  }
});
