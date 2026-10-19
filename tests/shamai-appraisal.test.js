'use strict';
// שמאות — חישובי זהב, כסף, יהלומים, שעונים, יודאיקה ומטבעות (PLAN.md 9.7).
// הבדיקות מריצות את פונקציות המסך עצמן עם DOM מדומה, ולכן נכתבו לפני סידור החישובים ועברו גם אחריו.
// מחירי בדיקה עגולים: גרם זהב טהור = 100$, גרם כסף טהור = 1$, דולר = 4 ₪.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadShamai } = require('./helpers/shamai-src');

const FILES = ['core', 'calc', 'appraise-metals', 'appraise-gems', 'appraise-judaica'];

function fresh() {
  const s = loadShamai(FILES);
  s.run("state.prices = { ...state.prices, gold: 3110.35, silver: 31.1035, usdIls: 4 }");
  return s;
}

test('זהב: 10 גרם 18K — שווי התכה, גרם טהור ורווח מול מחיר מבוקש', () => {
  const s = fresh();
  s.run("state.gold.metal = 'gold'; state.gold.purity = 0.750");
  const html = s.calc('recalcGold', '#g-result', { '#g-weight': 10, '#g-unit': 'g', '#g-asking': 2500, '#g-scrap-mode': false });
  assert.match(html, /\$750\.00/);
  assert.match(html, /₪3,000</);
  assert.match(html, /7\.50 גרם/);
  assert.match(html, /₪400\.00/); // מחיר לגרם טהור
  assert.match(html, /\+₪500 \(\+20%\)/);
  assert.match(html, /עסקה הוגנת/);
  assert.equal(s.el('#g-save').hidden, false);
});

test('זהב: מצב סקראפ = 70% משווי ההתכה', () => {
  const s = fresh();
  s.run("state.gold.metal = 'gold'; state.gold.purity = 0.750");
  const html = s.calc('recalcGold', '#g-result', { '#g-weight': 10, '#g-unit': 'g', '#g-asking': '', '#g-scrap-mode': true });
  assert.match(html, /\$525\.00/);
  assert.match(html, /₪2,100</);
  assert.equal(s.el('#g-save').hidden, true);
});

test('זהב: אונקיה 24K ומשקל בק"ג', () => {
  const s = fresh();
  s.run("state.gold.metal = 'gold'; state.gold.purity = 0.999");
  let html = s.calc('recalcGold', '#g-result', { '#g-weight': 1, '#g-unit': 'oz', '#g-asking': '', '#g-scrap-mode': false });
  assert.match(html, /\$3,107\.24/);
  assert.match(html, /₪12,429</);
  s.run("state.gold.metal = 'silver'; state.gold.purity = 0.925");
  html = s.calc('recalcGold', '#g-result', { '#g-weight': 1, '#g-unit': 'kg' });
  assert.match(html, /\$925\.00/);
  assert.match(html, /₪3,700</);
});

test('זהב: משקל ריק או אפס — אין תוצאה', () => {
  const s = fresh();
  assert.equal(s.calc('recalcGold', '#g-result', { '#g-weight': '' }), '');
  assert.equal(s.calc('recalcGold', '#g-result', { '#g-weight': 0 }), '');
});

test('כסף: calcSilverFromGrams לפי אלפיות', () => {
  const s = fresh();
  assert.equal(s.run('calcSilverFromGrams(100, 925)'), 370);
});

test('יהלום: 1.2 קראט G VS2 — קמעונאי, סיטונאי ומחיר לקראט', () => {
  const s = fresh();
  s.run("Object.assign(state.diamond, { origin: 'natural', shape: 'round', color: 'G', clarity: 'VS2', cut: 'Excellent', fluor: 'None', cert: 'GIA' })");
  const html = s.calc('recalcDiamond', '#d-result', { '#d-carat': 1.2, '#d-asking': '', '#d-currency': 'ILS' });
  assert.match(html, /₪24,186</);
  assert.match(html, /₪15,721 · \$3,930/);
  assert.match(html, /\$5,039</);
});

