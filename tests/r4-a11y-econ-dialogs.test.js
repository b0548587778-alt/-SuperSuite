// נגישות במודול הכלכלי (r4-a11y-econ): החלונות הקטנים (אישור, שאלה, תשלום, הגדרות), שגיאות
// מקושרות לשדה, אזורי הודעה (טוסט / שגיאה / קורא מסך), ושגיאות בשפה פשוטה.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers/econ-a11y-harness');
const D = require('./helpers/mini-dom');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r4-a11y-econ-dlg-'));
let h;
test.before(async () => { h = await H.boot({ real: DIR }); await h.go('tasks'); });
// ב-Windows קובץ מסד שעוד פתוח לא נמחק (EBUSY); tools/run-tests.js מוחק את כל התיקייה הזמנית בסוף
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* EBUSY ב-Windows */ } });

const textOf = (e) => e.textContent.replace(/\s+/g, ' ').trim();
const overlays = () => h.doc.querySelectorAll('.modal').filter(m => m.id !== 'modal');

// פתיחת חלון מכפתור שבמסך: המיקוד צריך לחזור אליו בסגירה
async function openFrom(expr) {
  const opener = h.doc.createElement('button');
  opener.textContent = 'פותח';
  h.view().appendChild(opener);
  opener.focus();
  h.run(`window.__dlg = ${expr}; window.__res = 'pending'; Promise.resolve(window.__dlg).then(v => { window.__res = v; });`);
  await h.settle();
  const list = overlays();
  return { opener, overlay: list[list.length - 1] };
}
const result = () => h.run('window.__res');

const DIALOGS = [
  ['אישור מחיקה', "askConfirm('למחוק את הפריט?')"],
  ['שאלה', "askFields('שם הקובץ', [{ name: 'a', label: 'שם' }, { name: 'b', label: 'הערה', optional: true, hint: 'לא חובה' }], 'שמירה')"],
  ['טופס מסמך', "askDocFields('קבלת תשלום', [{ name: 'date', label: 'תאריך התשלום', type: 'date', required: true }, { name: 'method', label: 'אמצעי תשלום', options: [['cash', 'מזומן'], ['check', 'המחאה']] }], 'רישום')"],
  ['טופס רישוי', "licForm('תנאים', [{ name: 'graceDays', label: 'ימי חסד', type: 'number', value: 7 }, { name: 'f', label: 'תחומים', type: 'checks', options: [['a', 'כספים']] }], 'שמירה', 'הסבר קצר')"],
  ['טקסט הודעה', "chatTextDialog('עריכת הודעה', '', 'שליחה', 'רמז')"],
  ['בחירה', "chatChoice('מה לעשות?', 'הסבר', [['a', 'אפשרות א'], ['b', 'אפשרות ב', 'primary']])"],
  ['הערת אימות', "labAskNote('אימות כלל')"],
  ['הודעה', "madvShowMessage('הודעה ללקוח', 'שלום וברכה')"],
  ['הודעה לגבייה', "collectMessageDialog({ ref: 'P00001', text: 'שלום', link: '' })"],
  ['תשלום עמלה', "(state.data.mortgageAdvisor = { feeMethods: { cash: 'מזומן' } }, madvAskPayment({ name: 'כהן', feeStatus: { balance: 100 } }))"],
  ['תשלום תיווך', "(state.data.realty = { payMethods: { cash: 'מזומן' } }, rltyAskPayment({ commission: { sides: [{ side: 'buyer', label: 'קונה', balance: 100 }] } }))"],
  ['כניסה עם Google', 'askGoogleSettings({})'],
  ['סיכום PCN', "showPcnSummary({ totals: { taxableNet: 0, taxableVat: 0, exemptNet: 0, otherInputVat: 0, equipmentInputVat: 0, payable: 0 }, counts: { S: 0, L: 0, T: 0 }, issues: [], difference: 0 })"],
];

