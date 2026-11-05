// צעד אחר צעד (סבב 5, מצב פשוט): האשפים במודול הכלכלי — שאלה אחת בכל מסך, התקדמות מוקראת, מיקוד,
// סיכום לפני שמירה, אותו ערוץ של הטופס, קלט מהמעטפת (prefill) מסונן, הרשאה ורישיון, ו-Escape.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers/econ-a11y-harness');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-guided-wiz-'));
let s; // שרת אמיתי, מצב פשוט
test.before(async () => {
  s = await H.boot({ real: DIR, simple: true });
  await s.run('window.systemAPI').saveNpoSettings({ orgName: 'עמותת חסד ואמת' });
  await s.go('dashboard');
});
// ב-Windows קובץ מסד שעוד פתוח לא נמחק (EBUSY); tools/run-tests.js מוחק את כל התיקייה הזמנית בסוף
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* EBUSY ב-Windows */ } });

const textOf = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
const wiz = (h = s) => h.doc.querySelector('.modal.wiz');
const named = (h, name) => h.calls.filter(c => c.name === name);

// תשובה לשלב: טקסט / מספר — בשדה; בחירה — לפי ערך, או null = האפשרות הראשונה
async function answer(h, v) {
  const inp = h.doc.getElementById('wizInput');
  if (inp) inp.value = v;
  else {
    const radios = h.doc.querySelectorAll('input[name="wizChoice"]');
    const pick = v === null ? radios[0] : radios.find(r => r.value === v);
    assert.ok(pick, 'אפשרות ' + v);
    for (const r of radios) r.checked = r === pick;
  }
  h.doc.getElementById('wizNext').click();
  await h.settle();
}
async function start(h, task, prefill) {
  h.run(`window.__started = 'pending'; econStartTask(${JSON.stringify(task)}${prefill === undefined ? '' : ', ' + JSON.stringify(prefill)}).then(v => { window.__started = v; })`);
  await h.settle();
  return h.run('window.__started');
}

// ---------- חוזה ----------
test('מזהי המשימות — החוזה עם המעטפת, ולכל אחד אשף; מפת הרישוי זהה ל-gate.js', () => {
  const ids = s.run('GUIDED_TASK_IDS');
  assert.deepEqual([...ids], ['donation', 'receipt', 'expense', 'invoice', 'loanPayment', 'gemachLoan', 'contact']);
  for (const id of ids) assert.ok(s.run(`!!WIZARDS[${JSON.stringify(id)}]`), id);
  const tasksFile = path.join(__dirname, '../shell/tasks.js');
  if (fs.existsSync(tasksFile)) {
    const src = fs.readFileSync(tasksFile, 'utf8');
    for (const id of ids) assert.match(src, new RegExp(`['"]${id}['"]`), 'shell/tasks.js: ' + id);
  }
  const gate = require('../shell/licensing/gate');
  const src = fs.readFileSync(path.join(__dirname, '../shell/licensing/gate.js'), 'utf8');
  const map = s.run('WIZ_LICENSE_FEATURES');
  for (const [k, v] of Object.entries(map)) assert.match(src, new RegExp(`${k}: '${v.replace('.', '\\.')}'`), k);
  assert.equal(typeof gate.checkChannel, 'function');
  // window.econStartTask — נקודת הכניסה מהמעטפת
  assert.equal(typeof s.run('window.econStartTask'), 'function');
});

