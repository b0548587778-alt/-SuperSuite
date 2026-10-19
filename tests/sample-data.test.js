// נתוני דוגמה להפעלה ראשונה (PLAN.md 1.5): רק בבחירה, מסומנים, בלי מספר קבלה, ומחיקה שלא נוגעת בנתונים אמיתיים
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const SD = require('../modules/econ/core/sampleData');
const N = require('../modules/econ/core/npo');
const EconUI = require('./helpers/econ-ui');

const handlers = {};
const Module = require('module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_sample__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_sample__.js'] = { id: '/__electron_stub_sample__.js', filename: '/__electron_stub_sample__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

let n = 0;
const uuid = () => 'id-' + (++n);
const TODAY = '2026-10-19';

test('pure: הכנסה לפי בחירה בלבד, מסומנת, ותרומות בלי מספר קבלה', () => {
  const data = { npo: { settings: { orgName: 'עמותת אור', receiptSeq: 7 }, donations: [{ id: 'real', donorName: 'אמיתי', receipt: { number: 7 } }] } };
  const added = SD.apply(data, ['npo'], { today: TODAY, uuid });
  assert.equal(added.npo, 4);
  assert.equal(added.gemach, undefined, 'לא נבחר — לא נוסף');
  const sample = data.npo.donations.filter(d => d.sample);
  assert.equal(sample.length, 4);
  for (const d of sample) {
    assert.equal(d.receipt.number, null);
    assert.equal(d.receipt.external, true);
    assert.equal(d.receipt.sec46, false);
    assert.equal(N.taxStatus(d), 'not-required', 'לא נכנסת לדיווח "תרומות ישראל"');
    assert.equal(N.receiptLabel(d), 'דוגמה');
    assert.equal(d.donorId, '', 'בלי מספרי זהות');
    assert.ok(d.date < TODAY, "תאריכים בעבר הקרוב");
  }
  assert.equal(data.npo.settings.receiptSeq, 7, 'מספור הקבלות לא זז');
  // פעם שנייה — לא מכפיל
  assert.deepEqual(SD.apply(data, ['npo'], { today: TODAY, uuid }), {});
  assert.equal(SD.counts(data).npo, 4);
});

test('pure: גמ"ח ועסק, וסינון לפי הרישיון', () => {
  const data = { contacts: { userId: 'u', contacts: [{ id: 'c1', name: 'אמיתי' }] }, products: [{ id: 'p1', name: 'אמיתי' }] };
  const added = SD.apply(data, ['gemach', 'business', 'npo'], { today: TODAY, uuid, allowed: ['gemach', 'business'] });
  assert.deepEqual(Object.keys(added).sort(), ['business', 'gemach'], 'תחום שלא ברישיון לא נוסף');
  const loan = data.gemach.loans[0];
  assert.equal(loan.sample, true);
  assert.equal(loan.guarantors.length, 1);
  assert.ok(loan.schedule.some(s => s.status === 'paid'), 'תשלום ראשון כבר נרשם');
  assert.equal(data.products.length, 4);
  assert.equal(data.contacts.length, 2, 'איש הקשר האמיתי נשאר');
  assert.throws(() => SD.apply({}, ['npo'], { today: TODAY, uuid, allowed: ['gemach'] }), /לא נבחר תחום/);
  assert.deepEqual(SD.availableKinds({ mode: 'unlicensed' }), ['npo', 'gemach', 'business']);
  assert.deepEqual(SD.availableKinds({ mode: 'licensed', features: ['econ.gemach'] }), ['gemach']);
});

test('pure: מחיקה — רק רשומות sample, כולל איש קשר באוסף ישן', () => {
  const data = {
    npo: { donations: [{ id: 'a' }, { id: 'b', sample: true }, { id: 'c', sample: 'true' }] },
    gemach: { loans: [{ id: 'l', sample: true }, { id: 'm' }] },
    products: [{ id: 'p', sample: true }, { id: 'q' }],
    contacts: [{ id: 'x' }, { id: 'y', sample: true }],
  };
  assert.equal(SD.remove(data), 4);
  assert.deepEqual(data.npo.donations.map(d => d.id), ['a', 'c'], 'רק sample === true');
  assert.deepEqual(data.gemach.loans.map(d => d.id), ['m']);
  assert.deepEqual(data.products.map(d => d.id), ['q']);
  assert.deepEqual(data.contacts.map(d => d.id), ['x']);
  assert.equal(SD.remove(data), 0);
});

test('תוכן הולם: שמות יהודיים, בלי תוכן זר', () => {
  const data = {};
  SD.apply(data, ['npo', 'gemach', 'business'], { today: TODAY, uuid });
  const text = JSON.stringify(data);
  for (const name of ['משה כהן', 'יעקב לוי', 'שמואל פרידמן', 'אהרן ויס', 'דוד ברגר', 'ישיבת אור התורה']) assert.ok(text.includes(name), name);
  assert.doesNotMatch(text, /[A-Za-z]{4,} [A-Za-z]{4,}/, 'בלי שמות לועזיים');
});

test('ipc: זרימה מלאה — דוגמה לא צורכת מספר קבלה, ומחיקה משאירה את הנתונים האמיתיים', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sample-'));
  await ipc.initEcon(dir, {});
  await handlers['auth:setup'](ev(31), 'menahel', 'a-very-long-pass-2026');
  await handlers['auth:login'](ev(31), 'menahel', 'a-very-long-pass-2026');
  await handlers['npo:saveSettings'](ev(31), { orgName: 'עמותת חסד ואמת' });
  const real1 = await handlers['npo:addDonation'](ev(31), { donorName: 'אברהם שטרן', amount: 100, date: '2026-10-01' });
  assert.equal(real1.receipt.number, 1);

  const st = await handlers['sample:getStatus'](ev(31));
  assert.deepEqual(st.kinds.map(k => k.id), ['npo', 'gemach', 'business']);
  assert.equal(st.counts.total, 0);
  const r = await handlers['sample:add'](ev(31), ['npo', 'gemach', 'business']);
  assert.equal(r.counts.total, 4 + 1 + 4);

  const real2 = await handlers['npo:addDonation'](ev(31), { donorName: 'אברהם שטרן', amount: 50, date: '2026-10-02' });
  assert.equal(real2.receipt.number, 2, 'הדוגמה לא דילגה על מספר');
  const products = await handlers['acct:getProducts'](ev(31));
  assert.equal(products.length, 3);

  // צופה לא מכניס ולא מוחק
  await handlers['users:create'](ev(31), { username: 'tzofe', password: 'another-long-pass-2026', role: 'viewer' });
  await handlers['auth:login'](ev(32), 'tzofe', 'another-long-pass-2026');
  await assert.rejects(handlers['sample:deleteAll'](ev(32)), /אין הרשאה/);
  await assert.rejects(handlers['sample:add'](ev(32), ['npo']), /אין הרשאה/);

  const del = await handlers['sample:deleteAll'](ev(31));
  assert.equal(del.removed, 9);
  const ov = await handlers['npo:getOverview'](ev(31), 2026);
  const all = [...(ov.donations || [])];
  assert.deepEqual(all.map(d => d.receipt.number).sort(), [1, 2], 'נשארו רק התרומות האמיתיות');
  assert.equal((await handlers['acct:getProducts'](ev(31))).length, 0);
  assert.equal((await handlers['sample:getStatus'](ev(31))).counts.total, 0);
});

