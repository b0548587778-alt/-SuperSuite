// מודל מדומה לבדיקות: מממש את פרוטוקול llm-worker.js (load / chat / tool / tool_result / done) בלי node-llama-cpp.
// script(msg) ← { calls: [{ name, args }], answer: string | (results) => string }. „{{tool.path}}” בתשובה
// מוחלף בערך מתוצאת הכלי — כמו מודל שמעתיק סכום שקיבל. כך ה-CI בודק את הצנרת כולה, בלי מודל ובלי רשת.
'use strict';

function pick(results, ref) {
  const [tool, ...rest] = ref.split('.');
  let v = results[tool];
  for (const k of rest) v = v == null ? undefined : v[k];
  return v == null ? '' : String(v);
}

function render(answer, results) {
  const text = typeof answer === 'function' ? answer(results) : String(answer || '');
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, ref) => pick(results, ref));
}

// options: { loadDelay, failLoad, hang, crashOnChat, log }
function createMockFork(script, options = {}) {
  const forks = [];
  const fork = () => {
    const listeners = { message: [], exit: [] };
    const pending = new Map();
    const emit = (evt, v) => setImmediate(() => listeners[evt].forEach(fn => fn(v)));
    const child = {
      killed: false,
      sent: [],
      on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return child; },
      kill() { child.killed = true; },
      postMessage(msg) {
        child.sent.push(msg);
        if (msg.t === 'load') {
          if (options.failLoad) return emit('message', { t: 'error', message: 'load failed' });
          setTimeout(() => emit('message', { t: 'loaded', ms: options.loadDelay || 1 }), options.loadDelay || 1);
        } else if (msg.t === 'chat') {
          if (options.crashOnChat) return emit('exit', 134);
          if (options.hang) return;
          runChat(msg);
        } else if (msg.t === 'tool_result') {
          const r = pending.get(msg.callId);
          pending.delete(msg.callId);
          if (r) r(msg.result);
        }
      },
    };
    async function runChat(msg) {
      const plan = script(msg) || {};
      const results = {};
      let n = 0;
      for (const c of plan.calls || []) {
        const callId = `${msg.id}:${++n}`;
        const result = await new Promise((resolve) => { pending.set(callId, resolve); emit('message', { t: 'tool', id: msg.id, callId, name: c.name, args: c.args || {} }); });
        results[c.name] = result;
      }
      emit('message', { t: 'done', id: msg.id, text: render(plan.answer, results), ms: 5 });
    }
    forks.push(child);
    return child;
  };
  fork.forks = forks;
  return fork;
}

// מאגר מודל מדומה: „מותקן” בלי קובץ אמיתי
const fakeStore = (present = true) => ({
  current: async () => (present
    ? { present: true, path: '/models/dictalm.gguf', manifest: { id: 'dictalm-3.0-1.7b-instruct-q4km', name: 'DictaLM 3.0 1.7B', size: 1, contextSize: 4096, license: 'Apache-2.0', quant: 'Q4_K_M' } }
    : { present: false }),
});

module.exports = { createMockFork, fakeStore, render };
