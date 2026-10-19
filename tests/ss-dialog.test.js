// חלון הודעה משותף (ss-dialog.js): אותו חלון בכל המסכים, במקום alert / confirm / prompt של הדפדפן.
// prompt() אינו נתמך ב-Electron — כפתורים שהשתמשו בו בשמאות לא עשו כלום.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { make, CSS } = require('../shell/ss-dialog');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// DOM מינימלי — מספיק לחלון
function fakeDoc() {
  const keyListeners = [];
  function el(tag) {
    const n = {
      tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, parent: null, value: '', textContent: '', className: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; },
      click() { (this.listeners.click || []).forEach(f => f({ target: this })); },
      focus() { doc.activeElement = this; }, select() {}
    };
    return n;
  }
  const body = el('body'), head = el('head');
  const doc = {
    body, head, documentElement: body, activeElement: null, createElement: el,
    getElementById: id => head.children.find(c => c.id === id) || null,
    addEventListener: (t, f) => keyListeners.push(f),
    removeEventListener: (t, f) => { const i = keyListeners.indexOf(f); if (i >= 0) keyListeners.splice(i, 1); },
    key: k => keyListeners.slice().forEach(f => f({ key: k, preventDefault() {} }))
  };
  return doc;
}
const all = (n, out = []) => { out.push(n); n.children.forEach(c => all(c, out)); return out; };
const buttons = doc => all(doc.body).filter(n => n.tagName === 'BUTTON');
const field = doc => all(doc.body).find(n => n.tagName === 'INPUT');

test('אישור: "אישור" ← true, "ביטול" ← false, Escape ← false, והחלון נסגר', async () => {
  const doc = fakeDoc(); const d = make({ document: doc });
  let p = d.confirm('למחוק?', { danger: true });
  assert.equal(buttons(doc)[0].className, 'ss-danger');
  assert.equal(buttons(doc)[0].textContent, 'אישור');
  buttons(doc)[0].click();
  assert.equal(await p, true);
  assert.equal(doc.body.children.length, 0);
  p = d.confirm('למחוק?'); buttons(doc)[1].click(); assert.equal(await p, false);
  p = d.confirm('למחוק?'); doc.key('Escape'); assert.equal(await p, false);
  assert.equal(doc.getElementById('ss-dialog-style') !== null, true, 'הסגנון נוסף פעם אחת');
  assert.equal(doc.head.children.length, 1);
});

test('שאלה: מחזירה את מה שהוקלד, Enter מאשר, ביטול ← null', async () => {
  const doc = fakeDoc(); const d = make({ document: doc });
  let p = d.prompt('בכמה ימים להזכיר?', '7');
  assert.equal(field(doc).value, '7');
  field(doc).value = '14';
  buttons(doc)[0].click();
  assert.equal(await p, '14');
  p = d.prompt('שם?'); field(doc).value = 'טבעת'; doc.activeElement = field(doc); doc.key('Enter');
  assert.equal(await p, 'טבעת');
  p = d.prompt('שם?'); buttons(doc)[1].click(); assert.equal(await p, null);
});

test('בחירה והודעה', async () => {
  const doc = fakeDoc(); const d = make({ document: doc });
  let p = d.choose('לייבא?', [{ label: 'להוסיף', value: 'merge' }, { label: 'להחליף', value: 'replace', kind: 'danger' }]);
  assert.deepEqual(buttons(doc).map(b => b.textContent), ['להוסיף', 'להחליף', 'ביטול']);
  buttons(doc)[1].click(); assert.equal(await p, 'replace');
  p = d.alert('נשמר'); buttons(doc)[0].click(); assert.equal(await p, undefined);
});

test('צבעים רק משפת העיצוב, ונגיש (role, aria-modal)', () => {
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,6}\b|rgba?\(/);
  for (const m of CSS.match(/var\(--ss-[a-z0-9-]+/g)) {
    assert.match(read('shell/design-tokens.css'), new RegExp(m.slice(4) + ':'), m);
  }
  const src = read('shell/ss-dialog.js');
  assert.match(src, /'role', 'dialog'/);
  assert.match(src, /'aria-modal', 'true'/);
});

test('אין alert / confirm / prompt של הדפדפן במעטפת, בשמאות, בארגז הכלים ובמסכים הכלכליים', () => {
  const dirs = ['shell', 'modules/shamai/src', 'modules/tools', 'modules/econ/ui'];
  const bad = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(path.join(ROOT, d))) {
      if (!/\.js$/.test(f) || f === 'ss-dialog.js') continue;
      const src = read(d + '/' + f).replace(/\/\/.*$/gm, '');
      for (const m of src.matchAll(/(^|[^.\w])(alert|confirm|prompt)\(/g)) bad.push(`${d}/${f}: ${m[2]}(`);
    }
  }
  assert.deepEqual(bad, [], 'להשתמש ב-ssDialog (או askConfirm במודול הכלכלי)');
});

test('נטען בכל מסך: שמאות, ארגז כלים ומעטפת; מוגש ב-main.js ומועתק לאנדרואיד', () => {
  assert.match(read('modules/shamai/index.html'), /<script src="\/ss-dialog\.js"><\/script>/);
  assert.match(read('modules/tools/index.html'), /<script src="\/ss-dialog\.js"><\/script>/);
  assert.match(read('shell/shell.html'), /<script src="ss-dialog\.js"><\/script>/);
  assert.match(read('main.js'), /rel === '\/ss-dialog\.js'.*shell', 'ss-dialog\.js'/);
  assert.match(read('android/build-apk.js'), /'ss-dialog\.js'/);
});

test('גופן אחד: כל המסכים משתמשים במשתני הגופן של שפת העיצוב', () => {
  const files = ['shell/shell.html', 'modules/econ/styles.css', 'modules/shamai/style.css', 'modules/tools/index.html'];
  for (const f of files) {
    const bad = read(f).match(/font-family:\s*['"]?(Heebo|Segoe UI|David|Frank Ruhl Libre)/g);
    assert.equal(bad, null, `${f}: ${bad} — להשתמש ב-var(--ss-font) / var(--ss-font-title)`);
  }
});

test('אימונים (קוד המקור): אותו חלון ואותו גופן', () => {
  const SRC = 'modules-src/trainer/src';
  const bad = [];
  (function walk(d) {
    for (const n of fs.readdirSync(path.join(ROOT, d))) {
      const rel = d + '/' + n;
      if (fs.statSync(path.join(ROOT, rel)).isDirectory()) { walk(rel); continue; }
      if (!/\.(js|jsx)$/.test(n) || rel.endsWith('lib/dialog.js')) continue;
      const src = read(rel).replace(/\/\/.*$/gm, '');
      for (const m of src.matchAll(/(^|[^.\w])(alert|confirm|prompt)\(/g)) bad.push(`${rel}: ${m[2]}(`);
      if (/["'](?:Heebo|Frank Ruhl Libre)["']/.test(src)) bad.push(`${rel}: גופן קבוע`);
    }
  })(SRC);
  assert.deepEqual(bad, [], 'להשתמש ב-askConfirm / showMessage מ-lib/dialog.js וב-var(--ss-font)');
  const html = read('modules-src/trainer/index.html');
  assert.match(html, /<script src="\/ss-dialog\.js"><\/script>/);
  assert.match(html, /--font-body:var\(--ss-font\)/);
});
