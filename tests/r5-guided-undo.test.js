// "טעיתי, לבטל" (סבב 5): 30 שניות אחרי שמירה באשף או בטופס. רשומה בלי מספר — הערוץ הקיים של מחיקה / ביטול;
// מסמך ממוספר (קבלה, חשבונית) — לא נמחק: המסלול החוקי (קבלה מבוטלת / חשבונית זיכוי) ורק אחרי אישור מפורש.
// ההרשאה — כמו של ערוץ הביטול, והשרת אוכף.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers/econ-a11y-harness');
const G = require('../modules/econ/core/gemach');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-guided-undo-'));
let s;
let api;
test.before(async () => {
  s = await H.boot({ real: DIR, simple: true });
  api = s.run('window.systemAPI');
  await api.saveNpoSettings({ orgName: 'עמותת חסד ואמת' });
  await s.go('dashboard');
});
// ב-Windows קובץ מסד שעוד פתוח לא נמחק (EBUSY); tools/run-tests.js מוחק את כל התיקייה הזמנית בסוף
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* EBUSY ב-Windows */ } });

const textOf = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
const named = (name) => s.calls.filter(c => c.name === name);
const dialogs = () => s.doc.querySelectorAll('.modal').filter(m => m.id !== 'modal' && !m.classList.contains('wiz'));
const lastUndoToast = () => s.doc.getElementById('toastContainer').querySelectorAll('.undo-toast').pop();

async function runWizard(task, answers) {
  s.run(`econStartTask(${JSON.stringify(task)})`);
  await s.settle();
  assert.ok(s.doc.querySelector('.modal.wiz'), task + ': נפתח');
  for (const v of answers) {
    const inp = s.doc.getElementById('wizInput');
    if (inp) inp.value = v;
    else {
      const radios = s.doc.querySelectorAll('input[name="wizChoice"]');
      const pick = v === null ? radios[0] : radios.find(r => r.value === v);
      for (const r of radios) r.checked = r === pick;
    }
    s.doc.getElementById('wizNext').click();
    await s.settle();
  }
  s.doc.getElementById('wizNext').click(); // כן, לשמור
  await s.settle(40);
  assert.equal(s.doc.querySelector('.modal.wiz'), null, task + ': נשמר — ' + textOf(s.doc.getElementById('wizError')));
  const t = lastUndoToast();
  assert.ok(t, task + ': טוסט');
  return t;
}
// לחיצה על "טעיתי, לבטל"; confirm — 'yes' / 'no' / null (אין שאלה)
async function clickUndo(toast, confirm) {
  const btn = toast.querySelector('button');
  assert.equal(textOf(btn), 'טעיתי, לבטל');
  btn.click();
  await s.settle();
  const d = dialogs().pop();
  if (confirm === null) { assert.equal(d, undefined, 'בלי שאלה — רשומה בלי מספר'); await s.settle(20); return null; }
  assert.ok(d, 'שאלת אישור למסמך ממוספר');
  assert.equal(d.getAttribute('role'), 'alertdialog');
  const text = textOf(d);
  const [no, yes] = d.querySelectorAll('.modal-actions button');
  assert.equal(textOf(yes), 'כן, לבטל');
  assert.equal(textOf(no), 'לא, להשאיר');
  assert.equal(s.doc.activeElement, no, 'המיקוד על "לא"');
  (confirm === 'yes' ? yes : no).click();
  await s.settle(40);
  return text;
}

test('הטוסט: מוקרא (אזור status), "טעיתי, לבטל" לחצן אמיתי, ונעלם אחרי 30 שניות', async () => {
  const toast = await runWizard('contact', ['איש לבדיקה', '', '']);
  assert.equal(s.doc.getElementById('toastContainer').getAttribute('role'), 'status');
  assert.equal(s.doc.getElementById('toastContainer').getAttribute('aria-live'), 'polite');
  assert.equal(toast.querySelector('button').getAttribute('type'), 'button');
  const t = s.timers.find(x => x.ms === 30000);
  assert.ok(t, 'טיימר של 30 שניות');
  t.fn();
  assert.equal(toast.parentNode, null, 'הוסר');
});

test('איש קשר (בלי מספר): ביטול מיידי דרך contacts:delete', async () => {
  const toast = await runWizard('contact', ['זלמן לבדיקה', '', '']);
  await clickUndo(toast, null);
  assert.equal(named('deleteContact').length, 1);
  assert.ok(!(await api.getContacts()).contacts.some(c => c.name === 'זלמן לבדיקה'), 'נמחק');
  assert.match(textOf(s.doc.getElementById('toastContainer')), /איש הקשר נמחק ✓/);
});

