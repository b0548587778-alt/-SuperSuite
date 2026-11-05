// נגישות במודול הכלכלי (r4-a11y-econ): כל מסך שבסרגל הפנימי, עם השרת האמיתי ונתוני הדוגמה —
// שדות וכפתורים עם שם, טבלאות עם כותרת ו-scope, סדר כותרות, מקלדת, "מה עושים כאן" לכל מסך,
// טופס ההוספה (תוויות, "(חובה)" במילים, מלכודת Tab, Escape והחזרת המיקוד) ומצב פשוט.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers/econ-a11y-harness');
const D = require('./helpers/mini-dom');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r4-a11y-econ-'));
let h;
test.before(async () => { h = await H.boot({ real: DIR }); });
test.after(() => { fs.rmSync(DIR, { recursive: true, force: true }); });

const STYLES = fs.readFileSync(path.join(__dirname, '../modules/econ/styles.css'), 'utf8');
const textOf = (e) => e.textContent.replace(/\s+/g, ' ').trim();

// מצב פשוט כמו בדפדפן: כלל ה-CSS של המעטפת (html[data-ss-simple="on"] .ss-advanced { display:none })
function hiddenInSimple(doc, e) {
  if (doc.documentElement.getAttribute('data-ss-simple') !== 'on') return false;
  for (let x = e; x && x.nodeType === 1; x = x.parentNode) if (x.classList.contains('ss-advanced')) return true;
  return false;
}

test('כל מסך: שמות לשדות ולכפתורים, טבלאות עם כותרת ו-scope, כותרות בסדר, בלי סטטוס בצבע בלבד', async () => {
  assert.ok(H.VIEWS.length >= 30, 'כל המסכים שבסרגל');
  const all = {};
  for (const v of H.VIEWS) {
    await h.go(v);
    assert.ok(textOf(h.view()).length > 20, v + ': המסך רונדר');
    const p = H.audit(h.view());
    if (p.length) all[v] = p;
  }
  assert.deepEqual(all, {}, 'בעיות נגישות במסכים');
  assert.deepEqual(h.errors, [], 'בלי שגיאות JS');
});

test('כל מסך: "מה עושים כאן" מתחת לכותרת, data-ss-help לבועה, ואזור התוכן מתואר בו', async () => {
  const titles = h.run('Object.keys(viewTitles)');
  const help = h.run('VIEW_HELP');
  for (const v of titles) assert.ok(help[v] && help[v].length > 20, 'חסר הסבר למסך ' + v);
  for (const v of H.VIEWS) {
    await h.go(v);
    const ph = h.doc.getElementById('pageHelp');
    assert.equal(ph.hidden, false, v);
    assert.equal(textOf(ph), help[v], v);
    assert.equal(h.doc.getElementById('pageTitle').getAttribute('data-ss-help'), help[v], v);
  }
  assert.equal(h.view().getAttribute('aria-describedby'), 'pageHelp');
  assert.equal(h.view().getAttribute('aria-labelledby'), 'pageTitle');
});

test('מעבר מסך בלחיצה: המיקוד עובר לכותרת המסך, והכפתור בסרגל מסומן aria-current', async () => {
  const btn = h.doc.querySelector('button.nav[data-view="tasks"]');
  btn.focus();
  btn.click();
  await h.settle();
  const title = h.doc.getElementById('pageTitle');
  assert.equal(h.doc.activeElement, title);
  assert.equal(title.getAttribute('tabindex'), '-1');
  assert.equal(btn.getAttribute('aria-current'), 'page');
  assert.equal(h.doc.querySelectorAll('button.nav[aria-current]').length, 1);
  assert.equal(h.view().getAttribute('aria-busy'), null, 'הטעינה הסתיימה');
});

