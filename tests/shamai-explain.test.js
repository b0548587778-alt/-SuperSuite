'use strict';
// שמאות — פאנל "מאין הסכום?" ובדיקת שדות חסרים (src/explain.js): אותו חישוב, מספרים זהים לתוצאה
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DIR, shamaiFiles, loadShamai } = require('./helpers/shamai-src');

const FILES = ['core', 'calc', 'explain', 'prices', 'appraise-metals', 'appraise-gems', 'appraise-judaica', 'ledger'];

function fresh() {
  const s = loadShamai(FILES);
  s.run("state.prices = { ...state.prices, gold: 3110.35, silver: 31.1035, usdIls: 4 }; var toast = () => {};");
  return s;
}

const plain = (s, expr) => JSON.parse(JSON.stringify(s.run(expr)));

// מספר מתוך שורה בפאנל, לפי התווית
function stepValue(html, label) {
  const re = new RegExp(`<span class="explain-label">${label}</span>\\s*<span class="explain-value">([^<]*)</span>`);
  const m = html.match(re);
  return m ? m[1] : null;
}

const num = (text) => text.replace(/[^\d.-]/g, '');

test('הקובץ רשום ב-index.html וב-sw.js אחרי calc.js, עם \'use strict\'', () => {
  const listed = shamaiFiles();
  const i = listed.indexOf('src/explain.js');
  assert.ok(i > listed.indexOf('src/calc.js'), 'explain.js אחרי calc.js');
  assert.ok(i < listed.indexOf('src/appraise-metals.js'), 'explain.js לפני קובצי המסכים');
  const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  assert.ok(sw.includes("'./src/explain.js'"));
  assert.match(fs.readFileSync(path.join(DIR, 'src', 'explain.js'), 'utf8'), /^(\/\/[^\n]*\n)?'use strict';/);
});

test('הפאנל מציג את המספרים של החישוב עצמו — זהב', () => {
  const s = fresh();
  const html = s.calc('recalcGold', '#g-result', { '#g-weight': 10, '#g-unit': 'g', '#g-scrap-mode': false, '#g-asking': '' });
  const v = plain(s, 'goldValue({ weight: 10, unit: "g", purity: state.gold.purity, spotUsd: state.prices.gold, usdIls: state.prices.usdIls })');
  assert.match(html, /<details class="explain explain-stays">/);
  assert.match(html, /מאין הסכום\?/);
  assert.equal(num(stepValue(html, 'שווי התכה')), num('₪' + s.run('fmt0(' + v.meltIls + ')')));
  assert.equal(num(stepValue(html, 'מחיר לגרם טהור \\(₪\\)')), num('₪' + s.run('fmt(' + v.perGramIls + ')')));
  assert.match(html, /31\.1/);
  assert.doesNotMatch(html, /class="explain-missing"/);
});

test('יהלום: מקדמים וצורות בשמות, לא במפתחות', () => {
  const s = fresh();
  const html = s.calc('recalcDiamond', '#d-result', { '#d-carat': 1, '#d-asking': '' });
  assert.equal(stepValue(html, 'תעודה'), 'GIA × 1.00');
  assert.match(stepValue(html, 'צורה'), /^עגול × 1\.00/);
  assert.match(stepValue(html, 'פלואורסנציה'), /^None × 1\.00/);
  assert.doesNotMatch(html, /undefined/);
  const v = plain(s, 'diamondValue(state.diamond, 1, state.prices.usdIls)');
  assert.match(stepValue(html, 'סיטונאי'), new RegExp('^₪' + s.run('fmt0(' + v.wholesaleIls + ')') + ' \\('));
});

test('שעון: מותג עם נזילות, בלי מכפיל שאינו קיים; שדה חסר מסומן', () => {
  const s = fresh();
  const w = plain(s, 'watchValue({ brand: "rolex", retail: 40000, condition: "excellent", papers: "full", service: "medium" })');
  const html = s.calc('recalcWatch', '#w-result', { '#w-retail': 40000, '#w-asking': '', '#w-condition': 'excellent', '#w-papers': 'full', '#w-service': 'medium' });
  assert.equal(stepValue(html, 'מותג'), 'Rolex — נזילות 100%');
  assert.match(stepValue(html, 'לסוחר'), new RegExp('^₪' + s.run('fmt0(' + w.wholesale + ')') + ' \\('));
  assert.doesNotMatch(html, /undefined|NaN/);

  const missing = plain(s, 'missingFieldWarnings({}, [{ key: "retail", label: "מחיר יד שנייה", what: "אין הערכה" }])');
  assert.equal(missing.length, 1);
  assert.match(s.run('missingFieldPanel(' + JSON.stringify(missing) + ')'), /explain-missing/);
  assert.equal(s.run("missingFieldWarnings({ retail: 1000 }, [{ key: 'retail', label: 'x' }])").length, 0);
});

