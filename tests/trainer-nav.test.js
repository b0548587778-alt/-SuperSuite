// מסכי מודול האימונים בסרגל האחיד: הקטלוג מול החבילה המהודרת, וה-preload שמנווט ומדווח.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const Catalog = require(path.join(ROOT, 'shell', 'catalog.js'));
const TRAINER = path.join(ROOT, 'modules', 'trainer');

function bundleSource() {
  const html = fs.readFileSync(path.join(TRAINER, 'index.html'), 'utf8');
  const src = html.match(/src="\/(assets\/index-[^"]+\.js)"/);
  assert.ok(src, 'index.html טוען את החבילה');
  return fs.readFileSync(path.join(TRAINER, src[1]), 'utf8');
}

test('כל מסך אימונים בקטלוג תואם כפתור בסרגל הפנימי של החבילה', () => {
  const js = bundleSource();
  const items = Catalog.ITEMS.filter(it => it.mod === 'trainer' && it.view);
  assert.equal(items.length, Catalog.TRAINER_VIEWS.length);
  for (const view of Catalog.TRAINER_VIEWS) {
    const label = Catalog.TRAINER_LABELS[view];
    assert.ok(js.includes(`label:${JSON.stringify(label)}`), `כפתור "${label}" (${view}) לא נמצא — בנייה חדשה של המודול שינתה את הסרגל?`);
  }
  assert.equal(new Set(Object.values(Catalog.TRAINER_LABELS)).size, Catalog.TRAINER_VIEWS.length, 'טקסטים ייחודיים');
});

// DOM מינימלי: aside עם כפתורים, MutationObserver ידני
function makeDom(labels, activeIdx) {
  const observers = [];
  const buttons = labels.map((l, i) => ({
    textContent: '🏷' + l,
    className: i === activeIdx ? 'w-full bg-indigo-500/15 text-indigo-300' : 'w-full text-slate-400',
    clicks: 0,
    click() { this.clicks++; buttons.forEach(b => { b.className = b === this ? 'w-full bg-indigo-500/15' : 'w-full'; }); },
  }));
  const document = {
    head: { children: [], appendChild(el) { this.children.push(el); } },
    body: {},
    createElement: () => ({ textContent: '' }),
    querySelectorAll: (sel) => (sel === 'aside button' ? (document.asideReady ? buttons : []) : []),
    asideReady: true,
  };
  const listeners = {};
  const window = { addEventListener: (ev, fn) => { listeners[ev] = fn; } };
  class MutationObserver { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} }
  const mutate = () => observers.forEach(o => o.fn());
  return { document, window, MutationObserver, buttons, listeners, mutate };
}

function loadPreload(dom) {
  const invoked = [];
  const on = {};
  const ipcRenderer = {
    invoke: (ch, arg) => { invoked.push([ch, arg]); return Promise.resolve(true); },
    on: (ch, fn) => { on[ch] = fn; },
  };
  const code = fs.readFileSync(path.join(TRAINER, 'preload.js'), 'utf8');
  vm.runInNewContext(code, {
    require: (m) => { assert.equal(m, 'electron', 'preload בארגז חול טוען רק electron'); return { ipcRenderer }; },
    document: dom.document, window: dom.window, MutationObserver: dom.MutationObserver,
  });
  return { invoked, on };
}

test('preload האימונים: מסתיר את הסרגל הפנימי, מנווט לפי הטקסט ומדווח על המסך הפעיל', () => {
  const labels = Object.values(Catalog.TRAINER_LABELS);
  const dom = makeDom(labels, 0);
  const { invoked, on } = loadPreload(dom);
  dom.listeners.DOMContentLoaded();
  assert.match(dom.document.head.children[0].textContent, /aside\{display:none/);
  assert.deepEqual(invoked, [['shell:trainer-view', labels[0]]], 'דיווח ראשוני על המסך הפעיל');

  const target = dom.buttons[labels.indexOf(Catalog.TRAINER_LABELS.cardio)];
  on['trainer:goto']({}, Catalog.TRAINER_LABELS.cardio);
  assert.equal(target.clicks, 1);
  dom.mutate();
  assert.deepEqual(invoked.at(-1), ['shell:trainer-view', Catalog.TRAINER_LABELS.cardio]);
  dom.mutate();
  assert.equal(invoked.length, 2, 'אין דיווח חוזר על אותו מסך');
  // "כלים" לא נלחץ בטעות כשמבקשים טקסט אחר (התאמה מלאה ולא חלקית)
  on['trainer:goto']({}, 'כלי');
  assert.equal(dom.buttons.reduce((s, b) => s + b.clicks, 0), 1);
});

test('preload האימונים: בקשת ניווט לפני שהסרגל קיים (מסך הגדרה ראשונית) נשמרת עד שהוא מופיע', () => {
  const labels = Object.values(Catalog.TRAINER_LABELS);
  const dom = makeDom(labels, 0);
  dom.document.asideReady = false;
  const { on } = loadPreload(dom);
  dom.listeners.DOMContentLoaded();
  on['trainer:goto']({}, Catalog.TRAINER_LABELS.settings);
  const target = dom.buttons[labels.indexOf(Catalog.TRAINER_LABELS.settings)];
  assert.equal(target.clicks, 0);
  dom.document.asideReady = true;
  dom.mutate();
  assert.equal(target.clicks, 1);
  dom.mutate();
  assert.equal(target.clicks, 1, 'הבקשה מתבצעת פעם אחת');
});

test('מודול האימונים: שורת לשוניות גלילה אופקית לא מציגה פס גלילה אנכי (פיקסל של -mb-px)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'modules-src', 'trainer', 'src', 'theme.css'), 'utf8');
  assert.match(css, /\.overflow-x-auto\s*\{\s*overflow-y:\s*hidden;?\s*\}/);
  // הסתרת הגלילה האנכית בטוחה רק כשאין לאלמנט גובה קבוע שדורש גלילה כזו
  for (const m of bundleSource().matchAll(/className:"([^"]*overflow-x-auto[^"]*)"/g)) {
    assert.doesNotMatch(m[1], /(^|\s)(max-h-|h-\d)/, 'overflow-x-auto עם גובה קבוע: ' + m[1]);
  }
});