test('מבנה העמוד: דילוג לתוכן, ניווט עם שם, אזורי הודעה (status / alert / שקט לקורא מסך)', () => {
  const skip = h.doc.querySelector('a.skip-link');
  assert.equal(skip.getAttribute('href'), '#view');
  assert.ok(h.doc.querySelector('nav').getAttribute('aria-label'));
  assert.equal(h.doc.getElementById('toastContainer').getAttribute('aria-live'), 'polite');
  assert.equal(h.doc.getElementById('alertContainer').getAttribute('role'), 'alert');
  assert.equal(h.doc.getElementById('srAnnounce').getAttribute('aria-live'), 'polite');
  assert.equal(h.doc.getElementById('modalError').getAttribute('role'), 'alert');
  // כפתורים שהשם שלהם מספיק — בלי data-ss-help (המעטפת מוסיפה לו כפתור "?" גלוי)
  for (const id of ['addBtn', 'userBtn']) {
    const b = h.doc.getElementById(id);
    assert.equal(b.getAttribute('data-ss-help'), null, id);
    assert.match(D.accessibleName(b), /[א-ת]{3}/, id);
  }
  // כפתורי הטופס הראשי — type=button (לא שולחים טופס בטעות)
  for (const id of ['cancelBtn', 'submitBtn', 'closeModal']) assert.equal(h.doc.getElementById(id).getAttribute('type'), 'button', id);
});

test('לשוניות בתוך מסך (נדל"ן, דוחות לעסק, מעבדת תמהיל): קבוצה עם שם, כפתור עם aria-pressed, וכל לשונית נקייה', async () => {
  for (const [v, attr] of [['realty', 'data-rlty-tab'], ['biz-reports', 'data-biz-tab'], ['mortgage-lab', 'data-lab-tab']]) {
    await h.go(v);
    assert.equal(h.view().querySelectorAll('[role="tablist"]').length, 0, v + ': tablist בלי role=tab — לא');
    const group = h.view().querySelector('[role="group"]');
    assert.ok(group && group.getAttribute('aria-label'), v);
    const ids = [...new Set(group.querySelectorAll(`[${attr}]`).map(b => b.getAttribute(attr)))];
    assert.ok(ids.length >= 3, v);
    for (const id of ids) {
      const b = h.view().querySelector(`[role="group"] [${attr}="${id}"]`);
      b.click();
      await h.settle();
      const cur = h.view().querySelector(`[role="group"] [${attr}="${id}"]`);
      assert.equal(cur.getAttribute('aria-pressed'), 'true', `${v}/${id}`);
      assert.deepEqual(H.audit(h.view()), [], `${v}/${id}`);
    }
  }
});

test('רכיב לחיץ שאינו כפתור (data-goto) — פעיל גם במקלדת: role=button, tabindex=0, Enter מפעיל', async () => {
  await h.go('tasks');
  h.view().insertAdjacentHTML('beforeend', '<div class="card" data-goto="contacts">אנשי קשר</div>');
  h.run('enhanceA11y(elements.view)');
  const el = h.view().querySelector('div[data-goto]');
  let clicked = 0;
  el.addEventListener('click', () => { clicked++; });
  assert.equal(el.getAttribute('role'), 'button');
  assert.equal(el.getAttribute('tabindex'), '0');
  D.dispatch(el, { type: 'keydown', key: 'Enter' });
  D.dispatch(el, { type: 'keydown', key: ' ' });
  assert.equal(clicked, 2);
});

test('טבלה: שם מהכותרת שמעליה, scope לעמודות ולשורות; שדה בטבלה מקבל שם מהעמודה והשורה; כפתור אייקון — שם עם השורה', async () => {
  await h.go('tasks');
  h.view().insertAdjacentHTML('beforeend', `<div class="card"><h3>רשימת בדיקה</h3><table>
    <thead><tr><th>שם</th><th>סכום</th><th></th></tr></thead>
    <tbody><tr><th>משה לוי</th><td><input type="number"></td><td><button title="מחיקה">🗑</button></td></tr></tbody></table></div>`);
  h.run('labelIconButtons(elements.view); enhanceA11y(elements.view)');
  const t = [...h.view().querySelectorAll('table')].pop();
  assert.equal(t.getAttribute('aria-label'), 'רשימת בדיקה');
  const ths = t.querySelectorAll('th');
  assert.deepEqual(ths.map(x => x.getAttribute('scope')), ['col', 'col', 'col', 'row']);
  assert.equal(t.querySelector('input').getAttribute('aria-label'), 'סכום — משה לוי');
  assert.equal(t.querySelector('button').getAttribute('aria-label'), 'מחיקה — משה לוי');
  // מעבר חוזר לא מכפיל את ההקשר
  h.run('enhanceA11y(elements.view)');
  assert.equal(t.querySelector('button').getAttribute('aria-label'), 'מחיקה — משה לוי');
});

