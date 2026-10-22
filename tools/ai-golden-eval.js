#!/usr/bin/env node
// מדידת המודל המקומי מול סט הזהב בעברית (tests/fixtures/ai-golden-he.json) — על מודל GGUF אמיתי.
// לא חלק מ-npm test (דורש node-llama-cpp ומודל). בלי רשת: המודל נטען מקובץ מקומי.
//   npm i --no-save node-llama-cpp@3        (פעם אחת, במחשב פיתוח)
//   node tools/ai-golden-eval.js <model.gguf> [--threads 4]
// הפלט: לכל שאלה — מנוע, כלים, עבר/נכשל וזמן; ובסוף — זמן טעינה, חציון ו-p90.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { createAI } = require(path.join(ROOT, 'shell/ai'));
const { createLocalEngine } = require(path.join(ROOT, 'shell/ai/engines/local-llm'));

const modelPath = process.argv[2];
if (!modelPath || !fs.existsSync(modelPath)) {
  console.error('שימוש: node tools/ai-golden-eval.js <model.gguf>');
  process.exit(2);
}
const GOLDEN = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/ai-golden-he.json'), 'utf8'));
const LICENSED = { mode: 'licensed', status: 'active', features: ['ai', 'ai.local'] };

const forkWorker = () => {
  const c = fork(path.join(ROOT, 'shell/ai/engines/llm-worker.js'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, NODE_LLAMA_CPP_SKIP_DOWNLOAD: 'true' } });
  return { postMessage: (m) => c.send(m), on: (evt, fn) => c.on(evt, fn), kill: () => c.kill() };
};
const store = { current: async () => ({ present: true, path: path.resolve(modelPath), manifest: { id: 'eval', name: path.basename(modelPath), size: fs.statSync(modelPath).size, contextSize: 4096 } }) };

(async () => {
  const local = createLocalEngine({ modelStore: store, fork: forkWorker, hasRuntime: () => true, options: { chatTimeoutMs: 180_000 } });
  const ai = createAI({ userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'ai-eval-')), getBackupKey: () => null, licenseState: () => LICENSED, localEngine: local });
  await local.refresh();
  const t0 = Date.now();
  await local.ensureLoaded();
  console.log(`טעינת המודל: ${Date.now() - t0}ms (${(fs.statSync(modelPath).size / 2 ** 30).toFixed(2)}GB, ${os.cpus().length} ליבות)`);
  const times = [];
  let pass = 0;
  for (const c of GOLDEN.cases) {
    const ctx = structuredClone(GOLDEN.contexts[c.ctx]);
    const s = Date.now();
    const r = c.kind === 'search' ? await ai.search(c.q, ctx) : await ai.run(c.q, ctx);
    const ms = Date.now() - s;
    const e = c.expect;
    // מול מודל אמיתי: מנוע וסכומים; הנוסח המדויק חופשי. חזרה לכללים מתשובה לא מעוגנת — כשל של המודל, לא של הבטיחות
    const problems = [];
    if (e.fallback) { if (r.engine !== 'rules') problems.push('ציפינו לדחייה'); }
    else if (r.engine !== e.engine) problems.push(`מנוע ${r.engine}${r.fallback ? ' (' + r.fallback + ')' : ''}`);
    if (c.kind === 'ask') for (const x of e.contains || []) if (!r.text.includes(x)) problems.push('חסר ' + x);
    if (c.kind === 'search' && e.screens) for (const v of e.screens) if (!r.screens.some(sc => sc.view === v)) problems.push('חסר מסך ' + v);
    if (r.engine === 'local') times.push(ms);
    if (!problems.length) pass++;
    console.log(`${problems.length ? '✖' : '✔'} ${c.id} [${r.engine}${r.tools ? ' ' + r.tools.join(',') : ''}] ${ms}ms${problems.length ? ' — ' + problems.join('; ') : ''}`);
    if (process.argv.includes('--verbose') && r.text) console.log('   ' + r.text.replace(/\n/g, '\n   '));
  }
  times.sort((a, b) => a - b);
  const q = (p) => (times.length ? times[Math.min(times.length - 1, Math.floor(p * times.length))] : 0);
  console.log(`\n${pass}/${GOLDEN.cases.length} עברו. זמן תשובה של המודל: חציון ${q(0.5)}ms, p90 ${q(0.9)}ms (${times.length} תשובות)`);
  ai.dispose();
  process.exit(pass === GOLDEN.cases.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