test('תרומה: 4 שאלות, "שלב N מתוך 4" מוקרא, מיקוד בשדה של השאלה, סיכום — ושום דבר לא נשמר לפני "כן, לשמור"', async () => {
  const year = new Date().getFullYear();
  const before = (await s.run('window.systemAPI').getNpoOverview(year)).donations.length;
  assert.equal(await start(s, 'donation'), true);
  const w = wiz();
  assert.equal(w.getAttribute('role'), 'dialog');
  assert.equal(w.getAttribute('aria-modal'), 'true');
  assert.equal(textOf(s.doc.getElementById(w.getAttribute('aria-labelledby'))), 'רישום תרומה והפקת קבלה');
  const prog = s.doc.getElementById('wizProgress');
  assert.equal(prog.getAttribute('aria-live'), 'polite');
  assert.equal(textOf(prog), 'שלב 1 מתוך 4');
  assert.equal(s.doc.activeElement, s.doc.getElementById('wizInput'), 'מיקוד בשדה');
  assert.equal(textOf(s.doc.querySelector(`label[for="wizInput"]`)), 'ממי התרומה?');
  assert.equal(s.doc.getElementById('wizBack').hidden, true, 'בשלב הראשון אין "חזרה"');
  assert.deepEqual(H.audit(w, { startLevel: 1 }), []);
  // "המשך" בלי תשובה — מה חסר ואיך מתקנים, ליד השדה
  await answer(s, '');
  const err = s.doc.getElementById('wizError');
  assert.equal(err.getAttribute('role'), 'alert');
  assert.match(textOf(err), /חסר שם התורם — כתבו ממי התרומה/);
  assert.equal(s.doc.getElementById('wizInput').getAttribute('aria-invalid'), 'true');
  assert.match(s.doc.getElementById('wizInput').getAttribute('aria-describedby'), /wizError/);
  await answer(s, 'משפחת לוי');
  assert.equal(textOf(prog), 'שלב 2 מתוך 4');
  await answer(s, 'מאה');
  assert.match(textOf(s.doc.getElementById('wizError')), /מספר בלבד/);
  await answer(s, '1,250');
  assert.equal(textOf(prog), 'שלב 3 מתוך 4');
  // בחירה: fieldset + legend = השאלה, מיקוד ברדיו הראשון
  assert.equal(textOf(s.doc.querySelector('.wiz-choices legend')), 'איך שולם?');
  assert.equal(s.doc.activeElement.getAttribute('name'), 'wizChoice');
  await answer(s, 'cash');
  await answer(s, 'no');
  assert.match(textOf(prog), /בדיקה לפני שמירה — עוד לא נשמר דבר/);
  assert.equal(s.doc.activeElement, s.doc.getElementById('wizQ'), 'מיקוד בכותרת הסיכום');
  const sum = textOf(s.doc.querySelector('.wiz-summary'));
  assert.match(sum, /משפחת לוי/);
  assert.match(sum, /1,250/);
  assert.match(sum, /מזומן/);
  assert.equal(textOf(s.doc.getElementById('wizNext')), 'כן, לשמור');
  assert.equal(named(s, 'addNpoDonation').length, 0, 'לא נשמר לפני האישור');
  assert.equal((await s.run('window.systemAPI').getNpoOverview(year)).donations.length, before);
  // "חזרה לתיקון" שומרת את התשובות
  s.doc.getElementById('wizBack').click();
  await s.settle();
  assert.equal(s.doc.querySelector('input[name="wizChoice"]:checked').value, 'no');
  await answer(s, 'no');
  s.doc.getElementById('wizNext').click();
  await s.settle();
  assert.equal(wiz(), null, 'האשף נסגר: ' + textOf(s.doc.getElementById('wizError')));
  // אותו ערוץ של הטופס (npo:addDonation דרך formSchemas.npo.create), עם הסכום כמו שהוקלד — ההמרה לאגורות בשרת
  const call = named(s, 'addNpoDonation');
  assert.equal(call.length, 1);
  assert.equal(call[0].args[0].amount, 1250);
  assert.equal(call[0].args[0].donorName, 'משפחת לוי');
  const after = (await s.run('window.systemAPI').getNpoOverview(year)).donations;
  assert.equal(after.length, before + 1);
  const d = after.find(x => x.donorName === 'משפחת לוי');
  assert.equal(d.amount, 1250);
  assert.equal(d.method, 'cash');
  assert.ok(Number.isInteger(d.receipt.number), 'קבלה ממוספרת');
  // טוסט עם "טעיתי, לבטל"
  const toast = s.doc.getElementById('toastContainer').querySelectorAll('.undo-toast').pop();
  assert.match(textOf(toast), /התרומה נרשמה ✓ — קבלה מספר \d+/);
  assert.equal(textOf(toast.querySelector('button')), 'טעיתי, לבטל');
});

