// רשת ביטחון במסכים (PLAN.md 2.4): תקלה במסך של שמאות / אימונים / ארגז כלים מציגה הודעה עם "טען מחדש"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { install, MESSAGE } = require('../shell/screen-guard');
const { checkThemeOrder } = require('../tools/build-trainer');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// DOM מינימלי — מספיק למה שהרשת עושה
function el(tag) {
  const node = {
    tagName: tag.toUpperCase(), children: [], style: {}, attrs: {}, listeners: {}, textContent: '', parent: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { c.parent = this; this.children.push(c); this.textContent += c.textContent || ''; return c; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
    click() { (this.listeners.click || []).forEach(f => f()); }
  };
  return node;
}
function fakeWindow({ rootText = '' } = {}) {
  const body = el('body');
  const root = el('div'); root.textContent = rootText;
  body.children.push(root);
  const listeners = {};
  const timers = [];
  const win = {
    reloaded: 0,
    location: { reload() { win.reloaded++; } },
    document: { body, documentElement: body, createElement: el, getElementById: id => (id === 'root' ? root : null) },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    setTimeout(f) { timers.push(f); },
    fire(t, e) { (listeners[t] || []).forEach(f => f(e)); },
    tick() { timers.splice(0).forEach(f => f()); },
    root
  };
  return win;
}
const banner = win => win.document.body.children.find(c => c.id === 'ss-screen-guard');
const buttons = box => box.children.filter(c => c.tagName === 'BUTTON');

test('שגיאה במסך עם תוכן — פס הודעה עם "טען מחדש" ו"סגור"', () => {
  const win = fakeWindow({ rootText: 'רשימת לקוחות' });
  install(win);
  win.fire('error', { message: 'x is not defined' });
  win.tick();
  const box = banner(win);
  assert.ok(box, 'מוצגת הודעה');
  assert.equal(box.attrs.role, 'alert');
  assert.equal(box.dir, 'rtl');
  assert.match(box.textContent, new RegExp(MESSAGE));
  assert.deepEqual(buttons(box).map(b => b.textContent), ['טען מחדש', 'סגור']);
  buttons(box)[0].click();
  assert.equal(win.reloaded, 1);
});

test('מסך שהתרוקן (React הסיר הכול) — הודעה על כל המסך, בלי "סגור"', () => {
  const win = fakeWindow({ rootText: 'תוכן' });
  install(win);
  win.fire('unhandledrejection', { reason: new Error('boom') });
  win.root.textContent = ''; // React מרוקן אחרי הדיווח
  win.tick();
  const box = banner(win);
  assert.ok(box);
  assert.match(box.style.cssText, /inset:0/);
  assert.deepEqual(buttons(box).map(b => b.textContent), ['טען מחדש']);
});

test('כמה שגיאות ברצף — הודעה אחת בלבד; אחרי "סגור" אפשר להציג שוב', () => {
  const win = fakeWindow({ rootText: 'תוכן' });
  install(win);
  win.fire('error', { message: 'a' }); win.fire('error', { message: 'b' }); win.tick();
  win.fire('error', { message: 'c' }); win.tick();
  assert.equal(win.document.body.children.filter(c => c.id === 'ss-screen-guard').length, 1);
  buttons(banner(win))[1].click();
  assert.equal(banner(win), undefined);
  win.fire('error', { message: 'd' }); win.tick();
  assert.ok(banner(win));
});

test('ההודעה בצבעי שפת העיצוב בלבד (בלי hex)', () => {
  assert.doesNotMatch(read('shell/screen-guard.js'), /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/);
});

test('כל מודול טוען את רשת הביטחון, ו-main.js מגיש אותה מהמעטפת', () => {
  for (const f of ['modules/shamai/index.html', 'modules/tools/index.html', 'modules/trainer/index.html', 'modules-src/trainer/index.html']) {
    assert.match(read(f), /<script src="\/screen-guard\.js"><\/script>/, f);
  }
  // בשמאות ובכלים — לפני כל סקריפט אחר, כדי לתפוס גם שגיאה בטעינה
  for (const f of ['modules/shamai/index.html', 'modules/tools/index.html']) {
    const html = read(f);
    assert.equal(html.indexOf('<script'), html.indexOf('<script src="/screen-guard.js"'), f);
  }
  assert.match(read('main.js'), /rel === '\/screen-guard\.js'.*shell', 'screen-guard\.js'/);
  assert.match(read('android/build-apk.js'), /'screen-guard\.js'/);
});

test('בניית האימונים נכשלת כשרשת הביטחון או חלון ההודעה חסרים ב-index.html', () => {
  const head = '<link rel="stylesheet" href="/design-tokens.css"><link rel="stylesheet" href="/ui-kit.css">';
  const ok = `<head>${head}<script src="/screen-guard.js"></script><script src="/ss-dialog.js"></script><link rel="stylesheet" href="/assets/x.css"></head>`;
  assert.equal(checkThemeOrder(ok), ok);
  assert.throws(() => checkThemeOrder(ok.replace('<script src="/screen-guard.js"></script>', '')), /screen-guard/);
  assert.throws(() => checkThemeOrder(ok.replace('<script src="/ss-dialog.js"></script>', '')), /ss-dialog/);
});