// שמירה כ-PDF (PLAN.md 6.4): המסך שולח ss:save-pdf, וה-preload מבקש מהתוכנה PDF של התצוגה
function loadPdfPreload({ invokeImpl } = {}) {
  const dom = makeDom(Object.values(Catalog.TRAINER_LABELS), 0);
  const attrs = {};
  dom.document.documentElement = {
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    classList: { add() {}, remove() {} },
  };
  dom.document.getElementById = () => null;
  const invoked = [];
  let printed = 0;
  dom.window.print = () => { printed++; };
  dom.window.confirm = () => true;
  const ipcRenderer = {
    invoke: (ch, arg) => { invoked.push([ch, arg]); return invokeImpl ? invokeImpl(ch, arg) : Promise.resolve(true); },
    on() {},
  };
  const code = fs.readFileSync(path.join(TRAINER, 'preload.js'), 'utf8');
  vm.runInNewContext(code, { require: () => ({ ipcRenderer }), document: dom.document, window: dom.window, MutationObserver: dom.MutationObserver, Event: class { constructor(type) { this.type = type; } } });
  dom.listeners.DOMContentLoaded();
  return { dom, attrs, invoked, printed: () => printed };
}

test('preload האימונים: שמירה כ-PDF — מסמן את המסך, ושולח לתוכנה את השם המוצע', async () => {
  const { dom, attrs, invoked, printed } = loadPdfPreload();
  assert.equal(attrs['data-ss-pdf'], '1', 'המסך יודע שאפשר לשמור דרך התוכנה');
  attrs['data-ss-pdf-name'] = 'תוכנית אימון — יצחק';
  await dom.listeners['ss:save-pdf']();
  assert.deepEqual(invoked.filter(c => c[0] === 'trainer:save-pdf'), [['trainer:save-pdf', 'תוכנית אימון — יצחק']]);
  assert.equal(printed(), 0, 'לא נפתח גם חלון הדפסה');
});

test('preload האימונים: בלי ערוץ שמירה (אנדרואיד) — חוזרים להדפסה', async () => {
  const { dom, printed } = loadPdfPreload({ invokeImpl: (ch) => (ch === 'trainer:save-pdf' ? Promise.reject(new Error('No handler')) : Promise.resolve(true)) });
  await dom.listeners['ss:save-pdf']();
  assert.equal(printed(), 1);
});

test('קוד המקור: כל כפתור PDF עובר דרך lib/print.js, ואין window.print ישיר במסכים', () => {
  const src = require('./helpers/trainer-src');
  const ui = src.trainerUiSource();
  assert.doesNotMatch(ui.replace(/\/\/.*$/gm, ''), /window\.print\(/, 'להשתמש ב-savePdf / printNow מ-lib/print.js');
  const lib = fs.readFileSync(path.join(ROOT, 'modules-src', 'trainer', 'src', 'lib', 'print.js'), 'utf8');
  assert.match(lib, /dispatchEvent\(new Event\('ss:save-pdf'\)\)/);
  assert.match(lib, /hasAttribute\('data-ss-pdf'\)/);
  // תוכנית, תזונה, תבנית, דוח למתאמן וטופס PAR-Q
  assert.equal((ui.match(/savePdf\(/g) || []).length, 5);
});

test('preload האימונים: שגיאה בשמירת ה-PDF מועברת לעמוד (מאפיין + אירוע), בלי הדפסה', async () => {
  const { dom, attrs, printed } = loadPdfPreload({ invokeImpl: (ch) => Promise.resolve(ch === 'trainer:save-pdf' ? { ok: false, error: 'שמירת הקובץ נכשלה.' } : true) });
  const events = [];
  dom.window.dispatchEvent = (ev) => { events.push(ev.type); };
  await dom.listeners['ss:save-pdf']();
  assert.equal(attrs['data-ss-pdf-error'], 'שמירת הקובץ נכשלה.');
  assert.deepEqual(events, ['ss:pdf-error']);
  assert.equal(printed(), 0);
});
