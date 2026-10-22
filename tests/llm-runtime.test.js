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

// פרויקט מדומה: node-llama-cpp עם תלות מורמת, תלות מקוננת, רכיב מעבד, רכיב CUDA וחבילה שלא קשורה
const LOCK = {
  packages: {
    '': { name: 'supersuite' },
    'node_modules/node-llama-cpp': { version: '3.1.0', dependencies: { chalk: '^5', semver: '^7' }, optionalDependencies: { '@node-llama-cpp/win-x64': '3.1.0', '@node-llama-cpp/win-x64-cuda': '3.1.0', '@node-llama-cpp/linux-x64': '3.1.0' } },
    'node_modules/chalk': { version: '5.0.0', dependencies: { semver: '^6' } },
    'node_modules/chalk/node_modules/semver': { version: '6.0.0' },
    'node_modules/semver': { version: '7.0.0' },
    'node_modules/@node-llama-cpp/win-x64': { version: '3.1.0' },
    'node_modules/@node-llama-cpp/win-x64-cuda': { version: '3.1.0' },
    'node_modules/@node-llama-cpp/linux-x64': { version: '3.1.0' },
    'node_modules/electron': { version: '38.0.0' },
  },
};

function makeProject() {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(LOCK));
  for (const [p, info] of Object.entries(LOCK.packages)) {
    if (!p || p.endsWith('linux-x64')) continue; // רכיב של מערכת אחרת לא הותקן
    fs.mkdirSync(path.join(dir, p), { recursive: true });
    fs.writeFileSync(path.join(dir, p, 'package.json'), JSON.stringify({ name: p.split('node_modules/').pop(), version: info.version }));
  }
  fs.writeFileSync(path.join(dir, 'node_modules/@node-llama-cpp/win-x64/addon.node'), 'bin');
  return dir;
}

test('closure: התלויות וההרכבים של החבילה, בלי CUDA, בלי חבילות שלא הותקנו ובלי חבילות אחרות', () => {
  const dir = makeProject();
  const list = R.closure(LOCK, (p) => fs.existsSync(path.join(dir, p, 'package.json')));
  assert.deepStrictEqual(list, [
    'node_modules/@node-llama-cpp/win-x64',
    'node_modules/chalk',
    'node_modules/chalk/node_modules/semver',
    'node_modules/node-llama-cpp',
    'node_modules/semver',
  ]);
  assert.deepStrictEqual(R.closure({ packages: {} }), []);
});

test('targetOf: הכול בתוך node_modules/node-llama-cpp', () => {
  assert.strictEqual(R.targetOf('node_modules/node-llama-cpp'), 'node_modules/node-llama-cpp');
  assert.strictEqual(R.targetOf('node_modules/chalk/node_modules/semver'), 'node_modules/node-llama-cpp/node_modules/chalk/node_modules/semver');
  assert.strictEqual(R.targetOf('node_modules/node-llama-cpp/node_modules/x'), 'node_modules/node-llama-cpp/node_modules/x');
});

test('pack ואז install: הרכיב מזוהה כזמין, ושאר node_modules של המחשב לא נדרס', () => {
  const src = makeProject();
  const out = path.join(tmp(), 'llm-runtime');
  const r = R.pack(src, out);
  assert.strictEqual(r.packed, true);
  assert.deepStrictEqual(r.binaries, ['win-x64']);
  assert.ok(!fs.existsSync(path.join(out, 'node_modules/node-llama-cpp/node_modules/@node-llama-cpp/win-x64-cuda')));

  const local = tmp();
  fs.mkdirSync(path.join(local, 'node_modules/semver'), { recursive: true });
  fs.writeFileSync(path.join(local, 'node_modules/semver/package.json'), '{"version":"5.0.0"}');
  assert.strictEqual(runtimeAvailable([path.join(local, 'node_modules')], { platform: 'win32', arch: 'x64' }), false);

  const m = R.install(out, local);
  assert.strictEqual(m.version, '3.1.0');
  assert.strictEqual(runtimeAvailable([path.join(local, 'node_modules')], { platform: 'win32', arch: 'x64' }), true);
  assert.match(fs.readFileSync(path.join(local, 'node_modules/semver/package.json'), 'utf8'), /5\.0\.0/, 'הגרסה של הפרויקט נשארת');
  const nested = path.join(local, 'node_modules/node-llama-cpp/node_modules');
  assert.match(fs.readFileSync(path.join(nested, 'semver/package.json'), 'utf8'), /7\.0\.0/);
  assert.match(fs.readFileSync(path.join(nested, 'chalk/node_modules/semver/package.json'), 'utf8'), /6\.0\.0/);
});

test('pack בלי node-llama-cpp מותקן — לא נכשל; install מתיקייה זרה — נדחה', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(LOCK));
  assert.strictEqual(R.pack(dir, path.join(dir, 'out')).packed, false);
  assert.throws(() => R.install(dir, tmp()), /llm-runtime\.json/);
});

test('CI: הרכיב נארז ל-ci-status אחרי ההתקנה, ולפני שמירת היומנים', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8');
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  report:'));
  const iPack = build.indexOf('node tools/llm-runtime.js pack ci-logs/llm-runtime');
  assert.ok(iPack > build.indexOf('$CMD 2>&1') && iPack < build.indexOf('path: ci-logs'));
});