test('כותרות בתוך מסך שמתחילות ב-h3 או קופצות — מקבלות רמה רציפה (aria-level) מתחת ל-h1', async () => {
  await h.go('tasks');
  const box = h.doc.createElement('div');
  box.innerHTML = '<h3>א</h3><h5>ב</h5><h3>ג</h3>';
  h.view().appendChild(box);
  h.run('enhanceA11y(elements.view)');
  const lv = box.querySelectorAll('h3, h5').map(x => x.getAttribute('aria-level') || x.localName.slice(1));
  assert.deepEqual(lv, ['2', '3', '2']);
});

// ---------- טופס ההוספה בכל מסך ----------
test('טופס ההוספה בכל מסך: תוויות מקושרות, "(חובה)" במילים, מיקוד בשדה הראשון, Tab נשאר בחלון, Escape סוגר ומחזיר מיקוד', async () => {
  const modal = h.doc.getElementById('modal');
  let forms = 0;
  for (const v of H.VIEWS) {
    await h.go(v);
    const add = h.doc.getElementById('addBtn');
    if (add.disabled) continue;
    add.focus();
    add.click();
    await h.settle();
    if (modal.classList.contains('hidden')) continue; // מסך שההוספה בו פותחת חלון אחר (נבדק בקובץ החלונות)
    forms++;
    assert.deepEqual(H.audit(modal), [], v);
    const fields = modal.querySelectorAll('#modalForm input, #modalForm select, #modalForm textarea');
    assert.ok(fields.length, v);
    for (const f of fields) {
      const label = h.doc.querySelector(`label[for="${f.id}"]`);
      assert.ok(label && textOf(label), `${v}: ${f.id} — תווית מקושרת`);
      if (f.hasAttribute('required')) {
        assert.equal(f.getAttribute('aria-required'), 'true', `${v}: ${f.id}`);
        assert.match(textOf(label), /\(חובה\)/, `${v}: ${f.id} — חובה במילים`);
      }
      for (const id of (f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)) assert.ok(h.doc.getElementById(id), `${v}: ${id}`);
    }
    if (modal.querySelector('[aria-required="true"]')) assert.match(textOf(modal), /שדות שמסומנים \(חובה\)/, v);
    // מיקוד בשדה הראשון
    assert.ok(modal.contains(h.doc.activeElement) && h.doc.activeElement !== h.doc.body, v + ': המיקוד בחלון');
    // Tab מהכפתור האחרון חוזר להתחלה; Shift+Tab מהראשון — לסוף
    const last = h.doc.getElementById('submitBtn');
    last.focus();
    h.key(last, 'Tab');
    assert.ok(modal.contains(h.doc.activeElement) && h.doc.activeElement !== last, v + ': Tab נשאר בחלון');
    const first = h.doc.activeElement;
    h.key(first, 'Tab', { shiftKey: true });
    assert.equal(h.doc.activeElement, last, v + ': Shift+Tab מהראשון — לאחרון');
    h.key(h.doc.activeElement, 'Escape');
    await h.settle();
    assert.ok(modal.classList.contains('hidden'), v + ': Escape סגר');
    assert.equal(h.doc.activeElement, add, v + ': המיקוד חזר לכפתור');
  }
  assert.ok(forms >= 18, 'נבדקו ' + forms + ' טפסים');
});

test('שגיאה בטופס: ליד השדה (aria-invalid + aria-describedby), בראש החלון (role=alert), מיקוד בשדה — ובלי שליחה', async () => {
  await h.go('tasks');
  h.doc.getElementById('addBtn').click();
  await h.settle();
  const before = h.calls.length;
  h.doc.getElementById('submitBtn').click();
  await h.settle();
  assert.equal(h.calls.filter(c => /^create/.test(c.name)).length, h.calls.slice(0, before).filter(c => /^create/.test(c.name)).length, 'לא נשלח');
  const f = h.doc.getElementById('f_title');
  assert.equal(f.getAttribute('aria-invalid'), 'true');
  assert.ok(f.getAttribute('aria-describedby').split(' ').includes('e_title'));
  const e = h.doc.getElementById('e_title');
  assert.equal(e.hidden, false);
  assert.match(textOf(e), /חסר.*חובה.*מלאו/);
  const box = h.doc.getElementById('modalError');
  assert.equal(box.hidden, false);
  assert.equal(textOf(box), textOf(e));
  assert.equal(h.doc.activeElement, f);
  // מילוי ושמירה מנקים את השגיאה
  f.value = 'משימה לבדיקה';
  h.doc.getElementById('submitBtn').click();
  await h.settle();
  assert.ok(h.doc.getElementById('modal').classList.contains('hidden'));
  assert.equal(h.doc.querySelectorAll('[aria-invalid]').length, 0);
  assert.equal(h.doc.getElementById('modalError').hidden, true);
});

