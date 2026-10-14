// המודול הכלכלי משתמש באותו לוח עברי כמו המעטפת — מקור אחד, בלי חישוב כפול.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

test('core/hebcal במודול הכלכלי הוא אותו מודול כמו shell/hebcal', () => {
  const econ = require(path.join(__dirname, '..', 'modules', 'econ', 'core', 'hebcal'));
  const shell = require(path.join(__dirname, '..', 'shell', 'hebcal'));
  assert.equal(econ, shell);
  assert.equal(typeof econ.hebrewDate, 'function');
});
