// המודל המקומי של העוזר: מנוע תהליך העזר (engines/local-llm.js), חבילת המודל החתומה (model-pack.js),
// הניתוב „כללים קודם” והזכאות ברישיון 'ai.local' (router.js), ועיגון המספרים (grounding.js).
// בלי node-llama-cpp ובלי מודל: תהליך העזר מדומה (tests/helpers/mock-llm.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const L = require(path.join(ROOT, 'shell/licensing/license'));
const MP = require(path.join(ROOT, 'shell/ai/model-pack'));
const router = require(path.join(ROOT, 'shell/ai/router'));
const T = require(path.join(ROOT, 'shell/ai/tools'));
const { checkGrounded } = require(path.join(ROOT, 'shell/ai/grounding'));
const { createLocalEngine } = require(path.join(ROOT, 'shell/ai/engines/local-llm'));
const { createAI } = require(path.join(ROOT, 'shell/ai'));
const { createMockFork, fakeStore } = require('./helpers/mock-llm');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const LICENSED = { mode: 'licensed', status: 'active', features: ['ai', 'ai.local'] };

// קובץ GGUF מזויף (כותרת אמיתית + בתים) ותעודה חתומה עליו
function fakeModel(dir, { magic = 'GGUF', bytes = 4096 } = {}) {
  const file = path.join(dir, 'dictalm.gguf');
  const buf = Buffer.concat([Buffer.from(magic, 'latin1'), crypto.randomBytes(bytes - 4)]);
  fs.writeFileSync(file, buf);
  return { file, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
}
const root = L.generateKeyPair();
const manifestFor = (m, extra = {}) => MP.createModelManifest(root.privateJwk, {
  id: 'dictalm-3.0-1.7b-instruct-q4km', name: 'DictaLM 3.0 1.7B Instruct', fileName: 'dictalm.gguf',
  sha256: m.sha256, size: m.size, license: 'Apache-2.0', quant: 'Q4_K_M', contextSize: 4096, ...extra,
});

// ---------- חבילת המודל ----------
test('model-pack: תעודה חתומה מאומתת מול מפתח השורש; מפתח אחר או שינוי בתוכן — נדחים', () => {
  const m = { sha256: 'a'.repeat(64), size: 1000 };
  const text = manifestFor(m);
  assert.equal(MP.verifyModelManifest(text, [root.publicJwk]).id, 'dictalm-3.0-1.7b-instruct-q4km');
  assert.throws(() => MP.verifyModelManifest(text, [L.generateKeyPair().publicJwk]), /חתימת המודל אינה תקינה/);
  assert.throws(() => MP.verifyModelManifest(text, []), /מפתח מנהל-העל אינו מוגדר/);
  const forged = JSON.parse(text);
  forged.payload.sha256 = 'b'.repeat(64);
  assert.throws(() => MP.verifyModelManifest(JSON.stringify(forged), [root.publicJwk]), /חתימת המודל אינה תקינה/);
  // תעודת עדכון גרסה אינה תעודת מודל
  assert.throws(() => MP.verifyModelManifest(JSON.stringify({ type: 'supersuite-update', payload: {}, sig: 'x' }), [root.publicJwk]), /אינו תעודת מודל/);
});

test('model-pack: תקרת 3GB, GGUF בלבד, מזהה תקין', () => {
  assert.throws(() => manifestFor({ sha256: 'a'.repeat(64), size: MP.MAX_SIZE + 1 }), /עד 3GB/);
  assert.throws(() => manifestFor({ sha256: 'a'.repeat(64), size: 10 }, { fileName: 'model.bin' }), /GGUF/);
  assert.throws(() => manifestFor({ sha256: 'a'.repeat(64), size: 10 }, { id: '../etc' }), /מזהה/);
});

test('model-pack: התקנה מ-USB — העתקה עם אימות, ואז המודל „קיים”', async () => {
  const src = tmp('ai-usb-'), dest = path.join(tmp('ai-ud-'), 'ai-models');
  const m = fakeModel(src);
  const store = MP.createModelStore({ fs, dir: dest, rootKeys: [root.publicJwk] });
  assert.equal((await store.current()).present, false);
  const r = await store.install(manifestFor(m), m.file);
  assert.equal(r.id, 'dictalm-3.0-1.7b-instruct-q4km');
  assert.ok(fs.existsSync(path.join(dest, 'dictalm-3.0-1.7b-instruct-q4km.gguf')));
  const cur = await store.current();
  assert.equal(cur.present, true);
  assert.equal(cur.manifest.license, 'Apache-2.0');
  // הקובץ שונה בדיסק אחרי ההתקנה — לא נטען בלי אימות מלא, והאימות המלא דוחה אותו
  fs.appendFileSync(cur.path, 'x');
  assert.equal((await store.current()).present, false);
  assert.equal((await store.current({ deep: true })).present, false);
  await store.remove();
  assert.equal(fs.existsSync(cur.path), false);
});

test('model-pack: הסרה כשקובץ המודל עוד פתוח (Windows) — ממתינה, ולא מוחקת את התעודה לפני הקובץ', async () => {
  const src = tmp('ai-usb-'), dest = path.join(tmp('ai-ud-'), 'ai-models');
  const m = fakeModel(src);
  // fs שבו קובץ ה-GGUF „תפוס” (EPERM) מספר פעמים — כמו תהליך המודל שזה עתה נעצר
  let busy = 0;
  const lockedFs = Object.assign(Object.create(fs), { unlinkSync: (f) => {
    if (f.endsWith('.gguf') && busy > 0) { busy--; throw Object.assign(new Error('busy'), { code: 'EPERM' }); }
    return fs.unlinkSync(f);
  } });
  const store = MP.createModelStore({ fs: lockedFs, dir: dest, rootKeys: [root.publicJwk], retry: { tries: 3, waitMs: 1 } });
  await store.install(manifestFor(m), m.file);
  const gguf = (await store.current()).path;
  busy = 2;
  assert.deepEqual(await store.remove(), { present: false }, 'משתחרר בניסיון השלישי');
  assert.equal(fs.existsSync(gguf), false);
  assert.equal(fs.existsSync(path.join(dest, 'model.ssmodel')), false);

  await store.install(manifestFor(m), m.file);
  busy = 99;
  await assert.rejects(store.remove(), /עדיין בשימוש/);
  assert.ok(fs.existsSync(gguf), 'הקובץ נשאר');
  assert.equal((await store.current()).present, true, 'התעודה נשארה — אפשר לנסות שוב, ואין קובץ יתום');
  busy = 0;
  await store.remove();
  assert.equal(fs.existsSync(gguf), false);
});

test('model-pack: קובץ שאינו תואם לתעודה, או שאינו GGUF — נדחה ולא נשאר בדיסק', async () => {
  const src = tmp('ai-usb-'), dest = path.join(tmp('ai-ud-'), 'ai-models');
  const store = MP.createModelStore({ fs, dir: dest, rootKeys: [root.publicJwk] });
  const m = fakeModel(src);
  await assert.rejects(store.install(manifestFor({ ...m, sha256: 'c'.repeat(64) }), m.file), /אינו תואם לתעודה/);
  await assert.rejects(store.install(manifestFor({ ...m, size: m.size + 1 }), m.file), /גודל/);
  const bad = fakeModel(tmp('ai-usb-'), { magic: 'MZ\u0090\u0000' });
  await assert.rejects(store.install(manifestFor(bad), bad.file), /אינו מודל GGUF/);
  assert.deepEqual(fs.existsSync(dest) ? fs.readdirSync(dest) : [], []);
});

// ---------- הבורר והזכאות ----------
test('router: זכאות למודל המקומי רק ברישיון פעיל עם ai.local', () => {
  assert.equal(router.localLicensed(LICENSED), true);
  assert.equal(router.localLicensed(null), false);
  assert.equal(router.localLicensed({ mode: 'unlicensed' }), false, 'תוסף בתשלום — לא במצב פתוח');
  assert.equal(router.localLicensed({ mode: 'licensed', status: 'active', features: ['ai', 'ai.cloud'] }), false);
  assert.equal(router.localLicensed({ ...LICENSED, status: 'trial_ended' }), false);
});

test('router: כללים קודם — שאלה מוכרת לכללים לא מגיעה למודל; ניסוח וסיכום — למודל', () => {
  const R = require(path.join(ROOT, 'shell/ai/rules'));
  const route = (q, localReady = true) => router.routeQuestion({ task: router.detectTask(q), intent: R.detectIntent(q), domain: R.detectDomain(q), localReady });
  assert.equal(route('מי לא שילם?'), 'rules');
  assert.equal(route('כמה גבייתי החודש?'), 'rules');
  assert.equal(route('אילו תורמים תרמו השנה?'), 'rules');
  assert.equal(route('תן לי תמונת מצב של העסק'), 'local');
  assert.equal(route('נסח מכתב תודה לתורם'), 'local');
  assert.equal(route('סכם את הדוח החודשי'), 'local');
  assert.equal(route('נסח מכתב תודה לתורם', false), 'rules', 'בלי מודל מוכן — תמיד כללים');
  assert.equal(router.detectTask('נסח נוסח קבלה'), 'letter');
  assert.equal(router.detectTask('מה המצב?'), 'answer');
});

// ---------- עיגון מספרים ----------
test('grounding: מספר שלא הגיע מכלי — נדחה; סכום שהועתק — מתקבל בכל צורת כתיבה', () => {
  const src = [{ total: '₪18,000.00', count: 3 }];
  assert.equal(checkGrounded('נותרו 3 חשבוניות בסך ₪18,000.00', src).ok, true);
  assert.equal(checkGrounded('בסך 18000 ש"ח', src).ok, true, '18000 = 18,000.00');
  assert.deepEqual(checkGrounded('ההכנסות יהיו ₪20,000', src).invented, ['20,000']);
  assert.equal(checkGrounded('צמיחה של 7%', src).ok, false, 'אחוז קטן — עדיין נבדק');
  assert.equal(checkGrounded('1. ראשון\n2. שני', []).ok, true, 'מספור רשימה מותר');
  assert.equal(checkGrounded('אין נתונים', []).ok, true);
});

// ---------- הכלים ----------
test('tools: תחום סגור — הכלי לא מוצג למודל, וקריאה ישירה מחזירה שגיאה בלי נתונים', () => {
  const ctx = { opened: { acct: false, npo: true }, summary: { income: 5000 }, npo: { donors: [] } };
  const names = T.toolsFor(ctx).map(t => t.name);
  assert.ok(!names.includes('period_summary'));
  assert.ok(names.includes('donors_summary'));
  const r = T.callTool('period_summary', {}, ctx);
  assert.match(r.error, /אינו פתוח/);
  assert.equal(JSON.stringify(r).includes('5000'), false);
  assert.match(T.callTool('drop_table', {}, ctx).error, /לא מוכר/);
});

// ---------- מנוע תהליך העזר ----------
const engineWith = (script, opts = {}, options = {}) => {
  const fork = createMockFork(script, opts);
  const engine = createLocalEngine({ modelStore: fakeStore(), fork, hasRuntime: () => true, options });
  return { engine, fork };
};

test('engine: טעינה עצלה — אין תהליך עד השאלה הראשונה; כלי מבוצע בתהליך הראשי', async () => {
  const { engine, fork } = engineWith(() => ({ calls: [{ name: 'echo', args: { a: 1 } }], answer: 'קיבלתי {{echo.v}}' }));
  await engine.refresh();
  assert.equal(engine.status().mode, 'ready');
  assert.equal(fork.forks.length, 0);
  const seen = [];
  const out = await engine.chat({ system: 's', prompt: 'p', tools: [{ name: 'echo', description: 'd', params: {} }], onTool: (n, a) => { seen.push([n, a]); return { v: 'שלום' }; } });
  assert.equal(out.text, 'קיבלתי שלום');
  assert.deepEqual(seen, [['echo', { a: 1 }]]);
  assert.equal(fork.forks.length, 1);
  assert.equal(fork.forks[0].sent[0].t, 'load');
  assert.equal(fork.forks[0].sent[0].modelPath, '/models/dictalm.gguf');
  engine.stop();
  assert.equal(fork.forks[0].killed, true);
});

test('engine: המודל מבקש כלי שלא הוצע לו — מקבל שגיאה, והתהליך הראשי לא מריץ דבר', async () => {
  const { engine } = engineWith(() => ({ calls: [{ name: 'secret' }], answer: '{{secret.error}}' }));
  let ran = false;
  const out = await engine.chat({ system: 's', prompt: 'p', tools: [], onTool: () => { ran = true; return {}; } });
  assert.equal(ran, false);
  assert.match(out.text, /לא מוכר/);
  assert.deepEqual(out.toolCalls, []);
  engine.stop();
});

test('engine: זמן קצוב — התהליך נהרג, והשאלה הבאה טוענת מחדש', async () => {
  const fork = createMockFork(() => ({ calls: [], answer: 'בסדר' }), { hang: true });
  const engine = createLocalEngine({ modelStore: fakeStore(), fork, hasRuntime: () => true, options: { chatTimeoutMs: 50 } });
  await assert.rejects(engine.chat({ system: 's', prompt: 'p', onTool: () => ({}) }), /לא ענה בזמן/);
  assert.equal(fork.forks[0].killed, true);
  assert.equal(engine.status().running, false);
  engine.stop();
});

test('engine: קריסת תהליך המודל — השאלה נכשלת בשקט והמצב „degraded”', async () => {
  const { engine } = engineWith(() => ({}), { crashOnChat: true });
  await assert.rejects(engine.chat({ system: 's', prompt: 'p', onTool: () => ({}) }), /נסגר/);
  assert.equal(engine.status().mode, 'degraded');
  engine.stop();
});

test('engine: בלי מודל מותקן או בלי רכיב הריצה — „unavailable”, ולא נוצר תהליך', async () => {
  const fork = createMockFork(() => ({}));
  const none = createLocalEngine({ modelStore: fakeStore(false), fork, hasRuntime: () => true });
  await none.refresh();
  assert.equal(none.status().mode, 'unavailable');
  await assert.rejects(none.chat({ prompt: 'p', onTool: () => ({}) }), /אינו מותקן/);
  const noRuntime = createLocalEngine({ modelStore: fakeStore(), fork, hasRuntime: () => false });
  await noRuntime.refresh();
  assert.equal(noRuntime.status().mode, 'unavailable');
  assert.equal(fork.forks.length, 0);
});

test('engine: שאלות במקביל רצות בתור — אחת אחרי השנייה, בתהליך אחד', async () => {
  let active = 0, peak = 0;
  const { engine, fork } = engineWith((msg) => ({ calls: [{ name: 'slow' }], answer: msg.prompt }));
  const onTool = async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 10)); active--; return {}; };
  const tools = [{ name: 'slow', description: 'd', params: {} }];
  const outs = await Promise.all(['א', 'ב', 'ג'].map(p => engine.chat({ system: 's', prompt: p, tools, onTool })));
  assert.deepEqual(outs.map(o => o.text), ['א', 'ב', 'ג']);
  assert.equal(peak, 1);
  assert.equal(fork.forks.length, 1);
  engine.stop();
});

