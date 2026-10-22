// תהליך העזר של המודל המקומי (Electron utilityProcess). רץ בנפרד מהתהליך הראשי: קריסה או זיכרון
// גדוש כאן לא מפילים את התוכנה, והתהליך הראשי יכול להרוג אותו בכל רגע (זמן קצוב / סגירה).
// אין כאן רשת: node-llama-cpp טוען קובץ GGUF מקומי בלבד, בלי הורדת מודל ובלי בניית llama.cpp.
// אין כאן גישה לנתונים: כל נתון מגיע רק כתשובה לקריאת כלי (tool) שהתהליך הראשי מבצע ומחליט עליה.
'use strict';

// ב-Electron: parentPort. מחוץ ל-Electron (כלי המדידה tools/ai-golden-eval.js): child_process.fork רגיל
const port = process.parentPort || {
  on: (evt, fn) => process.on(evt, (data) => fn({ data })),
  postMessage: (msg) => process.send(msg),
};
let lib = null;
let llama = null;
let model = null;
let context = null;
const pendingTools = new Map(); // callId ← resolve

const send = (msg) => port.postMessage(msg);

async function load({ modelPath, contextSize, threads }) {
  const started = Date.now();
  // node-llama-cpp הוא ESM בלבד — import דינמי. הספרייה נארזת עם התוכנה; המודל — תוסף נפרד
  lib = lib || await import('node-llama-cpp');
  llama = llama || await lib.getLlama({ build: 'never', gpu: 'auto', progressLogs: false, logLevel: 'error' });
  model = await llama.loadModel({ modelPath });
  context = await model.createContext({ contextSize: contextSize || 4096, threads: threads || undefined });
  return { ms: Date.now() - started, gpu: llama.gpu || false };
}

function askTool(id, callId, name, args) {
  return new Promise((resolve) => {
    pendingTools.set(callId, resolve);
    send({ t: 'tool', id, callId, name, args });
  });
}

async function chat({ id, system, prompt, tools, maxTokens, temperature }) {
  const started = Date.now();
  const sequence = context.getSequence();
  const session = new lib.LlamaChatSession({ contextSequence: sequence, systemPrompt: system });
  let n = 0;
  const functions = {};
  for (const t of tools || []) {
    functions[t.name] = lib.defineChatSessionFunction({
      description: t.description,
      params: t.params,
      handler: (args) => askTool(id, `${id}:${++n}`, t.name, args || {}),
    });
  }
  try {
    const text = await session.prompt(prompt, {
      functions: Object.keys(functions).length ? functions : undefined,
      maxTokens: maxTokens || 512,
      temperature: temperature == null ? 0.2 : temperature,
    });
    return { text, ms: Date.now() - started };
  } finally {
    try { session.dispose(); } catch { /* */ }
    try { sequence.dispose(); } catch { /* */ }
  }
}

port.on('message', async (event) => {
  const msg = event && event.data ? event.data : event;
  if (!msg || typeof msg !== 'object') return;
  try {
    if (msg.t === 'load') {
      send({ t: 'loaded', ...(await load(msg)) });
    } else if (msg.t === 'chat') {
      send({ t: 'done', id: msg.id, ...(await chat(msg)) });
    } else if (msg.t === 'tool_result') {
      const resolve = pendingTools.get(msg.callId);
      pendingTools.delete(msg.callId);
      if (resolve) resolve(msg.result);
    } else if (msg.t === 'dispose') {
      try { if (context) await context.dispose(); if (model) await model.dispose(); } catch { /* */ }
      process.exit(0);
    }
  } catch (e) {
    send({ t: 'error', id: msg.id, message: String((e && e.message) || e).slice(0, 300) });
  }
});