test('כל חלון קטן: role=dialog/alertdialog, aria-modal, שם מהכותרת, שמות לכל השדות והכפתורים, Tab נשאר בחלון, Escape סוגר ומחזיר מיקוד', async () => {
  for (const [name, expr] of DIALOGS) {
    const { opener, overlay } = await openFrom(expr);
    assert.ok(overlay, name + ': נפתח חלון');
    assert.match(overlay.getAttribute('role'), /^(dialog|alertdialog)$/, name);
    assert.equal(overlay.getAttribute('aria-modal'), 'true', name);
    const lb = h.doc.getElementById(overlay.getAttribute('aria-labelledby') || '');
    assert.ok(lb && textOf(lb), name + ': שם לחלון');
    assert.deepEqual(H.audit(overlay, { startLevel: 1 }), [], name);
    assert.ok(overlay.contains(h.doc.activeElement) || h.doc.activeElement === opener, name);
    // מלכודת Tab: מהאחרון לראשון ומהראשון לאחרון
    const list = h.run('focusablesIn')(overlay);
    if (list.length > 1) {
      list[list.length - 1].focus();
      h.key(h.doc.activeElement, 'Tab');
      assert.equal(h.doc.activeElement, list[0], name + ': Tab מהאחרון — לראשון');
      h.key(h.doc.activeElement, 'Tab', { shiftKey: true });
      assert.equal(h.doc.activeElement, list[list.length - 1], name + ': Shift+Tab מהראשון — לאחרון');
    }
    h.key(h.doc.activeElement, 'Escape');
    await h.settle();
    assert.equal(overlays().length, 0, name + ': Escape סגר');
    assert.ok([null, false, undefined].includes(result()), name + ': ביטול');
    assert.equal(h.doc.activeElement, opener, name + ': המיקוד חזר');
  }
  assert.deepEqual(h.errors, []);
});

