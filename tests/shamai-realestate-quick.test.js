// הערכה מהירה לנדל"ן בשמאות: בלי טבלת מחירי אזורים קבועה — המחיר למ"ר מוקלד, והתוצאה מסומנת "הערכה גסה — לא שומה"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DIR, loadShamai } = require('./helpers/shamai-src');

const load = () => loadShamai(['core', 'calc', 'explain', 'prices', 'appraise-metals', 'appraise-gems', 'appraise-judaica', 'appraise-assets', 'ledger']);

test('בלי מחיר למ"ר — אין שווי, ויש הפניה לשמאות המקצועית', () => {
  const s = load();
  const html = s.calc('recalcRealEstate', '#re-result', { '#re-size': 100, '#re-ppsqm': '' });
  assert.match(html, /נדרשים שטח ומחיר למ"ר/);
  assert.match(html, /שמאות מקרקעין/);
  assert.equal(s.run('reQuickEstimate({ size: 100, pricePerSqm: NaN })'), null);
});

test('מחיר מוקלד × שטח × מקדמים; "הערכה גסה" ולא "שווי שוק"', () => {
  const s = load();
  const html = s.calc('recalcRealEstate', '#re-result', { '#re-size': 100, '#re-ppsqm': '30,000', '#re-floor': 2 });
  assert.match(html, /הערכה גסה/);
  assert.doesNotMatch(html, /שווי שוק משוער/);
  const q = JSON.parse(JSON.stringify(s.run(`reQuickEstimate({ type: 'apartment', condition: 'good', size: 100, pricePerSqm: 30000, floor: 2 })`)));
  assert.equal(q.baseValue, 3000000);
});

test('אין עוד טבלת מחירים קבועה לאזורים', () => {
  const src = fs.readFileSync(path.join(DIR, 'src', 'appraise-assets.js'), 'utf8');
  assert.doesNotMatch(src, /RE_AREAS|Q1 2026/);
  assert.doesNotMatch(fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'), /id="re-area"/);
});
