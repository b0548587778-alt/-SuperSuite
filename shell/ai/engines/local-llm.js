// מנוע המודל המקומי: מנהל את תהליך העזר (llm-worker.js) שבו רץ GGUF דרך node-llama-cpp.
// התהליך הראשי שולט בהכול: מתי לטעון, זמן קצוב לכל שאלה, ואילו כלים (tools) מותרים — והוא שמבצע אותם.
// המודל לא נוגע במסד ולא בקבצים; הוא מקבל רק את מה שכלי מחזיר מתוך ההקשר שכבר נבדק בהרשאות.
// אין כאן רשת. Electron נטען בעצלות — הקובץ נארז גם לאנדרואיד, שם אין utilityProcess והמנוע „לא זמין”.
const path = require('path');

const DEFAULTS = Object.freeze({ loadTimeoutMs: 120_000, chatTimeoutMs: 90_000, idleMs: 10 * 60_000, maxToolCalls: 6 });

// ברירת המחדל: utilityProcess של Electron, בסביבה מצומצמת (בלי משתני סביבה של המשתמש)
function electronFork() {
  let electron;
  try { electron = require('electron'); } catch { return null; }
  if (!electron || !electron.utilityProcess) return null;
  return electron.utilityProcess.fork(path.join(__dirname, 'llm-worker.js'), [], {
    serviceName: 'SuperSuite AI',
    stdio: 'ignore',
    env: { NODE_LLAMA_CPP_SKIP_DOWNLOAD: 'true', SYSTEMROOT: process.env.SYSTEMROOT || '', PATH: process.env.PATH || '' },
  });
}

// runtimeAvailable — האם node-llama-cpp ארוז בהתקנה הזו (בלי לטעון אותו).
// לא require.resolve: החבילה היא ESM בלבד, ואם ב-exports שלה אין תנאי require — הוא נכשל גם כשהיא ארוזה,
// והמודל היה „לא זמין” תמיד. בודקים שקובץ ה-package.json קיים באחת מתיקיות node_modules של החיפוש
// (גם בתוך app.asar: הקבצים שב-asarUnpack רשומים באינדקס, ו-fs של Electron מכיר אותם).
// וגם הרכיב המוכן למעבד של המחשב הזה (‎@node-llama-cpp/win-x64): בלעדיו getLlama({ build: 'never', gpu: false })
// נכשל בכל שאלה, והמסך היה מציג „מוכן”. גרסאות CUDA / Vulkan לא נארזות — ולא נחשבות
const PLATFORM_PREFIX = { win32: 'win', darwin: 'mac', linux: 'linux' };
function runtimeAvailable(searchPaths = module.paths, { platform = process.platform, arch = process.arch } = {}) {
  let fs;
  try { fs = require('fs'); } catch { return false; }
  const prefix = (PLATFORM_PREFIX[platform] || platform) + '-' + arch;
  const hasBinary = (scope) => {
    try { return fs.readdirSync(scope).some((n) => n.startsWith(prefix) && !/cuda|vulkan/i.test(n)); } catch { return false; }
  };
  return (searchPaths || []).some((dir) => {
    try {
      if (!fs.existsSync(path.join(dir, 'node-llama-cpp', 'package.json'))) return false;
      // npm מציב את הרכיב לצד החבילה, או בתוכה כשאין אפשרות להעלות אותו
      return hasBinary(path.join(dir, '@node-llama-cpp')) || hasBinary(path.join(dir, 'node-llama-cpp', 'node_modules', '@node-llama-cpp'));
    } catch { return false; }
  });
}

