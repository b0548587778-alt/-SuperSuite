// קוד שחזור לגיבוי האוטומטי: בלעדיו, תקלה במחשב = אובדן כל הגיבויים האוטומטיים (המפתח מוגן ב-DPAPI).
// החלק הראשון — קידוד טהור; החלק השני — main.js האמיתי עם Electron מדומה, כמו ב-main-behavior.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const A = require('../shell/auto-backup');
const BK = require('../modules/econ/core/backupCrypto');

const newKey = () => crypto.randomBytes(32).toString('base64');

test('קוד ← מפתח ← קוד: 55 תווים בקבוצות של 5, חוזר למפתח המקורי', () => {
  for (let i = 0; i < 50; i++) {
    const k = newKey();
    const code = A.recoveryCodeFromKey(k);
    assert.match(code, /^([0-9A-HJKMNP-TV-Z]{5}-){10}[0-9A-HJKMNP-TV-Z]{5}$/);
    assert.equal(A.keyFromRecoveryCode(code), k);
  }
});

test('הקלדה סלחנית: אותיות קטנות, רווחים, O במקום 0 ו-I/L במקום 1', () => {
  const k = newKey();
  const code = A.recoveryCodeFromKey(k);
  const sloppy = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
  assert.equal(A.keyFromRecoveryCode(sloppy), k);
});

test('טעות הקלדה בתו אחד נתפסת בספרת הביקורת', () => {
  const k = newKey();
  const plain = A.recoveryCodeFromKey(k).replace(/-/g, '');
  let caught = 0;
  for (let i = 0; i < plain.length; i++) {
    const swapped = plain.slice(0, i) + (plain[i] === '2' ? '3' : '2') + plain.slice(i + 1);
    try { if (A.keyFromRecoveryCode(swapped) !== k) caught++; } catch { caught++; }
  }
  assert.equal(caught, plain.length);
});

// רגרסיה: 55 תווים = 275 סיביות ל-272 של מפתח+ביקורת. טעות שנגעה רק בסיביות המילוי של התו האחרון
// עברה בלי שגיאה (פעם בכמה הרצות של הבדיקה הקודמת). כל ערך אחר בתו האחרון — נדחה
test('התו האחרון: כל החלפה נדחית, כולל כזו שמשנה רק את סיביות המילוי', () => {
  const plain = A.recoveryCodeFromKey(newKey()).replace(/-/g, '');
  const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  for (const ch of ALPHA) {
    if (ch === plain[plain.length - 1]) continue;
    assert.throws(() => A.keyFromRecoveryCode(plain.slice(0, -1) + ch), /שגוי/, 'תו אחרון ' + ch);
  }
});

test('סיסמה רגילה אינה מזוהה כקוד', () => {
  assert.equal(A.looksLikeRecoveryCode('סיסמה-ארוכה-מאוד'), false);
  assert.equal(A.looksLikeRecoveryCode('abcdefgh12'), false);
  assert.throws(() => A.keyFromRecoveryCode('12345'), /55 תווים/);
});

// ---------- main.js ----------
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-rk-'));
const handlers = {};
const created = { views: [] };
let readyCallback = null;
const ui = { open: null, errors: [], confirms: [] };

function chainable(props = {}) {
  const target = function () { return chainable(); };
  return new Proxy(target, {
    get(_t, key) {
      if (key in props) return props[key];
      if (key === 'then') return undefined;
      if (key === Symbol.toPrimitive) return () => 0;
      return chainable();
    },
    apply() { return chainable(); },
  });
}
class ViewStub {
  constructor() {
    this.id = created.views.length + 100;
    created.views.push(this);
    this.webContents = chainable({ id: this.id, isDestroyed: () => false, isLoading: () => false, send() {} });
  }
  setVisible() {} setBounds() {}
}
class WinStub {
  constructor() { this.contentView = { addChildView() {} }; this.webContents = chainable({ id: 1, isDestroyed: () => false }); }
  isDestroyed() { return false; } isMaximized() { return false; } isMinimized() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
  getNormalBounds() { return this.getBounds(); } getContentBounds() { return this.getBounds(); }
  getContentSize() { return [1500, 940]; } on() {} removeMenu() {} loadFile() {} maximize() {}
}
// DPAPI מדומה — הפיך, כדי שמפתח הגיבוי יישמר ויקרא
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('dp:' + s, 'utf8'),
  decryptString: (b) => b.toString('utf8').slice(3),
};
const electronStub = {
  app: chainable({
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: (fn) => { readyCallback = fn; return { catch() {} }; } }),
    getPath: () => userData, on() {}, exit() {}, quit() {}, isPackaged: false,
  }),
  BrowserWindow: WinStub, WebContentsView: ViewStub,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  dialog: {
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => (ui.open ? { canceled: false, filePaths: [ui.open] } : { canceled: true, filePaths: [] }),
    showMessageBox: async (_w, o) => { ui.confirms.push((o || _w).message); return { response: 1 }; }, // ביטול אחרי האישור
    showErrorBox: (_t, msg) => { ui.errors.push(msg); },
  },
  protocol: chainable(), net: chainable(), session: chainable(), shell: chainable(), Menu: chainable(), safeStorage,
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_rk__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_rk__.js'] = { id: '/__electron_stub_rk__.js', filename: '/__electron_stub_rk__.js', loaded: true, exports: electronStub };
const realSetTimeout = global.setTimeout, realSetInterval = global.setInterval;
global.setTimeout = (fn, ms, ...r) => realSetTimeout(fn, ms, ...r).unref();
global.setInterval = (fn, ms, ...r) => realSetInterval(fn, ms, ...r).unref();