test('יודאיקה ומטבעות: הסכומים זהים לתוצאה; אזהרת שדה חסר רק כשחסר', () => {
  const s = fresh();
  // המצב וההולמרק הם ברירת המחדל של המסך (state.antique), כמו במסך עצמו
  const a = plain(s, 'antiqueValue({ market: 5000, condition: state.antique.condition, hallmark: state.antique.hallmark, prov: true })');
  const htmlA = s.calc('recalcAntique', '#a-result', { '#a-market': 5000, '#a-asking': '', '#a-prov': true, '#a-signed': false, '#a-rare': false });
  assert.equal(num(stepValue(htmlA, 'שווי')), num('₪' + s.run('fmt0(' + a.value + ')')));
  assert.match(stepValue(htmlA, 'מקור מתועד'), /1\.25/);

  const c = plain(s, 'coinValue({ metal: "silver", weight: 14, purity: 900, premium: 1.5, grade: "XF" }, state.prices)');
  const htmlC = s.calc('recalcCoin', '#cn-result', { '#cn-weight': 14, '#cn-purity': 900, '#cn-premium': 1.5, '#cn-asking': '' });
  assert.match(stepValue(htmlC, 'שווי'), new RegExp('^₪' + s.run('fmt0(' + c.value + ')') + ' \\('));
  assert.match(stepValue(htmlC, 'רכישה מקסימלית'), new RegExp('^₪' + s.run('fmt0(' + c.maxPurchase + ')') + ' \\('));

  // מטבע כסף בלי משקל — מתכת יקרה שחסר לה משקל: הסבר נכון ואזהרה (פעם "לא ממתכת יקרה" ובלי אזהרה)
  const noWeight = s.calc('recalcCoin', '#cn-result', { '#cn-metal': 'silver', '#cn-weight': '', '#cn-asking': '' });
  assert.match(noWeight, /לא הוזן משקל/);
  assert.doesNotMatch(noWeight, /לא ממתכת יקרה/);
  assert.match(noWeight, /class="explain-missing"/);
  // מטבע נחושת בלי משקל — באמת לא ממתכת יקרה, ואין אזהרה
  const copper = s.calc('recalcCoin', '#cn-result', { '#cn-metal': 'copper', '#cn-weight': '', '#cn-asking': '' });
  assert.match(copper, /לא ממתכת יקרה/);
  assert.doesNotMatch(copper, /class="explain-missing"/);
});

test('הפאנל מתחסן HTML, ומצב הפתיחה נשמר אחרי חישוב מחדש', () => {
  const s = fresh();
  const evil = plain(s, 'explainPanel([{ label: "<img src=x onerror=alert(1)>", value: "<b>a</b>" }])');
  assert.doesNotMatch(evil, /<img|<b>/);
  assert.match(evil, /&lt;img/);

  assert.equal(s.run('explainPanel([])'), '');
  assert.equal(s.run('missingFieldPanel([])'), '');
  // explainAttach מחזיר את המצב השמור — here אין אלמנט תוצאה אמיתי, ולכן לא נופל
  s.run("state.explainOpen = true; explainAttach('#g-result');");
  assert.equal(s.run('state.explainOpen'), true);
});

test('הפאנל מודפס בכל חמשת מסכי השמאות', () => {
  const src = fs.readFileSync(path.join(DIR, 'src', 'explain.js'), 'utf8');
  for (const fn of ['explainGold', 'explainDiamond', 'explainWatch', 'explainAntique', 'explainCoin']) {
    assert.ok(src.includes(`function ${fn}(`), fn);
  }
  for (const [file, sel] of [['appraise-metals', '#g-result'], ['appraise-gems', '#d-result'], ['appraise-gems', '#w-result'], ['appraise-judaica', '#a-result'], ['appraise-judaica', '#cn-result']]) {
    const code = fs.readFileSync(path.join(DIR, 'src', file + '.js'), 'utf8');
    assert.ok(code.includes(`explainAttach('${sel}')`), `${file}: ${sel}`);
  }
});