test('ממשק: הצעה בלוח הבקרה, פס במסכים, וכפתור קבלה ראשונה', () => {
  const ctx = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    localStorage: { getItem: () => null, setItem() {} },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  EconUI.run(ctx);
  vm.runInContext(`state.sample = { counts: { total: 0 }, kinds: [{ id: 'npo', label: 'עמותה' }, { id: 'gemach', label: 'גמ"ח' }] }`, ctx);
  const offer = vm.runInContext('renderSampleOffer()', ctx);
  assert.match(offer, /data-sample-add/);
  assert.match(offer, /name="sampleKind" value="npo" checked/);
  assert.match(offer, /data-first-receipt/);
  assert.equal(vm.runInContext(`renderSampleBanner('npo')`, ctx), '', 'בלי דוגמה — בלי פס');

  vm.runInContext(`state.sample = { counts: { total: 9 }, kinds: [{ id: 'gemach', label: 'גמ"ח' }] }`, ctx);
  assert.doesNotMatch(vm.runInContext('renderSampleOffer()', ctx), /data-sample-add|data-first-receipt/, 'יש דוגמה ואין עמותה');
  const banner = vm.runInContext(`renderSampleBanner('gemach')`, ctx);
  assert.match(banner, /נתוני דוגמה/);
  assert.match(banner, /data-sample-delete/);
  assert.equal(vm.runInContext(`renderSampleBanner('acct-journal')`, ctx), '', 'רק במסכים שבהם הדוגמה מופיעה');
});
