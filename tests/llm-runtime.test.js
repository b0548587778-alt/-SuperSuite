// רכיב ההרצה של המודל המקומי דרך ci-status (tools/llm-runtime.js)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../tools/llm-runtime.js');
const { runtimeAvailable } = require('../shell/ai/engines/local-llm.js');

const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-llmrt-')); dirs.push(d); return d; };
const writePkg = (dir, version) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version })); };

// פרויקט שבו node-llama-cpp הותקן (כמו ב-CI אחרי npm install)
function makeProject(version = '3.1.0') {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/node-llama-cpp': { version } } }));
  writePkg(path.join(dir, 'node_modules/node-llama-cpp'), version);
  return dir;
}

// התקנה מדומה בסגנון shallow: רק החבילה בשורש, התלויות בתוכה — כולל אותה חבילה בשתי גרסאות (ריצה #62)
function fakeShallow({ version = '3.1.0', extraTop = false, binaries = ['win-x64', 'win-x64-cuda', 'win-x64-vulkan'] } = {}) {
  return (work) => {
    const deps = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8')).dependencies;
    assert.deepStrictEqual(deps, { 'node-llama-cpp': '3.1.0' }, 'אותה גרסה כמו בקובץ הנעילה');
    const pkg = path.join(work, 'node_modules/node-llama-cpp');
    writePkg(pkg, version);
    writePkg(path.join(pkg, 'node_modules/ansi-regex'), '6.0.0');
    writePkg(path.join(pkg, 'node_modules/strip-ansi/node_modules/ansi-regex'), '5.0.0');
    for (const b of binaries) writePkg(path.join(pkg, 'node_modules/@node-llama-cpp', b), version);
    fs.mkdirSync(path.join(work, 'node_modules/.bin'), { recursive: true });
    if (extraTop) writePkg(path.join(work, 'node_modules/typescript'), '5.0.0');
  };
}

test('pack ואז install: הרכיב מזוהה כזמין, בלי CUDA / Vulkan, ושאר node_modules של המחשב לא נדרס', () => {
  const out = path.join(tmp(), 'llm-runtime');
  const r = R.pack(makeProject(), out, { installer: fakeShallow() });
  assert.deepStrictEqual(r, { packed: true, version: '3.1.0', binaries: ['win-x64'] });

  const local = tmp();
  writePkg(path.join(local, 'node_modules/ansi-regex'), '4.0.0');
  const paths = [path.join(local, 'node_modules')];
  assert.strictEqual(runtimeAvailable(paths, { platform: 'win32', arch: 'x64' }), false);

  assert.strictEqual(R.install(out, local).version, '3.1.0');
  assert.strictEqual(runtimeAvailable(paths, { platform: 'win32', arch: 'x64' }), true);
  const read = (p) => JSON.parse(fs.readFileSync(path.join(local, 'node_modules', p, 'package.json'), 'utf8')).version;
  assert.strictEqual(read('ansi-regex'), '4.0.0', 'הגרסה של הפרויקט נשארת');
  assert.strictEqual(read('node-llama-cpp/node_modules/ansi-regex'), '6.0.0');
  assert.strictEqual(read('node-llama-cpp/node_modules/strip-ansi/node_modules/ansi-regex'), '5.0.0');
  assert.deepStrictEqual(fs.readdirSync(path.join(local, 'node_modules/node-llama-cpp/node_modules/@node-llama-cpp')), ['win-x64']);
});

test('pack: נכשל בגלוי על חבילה נוספת בשורש, גרסה אחרת או בלי רכיב למעבד', () => {
  const out = path.join(tmp(), 'out');
  assert.throws(() => R.pack(makeProject(), out, { installer: fakeShallow({ extraTop: true }) }), /typescript/);
  assert.throws(() => R.pack(makeProject(), out, { installer: fakeShallow({ version: '3.2.0' }) }), /3\.2\.0/);
  assert.throws(() => R.pack(makeProject(), out, { installer: fakeShallow({ binaries: ['win-x64-cuda'] }) }), /רכיב מוכן למעבד/);
});

test('pack בלי node-llama-cpp מותקן — לא נכשל ולא מתקין; install מתיקייה זרה — נדחה', () => {
  const dir = tmp();
  let called = false;
  assert.strictEqual(R.pack(dir, path.join(dir, 'out'), { installer: () => { called = true; } }).packed, false);
  assert.strictEqual(called, false);
  assert.throws(() => R.install(dir, tmp()), /llm-runtime\.json/);
});

test('CI: הרכיב נארז בצעד נפרד שלא עוצר את הבנייה, אחרי ההתקנה ולפני שמירת היומנים', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  report:'));
  const iStep = build.indexOf('- name: llm runtime for ci-status');
  assert.ok(iStep > build.indexOf('$CMD 2>&1') && iStep < build.indexOf('path: ci-logs'));
  const step = build.slice(iStep, build.indexOf('- name:', iStep + 10));
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /node tools\/llm-runtime\.js pack ci-logs\/llm-runtime/);
});
