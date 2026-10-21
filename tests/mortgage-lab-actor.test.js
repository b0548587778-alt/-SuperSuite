// בדיקת ייעוץ משכנתאות ונדל"ן 21.10.2026 (audit-mortgage-realty.md, ממצא 4): מחיקת תרחיש ולוח הסילוקין שלו
// לא קיבלו את המשתמש — יועץ ייצא (וכשיש לו הרשאת מחיקה — מחק) תרחיש של תיק שמשויך ליועץ אחר
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const handlers = {};
const saves = [];
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_mlab_actor__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_mlab_actor__.js'] = {
  id: '/__electron_stub_mlab_actor__.js', filename: '/__electron_stub_mlab_actor__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async (o) => { saves.push(o && o.defaultPath); return { canceled: true }; } } }
};
const ipc = require('../modules/econ/ipc');
const { MortgageLabService } = require('../modules/econ/services/mortgageLabService');
const ev = (id) => ({ sender: { id } });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-mlab-actor-'));
test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* המסד פתוח */ } });

const MIX = [{ type: 'FIXED_UNLINKED', repayment: 'SPITZER', amount: 500000, years: 20, ratePct: 4.5 }];

test('ממצא 4: יועץ לא מייצא ולא מוחק תרחיש של תיק שמשויך ליועץ אחר; בעל התיק והמנהל — כן', async () => {
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(81), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(81), 'menahel', 'menahel-strong-pass-1');
  const ua = await handlers['users:create'](ev(81), { username: 'yoetz_a', password: 'yoetz-a-strong-pass', role: 'editor' });
  const ub = await handlers['users:create'](ev(81), { username: 'yoetz_b', password: 'yoetz-b-strong-pass', role: 'editor' });
  await handlers['auth:login'](ev(82), 'yoetz_a', 'yoetz-a-strong-pass');
  await handlers['auth:login'](ev(83), 'yoetz_b', 'yoetz-b-strong-pass');

  const cb = await handlers['madv:createClient'](ev(83), { name: 'משפחת שפירא', requestedAmount: 500000 });
  const sc = await handlers['mlab:saveScenario'](ev(83), { name: 'תמהיל לשפירא', clientId: cb.id, tracks: MIX });
  assert.equal((await handlers['mlab:getOverview'](ev(82))).scenarios.length, 0, 'יועץ א לא רואה את התרחיש');

  // ייצוא: לפני התיקון — חלון השמירה נפתח עם לוח הסילוקין של התיק של יועץ ב
  saves.length = 0;
  await assert.rejects(handlers['mlab:exportScenario'](ev(82), sc.id), /התרחיש לא נמצא/);
  assert.deepEqual(saves, [], 'לא נפתח חלון שמירה');
  const own = await handlers['mlab:exportScenario'](ev(83), sc.id);
  assert.equal(own.ok, false, 'בעל התיק — חלון השמירה נפתח (ובוטל בבדיקה)');
  assert.equal(saves.length, 1);

  // מחיקה: עורך אינו מוחק בכלל (data.delete); השירות עצמו בודק את המשתמש גם הוא
  const actorA = { id: ua.id, username: 'yoetz_a', isManager: false };
  await assert.rejects(MortgageLabService.deleteScenario(sc.id, actorA), /התרחיש לא נמצא/);
  await assert.rejects(MortgageLabService.getScenarioExport(sc.id, actorA), /התרחיש לא נמצא/);
  assert.equal((await handlers['mlab:getOverview'](ev(83))).scenarios.length, 1, 'התרחיש לא נמחק');
  assert.ok(await MortgageLabService.getScenarioExport(sc.id, { id: ub.id, isManager: false }));

  // תרחיש בלי תיק — גלוי לכולם, כמו ברשימה
  const free = await handlers['mlab:saveScenario'](ev(83), { name: 'בלי תיק', tracks: MIX });
  assert.ok(await MortgageLabService.getScenarioExport(free.id, actorA));

  await handlers['mlab:deleteScenario'](ev(81), sc.id);
  assert.deepEqual((await handlers['mlab:getOverview'](ev(83))).scenarios.map(s => s.name), ['בלי תיק'], 'מנהל מוחק');
});
