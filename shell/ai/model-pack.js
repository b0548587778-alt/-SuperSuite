// חבילת המודל המקומי (תוסף אופציונלי): קובץ GGUF + „תעודת מודל” חתומה (‎.ssmodel).
// אותו מסלול אמון כמו עדכוני הגרסה (shell/licensing/update.js): התעודה חתומה ב-Ed25519 במפתח השורש,
// ובה SHA-256 וגודל של הקובץ. הקובץ עצמו מגיע מ-USB או מתיקייה — המקור אינו מהימן, רק התעודה.
// אין כאן רשת בכלל: ההתקנה היא העתקה מקומית עם אימות תוך כדי.
const crypto = require('crypto');
const path = require('path');
const L = require('../licensing/license');

const MODEL_TYPE = 'supersuite-ai-model';
const MAX_SIZE = 3 * 1024 * 1024 * 1024; // 3GB — תקרת התוסף, כדי שירוץ גם במחשב משרדי עם 8GB זיכרון
const HEX64 = /^[0-9a-f]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const GGUF_MAGIC = 'GGUF';
const INSTALLED = 'model.ssmodel';
const STATE = 'model-state.json';

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

function cleanPayload(input, issuedAt) {
  const r = input && typeof input === 'object' ? input : {};
  const id = String(r.id || '');
  if (!ID_RE.test(id)) throw new Error('מזהה המודל אינו תקין');
  const fileName = clip(r.fileName, 120).replace(/^.*[\\/]/, '');
  if (!/\.gguf$/i.test(fileName) || fileName.startsWith('.')) throw new Error('קובץ המודל חייב להיות GGUF');
  const sha256 = String(r.sha256 || '').toLowerCase();
  if (!HEX64.test(sha256)) throw new Error('תמצית הקובץ (SHA-256) אינה תקינה');
  const size = Number(r.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SIZE) throw new Error('גודל המודל אינו תקין (עד 3GB)');
  const contextSize = Number(r.contextSize || 4096);
  if (!Number.isSafeInteger(contextSize) || contextSize < 512 || contextSize > 32768) throw new Error('אורך ההקשר אינו תקין');
  return {
    v: 1, id, fileName, sha256, size, contextSize,
    name: clip(r.name, 80) || id,
    license: clip(r.license, 40),
    quant: clip(r.quant, 20),
    issuedAt: Number.isSafeInteger(issuedAt) ? issuedAt : Date.now(),
  };
}

// מנהל-העל: תעודת מודל חתומה (טקסט JSON שנשמר ליד הקובץ כ-‎.ssmodel)
function createModelManifest(rootPrivateJwk, input, { issuedAt } = {}) {
  const payload = { ...cleanPayload(input, issuedAt), issuer: L.keyId(rootPrivateJwk) };
  return JSON.stringify({ type: MODEL_TYPE, payload, sig: L.signObject(payload, rootPrivateJwk) });
}

// אימות מול מפתחות השורש שבתוכנה. מחזיר את התוכן, או זורק שגיאה בעברית
function verifyModelManifest(text, rootKeys) {
  let m;
  try { m = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('תעודת המודל פגומה'); }
  if (!m || m.type !== MODEL_TYPE || !m.payload || typeof m.sig !== 'string') throw new Error('הקובץ אינו תעודת מודל של SuperSuite');
  if (!Array.isArray(rootKeys) || !rootKeys.length) throw new Error('מפתח מנהל-העל אינו מוגדר בתוכנה — אי אפשר לאמת את המודל');
  const key = rootKeys.find(k => { try { return L.keyId(k) === m.payload.issuer; } catch { return false; } });
  if (!key || !L.verifyObject(m.payload, m.sig, key)) throw new Error('חתימת המודל אינה תקינה — המודל נדחה');
  const clean = cleanPayload(m.payload, m.payload.issuedAt);
  for (const k of ['id', 'fileName', 'sha256', 'size', 'name']) {
    if (clean[k] !== m.payload[k]) throw new Error('תעודת המודל אינה תקינה');
  }
  return { ...clean, issuer: m.payload.issuer };
}