let ready = null;
const shell = () => ({ sender: { id: 1 } });
function boot() {
  ready = ready || (async () => {
    require(path.join(__dirname, '..', 'main.js'));
    await readyCallback();
    await handlers['shell:switch'](shell(), 'econ');
    const econ = { sender: { id: created.views[0].id } };
    await handlers['auth:setup'](econ, 'menahel', 'menahel-pass-long-1');
    await handlers['auth:login'](econ, 'menahel', 'menahel-pass-long-1');
  })();
  return ready;
}

// גיבוי אוטומטי "ממחשב אחר": מוצפן במפתח שאינו המפתח המקומי
function foreignBackup() {
  const key = newKey();
  const file = path.join(userData, 'auto-foreign-' + crypto.randomBytes(4).toString('hex') + '.ssbk');
  fs.writeFileSync(file, BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', scope: 'all', localStorage: {} }), key), 'utf8');
  return { file, code: A.recoveryCodeFromKey(key) };
}
async function restoreWith(file, pass) {
  ui.open = file; ui.errors = []; ui.confirms = [];
  await handlers['shell:restore-all'](shell(), pass);
  return { reachedConfirm: ui.confirms.some(m => /השחזור יחליף/.test(m)), error: ui.errors[0] || '' };
}

test('מסך הקוד: מוצג רק מהמעטפת, יציב בין קריאות, ותואם למפתח שנשמר', async () => {
  await boot();
  assert.throws(() => handlers['shell:get-recovery-code']({ sender: { id: 999 } }), /מתוך המעטפת בלבד/);
  const a = handlers['shell:get-recovery-code'](shell());
  const b = handlers['shell:get-recovery-code'](shell());
  assert.equal(a, b);
  const stored = safeStorage.decryptString(fs.readFileSync(path.join(userData, 'autobackup.key')));
  assert.equal(A.keyFromRecoveryCode(a), stored);
});

test('תזכורת "טרם נרשם קוד שחזור" נעלמת אחרי אישור', async () => {
  await boot();
  assert.match(handlers['shell:get-backup-status'](shell()), /טרם נרשם קוד שחזור/);
  assert.equal(handlers['shell:recovery-code-saved'](shell()), true);
  assert.doesNotMatch(handlers['shell:get-backup-status'](shell()) || '', /קוד שחזור/);
});

test('שחזור גיבוי אוטומטי ממחשב אחר עם קוד השחזור שלו — נפתח', async () => {
  await boot();
  const { file, code } = foreignBackup();
  const r = await restoreWith(file, code.toLowerCase());
  assert.equal(r.error, '');
  assert.equal(r.reachedConfirm, true, 'הקובץ פוענח והגיע לשלב האישור');
});

test('בלי קוד — הודעה שמזכירה את קוד השחזור; קוד עם טעות — "שגוי"; קוד של גיבוי אחר — "אינו של הגיבוי"', async () => {
  await boot();
  const { file, code } = foreignBackup();
  assert.match((await restoreWith(file, '')).error, /סיסמת גיבוי/);
  const plain = code.replace(/-/g, '');
  const typo = plain.slice(0, 10) + (plain[10] === '2' ? '3' : '2') + plain.slice(11);
  assert.match((await restoreWith(file, typo)).error, /קוד השחזור שגוי/);
  assert.match((await restoreWith(file, foreignBackup().code)).error, /אינו של הגיבוי הזה/);
});

test('גיבוי ידני עם סיסמה רגילה ממשיך לעבוד', async () => {
  await boot();
  const file = path.join(userData, 'manual.ssbk');
  fs.writeFileSync(file, BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', scope: 'all' }), 'סיסמה-של-גיבוי'), 'utf8');
  assert.equal((await restoreWith(file, 'סיסמה-של-גיבוי')).reachedConfirm, true);
});