test('אישור לפני פעולה: כפתורים במילים ("כן, למחוק" / "לא, לחזור"), alertdialog עם תיאור, ובמחיקה המיקוד על "לא"', async () => {
  for (const [msg, ok, danger] of [
    ['למחוק את הפריט?', 'כן, למחוק', true],
    ['האם למחוק את הרשומה? לא ניתן לבטל.', 'כן, למחוק', true],
    ['לבטל את הקבלה? המספר לא ישומש שוב', 'כן, לבטל', true],
    ['להפיק חשבונית מס מהמסמך?', 'כן, להפיק', false],
  ]) {
    const { overlay } = await openFrom(`askConfirm(${JSON.stringify(msg)})`);
    assert.equal(overlay.getAttribute('role'), 'alertdialog');
    assert.equal(textOf(h.doc.getElementById(overlay.getAttribute('aria-describedby'))), msg.replace(/\s+/g, ' '));
    const [cancel, okBtn] = overlay.querySelectorAll('.modal-actions button');
    assert.equal(textOf(okBtn), ok, msg);
    assert.equal(textOf(cancel), 'לא, לחזור');
    assert.equal(okBtn.classList.contains('danger'), danger, msg);
    assert.equal(h.doc.activeElement, danger ? cancel : okBtn, msg + ': מיקוד');
    okBtn.click();
    await h.settle();
    assert.equal(result(), true);
  }
  // הודעה בלי פועל בהתחלה — הכפתור לפי opts
  const { overlay } = await openFrom("askConfirm('השחזור יחליף את כל הנתונים. להמשיך?', { danger: true, okText: 'כן, לשחזר ולהחליף' })");
  assert.equal(textOf(overlay.querySelector('.danger')), 'כן, לשחזר ולהחליף');
  h.key(h.doc.activeElement, 'Escape');
  await h.settle();
  // אין askConfirm בלי פועל ובלי opts
  const src = require('./helpers/econ-ui').source();
  const bare = [...src.matchAll(/askConfirm\('([^']*)'\)/g)].map(m => m[1]).filter(m => !/^(?:⚠\s*)?(?:האם\s+)?ל[א-ת]+/.test(m));
  assert.deepEqual(bare, [], 'שאלת אישור שמתחילה בפועל, או okText מפורש');
});

test('מסך הכניסה (askFields עם screen): Escape לא סוגר, "הצגת הסיסמה" עם aria-pressed, שדות חובה מסומנים', async () => {
  const { overlay } = await openFrom("askFields('כניסה', [{ name: 'u', label: 'שם משתמש' }, { name: 'p', label: 'סיסמה', type: 'password' }], 'כניסה', {}, { screen: { intro: 'שלום' } })");
  h.key(h.doc.activeElement, 'Escape');
  await h.settle();
  assert.equal(overlays().length, 1, 'נשאר פתוח');
  const pw = overlay.querySelector('input[type="password"]');
  const show = overlay.querySelector('.pw-toggle');
  assert.equal(show.getAttribute('aria-controls'), pw.id);
  show.click();
  assert.equal(pw.type, 'text');
  assert.equal(show.getAttribute('aria-pressed'), 'true');
  show.click();
  assert.equal(pw.type, 'password');
  for (const i of overlay.querySelectorAll('input')) {
    assert.equal(i.getAttribute('aria-required'), 'true');
    assert.ok(h.doc.querySelector(`label[for="${i.id}"]`), i.id);
  }
  // שליחה ריקה: שגיאה מקושרת לשדה ומוקראת
  overlay.querySelector('form').dispatchEvent({ type: 'submit' });
  const u = overlay.querySelector('input[name="u"]');
  const err = h.doc.getElementById(u.getAttribute('aria-describedby').split(' ')[0]);
  assert.equal(u.getAttribute('aria-invalid'), 'true');
  assert.equal(err.getAttribute('role'), 'alert');
  assert.match(textOf(err), /חסר: שם משתמש.*"כניסה"/);
  assert.equal(h.doc.activeElement, u);
  u.value = 'משה';
  pw.value = 'סיסמה-ארוכה-מאוד';
  overlay.querySelector('form').dispatchEvent({ type: 'submit' });
  await h.settle();
  assert.deepEqual(result(), { u: 'משה', p: 'סיסמה-ארוכה-מאוד' });
});

test('שגיאה בחלון קטן (dialogFieldError): role=alert, aria-invalid, aria-describedby, מיקוד — בכל החלונות שבודקים שדות', async () => {
  const cases = [
    ["askDocFields('קבלת תשלום', [{ name: 'date', label: 'תאריך התשלום', type: 'date', required: true }], 'רישום')", 'input', /חסר: תאריך התשלום.*"רישום"/],
    ["licForm('תנאים', [{ name: 'graceDays', label: 'ימי חסד', type: 'number', value: '' }], 'שמירה')", 'input', /ימי חסד: מספר שלם/],
    ["(state.data.mortgageAdvisor = {}, madvAskPayment({ name: 'כהן' }))", 'input[type="number"]', /הסכום חסר.*גדול מאפס/],
    ["(state.data.realty = {}, rltyAskPayment({ commission: { sides: [{ side: 'b', label: 'קונה', balance: 0 }] } }))", 'input[type="number"]', /הסכום חסר.*גדול מאפס/],
    ["askGoogleSettings({ enabled: true })", 'input[type="text"], input:not([type])', /חסר מזהה הלקוח של Google/],
  ];
  for (const [expr, sel, re] of cases) {
    const { overlay } = await openFrom(expr);
    if (/askGoogleSettings/.test(expr)) { const cb = overlay.querySelector('input[type="checkbox"]'); cb.checked = true; }
    const form = overlay.querySelector('form');
    form.dispatchEvent({ type: 'submit' });
    await h.settle();
    const bad = overlay.querySelector('[aria-invalid="true"]');
    assert.ok(bad, expr + ': שדה מסומן');
    assert.ok(bad.matches(sel), expr);
    const err = h.doc.getElementById(bad.getAttribute('aria-describedby').split(' ')[0]);
    assert.equal(err.getAttribute('role'), 'alert', expr);
    assert.match(textOf(err), re, expr);
    assert.equal(h.doc.activeElement, bad, expr + ': מיקוד בשדה');
    assert.equal(overlays().length, 1, expr + ': לא נסגר');
    h.key(h.doc.activeElement, 'Escape');
    await h.settle();
  }
});

test('askDocFields: שדה חובה מסומן "(חובה)" במילים ו-aria-required', async () => {
  const { overlay } = await openFrom("askDocFields('x', [{ name: 'a', label: 'תאריך', type: 'date', required: true }, { name: 'b', label: 'אסמכתא' }], 'שמירה')");
  const [a, b] = overlay.querySelectorAll('input');
  assert.equal(a.getAttribute('aria-required'), 'true');
  assert.match(textOf(a.closest('label')), /\(חובה\)/);
  assert.equal(b.getAttribute('aria-required'), null);
  h.key(h.doc.activeElement, 'Escape');
  await h.settle();
});

test('גמ"ח — השאלת חפץ: שם השואל חובה במילים, ושגיאה מקושרת לשדה', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../modules/econ/ui/gemach.js'), 'utf8');
  assert.match(src, /שם השואל <span class="req">\(חובה\)<\/span><input name="borrowerName" aria-required="true">/);
  assert.match(src, /class="gx-err" role="alert"/);
  assert.match(src, /dialogFieldError\(card\.querySelector\('\.gx-err'\), form\.elements\.borrowerName/);
});

// ---------- אזורי הודעה ----------
test('טוסט מוקרא (status, polite) ונשאר 6 שניות; שגיאה — באזור alert, עם כפתור סגירה עם שם, ונשארת 20 שניות', () => {
  h.timers.length = 0;
  h.run("showToast('נשמר')");
  const toast = [...h.doc.getElementById('toastContainer').querySelectorAll('.toast')].pop();
  assert.equal(textOf(toast), 'נשמר');
  assert.equal(h.timers[h.timers.length - 1].ms, 6000);
  h.run("showError('הקובץ לא נשמר')");
  const err = h.doc.getElementById('alertContainer').querySelector('.toast.danger');
  assert.match(textOf(err), /⚠ הקובץ לא נשמר/);
  const close = err.querySelector('button.toast-close');
  assert.equal(close.getAttribute('aria-label'), 'סגירת ההודעה');
  assert.equal(h.timers[h.timers.length - 1].ms, 20000);
  close.click();
  assert.equal(h.doc.getElementById('alertContainer').querySelector('.toast.danger'), null);
});

test('שגיאה כשהטופס פתוח מוצגת גם בתוך החלון (#modalError)', async () => {
  h.doc.getElementById('addBtn').click();
  await h.settle();
  h.run("showError('השמירה נכשלה')");
  const box = h.doc.getElementById('modalError');
  assert.equal(box.hidden, false);
  assert.equal(textOf(box), 'השמירה נכשלה');
  h.key(h.doc.activeElement, 'Escape');
  await h.settle();
  assert.equal(box.hidden, true, 'נוקה בסגירה');
});

test('announce: הודעה שקטה לקורא המסך באזור aria-live', () => {
  h.timers.length = 0;
  h.run("announce('נמצאו 3 תוצאות')");
  h.runTimers();
  assert.equal(textOf(h.doc.getElementById('srAnnounce')), 'נמצאו 3 תוצאות');
});

test('שגיאות בשפה פשוטה: הודעה טכנית באנגלית מתורגמת למה קרה ומה לעשות; עברית מהשרת נשארת', () => {
  const m = (s) => h.run(`errMsg(new Error(${JSON.stringify(s)}))`);
  assert.match(m('Invalid credentials'), /שם המשתמש או הסיסמה לא נכונים.*נסו שוב/);
  assert.match(m("Error invoking remote method 'x': Error: ENOSPC: no space left on device"), /אין מספיק מקום.*נסו שוב/);
  assert.match(m('SQLITE_BUSY: database is locked'), /המערכת עסוקה/);
  assert.match(m('EBUSY: resource busy'), /פתוח בתוכנה אחרת/);
  assert.match(m("TypeError: Cannot read properties of undefined (reading 'x')"), /משהו השתבש.*דוח תקלה/);
  assert.equal(m('הסכום חייב להיות חיובי'), 'הסכום חייב להיות חיובי');
  for (const s of ['ENOENT', 'Unexpected token < in JSON', 'Failed to fetch']) assert.match(m(s), /[א-ת]/, s);
});

test('dialogFieldError: מזהה להודעה, בלי כפילות ב-aria-describedby, וניקוי של שדה קודם', () => {
  const form = h.doc.createElement('form');
  form.innerHTML = '<input id="x1" aria-describedby="hint1"><input id="x2"><div class="e"></div>';
  h.view().appendChild(form);
  const [a, b] = form.querySelectorAll('input');
  const err = form.querySelector('.e');
  const fe = h.run('dialogFieldError');
  fe(err, a, 'חסר');
  fe(err, a, 'חסר');
  assert.equal(a.getAttribute('aria-describedby'), err.id + ' hint1');
  assert.equal(err.getAttribute('role'), 'alert');
  fe(err, b, 'חסר אחר');
  assert.equal(a.getAttribute('aria-invalid'), null);
  assert.equal(b.getAttribute('aria-invalid'), 'true');
  assert.equal(h.doc.activeElement, b);
  assert.equal(D.accessibleName(b), '');
  form.remove();
});