test('prefill מהמעטפת: ערכים תקינים ממלאים את השאלות, אבל האשף מתחיל בשאלה הראשונה ולא שומר לבד', async () => {
  const n = named(s, 'addNpoDonation').length;
  assert.equal(await start(s, 'donation', { donorName: 'יוסף כהן', amount: '300', method: 'check' }), true);
  assert.equal(s.doc.getElementById('wizInput').value, 'יוסף כהן');
  assert.equal(s.doc.getElementById('wizProgress').textContent, 'שלב 1 מתוך 4');
  s.doc.getElementById('wizNext').click(); await s.settle();
  assert.equal(s.doc.getElementById('wizInput').value, '300');
  s.doc.getElementById('wizNext').click(); await s.settle();
  assert.equal(s.doc.querySelector('input[name="wizChoice"]:checked').value, 'check');
  assert.equal(named(s, 'addNpoDonation').length, n, 'לא נשמר');
  // Escape אחרי ערכים מהמעטפת בלבד (לא הוקלד דבר) — נסגר בלי שאלה
  s.key(s.doc.activeElement, 'Escape');
  await s.settle();
  assert.equal(wiz(), null);
  assert.equal(named(s, 'addNpoDonation').length, n);
});

test('prefill עוין: מפתחות זרים, אובייקטים, סכומים שליליים/ענקיים, ערך שאינו באפשרויות ותווי בקרה — מסוננים', () => {
  const clean = (task, p) => JSON.parse(JSON.stringify(s.run(`sanitizePrefill(WIZARDS[${JSON.stringify(task)}], ${p}, { invoices: [{ id: 'inv1', number: 5, customer: 'א', total: 1 }] })`)));
  // אובייקט עם prototype אחר (גם __proto__ בליטרל) — נדחה כולו, כמו ב-shell/tasks.js
  assert.deepEqual(clean('donation', `{ donorName: 'א', __proto__: { polluted: 1 } }`), {});
  assert.deepEqual(clean('donation', `Object.assign(Object.create({ x: 1 }), { donorName: 'א' })`), {});
  assert.deepEqual(clean('donation', `{ donorName: '<img src=x onerror=alert(1)>\\u0000\\u001b' + 'א'.repeat(500), amount: -5, method: 'bitcoin', print: { a: 1 }, constructor: 'x', receiptNumber: 7 }`),
    { donorName: ('<img src=x onerror=alert(1)>  ' + 'א'.repeat(500)).slice(0, 120) }, 'תווי בקרה ← רווח, עד 120 תווים');
  assert.deepEqual(clean('donation', `{ amount: '1e12' }`), {});
  assert.deepEqual(clean('donation', `{ amount: 'NaN' }`), {});
  assert.deepEqual(clean('donation', `{ amount: [100] }`), {});
  assert.deepEqual(clean('donation', `{ amount: '1,500', method: 'cash' }`), { amount: '1500', method: 'cash' });
  assert.deepEqual(clean('gemachLoan', `{ installments: '2.5', amount: 0 }`), {});
  assert.deepEqual(clean('receipt', `{ invoiceId: 'other', method: 'cash' }`), { method: 'cash' });
  assert.deepEqual(clean('receipt', `{ invoiceId: 'inv1' }`), { invoiceId: 'inv1' });
  assert.deepEqual(clean('donation', 'null'), {});
  assert.deepEqual(clean('donation', `'donorName'`), {});
  assert.deepEqual(clean('donation', `[1, 2]`), {});
  assert.equal(s.run('({}).polluted'), undefined, 'בלי זיהום prototype');
  // הערך מוצג כטקסט, לא כ-HTML
  return (async () => {
    await start(s, 'donation', { donorName: '<b id="pwn">x</b>' });
    assert.equal(s.doc.getElementById('pwn'), null);
    assert.equal(s.doc.getElementById('wizInput').value, '<b id="pwn">x</b>');
    s.key(s.doc.activeElement, 'Escape'); await s.settle();
    // הקלדה שונה מה-prefill — Escape שואל לפני יציאה
    if (wiz()) { s.doc.querySelectorAll('.modal').filter(m => m !== wiz() && m.id !== 'modal').forEach(m => m.querySelector('.danger').click()); await s.settle(); }
    // משימה לא מוכרת — לא נפתח דבר
    assert.equal(await start(s, '__proto__'), false);
    assert.equal(await start(s, 'toString'), false);
    assert.equal(wiz(), null);
  })();
});

