// קובץ מס"ב נכתב בכתיבה עמידה (קובץ זמני ← החלפה), וכשל בכתיבה מבטל את האצווה:
// לא נשארת אצווה פתוחה בלי קובץ, והחיובים זמינים שוב לאצווה חדשה (PLAN שלב 10, 10.1א)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const handlers = {};
let savePath = null;
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_msvdur__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_msvdur__.js'] = {
  id: '/__electron_stub_msvdur__.js', filename: '/__electron_stub_msvdur__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async () => (savePath ? { canceled: false, filePath: savePath } : { canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  }
};
const ipc = require('../modules/econ/ipc');
const ev = { sender: { id: 81 } };
// המסד נשאר פתוח עד סוף התהליך — tools/run-tests.js מוחק את התיקייה הזמנית בסוף
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-msvdur-'));
const MONTH = '2099-03';
const input = { month: MONTH, chargeDate: '2099-03-10' };

async function openBatches() {
  const st = await handlers['npo:getStandingOrders'](ev, '2099-01-01');
  return (st.masav.batches || []).filter(b => b.status === 'open');
}

test.before(async () => {
  await ipc.initEcon(dir, { relayUrl: '' });
  await handlers['auth:setup'](ev, 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev, 'menahel', 'menahel-strong-pass-1');
  await handlers['npo:saveSettings'](ev, { orgName: 'עמותת חסד לדוגמה', vatStatus: 'exempt' });
  await handlers['npo:saveMasavSettings'](ev, { institution: '12345678', sender: '54321', name: 'עמותת חסד', hebrew: 'oldcode' });
  const o = await handlers['npo:saveStandingOrder'](ev, null, { donorName: 'אברהם לוי', amount: 100, dayOfMonth: 10, startMonth: '2099-01', method: 'standing' });
  await handlers['npo:setStandingBank'](ev, o.id, { bank: '12', branch: '345', account: '678901' });
});

test('כתיבה שנכשלה: האצווה מבוטלת, ואפשר ליצור אותה שוב', async () => {
  // יעד בתיקייה שלא קיימת ← הכתיבה נכשלת
  savePath = path.join(dir, 'no-such-dir', 'masav.txt');
  await assert.rejects(handlers['npo:createMasavFile'](ev, input), /שמירת הקובץ נכשלה/);
  assert.equal(fs.existsSync(savePath), false);
  assert.equal((await openBatches()).length, 0, 'אין אצווה פתוחה בלי קובץ');

  // יעד תקין ← הקובץ נכתב והאצווה נשמרת, בלי קובץ זמני שנשאר
  savePath = path.join(dir, 'masav.txt');
  const r = await handlers['npo:createMasavFile'](ev, input);
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  const text = fs.readFileSync(savePath, 'latin1');
  assert.match(text, /^K12345678/);
  assert.equal(fs.existsSync(savePath + '.tmp'), false);
  assert.equal((await openBatches()).length, 1);
});

test('הקוד: כתיבה דרך writeFileDurable, לא writeFileSync ישיר', () => {
  const src = fs.readFileSync(path.join(__dirname, '../modules/econ/ipc.js'), 'utf8');
  const block = /handleLong\(`\$\{prefix\}:createMasavFile`[\s\S]*?\n {4}\}\);/.exec(src);
  assert.ok(block, 'נמצא הערוץ');
  assert.match(block[0], /writeFileDurable\(file, out\.text, 'latin1'\)/);
  assert.doesNotMatch(block[0], /fs\.writeFileSync/);
  assert.match(block[0], /cancelMasavBatch\(out\.batchId\)/);
});