// modelStore — createModelStore (model-pack.js). fork — לבדיקות: מחזיר אובייקט עם postMessage/on/kill
function createLocalEngine({ modelStore, fork = electronFork, hasRuntime = runtimeAvailable, options = {}, onError = () => {}, clock = () => Date.now() } = {}) {
  const opt = { ...DEFAULTS, ...options };
  let child = null;
  let loaded = null;      // Promise של טעינה
  let lastError = null;
  let loadMs = null;
  let idleTimer = null;
  let seq = 0;
  let queue = Promise.resolve();
  const inflight = new Map(); // id ← { resolve, reject, onTool, timer }
  let loadWaiter = null;
  let installed = { present: false };

  async function refresh() {
    installed = modelStore ? await modelStore.current() : { present: false };
    return installed;
  }

  function mode() {
    if (!installed.present) return 'unavailable';
    if (!hasRuntime()) return 'unavailable';
    if (lastError) return 'degraded'; // טעינה קודמת נכשלה — ננסה שוב בשאלה הבאה
    return 'ready';
  }

  function status() {
    const m = installed.present ? installed.manifest : null;
    return {
      mode: mode(), present: !!installed.present, running: !!child, loadMs,
      model: m ? { id: m.id, name: m.name, size: m.size, license: m.license, quant: m.quant } : null,
      error: lastError || installed.error || null,
    };
  }

  function stop(reason) {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    const c = child;
    child = null;
    loaded = null;
    if (c) { try { c.postMessage({ t: 'dispose' }); } catch { /* */ } try { c.kill(); } catch { /* */ } }
    for (const [id, r] of inflight) { clearTimeout(r.timer); r.reject(new Error(reason || 'המודל המקומי נסגר')); inflight.delete(id); }
    if (loadWaiter) { loadWaiter.reject(new Error(reason || 'המודל המקומי נסגר')); loadWaiter = null; }
  }

  function armIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop('המודל המקומי נסגר אחרי זמן ללא שימוש'), opt.idleMs);
    if (idleTimer.unref) idleTimer.unref();
  }

  function onMessage(raw) {
    const msg = raw && raw.data && raw.t === undefined ? raw.data : raw;
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'loaded' && loadWaiter) { loadWaiter.resolve(msg); loadWaiter = null; return; }
    if (msg.t === 'error' && msg.id == null && loadWaiter) { loadWaiter.reject(new Error(msg.message)); loadWaiter = null; return; }
    const r = inflight.get(msg.id);
    if (!r) return;
    if (msg.t === 'tool') {
      Promise.resolve().then(() => r.onTool(msg.name, msg.args)).catch(e => ({ error: String(e && e.message || e) }))
        .then(result => { if (child) child.postMessage({ t: 'tool_result', id: msg.id, callId: msg.callId, result }); });
    } else if (msg.t === 'done') {
      clearTimeout(r.timer); inflight.delete(msg.id); r.resolve({ text: String(msg.text || ''), ms: msg.ms });
    } else if (msg.t === 'error') {
      clearTimeout(r.timer); inflight.delete(msg.id); r.reject(new Error(msg.message || 'שגיאה במודל המקומי'));
    }
  }

  function ensureLoaded() {
    if (loaded) return loaded;
    loaded = (async () => {
      const cur = await refresh();
      if (!cur.present) throw new Error(cur.error || 'המודל המקומי אינו מותקן');
      if (!hasRuntime()) throw new Error('רכיב המודל המקומי אינו כלול בהתקנה הזו');
      const c = fork();
      if (!c) throw new Error('המודל המקומי זמין רק בגרסת המחשב');
      child = c;
      c.on('message', onMessage);
      c.on('exit', (code) => { if (child === c) { lastError = `תהליך המודל נסגר (${code})`; stop(lastError); } });
      const t0 = clock();
      const done = new Promise((resolve, reject) => { loadWaiter = { resolve, reject }; });
      const timer = setTimeout(() => stop('טעינת המודל ארכה יותר מדי'), opt.loadTimeoutMs);
      c.postMessage({ t: 'load', modelPath: cur.path, contextSize: cur.manifest.contextSize });
      try { await done; } finally { clearTimeout(timer); }
      loadMs = clock() - t0;
      lastError = null;
      armIdle();
      return true;
    })();
    loaded.catch((e) => { lastError = e.message; onError('ai-local-load', e); stop(e.message); });
    return loaded;
  }

  // chat: שאלה אחת, עם כלים. שאלות רצות אחת אחרי השנייה — המודל תופס את כל המעבד.
  // onTool(name, args) ← תוצאת הכלי (אובייקט JSON). מחזיר { text, ms, toolCalls }
  function chat({ system, prompt, tools = [], onTool, maxTokens, temperature }) {
    const run = async () => {
      await ensureLoaded();
      if (idleTimer) clearTimeout(idleTimer);
      const id = ++seq;
      const calls = [];
      const guardedTool = async (name, args) => {
        if (calls.length >= opt.maxToolCalls) return { error: 'יותר מדי קריאות לכלים בשאלה אחת' };
        if (!tools.some(t => t.name === name)) return { error: 'כלי לא מוכר' };
        const result = await onTool(name, args);
        calls.push({ name, args, result });
        return result;
      };
      try {
        const out = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { inflight.delete(id); reject(new Error('המודל המקומי לא ענה בזמן')); stop('זמן קצוב'); }, opt.chatTimeoutMs);
          inflight.set(id, { resolve, reject, onTool: guardedTool, timer });
          child.postMessage({ t: 'chat', id, system, prompt, tools: tools.map(t => ({ name: t.name, description: t.description, params: t.params })), maxTokens, temperature });
        });
        return { ...out, toolCalls: calls };
      } finally {
        if (child) armIdle();
      }
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  return { status, refresh, chat, stop: () => stop('נסגר'), ensureLoaded };
}

module.exports = { createLocalEngine, runtimeAvailable, DEFAULTS };