test('Escape באמצע הקלדה: "לצאת? מה שהוקלד לא יישמר" — "לא, להמשיך" משאיר, "כן, לצאת" סוגר ומחזיר מיקוד', async () => {
  const opener = s.doc.createElement('button');
  opener.textContent = 'פותח';
  s.view().appendChild(opener);
  opener.focus();
  await start(s, 'contact');
  s.doc.getElementById('wizInput').value = 'רבקה';
  s.key(s.doc.activeElement, 'Escape');
  await s.settle();
  const ask = s.doc.querySelectorAll('.modal').filter(m => m !== wiz() && m.id !== 'modal').pop();
  assert.ok(ask, 'שאלת אישור');
  assert.equal(ask.getAttribute('role'), 'alertdialog');
  assert.match(textOf(ask), /לצאת\? מה שהוקלד לא יישמר/);
  const [no, yes] = ask.querySelectorAll('.modal-actions button');
  assert.equal(textOf(no), 'לא, להמשיך');
  assert.equal(textOf(yes), 'כן, לצאת');
  assert.equal(s.doc.activeElement, no, 'המיקוד על "לא"');
  no.click(); await s.settle();
  assert.ok(wiz(), 'נשאר פתוח');
  assert.equal(s.doc.getElementById('wizInput').value, 'רבקה', 'מה שהוקלד נשמר באשף');
  s.key(s.doc.activeElement, 'Escape'); await s.settle();
  s.doc.querySelectorAll('.modal').filter(m => m !== wiz() && m.id !== 'modal').pop().querySelector('.danger').click();
  await s.settle();
  assert.equal(wiz(), null);
  assert.equal(s.doc.activeElement, opener, 'המיקוד חזר');
  assert.equal(named(s, 'createContact').length, 0);
});

test('Tab נשאר בתוך האשף, ו-Enter בשדה = "המשך"', async () => {
  await start(s, 'contact');
  const list = s.run('focusablesIn')(wiz());
  list[list.length - 1].focus();
  s.key(s.doc.activeElement, 'Tab');
  assert.equal(s.doc.activeElement, list[0]);
  s.doc.getElementById('wizInput').focus();
  s.doc.getElementById('wizInput').value = 'דוד';
  s.key(s.doc.getElementById('wizInput'), 'Enter');
  await s.settle();
  assert.equal(s.doc.getElementById('wizProgress').textContent, 'שלב 2 מתוך 3');
  s.doc.getElementById('wizExit').click(); await s.settle();
  s.doc.querySelectorAll('.modal').filter(m => m !== wiz() && m.id !== 'modal').pop().querySelector('.danger').click();
  await s.settle();
  assert.equal(wiz(), null);
});

