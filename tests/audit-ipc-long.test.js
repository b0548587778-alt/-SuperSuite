// בדיקת קוד 23.10.2026, ממצא 39: חלונות שמירה ובחירה, יצירת PDF, פניות לשרת (רישוי, הודעות, הרשמה), הורדת עדכון
// ושאלה למודל ה-AI המקומי רצו בתוך enqueue() — וכל המודול הכלכלי קפא עד שהסתיימו (עד כמה דקות).
// כאן: (1) בדיקה סטטית — אף ערוץ שנרשם ב-handle() (התור) לא ממתין לחלון, לרשת, לעדכון או למודל;
// (2) בדיקה התנהגותית — בזמן ההמתנה ערוץ קצר בתור עונה מיד; (3) הפניות לשרת עדיין אחת-אחת, והמנעולים חוסמים פעולה כפולה
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ipc.js'), 'utf8');

// ---------- (1) סטטי ----------
// פעולות ארוכות: חלון של המערכת, PDF, שרת הרישוי (חוץ מקריאות מקומיות), עדכון, המודל המקומי, רשת
const LONG_OPS = /\bdialog\.|\brenderPdf\(|printToPDF|\bpickSavePath\(|\blicenseSync\.(?!myContacts\b|dismissChildRequest\b)|\bupdateManager\.(?:download|fromFile)\b|\baiAssistant\.(?:run|ask|search|model\.(?:install|verify|remove))\b|\bfetch(?:Impl)?\(|\bgoogleDeps\.signIn\b/;
const word = (name) => new RegExp('\\b' + name + '\\b');

// הבלוק שמתחיל בשורה של start: עד השורה הבאה שההזחה שלה אינה עמוקה ממנה
function blockOf(src, start) {
  const lineStart = src.lastIndexOf('\n', start) + 1;
  const lines = src.slice(lineStart).split('\n');
  const indent = lines[0].match(/^ */)[0].length;
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() && lines[i].match(/^ */)[0].length <= indent) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

// ערוצים בתור (handle) שממתינים לפעולה ארוכה — ישירות או דרך פונקציית עזר (גם עזר של עזר)
function queuedLongChannels(src) {
  const defs = [];
  const defRe = /^ *(?:async\s+)?function\s+(\w+)\s*\(|^ *(?:(?:const|let)\s+)?(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/gm;
  let m;
  while ((m = defRe.exec(src))) defs.push({ name: m[1] || m[2], body: blockOf(src, m.index) });
  const longHelpers = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const d of defs) {
      if (longHelpers.has(d.name)) continue;
      if (LONG_OPS.test(d.body) || [...longHelpers].some(n => n !== d.name && word(n).test(d.body))) { longHelpers.add(d.name); changed = true; }
    }
  }
  const out = [];
  const regRe = /(?<![\w.])handle\(\s*(['`])([^'`]+)\1/g;
  while ((m = regRe.exec(src))) {
    const body = blockOf(src, m.index);
    const op = body.match(LONG_OPS);
    const helper = [...longHelpers].find(n => word(n).test(body));
    if (op || helper) out.push(`${m[2]} ← ${op ? op[0] : helper}`);
  }
  return out;
}

test('ממצא 39 — הבודק עצמו מזהה ערוץ בתור שממתין לחלון, לרשת, ל-PDF או למודל (גם דרך פונקציית עזר)', () => {
  const sample = [
    "  async function saveThing(x) {",
    "    const r = await dialog.showSaveDialog({ defaultPath: x });",
    "    return r;",
    "  }",
    "  const viaHelper = async () => saveThing('a');",
    "  handle('a:direct', async () => {",
    "    const r = await licenseSync.receive();",
    "    return r;",
    "  });",
    "  handle('a:helper', async () => viaHelper());",
    "  handle('a:ai', async (event, q) => aiAssistant.run(q, {}));",
    "  handle('a:local', async () => licenseSync.myContacts());",
    "  handle('a:fine', async () => db.load());",
    "",
  ].join('\n');
  const found = queuedLongChannels(sample).map(s => s.split(' ← ')[0]);
  assert.deepEqual(found, ['a:direct', 'a:helper', 'a:ai']);
});

test('ממצא 39 — אף ערוץ שנרשם ב-handle() (בתוך התור) לא ממתין לחלון, ל-PDF, לשרת, לעדכון או למודל המקומי', () => {
  assert.deepEqual(queuedLongChannels(SRC), [], 'ערוצים כאלה עוברים ל-handleLong / handleSave / handleNet');
  // העזרים הישנים שהציגו חלון בתוך התור — הוסרו
  assert.doesNotMatch(SRC, /function saveHtmlAsPdf|function saveCsv\(|function saveLicenseFile/);
  // הערוצים שעברו — עדיין רשומים (דרך השומר של runLong)
  for (const ch of ['license:saveFile', 'license:requestChildApproval', 'license:remoteRequest', 'license:remoteRequestFromParent',
    'license:remoteSync', 'license:remoteForwardChild', 'license:remotePushChild', 'owner:remoteReceive', 'owner:inboxIssue',
    'owner:inboxApprove', 'owner:inboxReject', 'owner:remotePush', 'license:getOffer', 'license:signup', 'license:signupStatus',
    'owner:exportBackup', 'owner:publishOffer', 'owner:signupIssue', 'owner:signupDocument', 'update:download', 'update:fromFile',
    'owner:releaseCreate', 'owner:releasePublish', 'chat:thread', 'chat:send', 'chat:edit', 'chat:deleteForAll', 'chat:forward',
    'chat:broadcast', 'chat:publishProfile', 'chat:saveAttachment', 'chat:refresh', 'audit:export', 'ports:export',
    'ports:exportTemplate', 'ports:exportVcard', 'ai:run', 'ai:search']) {
    assert.match(SRC, new RegExp(`handle(?:Long|Save|Net)\\('${ch}'`), ch);
  }
});

// ---------- (2) התנהגותי ----------
const handlers = {};
const probes = { dialog: 0, pdf: 0, fetch: 0, ai: 0 };
const blocked = [];
let current = '';
let holdDialog = null; // Promise — חלון שנשאר פתוח עד שמשחררים אותו
let fetchMode = 'fail'; // fail — מיד; slow — עיכוב קצר, למדידת פניות במקביל
let holdFetch = null; // Promise — פנייה לשרת שנשארת תלויה (מחזיקה את התור של השרת) עד שמשחררים אותה
let inFlight = 0;
let maxInFlight = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// ערוץ שלא ענה בזמן (התור תפוס) — כשל ברור במקום בדיקה תקועה
const within = (p, ms = 3000) => Promise.race([p, sleep(ms).then(() => { throw new Error('התור תפוס — הערוץ לא ענה בזמן'); })]);
const ev = { sender: { id: 391 } };

// ערוץ קצר בתור. אם הערוץ הארוך מחזיק את התור — הוא לא יענה עד שההמתנה תסתיים
async function queueFree() {
  return Promise.race([handlers['auth:status'](ev).then(() => true, () => true), sleep(1500).then(() => false)]);
}
async function probe(kind) {
  probes[kind]++;
  if (!(await queueFree())) blocked.push(`${current} (${kind})`);
}

Module._resolveFilename_ipcLong = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_ipclong__.js' : Module._resolveFilename_ipcLong.call(this, req, ...rest); };
require.cache['/__electron_stub_ipclong__.js'] = { id: '/__electron_stub_ipclong__.js', filename: '/__electron_stub_ipclong__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: {
      showSaveDialog: async () => { await probe('dialog'); if (holdDialog) await holdDialog; return { canceled: true }; },
      showOpenDialog: async () => { await probe('dialog'); if (holdDialog) await holdDialog; return { canceled: true, filePaths: [] }; },
    },
    BrowserWindow: class {
      constructor() { this.webContents = { printToPDF: async () => { await probe('pdf'); return Buffer.from('%PDF-1.4'); } }; }
      async loadURL() {}
      destroy() {}
    },
    app: { isPackaged: false },
  } };

// עוזר ה-AI האמיתי, עם בדיקה בכל שאלה / חיפוש (המודל המקומי עונה עד כמה דקות)
const aiPath = require.resolve('../shell/ai');
const realAI = require('../shell/ai');
require.cache[aiPath].exports = { ...realAI, createAI: (opts) => {
  const a = realAI.createAI(opts);
  return { ...a, run: async (q, ctx) => { await probe('ai'); return a.run(q, ctx); }, search: async (q, ctx) => { await probe('ai'); return a.search(q, ctx); } };
} };

const ipc = require('../modules/econ/ipc');

// שרת שאינו זמין — כל פנייה נכשלת (אחרי הבדיקה)
async function fetchImpl() {
  await probe('fetch');
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    if (fetchMode === 'slow') await sleep(60);
    if (holdFetch) await holdFetch;
    throw new Error('offline');
  } finally { inFlight--; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ipc-long-'));
test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* קובץ המסד פתוח — run-tests.js מנקה */ } });
const OWNER_PASS = 'owner-pass-long-2026';
// תיבת הודעות בזיכרון, עם הודעה נכנסת אחת שלא נקראה (לבדיקת chat:thread ואישור הקריאה)
const READ_PEER = 'p-read';
let chatText = JSON.stringify({ v: 2, meta: {}, settings: {}, messages: [
  { mid: 'm-read-1', peer: READ_PEER, subject: '', text: 'שלום וברכה', sentAt: Date.now() - 1000, dir: 'in', receivedAt: Date.now() - 1000, read: false },
] });
const chatStorage = { read: () => chatText, write: (t) => { chatText = t; } };
const ready = (async () => {
  let secret = null;
  await ipc.initEcon(dir, { rootKeys: [], relayUrl: 'https://relay.invalid', fetchImpl, chatStorage,
    licenseSecret: { read: () => secret, write: (t) => { secret = t; } } });
  await handlers['auth:setup'](ev, 'menahel_arokh', 'a-very-long-pass-2026');
  await handlers['owner:init'](ev, OWNER_PASS);
})();

async function call(ch, ...args) {
  current = ch;
  const before = Object.values(probes).reduce((a, b) => a + b, 0);
  let err = null;
  const out = await handlers[ch](ev, ...args).catch(e => { err = e; return null; });
  const reached = Object.values(probes).reduce((a, b) => a + b, 0) > before;
  return { out, err, reached };
}

test('ממצא 39 — בזמן חלון שמירה / בחירה, PDF, פנייה לשרת ושאלה לעוזר — התור פנוי לשאר המערכת', async () => {
  await ready;
  const cases = [
    // חלונות שמירה
    ['audit:export'], ['ports:export', 'contacts'], ['ports:exportTemplate', 'contacts'], ['ports:exportVcard'],
    ['license:saveFile', '{"type":"x"}', 'בקשה'], ['owner:exportBackup', OWNER_PASS], ['npo:exportMemorialsCsv'],
    // PDF ואז חלון שמירה
    ['privacy:exportDefinitionPdf'],
    // חלונות בחירה
    ['update:fromFile'], ['owner:releaseCreate', { version: '9.9.9' }], ['owner:modelSign', {}], ['acct:setLogo'],
    ['rlty:readTaxTableFile'], ['ai:model:install'],
    // שרת הרישוי
    ['license:remoteRequest', 'קהילת אור'], ['license:remoteRequestFromParent', 'סניף', 'A'.repeat(22)], ['license:getOffer'],
    ['owner:remoteReceive'], ['license:remoteSync'], ['chat:refresh'],
    // עוזר ה-AI
    ['ai:run', 'כמה גבייתי החודש?'], ['ai:search', 'מסך שאינו קיים בכלל'],
  ];
  const notReached = [];
  for (const [ch, ...args] of cases) {
    const r = await call(ch, ...args);
    if (!r.reached) notReached.push(`${ch}: ${r.err ? r.err.message : 'בלי המתנה'}`);
    // ביטול / כשל רשת — הודעה בעברית (לא השגיאה הגולמית)
    if (r.err) assert.match(r.err.message, /[֐-׿]/, ch);
  }
  assert.deepEqual(notReached, [], 'כל ערוץ הגיע לחלון / לשרת / לעוזר');
  assert.deepEqual(blocked, [], 'ערוצים שהחזיקו את התור בזמן ההמתנה');

  // ביטול בחלון השמירה — בלי קובץ ובלי רישום
  assert.deepEqual((await call('audit:export')).out, { ok: false });
  // מהמעטפת (shellCall) — אותה הפרדה
  current = 'shellCall:ai:run';
  const n = probes.ai;
  const a = await ipc.shellCall('ai:run', ev.sender.id, 'איך מוציאים חשבונית?');
  assert.ok(a && a.text, 'תשובה מהעוזר');
  assert.equal(probes.ai, n + 1);
  assert.deepEqual(blocked, []);
});

test('ממצא 39 — הפניות לשרת הרישוי עדיין אחת-אחת (גם מול הקבלה האוטומטית), והתור פנוי בינתיים', async () => {
  await ready;
  await handlers['chat:saveSettings'](ev, { autoFetch: true });
  fetchMode = 'slow';
  maxInFlight = 0;
  try {
    current = 'parallel';
    const all = Promise.all([
      handlers['license:getOffer'](ev).catch(e => e),
      handlers['license:getOffer'](ev).catch(e => e),
      handlers['license:remoteSync'](ev).catch(e => e),
      ipc.chatAutoFetch(),
    ]);
    // בזמן שהפניות ממתינות — ערוץ קצר בתור עונה
    assert.equal(await queueFree(), true);
    const [x, y, s, auto] = await all;
    assert.ok(x instanceof Error && y instanceof Error && s instanceof Error);
    assert.ok(auto && auto.systemError, 'הקבלה האוטומטית ניסתה והגיעה לשרת');
    assert.equal(maxInFlight, 1, 'אף פעם שתי פניות לשרת במקביל');
    assert.deepEqual(blocked, []);
  } finally { fetchMode = 'fail'; }
});

test('ממצא 39 (סקירה) — chat:thread לא מחכה לאישור הקריאה מאחורי פנייה ארוכה לשרת; האישור נשלח אחריה, בתור של השרת', async () => {
  await ready;
  let release;
  holdFetch = new Promise(r => { release = r; });
  try {
    current = 'thread';
    const f0 = probes.fetch;
    // פנייה לשרת שמחזיקה את התור של השרת (כמו קבלה אוטומטית או קובץ מצורף גדול)
    const offer = handlers['license:getOffer'](ev).catch(e => e);
    while (probes.fetch === f0) await sleep(5);
    // פתיחת השיחה עונה מיד, בלי לחכות שהפנייה תסתיים
    const t = await within(handlers['chat:thread'](ev, READ_PEER, ''), 1000);
    assert.deepEqual(t.messages.map(m => m.mid), ['m-read-1']);
    assert.equal(typeof t.now, 'number');
    // גם הקבלה האוטומטית לא עוקפת את התור של השרת — וגם היא לא מעכבת את פתיחת השיחה
    await handlers['chat:saveSettings'](ev, { autoFetch: true });
    const auto = ipc.chatAutoFetch();
    assert.ok(await within(handlers['chat:thread'](ev, READ_PEER, ''), 1000));
    release();
    assert.ok((await offer) instanceof Error);
    await auto;
    // אישור הקריאה (סימון מקומי + שליחה לשולח) רץ בתור של השרת אחרי הפניות שלפניו
    for (let i = 0; i < 100; i++) {
      if ((await handlers['chat:overview'](ev, '')).unread === 0) break;
      await sleep(10);
    }
    assert.equal((await handlers['chat:overview'](ev, '')).unread, 0, 'ההודעה סומנה כנקראה');
    assert.deepEqual(blocked, []);
  } finally { holdFetch = null; if (release) release(); }
});

test('ממצא 39 — מנעול: עדכון אחד בכל פעם; ערוץ שמירה אחד בכל פעם; התור פנוי בזמן שהחלון פתוח', async () => {
  await ready;
  let release;
  holdDialog = new Promise(r => { release = r; });
  try {
    current = 'lock';
    const d0 = probes.dialog;
    const opened = handlers['update:fromFile'](ev);
    while (probes.dialog === d0) await sleep(5);
    await assert.rejects(within(handlers['update:download'](ev)), /פעולת עדכון כבר מתבצעת/);
    const d1 = probes.dialog;
    const save = handlers['audit:export'](ev);
    while (probes.dialog === d1) await sleep(5);
    await assert.rejects(within(handlers['audit:export'](ev)), /חלון השמירה כבר פתוח/);
    // בזמן ששני החלונות פתוחים — המערכת עובדת
    assert.equal(await queueFree(), true);
    assert.ok(await within(handlers['acct:getSettings'](ev)));
    release();
    assert.deepEqual(await opened, { ok: false });
    assert.deepEqual(await save, { ok: false });
  } finally { holdDialog = null; if (release) release(); }
  // אחרי השחרור — המנעול פתוח
  assert.deepEqual(await handlers['update:fromFile'](ev), { ok: false });
});
