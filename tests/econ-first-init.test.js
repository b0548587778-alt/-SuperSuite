// רגרסיה: בהפעלה הראשונה של התהליך מסך ההודעות נתקע ("טוען...") — הסנכרון נוצר לפני מאגר הרישוי וקיבל null.
// בבדיקות אחרות initEcon רץ כמה פעמים באותו תהליך, ולכן המשתנה כבר החזיק מאגר ישן והבאג הוסתר.
// כאן: תהליך נפרד, initEcon פעם אחת בלבד.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = `
const Module = require('module');
const handlers = {};
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__e__.js' : orig.call(this, req, ...rest); };
require.cache['/__e__.js'] = { id: '/__e__.js', filename: '/__e__.js', loaded: true, exports: { ipcMain: { handle: (c, f) => { handlers[c] = f; } } } };
const fs = require('fs'), os = require('os'), path = require('path');
const ipc = require(${JSON.stringify(path.join(__dirname, '..', 'modules', 'econ', 'ipc'))});
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-first-'));
  await ipc.initEcon(dir);
  const ev = { sender: { id: 5 } };
  await handlers['auth:setup'](ev, 'admin_first', 'a-very-long-pass-2026');
  const ov = await handlers['chat:overview'](ev, '', 'all');
  process.stdout.write(JSON.stringify({ ok: Array.isArray(ov.contacts) && Array.isArray(ov.conversations) }));
})().catch(e => { process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message) })); });
`;

test('הפעלה ראשונה של התהליך: מסך ההודעות נטען (מאגר הרישוי קיים לפני הסנכרון)', () => {
  const r = spawnSync(process.execPath, ['-e', SCRIPT], { encoding: 'utf8', timeout: 60000 });
  const out = JSON.parse(r.stdout || '{}');
  assert.deepEqual(out, { ok: true }, r.stderr);
});