// כל אשף עד הסוף, מול השרת האמיתי — ואותו ערוץ של הטופס
const FLOWS = [
  ['contact', ['שרה לוי', '050-1234567', ''], 'createContact', async (api) => (await api.getContacts()).contacts.some(c => c.name === 'שרה לוי' && c.phone === '050-1234567')],
  ['gemachLoan', ['אהרן פרץ', '3000', '6', 'שמעון לוי, , 052-0000000'], 'addGemachLoan', async (api) => (await api.getGemachOverview()).loans.some(l => l.borrowerName === 'אהרן פרץ' && l.amount === 3000 && l.installments === 6)],
  ['invoice', ['חברת אור', 'שיעורי עזר', '200', 'no'], 'createInvoice', async (api) => (await api.getInvoices()).some(i => i.customer === 'חברת אור' && i.total > 200 && i.status === 'open')],
  ['expense', ['נייר למשרד', '120', null, '1000'], 'createEntry', async (api) => (await api.getJournal({})).some(e => e.description === 'נייר למשרד')],
  ['receipt', [null, 'cash', '123'], 'recordPayment', async (api) => (await api.getInvoices()).some(i => i.status === 'paid')],
  ['loanPayment', [null, ''], 'recordGemachPayment', async (api) => (await api.getGemachOverview()).loans.some(l => l.totalPaid > 0)],
];
test('כל אשף עד "כן, לשמור": מספר השלבים, הסיכום, ושמירה אחת דרך הערוץ של הטופס', async () => {
  const api = s.run('window.systemAPI');
  for (const [task, answers, channel, check] of FLOWS) {
    const n = named(s, channel).length;
    assert.equal(await start(s, task), true, task);
    const def = s.run(`WIZARDS[${JSON.stringify(task)}]`);
    assert.equal(def.steps.length, answers.length, task);
    for (let i = 0; i < answers.length; i++) {
      assert.equal(s.doc.getElementById('wizProgress').textContent, `שלב ${i + 1} מתוך ${answers.length}`, task);
      await answer(s, answers[i]);
      assert.equal(textOf(s.doc.getElementById('wizError')), '', task + ' שלב ' + (i + 1));
    }
    assert.ok(s.doc.querySelector('.wiz-summary'), task + ': סיכום');
    assert.equal(named(s, channel).length, n, task + ': לא נשמר לפני האישור');
    s.doc.getElementById('wizNext').click();
    await s.settle(40);
    assert.equal(wiz(), null, task + ': נסגר — ' + textOf(s.doc.getElementById('wizError')));
    assert.equal(named(s, channel).length, n + 1, task + ': ' + channel);
    assert.ok(await check(api), task + ': נשמר');
  }
});

