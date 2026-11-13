// נגישות, סבב 4 (בקשת הבעלים: "נגיש לכל אדם, ברמה הגבוהה ביותר"): חלון "♿ נגישות", מצב פשוט, בועות עזרה,
// והחוזה המשותף לכל המודולים — data-ss-simple / .ss-advanced / .ss-simple-only / data-ss-help.
// כאן בלי דפדפן (vm ובדיקת קבצים); בדפדפן אמיתי — tests/r4-a11y-shell-browser.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const D = require('../shell/display');
const S = require('../shell/simple-mode');
const CAT = require('../shell/catalog');
const TOKENS = read('shell/design-tokens.css');
const KIT = read('shell/ui-kit.css');

/* ---------- הגדרות ---------- */
test('display: הגדרות הנגישות החדשות — ברירת מחדל = המראה הקיים, וכל אחת הופכת למאפיין data-ss-*', () => {
  for (const k of ['simple', 'targets', 'links', 'font']) assert.ok(D.KEYS.includes(k), k);
  assert.equal(D.DEFAULTS.simple, 'off');
  assert.ok(D.OPTIONS.text.map(o => o.id).includes('xxl'), 'חמישה גדלי טקסט');
  assert.equal(D.OPTIONS.text.length, 5);
  const a = D.attrsFor({ simple: 'on', targets: 'large', links: 'underline', font: 'readable', text: 'xxl' }, false);
  assert.equal(a['data-ss-simple'], 'on');
  assert.equal(a['data-ss-targets'], 'large');
  assert.equal(a['data-ss-links'], 'underline');
  assert.equal(a['data-ss-font'], 'readable');
  assert.equal(a['data-ss-text'], 'xxl');
  // קלט לא מהימן
  assert.equal(D.attrsFor({ simple: 'yes' }, false)['data-ss-simple'], 'off');
});

test('display: "הכול בבת אחת", תשובת "כן" בהפעלה הראשונה, וחזרה למצב הרגיל', () => {
  assert.deepEqual(D.sanitize({ ...D.DEFAULTS, ...D.A11Y_FULL }), { ...D.DEFAULTS, ...D.A11Y_FULL }, 'ערכים תקינים');
  assert.deepEqual(D.sanitize({ ...D.DEFAULTS, ...D.A11Y_EASY }), { ...D.DEFAULTS, ...D.A11Y_EASY });
  assert.equal(D.A11Y_EASY.simple, 'on');
  assert.equal(D.isPlain(D.DEFAULTS), true);
  assert.equal(D.isPlain({ theme: 'dark', accent: 'gold' }), true, 'ערכה וצבע אינם הגדרות נגישות');
  assert.equal(D.isPlain({ text: 'lg' }), false);
  const r = D.resetA11y({ ...D.A11Y_FULL, theme: 'dark', accent: 'teal' });
  assert.equal(r.theme, 'dark', 'הערכה נשארת');
  assert.equal(r.accent, 'teal');
  assert.equal(D.isPlain(r), true);
  assert.equal(D.applyPreset('access').simple, 'on');
});