// ---------- העוזר כולו ----------
test('createAI: שגיאה במודל — התשובה מגיעה מהכללים, עם סיבה', async () => {
  const { engine } = engineWith(() => ({}), { failLoad: true });
  const ai = createAI({ userDataPath: tmp('ai-ud-'), getBackupKey: () => null, licenseState: () => LICENSED, localEngine: engine });
  await engine.refresh();
  const r = await ai.run('תן לי תמונת מצב של העסק', { today: '2026-10-22', opened: { acct: true }, summary: { income: 100, expenses: 0 }, invoices: [] });
  assert.equal(r.engine, 'rules');
  assert.equal(r.fallback, 'local-error');
  ai.dispose();
});

test('createAI: הסתרת מזהים — ת״ז בשאלה לא מגיעה למודל, ולא חוזרת בתשובה', async () => {
  let prompt = '';
  const { engine } = engineWith((msg) => { prompt = msg.prompt; return { calls: [], answer: 'טלפון 050-1234567 נמחק' }; });
  const ai = createAI({ userDataPath: tmp('ai-ud-'), getBackupKey: () => null, licenseState: () => LICENSED, localEngine: engine });
  await engine.refresh();
  const r = await ai.run('תמונת מצב ללקוח 123456789 בבקשה', { today: '2026-10-22', opened: {} });
  assert.ok(!prompt.includes('123456789'));
  assert.ok(prompt.includes('[ת״ז]'));
  assert.ok(!r.text.includes('050-1234567'));
  ai.dispose();
});