test('תרומה (קבלה ממוספרת): לא נמחקת — שאלה מפורשת, ואז ביטול חוקי (npo:cancelDonation): הקבלה נשארת, מסומנת "מבוטלת"', async () => {
  const toast = await runWizard('donation', ['משפחת גולד', '180', 'cash', 'no']);
  // "לא, להשאיר" — לא קורה דבר
  let text = await clickUndo(toast, 'no');
  assert.match(text, /לבטל את הקבלה מספר \d+\? הקבלה לא תימחק — היא תסומן "מבוטלת", והמספר שלה לא ישמש שוב/);
  assert.equal(named('cancelNpoDonation').length, 0);
  text = await clickUndo(toast, 'yes');
  assert.equal(named('cancelNpoDonation').length, 1);
  const d = (await api.getNpoOverview(new Date().getFullYear())).donations.find(x => x.donorName === 'משפחת גולד');
  assert.ok(d, 'התרומה לא נמחקה');
  assert.equal(d.status, 'cancelled');
  assert.ok(Number.isInteger(d.receipt.number), 'מספר הקבלה נשמר');
});

test('חשבונית שלא שולמה: ביטול = חשבונית זיכוי ממוספרת (acct:cancelInvoice) אחרי אישור', async () => {
  const toast = await runWizard('invoice', ['לקוח לביטול', 'ייעוץ', '100', 'no']);
  const text = await clickUndo(toast, 'yes');
  assert.match(text, /חשבונית לא נמחקת — תופק חשבונית זיכוי ממוספרת/);
  assert.equal(named('cancelInvoice').length, 1);
  const inv = (await api.getInvoices()).find(i => i.customer === 'לקוח לביטול');
  assert.equal(inv.status, 'cancelled');
  assert.ok(inv.cancelCreditNumber, 'הופקה חשבונית זיכוי');
});

test('חשבונית ששולמה מיד (חשבונית מס/קבלה): ביטול = חשבונית זיכוי מלאה (acct:createCreditNote)', async () => {
  const toast = await runWizard('invoice', ['לקוח ששילם', 'ייעוץ', '100', 'cash']);
  const text = await clickUndo(toast, 'yes');
  assert.match(text, /כבר סומנה כשולמה, ולכן תופק חשבונית זיכוי מלאה וממוספרת/);
  assert.equal(named('createCreditNote').length, 1);
  const inv = (await api.getInvoices()).find(i => i.customer === 'לקוח ששילם');
  assert.ok(Number(inv.credited) > 0, 'זוכתה');
});

test('קבלת תשלום על חשבונית: ביטול הקבלה (acct:unrecordPayment) אחרי אישור — החשבונית חוזרת להיות פתוחה', async () => {
  await runWizard('invoice', ['לקוח לקבלה', 'שיעור', '50', 'no']);
  const inv = (await api.getInvoices()).find(i => i.customer === 'לקוח לקבלה');
  const toast = await runWizard('receipt', [inv.id, 'transfer', '']);
  assert.equal((await api.getInvoices()).find(i => i.id === inv.id).status, 'paid');
  const text = await clickUndo(toast, 'yes');
  assert.match(text, /לבטל את הקבלה\? היא לא תימחק/);
  assert.equal(named('unrecordPayment').length, 1);
  assert.equal((await api.getInvoices()).find(i => i.id === inv.id).status, 'open');
});

test('הוצאה (רשומת יומן): ביטול מיידי דרך acct:reverseEntry — נרשמת רשומת ביטול, המקור נשמר', async () => {
  const toast = await runWizard('expense', ['מעטפות', '40', null, '1000']);
  await clickUndo(toast, null);
  assert.equal(named('reverseEntry').length, 1);
  const j = await api.getJournal({});
  const e = j.find(x => x.description === 'מעטפות');
  assert.ok(e && e.reversedBy, 'המקור נשמר ומסומן כמבוטל');
});

test('הלוואה חדשה: ביטול דרך gemach:cancelLoan', async () => {
  const toast = await runWizard('gemachLoan', ['לווה לביטול', '900', '3', '']);
  await clickUndo(toast, null);
  const l = (await api.getGemachOverview()).loans.find(x => x.borrowerName === 'לווה לביטול');
  assert.equal(l.status, 'cancelled');
});

test('החזר הלוואה: ביטול דרך gemach:reversePayment — חוזר בדיוק למצב שלפני', async () => {
  const loan = await api.addGemachLoan({ borrowerName: 'לווה להחזר', amount: 600, installments: 3, issueDate: '2026-01-01' });
  s.run('state.wizLicense = undefined');
  const toast = await runWizard('loanPayment', [loan.id, '50']);
  let full = await api.getGemachLoan(loan.id);
  assert.equal(full.schedule[0].paidAg, 5000);
  await clickUndo(toast, null);
  assert.equal(named('reverseGemachPayment').length, 1);
  full = await api.getGemachLoan(loan.id);
  assert.equal(full.schedule[0].paidAg, 0);
  assert.equal(full.schedule[0].status, 'pending');
  assert.equal(full.schedule[0].paidDate, '');
});