test('design-tokens / ui-kit: החוזה של מצב פשוט ובועות העזרה, בלי hex מחוץ לשפת העיצוב', () => {
  assert.match(KIT, /:root\[data-ss-simple="on"\] \.ss-advanced \{ display: none !important; \}/);
  assert.match(KIT, /:root:not\(\[data-ss-simple="on"\]\) \.ss-simple-only \{ display: none !important; \}/);
  assert.match(KIT, /\.ss-help-btn \{/);
  assert.match(KIT, /\.ss-help-tip\[hidden\] \{ display: none; \}/);
  assert.match(KIT, /:root\[data-ss-links="underline"\]/);
  assert.match(KIT, /:root\[data-ss-font="readable"\] body/);
  assert.match(KIT, /body\.ss-zoom-text/);
  assert.doesNotMatch(KIT, /#[0-9a-f]{3,8}\b/i);
  // גודל מטרה: 24 תמיד, 44 בכפתורים גדולים ובמצב פשוט
  assert.match(TOKENS, /--ss-target-min: 24px;/);
  assert.match(TOKENS, /:root\[data-ss-targets="large"\] \{[^}]*--ss-target-min: 44px;/);
  assert.match(TOKENS, /:root\[data-ss-simple="on"\] \{[^}]*--ss-target-min: 44px;/);
  // כל משתנה שהרכיבים משתמשים בו מוגדר
  for (const m of new Set(KIT.match(/var\(--ss-[a-z0-9-]+/g))) assert.match(TOKENS, new RegExp(m.slice(4) + ':'), m);
  // ss-help.js ו-simple-mode.js — בלי צבעים בכלל
  for (const f of ['shell/ss-help.js', 'shell/simple-mode.js']) assert.doesNotMatch(read(f), /#[0-9a-f]{3,6}\b|rgba?\(/i, f);
});

/* ---------- ניגודיות לצבעים החדשים (בהיר וכהה) ---------- */
function block(sel) {
  const i = TOKENS.indexOf(sel + ' {');
  const body = TOKENS.slice(i, TOKENS.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/--ss-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(m => [m[1], m[2]]));
}
function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
// זוגות טקסט/רקע שנוספו: "חזרה למסך הבית" (נייבי על זהב), בועת העזרה (ובהיפוך, במעבר עכבר), משימות מצב פשוט,
// מתג פעיל, וגודל טקסט שנבחר
const NEW_PAIRS = [['navy-1', 'gold-bright'], ['navy-1', 'gold-pale'], ['info-ink', 'info-soft'], ['text', 'primary-soft'],
  ['text', 'surface'], ['muted', 'surface'], ['on-primary', 'primary']];
test('ניגודיות: הצבעים של חלון הנגישות ומצב פשוט — 4.5 לפחות, בבהיר, בכהה ובניגודיות גבוהה', () => {
  const base = block(':root');
  const sets = {
    light: base,
    dark: { ...base, ...block(':root[data-ss-theme="dark"]') },
    high: { ...base, ...block(':root[data-ss-contrast="high"]') },
    darkHigh: { ...base, ...block(':root[data-ss-theme="dark"]'), ...block(':root[data-ss-theme="dark"][data-ss-contrast="high"]') },
  };
  const bad = [];
  for (const [name, T] of Object.entries(sets)) {
    for (const [a, b] of NEW_PAIRS) {
      assert.ok(T[a] && T[b], `${name}: חסר ${a}/${b}`);
      if (ratio(T[a], T[b]) < 4.5) bad.push(`${name}: ${a} על ${b} = ${ratio(T[a], T[b]).toFixed(2)}`);
    }
  }
  assert.deepEqual(bad, []);
  // מסגרת המיקוד על כפתור "♿ נגישות" (רקע הסרגל הכהה)
  assert.ok(ratio(base['gold-bright'], base['side-top']) >= 3);
});

/* ---------- מצב פשוט: משימות ---------- */
test('מצב פשוט: כל משימה מפנה לפריט קיים בקטלוג או לפעולה של המעטפת, בפועל פשוט', () => {
  const keys = new Set(CAT.ITEMS.map(i => i.key));
  const shell = read('shell/shell.js');
  for (const t of S.TASKS) {
    assert.ok(t.key ? keys.has(t.key) : ['search', 'backup', 'help'].includes(t.action), t.id);
    assert.match(t.verb, /^[֐-׿"() ]+$/, 'רק עברית: ' + t.verb);
    assert.ok(t.verb.split(' ').length <= 7, 'קצר: ' + t.verb);
    assert.match(shell, new RegExp(`\\n    '?${t.icon}'?: '<`), 'אייקון קיים: ' + t.icon);
  }
  assert.ok(S.TASKS.some(t => /חשבונית|קבלה/.test(t.verb)));
  assert.ok(S.TASKS.some(t => /תרומה/.test(t.verb)));
  assert.ok(S.TASKS.some(t => /כסף נכנס החודש/.test(t.verb)));
  assert.ok(S.TASKS.some(t => /לגבות/.test(t.verb)));
  assert.ok(S.TASKS.some(t => /גיבוי/.test(t.verb)));
});

test('מצב פשוט: רק משימות שפתוחות ברישיון, וגיבוי — למנהל בלבד', () => {
  const ids = (o) => S.tasksFor(o).map(t => t.id);
  assert.ok(ids({ admin: true }).includes('backup'));
  assert.ok(!ids({ admin: false }).includes('backup'));
  const noNpo = ids({ open: k => k !== 'econ:npo' });
  assert.ok(!noNpo.includes('donation'));
  assert.ok(noNpo.includes('help'), 'פעולות של המעטפת — תמיד');
  assert.ok(!ids({ has: k => k !== 'shamai' }).includes('appraise'));
  assert.deepEqual(S.sidebarKeys([{ key: 'tools' }, { action: 'help' }], ['tools', 'econ:npo']), ['tools', 'econ:npo']);
});

/* ---------- המעטפת בתוך vm ---------- */
function el(id) {
  const attrs = {};
  const kids = [];
  return {
    id, _l: {}, attrs, hidden: false, open: false, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, isConnected: true,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    focus() { el.focused = this; }, blur() {}, select() {},
    addEventListener(ev, fn) { this._l[ev] = fn; }, appendChild(k) { kids.push(k); }, querySelector() { return null; },
    querySelectorAll() { return []; },
    showModal() { this.open = true; }, close() { this.open = false; },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
  };
}
const flush = () => new Promise(r => setImmediate(r));

function loadShell({ display = {}, storage = {}, admin = true } = {}) {
  const elements = {};
  const calls = { open: [], save: [], overlay: [], backup: 0 };
  let disp = D.sanitize(display);
  const listeners = {};
  const shellAPI = {
    getCalendar: async () => ({ shabbatMode: false }),
    switchTo: async () => true, goHome: async () => {}, quit: async () => {},
    open: async (id, view) => { calls.open.push([id, view]); return true; },
    setOverlay: async (on) => { calls.overlay.push(on); return true; },
    backupAll: async () => { calls.backup++; return { ok: false }; },
    restoreAll: async () => ({ ok: false }),
    isLoggedIn: async () => true, isAdmin: async () => admin,
    getBackupTarget: async () => '', pickBackupTarget: async () => null,
    onActive: (cb) => { (listeners.active ||= []).push(cb); }, onCmd: (cb) => { listeners.cmd = cb; }, onActiveView: () => {},
    getDisplay: async () => disp,
    saveDisplay: async (s) => { calls.save.push(s); disp = D.sanitize(s); return disp; },
  };
  const docEl = el('html');
  const store = { ...storage };
  const document = {
    getElementById(id) { return (elements[id] ||= el(id)); },
    querySelector(sel) { return sel === 'dialog[open]' ? (Object.values(elements).find(e => e.open) || null) : null; },
    querySelectorAll() { return []; }, addEventListener() {}, createElement() { return el('x'); },
    body: el('body'), documentElement: docEl, get activeElement() { return el.focused || null; },
  };
  const context = { document, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Intl, Date, Math,
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
  context.window = context;
  context.shellAPI = shellAPI;
  context.HTMLElement = function () {};
  vm.createContext(context);
  for (const f of ['shell/hebcal.js', 'shell/catalog.js', 'shell/display.js', 'shell/simple-mode.js', 'shell/ss-dialog.js', 'shell/shell.js']) {
    vm.runInContext(read(f), context, { filename: f });
  }
  return { ctx: context, elements, calls, store, docEl, cmd: (c) => listeners.cmd(c), active: (id) => listeners.active.forEach(fn => fn(id)) };
}

test('המעטפת: במצב פשוט — משימות גדולות במסך הבית, הסרגל מקוצר עם "עוד מסכים", ולחיצה על משימה פותחת את המסך', async () => {
  const s = loadShell({ display: { simple: 'on' }, storage: { 'suite.a11yAsked': 'no' } });
  await flush(); await flush();
  const tasks = s.elements.simpleTasks.innerHTML;
  assert.match(tasks, /data-task="invoice"/);
  assert.match(tasks, /להוציא חשבונית או קבלה/);
  // תפריט "כמו ברכב": בעמוד הראשון 3 משימות, השאר ב"הבא"
  assert.equal((tasks.match(/data-task=/g) || []).length, 3);
  assert.doesNotMatch(tasks, /data-task="backup"/);
  assert.equal(s.elements.taskPrev.disabled, true, 'בעמוד הראשון אין "הקודם"');
  assert.equal(s.elements.taskPageInfo.textContent, 'עמוד 1 מתוך 4');
  s.elements.taskNext.onclick(); s.elements.taskNext.onclick();
  assert.match(s.elements.simpleTasks.innerHTML, /data-task="backup"/, 'מנהל — גם גיבוי (בעמוד השלישי)');
  s.elements.taskNext.onclick();
  assert.equal(s.elements.taskNext.disabled, true, 'בעמוד האחרון אין "הבא"');
  s.elements.taskNext.onclick();
  assert.equal(s.elements.taskPageInfo.textContent, 'עמוד 4 מתוך 4', 'לחיצה נוספת לא יוצאת מהטווח');
  for (let i = 0; i < 3; i++) s.elements.taskPrev.onclick();
  assert.match(s.elements.simpleTasks.innerHTML, /data-task="invoice"/, '"הקודם" מחזיר לעמוד הראשון');
  // הסרגל: המסכים הנפוצים ו"עוד מסכים", בלי כל התחומים
  const nav = s.elements.nav.innerHTML;
  assert.match(nav, /data-more aria-expanded="false">עוד מסכים</);
  assert.match(nav, /data-key="econ:acct-invoices"/);
  assert.doesNotMatch(nav, /data-key="econ:acct-chart"/, 'תוכנית חשבונות — מאחורי "עוד מסכים"');
  assert.doesNotMatch(nav, /class="grp-t"/);
  // "עוד מסכים" פותח את כל התחומים
  s.elements.nav.onclick({ target: { closest: (sel) => (sel === '[data-more]' ? { dataset: { more: '' } } : null) } });
  assert.match(s.elements.nav.innerHTML, /data-key="econ:acct-chart"/);
  assert.match(s.elements.nav.innerHTML, /aria-expanded="true">פחות מסכים</);
  // רשימת כל המסכים במסך הבית — מוסתרת (ss-advanced) עד "הצגת כל המסכים"
  assert.equal(s.elements.groups.classList.contains('ss-advanced'), true);
  s.elements.simpleAll.onclick();
  assert.equal(s.elements.groups.classList.contains('ss-advanced'), false);
  assert.equal(s.elements.simpleAll.getAttribute('aria-expanded'), 'true');
  // לחיצה על משימה
  s.elements.simpleTasks.onclick({ target: { closest: () => ({ dataset: { task: 'donation' } }) } });
  assert.deepEqual(s.calls.open.at(-1), ['econ', 'npo']);
  // "חזרה למסך הבית" — גלוי כשמסך פתוח
  s.active('econ');
  assert.equal(s.elements.simpleHome.hidden, false);
  s.active(null);
  assert.equal(s.elements.simpleHome.hidden, true);
});

test('המעטפת: בלי מצב פשוט — הסרגל המלא כמו קודם, והתפריט "כמו ברכב" מוצג גם כאן', async () => {
  const s = loadShell({ storage: { 'suite.a11yAsked': 'no' } });
  await flush(); await flush();
  assert.equal((s.elements.simpleTasks.innerHTML.match(/data-task=/g) || []).length, 3);
  assert.doesNotMatch(s.elements.nav.innerHTML, /data-more/);
  assert.match(s.elements.nav.innerHTML, /data-key="econ:acct-chart"/);
});

test('המעטפת: "הפשוט הוא הבסיס" — התקנה חדשה בלי שום שאלה; משתמש קיים רואה פעם אחת "המסך התחדש", עם דרך חזרה לתצוגה המלאה', async () => {
  // התקנה חדשה: אין היסטוריה ← אין חלון, והסימון נשמר
  const fresh = loadShell({ display: { simple: 'on' } });
  await flush(); await flush();
  assert.ok(!(fresh.elements.a11yAsk && fresh.elements.a11yAsk.open), 'בהפעלה הראשונה אין שאלות');
  assert.equal(fresh.store['suite.simpleBaseSeen'], 'new');
  assert.match(fresh.elements.simpleTasks.innerHTML, /data-task=/);
  // משתמש קיים (יש לו היסטוריה): ההודעה נפתחת פעם אחת
  const s = loadShell({ display: { simple: 'on' }, storage: { 'suite.a11yAsked': 'no' } });
  await flush(); await flush();
  assert.equal(s.elements.a11yAsk.open, true, 'ההודעה נפתחה');
  assert.equal(s.calls.overlay.at(-1), true, 'המודול מוסתר מאחורי החלון');
  s.elements.a11yAskYes.onclick();
  await flush(); await flush();
  assert.equal(s.elements.a11yAsk.open, false);
  assert.equal(s.store['suite.simpleBaseSeen'], 'ok');
  assert.equal(s.calls.save.length, 0, '"הבנתי" לא משנה שום הגדרה');
  // "להחזיר את התצוגה המלאה" — נשמר simple: off
  const back = loadShell({ display: { simple: 'on' }, storage: { 'suite.recent': '[]' } });
  await flush(); await flush();
  assert.equal(back.elements.a11yAsk.open, true);
  back.elements.a11yAskNo.onclick();
  await flush(); await flush();
  assert.equal(back.calls.save.at(-1).simple, 'off');
  assert.equal(back.store['suite.simpleBaseSeen'], 'full');
  // כבר הוצגה — לא שוב; ומי שכבר בתצוגה המלאה — בלי הודעה
  const again = loadShell({ display: { simple: 'on' }, storage: { 'suite.a11yAsked': 'no', 'suite.simpleBaseSeen': 'ok' } });
  await flush(); await flush();
  assert.ok(!(again.elements.a11yAsk && again.elements.a11yAsk.open), 'לא מוצגת שוב');
  const full = loadShell({ display: { simple: 'off' }, storage: { 'suite.a11yAsked': 'no' } });
  await flush(); await flush();
  assert.ok(!(full.elements.a11yAsk && full.elements.a11yAsk.open));
});

test('display: stored — התקנה חדשה והגדרות מלפני השינוי נפתחות במצב פשוט; אחרי שמירה הבחירה נשמרת כמו שהיא', () => {
  assert.equal(D.stored(undefined).simple, 'on', 'אין קובץ');
  assert.equal(D.stored({}).simple, 'on', 'התקנה חדשה');
  assert.equal(D.stored({ display: { simple: 'off', theme: 'dark' } }).simple, 'on', 'מי שעבד במסך המלא עובר פעם אחת');
  assert.equal(D.stored({ display: { simple: 'off', theme: 'dark' } }).theme, 'dark', 'שאר ההגדרות לא משתנות');
  const saved = D.withSaved({ zoom: 1.1 }, { simple: 'off' });
  assert.equal(saved.zoom, 1.1);
  assert.equal(D.stored(saved).simple, 'off', 'בחירה מפורשת בתצוגה המלאה נשמרת');
  assert.equal(D.stored({ display: { simple: 'off' }, displayBase: 'x' }).simple, 'on', 'סימון לא תקין = לא סומן');
  assert.equal(D.resetA11y({ simple: 'off', text: 'xl' }).simple, 'on', '"חזרה למצב הרגיל" = הפשוט');
  assert.equal(D.resetA11y({ simple: 'off', text: 'xl' }).text, 'md');
});

test('המעטפת: חלון הנגישות — מקיצור המקלדת (פקודה a11y), מתג נשמר מיד ומודיע בהודעה חיה', async () => {
  const s = loadShell({ storage: { 'suite.a11yAsked': 'no' } });
  await flush(); await flush();
  s.cmd('a11y');
  assert.equal(s.elements.a11yDlg.open, true);
  const html = s.elements.a11yOpts.innerHTML;
  assert.match(html, /role="switch" aria-checked="false" aria-labelledby="a11y-simple"/);
  assert.match(html, /aria-labelledby="a11y-contrast"/);
  assert.match(html, /data-size="xxl"/);
  // מתג "ניגודיות גבוהה"
  const sw = { dataset: { a11y: 'contrast' }, getAttribute: () => 'false' };
  await s.elements.a11yOpts.onclick({ target: { closest: () => sw } });
  assert.equal(s.calls.save.at(-1).contrast, 'high');
  await new Promise(r => setTimeout(r, 80));
  assert.equal(s.elements.a11yLive.textContent, 'ניגודיות גבוהה: פועל');
  assert.match(s.elements.a11yOpts.innerHTML, /aria-checked="true" aria-labelledby="a11y-contrast"/);
  // גודל טקסט
  await s.elements.a11yOpts.onclick({ target: { closest: () => ({ dataset: { size: 'xxl' }, getAttribute: () => null }) } });
  assert.equal(s.calls.save.at(-1).text, 'xxl');
  // חזרה למצב הרגיל
  await s.elements.a11yReset.onclick();
  assert.equal(D.isPlain(s.calls.save.at(-1)), true);
  // Esc = סגירה
  const ev = { preventDefault() { ev.prevented = true; } };
  s.elements.a11yDlg.oncancel(ev);
  assert.equal(s.elements.a11yDlg.open, false);
});

test('המעטפת: כפתור "♿ נגישות" בראש הסרגל, החלונות עם כותרת, והקבצים נטענים לפני shell.js', () => {
  const html = read('shell/shell.html');
  const side = html.slice(html.indexOf('<div class="side">'), html.indexOf('<nav id="nav"'));
  assert.match(side, /<button id="a11yBtn" class="a11y-btn" type="button" aria-haspopup="dialog"[^>]*><span class="a11y-ic" aria-hidden="true">♿<\/span><span>נגישות<\/span><\/button>/);
  assert.ok(side.indexOf('a11yBtn') < side.indexOf('id="q"'), 'לפני החיפוש — הדבר הראשון בסרגל');
  assert.match(html, /<dialog id="a11yDlg" class="a11y-dlg" aria-labelledby="a11yTitle" aria-describedby="a11yIntro">/);
  assert.match(html, /<dialog id="a11yAsk" class="a11y-ask" aria-labelledby="a11yAskTitle" aria-describedby="a11yAskText">/);
  assert.match(html, /המסך התחדש — עכשיו הוא פשוט יותר/);
  assert.match(html, /id="simpleOff">תצוגה מלאה \(למתקדמים\)</);
  assert.match(html, /id="simpleOn">חזרה לתצוגה הפשוטה</);
  assert.match(html, /id="a11yLive" role="status" aria-live="polite"/);
  for (const f of ['ss-help.js', 'simple-mode.js', 'display.js']) {
    assert.ok(html.indexOf(`src="${f}"`) > 0 && html.indexOf(`src="${f}"`) < html.indexOf('src="shell.js"'), f);
  }
  // מסך הבית: מה שמוסתר במצב פשוט מסומן ss-advanced, ומה שמוצג רק בו — ss-simple-only
  assert.match(html, /class="kpis ss-advanced"/);
  assert.match(html, /class="simple-tasks" id="simpleSec"/);
  assert.match(html, /id="simpleHome" class="simple-home ss-simple-only"/);
  // CSP לא השתנה (בלי סקריפט פנימי)
  assert.match(html, /script-src 'self';/);
  assert.doesNotMatch(html, /<script>(?!<\/script>)/);
});

test('main.js: קיצור Alt+0 / Ctrl+Alt+A פותח את חלון הנגישות; ss-help.js מוגש לכל מודול', () => {
  const main = read('main.js');
  assert.match(main, /input\.alt && !input\.control && !input\.shift && input\.code === 'Digit0'/);
  assert.match(main, /input\.control && input\.alt && !input\.shift && input\.code === 'KeyA'/);
  assert.match(main, /sendCmd\('a11y'\)/);
  assert.match(main, /rel === '\/ss-help\.js'.*shell', 'ss-help\.js'/);
  // הקיצור לפני הזום (Ctrl+0 לא נבלע)
  assert.ok(main.indexOf("sendCmd('a11y')") < main.indexOf("input.key === '0') { setZoom(1)"));
});

test('display-preload: מוסיף את תג בועות העזרה רק במודולים (app:), בלי require ובלי חשיפה נוספת', () => {
  const p = read('shell/display-preload.js');
  assert.match(p, /if \(location\.protocol === 'app:'\) \{/);
  assert.match(p, /s\.src = '\/ss-help\.js';/);
  assert.equal((p.match(/exposeInMainWorld\(/g) || []).length, 1);
  assert.doesNotMatch(p, /require\('(?!electron')/);
});

/* ---------- ss-help.js: בועת עזרה עם DOM מדומה ---------- */
function miniDom() {
  const all = [];
  const mk = (tag) => {
    const n = { tagName: tag.toUpperCase(), nodeType: 1, attrs: {}, children: [], parent: null, _l: {}, hidden: false, textContent: '', isConnected: true,
      classList: { contains: (c) => String(n.className || '').split(' ').includes(c) },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      hasAttribute(k) { return k in this.attrs; },
      addEventListener(ev, fn) { this._l[ev] = fn; },
      appendChild(c) { c.parent = this; this.children.push(c); all.push(c); return c; },
      insertAdjacentElement(pos, c) { c.parent = this.parent; c.after = this; all.push(c); return c; },
      closest() { return null; },
      querySelectorAll(sel) { return sel === '[data-ss-help]' ? all.filter(x => 'data-ss-help' in x.attrs && x !== this) : []; },
      focus() { doc.activeElement = this; },
    };
    return n;
  };
  const doc = { readyState: 'complete', _l: {}, nodeType: 9, addEventListener(ev, fn) { this._l[ev] = fn; },
    createElement: mk, querySelector: () => null, querySelectorAll: (sel) => (sel === '[data-ss-help]' ? all.filter(x => 'data-ss-help' in x.attrs) : []), body: null };
  doc.body = mk('body');
  return { doc, mk, all };
}

test('ss-help.js: כפתור "?" עם שם, aria-expanded ו-aria-controls; Esc סוגר ומחזיר את המיקוד', () => {
  const H = require('../shell/ss-help');
  const { doc, mk } = miniDom();
  const field = mk('input');
  field.id = 'amount';
  field.setAttribute('aria-label', 'סכום');
  field.setAttribute('data-ss-help', 'הסכום בשקלים, כולל מע"מ');
  field.ownerDocument = doc;
  doc.body.appendChild(field);
  const help = H.make({ document: doc });
  const wrap = field.__ssHelp.wrap;
  const btn = field.__ssHelp.btn;
  const tip = field.__ssHelp.tip;
  assert.equal(wrap.className, 'ss-help');
  assert.equal(btn.getAttribute('aria-label'), 'הסבר: סכום');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(btn.getAttribute('aria-controls'), tip.id);
  assert.equal(tip.getAttribute('role'), 'note');
  assert.equal(tip.textContent, 'הסכום בשקלים, כולל מע"מ');
  assert.equal(tip.hidden, true);
  assert.match(field.getAttribute('aria-describedby'), new RegExp(tip.id));
  // לחיצה פותחת
  btn._l.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(tip.hidden, false);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  // Esc סוגר ומחזיר את המיקוד לכפתור
  doc._l.keydown({ key: 'Escape', stopPropagation() {} });
  assert.equal(tip.hidden, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, btn);
  // סריקה חוזרת לא מוסיפה כפתור שני; טקסט חדש מתעדכן
  field.setAttribute('data-ss-help', 'הסבר חדש');
  help.scan(doc);
  assert.equal(field.__ssHelp.wrap, wrap);
  assert.equal(tip.textContent, 'הסבר חדש');
  // רכיב נוסף — כפתור משלו
  const b2 = mk('button');
  b2.textContent = 'ייצוא';
  b2.setAttribute('data-ss-help', 'שמירת הנתונים בקובץ');
  b2.ownerDocument = doc;
  help.enhance(b2);
  assert.equal(b2.__ssHelp.wrap.className, 'ss-help');
  assert.equal(b2.__ssHelp.btn.getAttribute('aria-label'), 'הסבר: ייצוא');
});

/* ---------- ss-dialog.js: מלכודת מיקוד ---------- */
test('ss-dialog.js: Tab ו-Shift+Tab נשארים בתוך החלון, וההודעה מקושרת (aria-describedby)', async () => {
  const src = read('shell/ss-dialog.js');
  assert.match(src, /e\.key === 'Tab'/);
  assert.match(src, /box\.setAttribute\('aria-describedby', p\.id\)/);
  assert.doesNotMatch(src, /'ss-dlg-title'\)/, 'מזהה ייחודי לכל חלון');
});

/* ---------- אנדרואיד ---------- */
test('אנדרואיד: הגדרות התצוגה והנגישות נשמרות ומגיעות למעטפת ולכל מודול (data-ss-simple)', async () => {
  const { bundle } = require('../android/lib/bundle');
  const { createNodeShims, createElectronShims } = require('../android/web/node-shims');
  const MA = require('../android/web/main-android');
  assert.ok(!('shell:get-display' in MA.NOT_ON_ANDROID) && !('shell:save-display' in MA.NOT_ON_ANDROID));
  const shims = createNodeShims({});
  const handlers = new Map();
  const electron = Object.assign({ ipcMain: { handle: (c, fn) => handlers.set(c, fn), on() {} } }, createElectronShims(shims, { bridgeAsync: async () => null }));
  const ext = { electron, fs: shims.fs, path: shims.path, crypto: shims.crypto, 'node:sqlite': shims['node:sqlite'], url: shims.url };
  const { code } = bundle({ 'main-android': path.join(ROOT, 'android/web/main-android.js') }, { root: ROOT, globalName: '__ssR4A11y' });
  new Function(code)();
  const host = globalThis.__ssR4A11y;
  delete globalThis.__ssR4A11y;
  const econ = new Proxy({ licenseState: () => ({ mode: 'unlicensed' }) }, { get: (t, k) => (k in t ? t[k] : () => false) });
  const toFrames = [], toShell = [];
  const frames = { exists: () => false, ensure() {}, setVisible() {}, setWriteBlock() {}, onActivity() {}, whenReady: () => Promise.resolve(),
    send() {}, request: async () => ({}), reloadAll() {}, moduleSenderIds: () => [], setDisplay: (a) => toFrames.push(a) };
  let ui = { calendar: { city: 'jerusalem' } };
  host.require('main-android', ext).start({ ipcMain: electron.ipcMain, econ, frames, SHELL_ID: 1, emitShell() {}, bridgeAsync: async () => null,
    senderOf: () => 2, ui: { load: () => ui, save: (v) => { ui = v; } }, applyShellDisplay: (a) => toShell.push(a), systemDark: () => true,
    setInterval: () => 0, alert() {}, confirm: () => true, exit() {} });
  assert.equal(toShell.length, 1, 'בעלייה — המצב השמור');
  assert.equal(toFrames.length, 1);
  const call = (sender, ch, ...a) => handlers.get(ch)({ sender: { id: sender } }, ...a);
  assert.deepEqual(await call(1, 'shell:get-display'), { ...D.DEFAULTS, simple: 'on' }, 'התקנה חדשה נפתחת במצב הפשוט');
  const saved = await call(1, 'shell:save-display', { simple: 'on', text: 'xxl', theme: 'system', evil: '<x>' });
  assert.equal(saved.simple, 'on');
  assert.equal(ui.display.text, 'xxl');
  assert.equal(ui.calendar.city, 'jerusalem', 'מיזוג — הלוח העברי נשאר');
  assert.equal(toFrames.at(-1)['data-ss-simple'], 'on');
  assert.equal(toShell.at(-1)['data-ss-theme'], 'dark', '"לפי המכשיר" נפתר');
  assert.ok(!('evil' in ui.display));
  // ממודול — לא
  assert.equal(await call(2, 'shell:save-display', { simple: 'off' }), null);
  assert.equal(ui.display.simple, 'on');
});

test('אנדרואיד: frame.js מציב את data-ss-* (רק ערכים פשוטים), זוכר אותם בטעינה מחדש, ומוסיף את בועות העזרה', () => {
  const DOMAIN = 'supersuite.androidplatform.net';
  const run = (session) => {
    const attrs = {};
    const added = [];
    let onMessage = null;
    const parent = { postMessage() {} };
    const sandbox = {
      console, setTimeout, clearTimeout, URLSearchParams, URL, Blob, Event, TextEncoder,
      HTMLAnchorElement: Object.assign(function () {}, { prototype: { click() {} } }),
      location: { host: 'econ.' + DOMAIN, protocol: 'https:', search: '' },
      navigator: {},
      sessionStorage: { getItem: (k) => (k in session ? session[k] : null), setItem: (k, v) => { session[k] = String(v); } },
      localStorage: { getItem: () => null, setItem() {} },
      document: {
        readyState: 'complete', head: { appendChild: (n) => added.push(n) }, documentElement: { setAttribute: (k, v) => { attrs[k] = v; } },
        querySelector: () => null, addEventListener() {}, createElement: () => ({ setAttribute(k, v) { this[k] = v; } }),
      },
      addEventListener: (type, fn) => { if (type === 'message') onMessage = fn; },
    };
    sandbox.window = sandbox;
    sandbox.parent = parent;
    sandbox.window.parent = parent;
    vm.createContext(sandbox);
    vm.runInContext(read('android/web/frame.js'), sandbox);
    return { attrs, added, send: (data) => onMessage({ source: parent, origin: 'https://shell.' + DOMAIN, data }),
      sendFrom: (origin, data) => onMessage({ source: parent, origin, data }) };
  };
  const session = {};
  const f = run(session);
  assert.equal(f.added.length, 1);
  assert.equal(f.added[0].src, '/ss-help.js');
  f.send({ ss: 'display', attrs: { 'data-ss-simple': 'on', 'data-ss-text': 'xl', onclick: 'x', 'data-ss-theme': 'a"b' } });
  assert.deepEqual(f.attrs, { 'data-ss-simple': 'on', 'data-ss-text': 'xl' });
  // הודעה ממקור אחר — לא
  f.sendFrom('https://evil.example', { ss: 'display', attrs: { 'data-ss-simple': 'off' } });
  assert.equal(f.attrs['data-ss-simple'], 'on');
  // מהמעטפת — מתקבל (המעטפת שולחת תמיד את כל המאפיינים)
  f.send({ ss: 'display', attrs: { 'data-ss-simple': 'off', 'data-ss-text': 'xl' } });
  assert.equal(f.attrs['data-ss-simple'], 'off');
  // טעינה מחדש של המודול — המצב האחרון מיד, לפני הודעה מהמעטפת
  const g = run(session);
  assert.equal(g.attrs['data-ss-simple'], 'off');
  assert.equal(g.attrs['data-ss-text'], 'xl');
});

test('אנדרואיד: host.js שולח את ההגדרות לכל מסגרת בכל טעינה; הקבצים החדשים נארזים; כפתור "תצוגה" פעיל', () => {
  const host = read('android/web/host.js');
  assert.match(host, /if \(m\.ss === 'ready'\) \{ f\.loaded = true; postWriteBlock\(id\); postDisplay\(id\);/);
  assert.match(host, /setDisplay\(attrs\) \{/);
  const apk = read('android/build-apk.js');
  assert.match(apk, /'ss-help\.js', 'simple-mode\.js'[,\]]/);
  assert.match(apk, /path\.join\(ROOT, 'shell', 'ss-help\.js'\), path\.join\(dst, 'ss-help\.js'\)/);
  const mobile = read('android/web/mobile.js');
  assert.doesNotMatch(mobile, /\['ds', /, 'חלון "תצוגה" עובד באנדרואיד');
  assert.match(mobile, /id="ssHome" class="ss-simple-only"/);
});

/* ---------- ארגז הכלים והשמאות: גודל טקסט וריפלואו ---------- */
test('ארגז הכלים והשמאות: גודל הטקסט מגדיל את המסך (ss-zoom-text), ובלי עמודה רחבה מ-320', () => {
  assert.match(read('modules/tools/index.html'), /<body class="ss-zoom-text">/);
  assert.match(read('modules/shamai/index.html'), /<body class="ss-zoom-text">/);
  assert.match(read('modules/tools/index.html'), /minmax\(min\(340px,100%\),1fr\)/);
  assert.match(read('modules/shamai/style.css'), /\.hdr-stats \{ flex-wrap: wrap;/);
});

test('הצהרת נגישות: במדריך, באתר ובאתר המותקן — עם דרכי פנייה וגם מה עוד לא מושלם', () => {
  for (const f of ['docs/website/accessibility.html', 'deploy/site/public/accessibility.html']) {
    const h = read(f);
    assert.match(h, /<html lang="he" dir="rtl">/, f);
    assert.match(h, /<h1>הצהרת נגישות — SuperSuite<\/h1>/, f);
    assert.match(h, /href="tel:\+972548587778"/, f);
    assert.match(h, /href="mailto:b0548587778@gmail\.com"/, f);
    assert.match(h, /מה עוד לא מושלם/, f);
    assert.match(h, /WCAG 2\.2/, f);
  }
  assert.match(read('docs/website/index.html'), /href="accessibility\.html">הצהרת נגישות/);
  assert.match(read('deploy/site/public/index.html'), /href="accessibility\.html">הצהרת נגישות/);
  const guide = read('shell/guide/index.html');
  assert.match(guide, /<h3>הצהרת נגישות<\/h3>/);
  assert.match(guide, /<kbd>Alt<\/kbd>\+<kbd>0<\/kbd>/);
  assert.doesNotMatch(guide, /<script/);
});