test('הטופס והאשף — אותו ערוץ: create של הסכימה הוא הערוץ שהאשף קורא לו', () => {
  const src = fs.readFileSync(path.join(__dirname, '../modules/econ/ui/wizards.js'), 'utf8');
  for (const [view, task] of [['npo', 'donation'], ['acct-journal', 'expense'], ['acct-invoices', 'invoice'], ['gemach', 'gemachLoan'], ['contacts', 'contact']]) {
    const body = src.slice(src.indexOf(`  ${task}: {`), src.indexOf('\n  },', src.indexOf(`  ${task}: {`)));
    assert.match(body, new RegExp(`formSchemas\\['${view}'\\]\\.create\\(`), task);
  }
  assert.match(src, /gemachPaymentSchema\(a\.loanId, row\.seq, 0\)\.create\(/, 'החזר — הסכימה של "רישום תשלום"');
  // בלי חישובי כסף באשף: אין Math.round / *100 / toAg
  assert.doesNotMatch(src, /Math\.round|\* ?100\b|toAg\(/);
});

test('מצב פשוט: "＋ הוספת רשומה" פותח את האשף; "לטופס המלא" פותח את הטופס הרגיל', async () => {
  await s.go('gemach');
  s.doc.getElementById('addBtn').click();
  await s.settle();
  assert.equal(wiz().getAttribute('data-task'), 'gemachLoan');
  s.doc.getElementById('wizFullForm').click();
  await s.settle();
  assert.equal(wiz(), null);
  assert.equal(s.doc.getElementById('modal').classList.contains('hidden'), false, 'הטופס המלא');
  s.key(s.doc.activeElement, 'Escape'); await s.settle();
});

// ---------- הרשאה ורישיון (API מדומה) ----------
test('צופה (בלי data.edit): אין אשף, "צעד אחר צעד" מוסתר, וקריאה מהמעטפת מסבירה במילים', async () => {
  const viewer = { id: 'u2', username: 'צופה', role: 'viewer', permissions: ['data.view'] };
  const h = await H.boot({ user: viewer, simple: true, api: { getLicenseStatus: () => ({ mode: 'unlicensed' }) } });
  await h.go('npo');
  assert.equal(h.doc.getElementById('wizardBtn').hidden, true);
  assert.equal(h.run("wizardAllowedSync('donation')"), false);
  assert.equal(await start(h, 'donation'), false);
  assert.equal(wiz(h), null);
  assert.match(textOf(h.doc.getElementById('alertContainer')), /אין לכם הרשאה לרשום/);
  assert.equal(h.calls.filter(c => c.name === 'addNpoDonation').length, 0);
});

test('רישיון: תחום סגור או מצב קריאה בלבד — האשף מוסתר ולא נפתח; תחום פתוח — כן', async () => {
  const lic = (st) => H.boot({ user: H.ADMIN, api: { getLicenseStatus: () => st, getNpoOverview: () => ({ settings: { orgName: 'עמותה' }, donations: [] }) } });
  const closed = await lic({ mode: 'licensed', status: 'active', features: ['econ', 'econ.accounting'] });
  await closed.go('gemach');
  await closed.settle();
  assert.equal(closed.doc.getElementById('wizardBtn').hidden, true, 'גמ"ח לא ברישיון');
  assert.equal(await start(closed, 'gemachLoan'), false);
  assert.match(textOf(closed.doc.getElementById('alertContainer')), /אינו פתוח ברישיון/);
  assert.equal(closed.run("wizardAllowedSync('invoice')"), true, 'חשבונות ברישיון');
  const ro = await lic({ mode: 'licensed', status: 'trial_ended', features: ['econ', 'econ.npo'] });
  assert.equal(await start(ro, 'donation'), false, 'קריאה בלבד');
  const open = await lic({ mode: 'licensed', status: 'active', features: ['econ', 'econ.npo'] });
  await open.go('npo');
  await open.settle();
  assert.equal(open.doc.getElementById('wizardBtn').hidden, false, 'מצב רגיל: כפתור "צעד אחר צעד"');
  assert.equal(open.doc.getElementById('wizardBtn').getAttribute('aria-label'), 'רישום תרומה — צעד אחר צעד');
  assert.equal(await start(open, 'donation'), true);
});

test('בקשה מהמעטפת לפני הכניסה — נשמרת ונפתחת אחרי הכניסה', async () => {
  const h = await H.boot({ user: H.ADMIN, api: { getLicenseStatus: () => ({ mode: 'unlicensed' }) } });
  h.run("state.user = null");
  assert.equal(await start(h, 'contact', { name: 'מנחם' }), false);
  // אותה צורה כמו בקשה מהמעטפת (openShellRequest אחרי הכניסה)
  assert.deepEqual(JSON.parse(JSON.stringify(h.run('state.requestedTask'))), { view: 'contacts', task: 'contact', prefill: { name: 'מנחם' } });
  assert.equal(h.run('state.requestedView'), 'contacts');
});

// ---------- החוזה עם תיבת הפקודה (shell/tasks.js) ----------
test('econStartTask(task, prefill, view): שדות המעטפת (name/amount/date/note) ממלאים את האשף, עוברים למסך, ושום דבר לא נשמר לבד', async () => {
  const T = require('../shell/tasks');
  const prefill = { name: 'משפחת ברגר', amount: '12.50', date: '2026-10-01', note: 'לבניין בית הכנסת' };
  assert.ok(T.validateTask('donation', prefill), 'מטען שעובר את main.js');
  await s.go('dashboard');
  const n = named(s, 'addNpoDonation').length;
  // המסלול של המעטפת: econ:goto ← openShellRequest ← econStartTask(task, prefill, view)
  s.run(`openShellRequest(${JSON.stringify({ view: 'npo', task: 'donation', prefill })})`);
  await s.settle(40);
  assert.equal(s.run('state.currentView'), 'npo', 'עבר למסך של המשימה');
  assert.equal(s.doc.getElementById('wizInput').value, 'משפחת ברגר');
  s.doc.getElementById('wizNext').click(); await s.settle();
  assert.equal(s.doc.getElementById('wizInput').value, '12.5');
  s.doc.getElementById('wizNext').click(); await s.settle();
  s.doc.querySelectorAll('input[name="wizChoice"]').find(r => r.value === 'transfer').checked = true;
  s.doc.getElementById('wizNext').click(); await s.settle();
  s.doc.querySelectorAll('input[name="wizChoice"]').find(r => r.value === 'no').checked = true;
  s.doc.getElementById('wizNext').click(); await s.settle();
  const sum = textOf(s.doc.querySelector('.wiz-summary'));
  assert.match(sum, /תאריך\s*2026-10-01/);
  assert.match(sum, /פירוט\s*לבניין בית הכנסת/);
  assert.equal(named(s, 'addNpoDonation').length, n, 'לא נשמר לפני "כן, לשמור"');
  s.doc.getElementById('wizNext').click(); await s.settle(40);
  const call = named(s, 'addNpoDonation').pop().args[0];
  assert.equal(call.date, '2026-10-01');
  assert.equal(call.purpose, 'לבניין בית הכנסת');
  assert.equal(call.amount, 12.5);
});

test('שם מהמעטפת ← רשומה רק כשהיא יחידה; תשלומים (מספר שלם) ← שלב; תאריך לא קיים ← נדחה', () => {
  const ctx = `{ loans: [{ id: 'a', borrowerName: 'לוי' }, { id: 'b', borrowerName: 'כהן' }, { id: 'c', borrowerName: 'כהן' }], invoices: [{ id: 'i', customer: 'אור', number: 1 }] }`;
  const clean = (task, p) => JSON.parse(JSON.stringify(s.run(`sanitizePrefill(WIZARDS[${JSON.stringify(task)}], ${p}, ${ctx})`)));
  assert.deepEqual(clean('loanPayment', `{ name: 'לוי', amount: '100' }`), { loanId: 'a', amount: '100' });
  assert.deepEqual(clean('loanPayment', `{ name: 'כהן' }`), {}, 'שני לווים בשם הזה — המשתמש בוחר');
  assert.deepEqual(clean('receipt', `{ name: 'אור' }`), { invoiceId: 'i' });
  assert.deepEqual(clean('gemachLoan', `{ name: 'פרץ', amount: '5000', installments: 12, date: '2026-02-31' }`), { borrowerName: 'פרץ', amount: '5000', installments: '12' });
  assert.deepEqual(clean('contact', `{ name: 'רחל', phone: '0501234567', note: 'שכנה' }`), { _note: 'שכנה', name: 'רחל', phone: '0501234567' });
  assert.deepEqual(clean('expense', `{ amount: '40', note: 'מעטפות' }`), { _note: 'מעטפות', description: 'מעטפות', amount: '40' });
  // משימת המעטפת בלי אשף (גיבוי) — לא נפתח דבר כאן
  assert.ok(require('../shell/tasks').getTask('backup'));
  assert.ok(!s.run('GUIDED_TASK_IDS').includes('backup'));
});