test('שדה מספר: "1,500" ו-"12,5" נקראים כמספר; אותיות — שגיאה בשפה פשוטה ליד השדה', async () => {
  assert.equal(h.run('normalizeNumberText("1,500")'), '1500');
  assert.equal(h.run('normalizeNumberText("12,5")'), '12.5');
  assert.equal(h.run('normalizeNumberText("₪ 2,000.50")'), '2000.50');
  await h.go('mortgage');
  h.doc.getElementById('addBtn').click();
  await h.settle();
  const num = h.doc.querySelector('#modalForm input[type="number"]');
  assert.equal(num.getAttribute('inputmode'), 'decimal');
  num.value = 'אלף';
  h.doc.getElementById('submitBtn').click();
  await h.settle();
  const name = num.id.slice(2);
  // שדה חובה ריק לפניו מדווח קודם — ממלאים ומנסים שוב
  for (const f of h.doc.querySelectorAll('#modalForm [aria-required="true"]')) if (f !== num && !f.value) f.value = f.type === 'number' ? '5' : 'א';
  h.doc.getElementById('submitBtn').click();
  await h.settle();
  assert.equal(num.getAttribute('aria-invalid'), 'true');
  assert.match(textOf(h.doc.getElementById('e_' + name)), /מספר בלבד/);
  h.key(h.doc.activeElement, 'Escape');
  await h.settle();
});

// ---------- מצב פשוט ----------
test('מצב פשוט: כלל ה-CSS קיים, שדות מתקדמים מוסתרים ו"עוד אפשרויות" מציג אותם (aria-expanded)', async () => {
  assert.match(STYLES, /html\[data-ss-simple="on"\] \.ss-advanced \{ display:none !important; \}/);
  const s = await H.boot({ real: DIR, simple: true });
  await s.go('npo');
  // מצב פשוט (סבב 5): "הוספת רשומה" פותח את האשף; הטופס המלא — ב"לטופס המלא" (handleAdd({ form: true }))
  s.run('handleAdd({ form: true })');
  await s.settle();
  const form = s.doc.getElementById('modalForm');
  const fields = form.querySelectorAll('input, select, textarea');
  const visible = fields.filter(f => !hiddenInSimple(s.doc, f));
  assert.ok(visible.length >= 3 && visible.length < fields.length, `גלויים ${visible.length} מתוך ${fields.length}`);
  // שדות החובה תמיד גלויים
  for (const f of form.querySelectorAll('[aria-required="true"]')) assert.ok(!hiddenInSimple(s.doc, f), f.id);
  // מעגל ה-Tab לא עובר בשדות מוסתרים
  const focusables = s.run('focusablesIn(elements.modalForm)');
  assert.ok(focusables.every(f => !hiddenInSimple(s.doc, f)));
  const more = form.querySelector('.ss-more-toggle');
  assert.equal(textOf(more), 'עוד אפשרויות');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  more.click();
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  assert.equal(form.querySelectorAll('.ss-advanced').length, 0, 'הכול גלוי');
  more.click();
  assert.ok(form.querySelectorAll('.ss-advanced').length > 0, 'הוסתר שוב');
  // שגיאה בשדה מתקדם — השדה נחשף
  const adv = form.querySelector('.ss-advanced input, .ss-advanced select');
  s.run(`showFormError('בדיקה', ${JSON.stringify(adv.id.slice(2))})`);
  assert.ok(!hiddenInSimple(s.doc, adv), 'השדה עם השגיאה גלוי');
  assert.equal(adv.getAttribute('aria-invalid'), 'true');
});

