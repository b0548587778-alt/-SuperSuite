// היסטוריית ניווט (אחורה/קדימה) — הלוגיקה הטהורה ב-shell/history.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../shell/history');

test('אחורה וקדימה בין מסכים, ומצב הכפתורים', () => {
  const h = H.create();
  assert.deepEqual(h.state(), { canBack: false, canForward: false });
  h.push({ mod: null });
  h.push({ mod: 'econ', view: 'npo' });
  h.push({ mod: 'tools' });
  assert.deepEqual(h.state(), { canBack: true, canForward: false });
  assert.deepEqual(h.go(-1), { mod: 'econ', view: 'npo' });
  assert.deepEqual(h.go(-1), { mod: null, view: null });
  assert.equal(h.go(-1), null, 'אין לאן לחזור');
  assert.deepEqual(h.state(), { canBack: false, canForward: true });
  assert.deepEqual(h.go(1), { mod: 'econ', view: 'npo' });
});

test('מעבר חדש אחרי חזרה מוחק את ה"קדימה"', () => {
  const h = H.create();
  h.push({ mod: 'econ', view: 'npo' });
  h.push({ mod: 'econ', view: 'gemach' });
  h.go(-1);
  h.push({ mod: 'econ', view: 'chesed' });
  assert.equal(h.state().canForward, false);
  assert.deepEqual(h.go(-1), { mod: 'econ', view: 'npo' });
});

test('אותו מסך פעמיים לא נרשם; כניסה למודול ואז דיווח התצוגה — צעד אחד', () => {
  const h = H.create();
  h.push({ mod: null });
  assert.equal(h.push({ mod: null }), false);
  h.push({ mod: 'econ' });
  h.push({ mod: 'econ', view: 'npo' });
  assert.deepEqual(h.go(-1), { mod: null, view: null }, 'הכניסה למודול והתצוגה הן צעד אחד');
});

test('תקרת אורך: הצעדים הוותיקים נמחקים', () => {
  const h = H.create(3);
  for (const v of ['a', 'b', 'c', 'd']) h.push({ mod: 'econ', view: v });
  h.go(-1); h.go(-1);
  assert.equal(h.go(-1), null);
  assert.deepEqual(h.current(), { mod: 'econ', view: 'b' });
});