test('יהלום: מעבדה = 25%, ומחיר מבוקש בדולר מומר לשקלים', () => {
  const s = fresh();
  s.run("Object.assign(state.diamond, { origin: 'lab', shape: 'round', color: 'G', clarity: 'VS2', cut: 'Excellent', fluor: 'None', cert: 'GIA' })");
  let html = s.calc('recalcDiamond', '#d-result', { '#d-carat': 1.2, '#d-asking': '', '#d-currency': 'ILS' });
  assert.match(html, /\$1,260</);
  s.run("state.diamond.origin = 'natural'");
  html = s.calc('recalcDiamond', '#d-result', { '#d-carat': 1.2, '#d-asking': 5000, '#d-currency': 'USD' });
  assert.match(html, /₪20,000</);
  assert.match(html, /₪-4,279 \(-21%\)/);
  assert.match(html, /מעל המחיר/);
});

test('יהלום: מתחת ל-0.30 קראט — אין תוצאה', () => {
  const s = fresh();
  assert.equal(s.calc('recalcDiamond', '#d-result', { '#d-carat': 0.2 }), '');
});

test('שעון: שווי שוק ומחיר לסוחר לפי מצב, אבזור, שירות ונזילות המותג', () => {
  const s = fresh();
  s.run("state.watch.brand = 'rolex'");
  let html = s.calc('recalcWatch', '#w-result', { '#w-retail': 40000, '#w-condition': 'excellent', '#w-papers': 'full', '#w-service': 'medium', '#w-asking': 20000 });
  assert.match(html, /₪34,000</);
  assert.match(html, /₪26,520</);
  assert.match(html, /\+₪6,520 \(33%\)/);
  s.run("state.watch.brand = 'omega'");
  html = s.calc('recalcWatch', '#w-result', { '#w-asking': '' });
  assert.match(html, /₪25,923</);
});

test('שעון: בלי מחיר שוק — רק הסבר, בלי שמירה', () => {
  const s = fresh();
  const html = s.calc('recalcWatch', '#w-result', { '#w-retail': '' });
  assert.match(html, /לפני שמתחילים/);
  assert.equal(s.el('#w-save').hidden, true);
});

test('יודאיקה: מקדמי מצב, הולמרק, מקור וחתימה; מחיר רכישה 55%', () => {
  const s = fresh();
  s.run("state.antique.condition = 'excellent'; state.antique.hallmark = 'polish'");
  const html = s.calc('recalcAntique', '#a-result', { '#a-market': 10000, '#a-prov': true, '#a-signed': true, '#a-rare': false, '#a-asking': '' });
  assert.match(html, /₪15,884</);
  assert.match(html, /₪8,736</);
  assert.match(html, /\+25%/);
  assert.doesNotMatch(html, /\+50%/);
});

test('מטבע: כסף — נומיסמטי מעל התכה; זהב בדירוג נמוך — שווי ההתכה', () => {
  const s = fresh();
  s.run("state.coin.grade = 'XF'");
  let html = s.calc('recalcCoin', '#cn-result', { '#cn-metal': 'silver', '#cn-weight': 26.73, '#cn-purity': 900, '#cn-premium': 1.5, '#cn-asking': '' });
  assert.match(html, /שווי משוער<\/span>\s*<strong>₪113</);
  assert.match(html, /₪73</);
  assert.match(html, /ערך התכה<\/span>\s*<span class="r-value">₪96</);
  s.run("state.coin.grade = 'P'");
  html = s.calc('recalcCoin', '#cn-result', { '#cn-metal': 'gold', '#cn-weight': 3.49, '#cn-purity': 986, '#cn-premium': 1.1 });
  assert.match(html, /שווי משוער<\/span>\s*<strong>₪1,376</);
  assert.match(html, /₪895</);
});

test('פסק עסקה לפי אחוז רווח: 80 / 40 / 15 / 0', () => {
  const s = fresh();
  const v = (p, m) => s.run(`verdictHTML(${p}, ${m})`);
  assert.match(v(800, 80), /הזדמנות נדירה/);
  assert.match(v(400, 40), /עסקה טובה מאוד/);
  assert.match(v(150, 15), /עסקה הוגנת/);
  assert.match(v(0, 0), /מחיר שוק/);
  assert.match(v(-1, -0.1), /מעל המחיר/);
  assert.equal(v('null', 'null'), '');
});