test('מצב פשוט: מסכים נדירים, ייבוא/ייצוא וקיצורי מקלדת מסומנים ss-advanced; המסכים הנפוצים גלויים', async () => {
  const s = await H.boot({ real: DIR, simple: true });
  const nav = (v) => s.doc.querySelector(`button.nav[data-view="${v}"]`);
  for (const v of ['acct-chart', 'market-intel', 'mortgage-lab', 'voice-notes', 'canvas', 'licensing']) assert.ok(hiddenInSimple(s.doc, nav(v)), v);
  for (const v of ['dashboard', 'acct-invoices', 'npo', 'gemach', 'tasks', 'contacts', 'settings']) assert.ok(!hiddenInSimple(s.doc, nav(v)), v);
  await s.go('contacts');
  assert.ok(hiddenInSimple(s.doc, s.view().querySelector('.ports-bar')), 'ייבוא/ייצוא');
  await s.go('acct-invoices');
  const keys = s.view().descendants().find(e => /^קיצורים:/.test(textOf(e)) && !e.children.length);
  assert.ok(keys && hiddenInSimple(s.doc, keys), 'קיצורי מקלדת');
  // פעולה נפוצה בשתי לחיצות: מסך ← "הוספת רשומה"
  // במסכים שיש להם אשף (סבב 5) — האשף נפתח במקום הטופס הארוך
  // (אשף התרומה נפתח רק כשפרטי העמותה מולאו — בלעדיהם אין קבלה)
  await s.run('window.systemAPI').saveNpoSettings({ orgName: 'עמותת חסד' });
  for (const v of ['acct-invoices', 'npo', 'tasks', 'contacts']) {
    await s.go(v);
    s.doc.getElementById('addBtn').click();
    await s.settle();
    const wiz = s.doc.querySelector('.modal.wiz');
    if (v === 'tasks') assert.equal(s.doc.getElementById('modal').classList.contains('hidden'), false, v);
    else assert.ok(wiz, v + ': אשף');
    s.key(s.doc.activeElement, 'Escape');
    await s.settle();
    assert.equal(s.doc.querySelector('.modal.wiz'), null, v + ': Escape בלי הקלדה סוגר');
  }
  // במצב רגיל — אין הסתרה, וכל השדות במעגל ה-Tab
  await h.go('npo');
  h.doc.getElementById('addBtn').click();
  await h.settle();
  const all = h.doc.getElementById('modalForm').querySelectorAll('input, select, textarea').length;
  assert.equal(h.run('focusablesIn(elements.modalForm)').filter(e => ['input', 'select', 'textarea'].includes(e.localName)).length, all);
  h.key(h.doc.activeElement, 'Escape');
  await h.settle();
});

test('מצב ריק: מסביר איזה כפתור ללחוץ', async () => {
  const s = await H.boot({ real: DIR });
  const html = (msg, view) => { s.run(`state.currentView = ${JSON.stringify(view)}`); return s.run(`renderEmpty(${JSON.stringify(msg)})`); };
  assert.match(html('אין משימות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל', 'tasks'), /data-empty-add/);
  const src = ['npo', 'people', 'gemach'].map(f => fs.readFileSync(path.join(__dirname, `../modules/econ/ui/${f}.js`), 'utf8')).join('\n');
  assert.match(src, /אין הוראות קבע עדיין — לחצו "＋ הוראת קבע"/);
  assert.match(src, /אין פריטים להשאלה עדיין — לחצו "＋ פריט"/);
  assert.match(src, /אנשים נוספים לכאן מעצמם/);
});

test('מסך שלא נפתח: הודעה במסך עצמו (role=alert) עם "נסו שוב" — לא "טוען…" לנצח', async () => {
  let fail = true;
  const s = await H.boot({ api: { getTasks: () => { if (fail) throw new Error('database is locked'); return { tasks: [] }; } } });
  await s.go('tasks');
  const alert = s.view().querySelector('[role="alert"]');
  assert.ok(alert, 'הודעה במסך');
  assert.match(textOf(alert), /המסך לא נפתח.*המערכת עסוקה/);
  assert.equal(s.view().getAttribute('aria-busy'), null);
  fail = false;
  s.view().querySelector('[data-view-retry]').click();
  await s.settle();
  assert.equal(s.view().querySelector('[data-view-retry]'), null, 'נטען בניסיון השני');
});
