// כללים רגולטוריים: לכל כלל שנת תוקף ותווית "לא מאומת · שנה"; רשימת האימות לבעלים מכסה כל כלל;
// והתחום החדש "נדל"ן ותיווך" רשום ברישיון.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../modules/econ/core/mortgageRules');
const gate = require('../shell/licensing/gate');

test('לכל כלל שנת תוקף, וכל כלל מתחיל כלא מאומת', () => {
  for (const r of R.RULE_CATALOG) {
    assert.ok(Number.isInteger(r.valueYear) && r.valueYear >= 2026, r.id);
    assert.equal(r.needsVerification, true, r.id);
    assert.equal(R.statusLabel(r), `לא מאומת · ${r.valueYear}`);
  }
  const v = R.defaultRuleSet.withVerifications([{ ruleId: 'boi.329.ptiMax', rulesVersion: R.RULES_VERSION }]);
  assert.equal(R.statusLabel(v.get('boi.329.ptiMax', '2026-10-20')), 'אומת');
});

test('רשימת האימות לבעלים (docs/RULES-TO-VERIFY.md) כוללת כל כלל בקוד', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'RULES-TO-VERIFY.md'), 'utf8');
  const missing = R.ALL_RULE_IDS.filter(id => !doc.includes('`' + id + '`'));
  assert.deepEqual(missing, [], 'כלל חדש — להוסיף שורה לרשימת האימות');
});

test('מסך הכללים מציג את התווית עם השנה', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'mortgage-lab.js'), 'utf8');
  assert.match(src, /r\.statusLabel/);
});

test('רישוי: ערוצי rlty: דורשים את רישיון "נדל"ן" (econ.realestate), והוא קיים בהצעה ובמסך הרישוי', () => {
  const state = { mode: 'licensed', status: 'active', features: ['econ', 'econ.mortgage-advisor'] };
  assert.match(gate.checkChannel(state, 'rlty:getOverview', 'data.view') || '', /אינו כלול ברישיון/);
  assert.equal(gate.checkChannel({ ...state, features: ['econ', 'econ.realestate'] }, 'rlty:getOverview', 'data.view'), null);
  // התחומים של SuperSuite — בקטלוג המוצרים (shell/licensing/products.js), וההצעה מקבלת אותם משם
  const OF = require('../shell/licensing/offer');
  assert.ok(OF.FEATURES.includes('econ.realestate'));
  assert.ok(!OF.FEATURES.some(f => /^econ\.realty/.test(f)), 'רישיון נדל"ן אחד — בלי תחום נפרד לתיווך');
  const products = fs.readFileSync(path.join(__dirname, '..', 'shell', 'licensing', 'products.js'), 'utf8');
  assert.doesNotMatch(products, /econ\.realty/);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'licensing.js'), 'utf8');
  assert.match(ui, /\['econ\.realestate', 'נדל"ן \(שמאות מקרקעין, תיווך ויזמים\)'\]/);
});