test('טופס רגיל (לא אשף): גם אחרי "שמירה" בטופס — "טעיתי, לבטל"', async () => {
  await s.go('contacts');
  s.run('handleAdd({ form: true })');
  await s.settle();
  s.doc.getElementById('f_name').value = 'מהטופס';
  s.doc.getElementById('submitBtn').click();
  await s.settle(40);
  const toast = lastUndoToast();
  assert.match(textOf(toast), /הרשומה נשמרה בהצלחה ✓/);
  await clickUndo(toast, null);
  assert.ok(!(await api.getContacts()).contacts.some(c => c.name === 'מהטופס'));
  // טופס משני (למשל הפקדה בגמ"ח) — בלי ביטול
  assert.equal(s.run("formUndoSpec('gemach', { id: 'x' }).kind"), 'gemachLoan');
  assert.equal(s.run("formUndoSpec('tasks', { id: 'x' })"), null);
  assert.equal(s.run("formUndoSpec('npo', { id: 'x', receipt: { external: true, number: null } })"), null, 'קבלה חיצונית — אין מה לבטל כאן');
});

test('הרשאה: ההרשאה של כל ביטול = permissionFor של הערוץ; בלי ההרשאה — אין לחצן ביטול', async () => {
  const ipc = require('../modules/econ/ipc');
  const kinds = s.run('UNDO_KINDS');
  for (const [k, v] of Object.entries(kinds)) assert.equal(ipc.permissionFor(v.channel), v.perm, k);
  assert.equal(ipc.permissionFor('gemach:reversePayment'), 'data.delete');
  // עורך בלי data.delete: הטוסט בלי לחצן
  const h = await H.boot({ user: { id: 'e', username: 'עורך', role: 'editor', permissions: ['data.view', 'data.edit'] } });
  h.run("showUndoToast('נשמר', { kind: 'contact', id: 'x' })");
  const t = h.doc.getElementById('toastContainer').querySelectorAll('.undo-toast').pop();
  assert.equal(t.querySelector('button'), null);
  assert.equal(h.timers[h.timers.length - 1].ms, 6000, 'טוסט רגיל');
  // חשבונית ששולמה — זיכוי הוא data.edit, ולכן העורך כן רואה ביטול
  h.run("showUndoToast('נשמר', { kind: 'paidInvoice', id: 'x' })");
  assert.ok(h.doc.getElementById('toastContainer').querySelectorAll('.undo-toast').pop().querySelector('button'));
  // השרת אוכף: פגישה בלי data.delete — reversePayment נדחה
  const { AuthService } = require('../modules/econ/services/authService');
  const sess = AuthService.getSession(1);
  const keep = sess.permissions;
  sess.permissions = ['data.view', 'data.edit'];
  try {
    await assert.rejects(api.reverseGemachPayment('x', 1, { from: 1, to: 0 }), /אין הרשאה/);
    await assert.rejects(api.cancelNpoDonation('x'), /אין הרשאה/);
  } finally { sess.permissions = keep; }
});

test('reversePayment (טהור): רק אם התשלום לא השתנה מאז; הלוואה שנסגרה חוזרת לפעילה', () => {
  let loan = { id: 'l', status: 'active', schedule: G.buildSchedule(200, 2, '2026-01-01') };
  loan = G.recordPayment(loan, 1, { date: '2026-02-01' });
  loan = G.recordPayment(loan, 2, { date: '2026-03-01' });
  assert.equal(loan.status, 'closed');
  const back = G.reversePayment(loan, 2, { from: 10000, to: 0 });
  assert.equal(back.status, 'active');
  assert.equal(back.schedule[1].paidAg, 0);
  assert.equal(back.schedule[0].paidAg, 10000, 'תשלום אחר לא נגוע');
  assert.throws(() => G.reversePayment(loan, 2, { from: 5000, to: 0 }), /התשלום השתנה מאז/);
  assert.throws(() => G.reversePayment(loan, 2, { from: 10000, to: 10000 }), /פרטי הביטול אינם תקינים/);
  assert.throws(() => G.reversePayment(loan, 2, { from: '10000', to: -1 }), /פרטי הביטול אינם תקינים/);
  assert.throws(() => G.reversePayment(loan, 9, { from: 1, to: 0 }), /לא נמצא/);
  const partial = G.reversePayment(G.recordPayment({ status: 'active', schedule: G.buildSchedule(100, 1, '2026-01-01') }, 1, { amount: 30 }), 1, { from: 3000, to: 0 });
  assert.equal(partial.schedule[0].status, 'pending');
});

test('ביטול שנכשל בשרת — הודעה בעברית, והלחצן חוזר לפעול', async () => {
  const h = await H.boot({ user: H.ADMIN, api: { deleteContact: () => { throw new Error('איש הקשר לא נמצא'); } } });
  const t = h.run("showUndoToast('נשמר', { kind: 'contact', id: 'x' })");
  t.querySelector('button').click();
  await h.settle();
  assert.match(textOf(h.doc.getElementById('alertContainer')), /הביטול לא בוצע — איש הקשר לא נמצא/);
  assert.equal(t.querySelector('button').disabled, false);
});
