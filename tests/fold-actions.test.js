// מצב פשוט: שורת כפתורים עמוסה מציגה עד 3 כפתורים, והשאר מאחורי "עוד אפשרויות" — בלי למחוק ובלי להזיז.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers/econ-a11y-harness');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-actions-'));
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* EBUSY ב-Windows */ } });

async function folded(simple) {
  const s = await H.boot({ real: path.join(DIR, simple ? 'a' : 'b'), simple });
  const out = [];
  for (const v of ['npo', 'gemach', 'acct-invoices', 'chesed', 'licensing']) {
    await s.go(v);
    await s.settle(20);
    out.push(...s.doc.querySelectorAll('[data-folded]').map(g => ({ v, g })));
  }
  return out;
}

test('מצב פשוט: בקבוצה עמוסה נשארים עד 3 כפתורים גלויים; "עוד אפשרויות" מגלה את כולם, ושום כפתור לא נעלם מה-DOM', async () => {
  fs.mkdirSync(path.join(DIR, 'a'), { recursive: true });
  const groups = await folded(true);
  assert.ok(groups.length > 0, 'יש לפחות מסך אחד עם שורת כפתורים עמוסה');
  for (const { v, g } of groups) {
    const btns = [...g.children].filter(c => c.tagName === 'BUTTON');
    const more = btns.find(b => b.classList.contains('fold-more'));
    const hidden = btns.filter(b => b.classList.contains('fold-hidden'));
    const shown = btns.filter(b => b !== more && !b.classList.contains('fold-hidden') && !b.hidden);
    assert.ok(more, v);
    assert.ok(shown.length <= 3 && shown.length >= 1, v + ': ' + shown.length);
    assert.ok(hidden.length >= 2, v);
    assert.equal(more.getAttribute('aria-expanded'), 'false');
    assert.equal(more.textContent, 'עוד אפשרויות (' + hidden.length + ')');
    more.click();
    assert.equal(g.classList.contains('fold-open'), true);
    assert.equal(more.getAttribute('aria-expanded'), 'true');
    assert.equal(more.textContent, 'פחות אפשרויות');
  }
});

test('תצוגה מלאה: שום דבר לא מקופל', async () => {
  fs.mkdirSync(path.join(DIR, 'b'), { recursive: true });
  assert.equal((await folded(false)).length, 0);
});