test('createAI: התקנת מודל דורשת רישיון ai.local', async () => {
  const ai = createAI({ userDataPath: tmp('ai-ud-'), getBackupKey: () => null, licenseState: () => ({ mode: 'licensed', status: 'active', features: ['ai'] }), rootKeys: [root.publicJwk] });
  const m = fakeModel(tmp('ai-usb-'));
  await assert.rejects(ai.model.install(manifestFor(m), m.file), /אינו כלול ברישיון/);
  ai.dispose();
});

test('createAI: התקנה אמיתית מקובץ ← המודל מוכן, וברירת המחדל לא פותחת תהליך עד שאלה', async () => {
  const ai = createAI({ userDataPath: tmp('ai-ud-'), getBackupKey: () => null, licenseState: () => LICENSED, rootKeys: [root.publicJwk] });
  const m = fakeModel(tmp('ai-usb-'));
  const r = await ai.model.install(manifestFor(m), m.file);
  assert.equal(r.id, 'dictalm-3.0-1.7b-instruct-q4km');
  const st = ai.status().local;
  assert.equal(st.present, true);
  assert.equal(st.running, false);
  assert.equal(st.model.license, 'Apache-2.0');
  await ai.model.remove();
  assert.equal(ai.status().local.present, false);
  ai.dispose();
});

// ---------- בלי רשת ----------
test('קבצי המודל המקומי: אין רשת, אין כתובות, ו-node-llama-cpp נטען רק בתהליך העזר', () => {
  const dir = path.join(ROOT, 'shell/ai');
  const files = ['index.js', 'tools.js', 'grounding.js', 'model-pack.js', 'engines/local-llm.js', 'engines/llm-worker.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const word of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'http://', 'https://', "require('http", "require('net", "require('dns"]) {
      assert.ok(!src.includes(word), `${f} לא צריך להכיל: ${word}`);
    }
    if (f !== 'engines/llm-worker.js') assert.ok(!/import\(\s*['"]node-llama-cpp/.test(src), f + ': הספרייה רק בתהליך העזר');
  }
  const worker = fs.readFileSync(path.join(dir, 'engines/llm-worker.js'), 'utf8');
  assert.match(worker, /build: 'never'/, 'בלי בניית llama.cpp (שמורידה קוד)');
  assert.doesNotMatch(worker, /resolveModelFile|createModelDownloader|modelUri|hf:/, 'בלי הורדת מודל');
});