// העתקה מאומתת: קוראים פעם אחת, מחשבים SHA-256 וכותבים לקובץ זמני — 2GB בלי לטעון לזיכרון
function copyVerified(fs, from, to, expected) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let total = 0;
    let head = '';
    const input = fs.createReadStream(from, { highWaterMark: 1024 * 1024 });
    const output = fs.createWriteStream(to);
    const fail = (e) => { input.destroy(); output.destroy(); reject(e); };
    input.on('data', (chunk) => {
      if (total === 0) head = chunk.subarray(0, 4).toString('latin1');
      total += chunk.length;
      if (total > expected.size) return fail(new Error('קובץ המודל גדול מהרשום בתעודה — נדחה'));
      if (total === chunk.length && head !== GGUF_MAGIC) return fail(new Error('הקובץ אינו מודל GGUF — נדחה'));
      hash.update(chunk);
    });
    input.on('error', () => fail(new Error('לא ניתן לקרוא את קובץ המודל')));
    output.on('error', () => fail(new Error('לא ניתן לשמור את המודל במחשב הזה')));
    input.pipe(output);
    output.on('finish', () => {
      if (total !== expected.size) return reject(new Error('גודל קובץ המודל אינו תואם לתעודה — נדחה'));
      if (hash.digest('hex') !== expected.sha256) return reject(new Error('תוכן קובץ המודל אינו תואם לתעודה — נדחה'));
      resolve();
    });
  });
}

function hashFile(fs, file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file, { highWaterMark: 1024 * 1024 })
      .on('data', c => hash.update(c))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// המודל המותקן: dir/<id>.gguf + dir/model.ssmodel + dir/model-state.json (גודל וזמן שינוי אחרי האימות)
function createModelStore({ fs, dir, rootKeys }) {
  const manifestFile = path.join(dir, INSTALLED);
  const stateFile = path.join(dir, STATE);

  function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }

  // התקנה מקובץ (USB / תיקייה). sourcePath — קובץ ה-GGUF; manifestText — תוכן ה-‎.ssmodel
  async function install(manifestText, sourcePath) {
    const p = verifyModelManifest(manifestText, rootKeys);
    let st;
    try { st = fs.statSync(sourcePath); } catch { throw new Error('קובץ המודל לא נמצא'); }
    if (!st.isFile()) throw new Error('קובץ המודל לא נמצא');
    if (st.size !== p.size) throw new Error('גודל קובץ המודל אינו תואם לתעודה — נדחה');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, p.id + '.gguf');
    const part = target + '.part';
    try {
      await copyVerified(fs, sourcePath, part, p);
      fs.renameSync(part, target);
    } catch (e) {
      try { fs.unlinkSync(part); } catch { /* אין קובץ זמני */ }
      throw e;
    }
    // מודל קודם בשם אחר — מוסר, כדי שלא יישארו 2GB מיותרים בדיסק
    const prev = readJson(manifestFile);
    if (prev && prev.payload && prev.payload.id !== p.id) {
      try { fs.unlinkSync(path.join(dir, prev.payload.id + '.gguf')); } catch { /* כבר הוסר */ }
    }
    fs.writeFileSync(manifestFile, typeof manifestText === 'string' ? manifestText : JSON.stringify(manifestText), 'utf8');
    const after = fs.statSync(target);
    fs.writeFileSync(stateFile, JSON.stringify({ sha256: p.sha256, size: after.size, mtimeMs: Math.round(after.mtimeMs) }), 'utf8');
    return { id: p.id, name: p.name, path: target, size: p.size };
  }

  // המודל המותקן, אחרי אימות התעודה. גודל/זמן שונה מאז ההתקנה — חישוב SHA-256 מחדש (deep), אחרת מוחזר 'changed'
  async function current({ deep = false } = {}) {
    const text = (() => { try { return fs.readFileSync(manifestFile, 'utf8'); } catch { return null; } })();
    if (!text) return { present: false };
    let p;
    try { p = verifyModelManifest(text, rootKeys); } catch (e) { return { present: false, error: e.message }; }
    const file = path.join(dir, p.id + '.gguf');
    let st;
    try { st = fs.statSync(file); } catch { return { present: false, error: 'קובץ המודל חסר — יש להתקין מחדש' }; }
    const saved = readJson(stateFile) || {};
    const same = saved.sha256 === p.sha256 && saved.size === st.size && saved.mtimeMs === Math.round(st.mtimeMs);
    if (!same) {
      if (!deep) return { present: false, changed: true, error: 'קובץ המודל השתנה מאז ההתקנה — נדרש אימות' };
      if (st.size !== p.size || (await hashFile(fs, file)) !== p.sha256) return { present: false, error: 'קובץ המודל אינו תואם לתעודה' };
      fs.writeFileSync(stateFile, JSON.stringify({ sha256: p.sha256, size: st.size, mtimeMs: Math.round(st.mtimeMs) }), 'utf8');
    }
    return { present: true, path: file, manifest: p };
  }

  function remove() {
    const prev = readJson(manifestFile);
    for (const f of [prev && prev.payload ? path.join(dir, prev.payload.id + '.gguf') : null, manifestFile, stateFile]) {
      if (f) { try { fs.unlinkSync(f); } catch { /* כבר הוסר */ } }
    }
    return { present: false };
  }

  return { install, current, remove, dir };
}

module.exports = { MODEL_TYPE, MAX_SIZE, GGUF_MAGIC, createModelManifest, verifyModelManifest, createModelStore, hashFile };
