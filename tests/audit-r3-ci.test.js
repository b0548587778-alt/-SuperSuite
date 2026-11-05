// סקירת קוד 2.11.2026 — CI, בנייה ושרת: קובץ נעילה לרכיב ה-AI, בדיקת התלויות, concurrency, Electron נתמכת,
// יומנים והגבלת קצב בשרת הממסר, וזמן קצוב לבדיקות ול-CI.
// מה שלא רץ כאן: GitHub Actions עצמו, Docker / Caddy, ו-Electron על Windows — בדיקה ידנית.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const json = (...p) => JSON.parse(read(...p));
const R = require('../tools/llm-runtime.js');

const TMP = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r3-ci-')); TMP.push(d); return d; };
test.after(() => { for (const d of TMP) fs.rmSync(d, { recursive: true, force: true }); });

const YML = read('.github', 'workflows', 'build.yml');
const BUILD_JOB = YML.slice(YML.indexOf('\n  build:'), YML.indexOf('\n  publish:'));
const stepNames = job => [...job.matchAll(/\n {6}- name: (.+)/g)].map(m => m[1].trim());
const stepText = (job, name) => {
  const i = job.indexOf('- name: ' + name);
  const j = job.indexOf('\n      - ', i + 5);
  return job.slice(i, j < 0 ? undefined : j);
};

/* ---------- רכיב ה-AI: קובץ נעילה ייעודי, npm ci --ignore-scripts, אחרי ה-Build, SHA-256 ---------- */

test('llm-runtime: קובץ נעילה ייעודי — אותה גרסה ואותם overrides כמו בשורש, מבנה shallow, integrity לכל חבילה', () => {
  const pkg = json('tools', 'llm-runtime-deps', 'package.json');
  const lock = json('tools', 'llm-runtime-deps', 'package-lock.json');
  const root = json('package.json');
  const rootLock = json('package-lock.json');
  const pin = root.optionalDependencies['node-llama-cpp'];
  assert.equal(pkg.dependencies['node-llama-cpp'], pin);
  assert.equal(lock.packages['node_modules/node-llama-cpp'].version, pin);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies, 'npm ci: קובץ הנעילה תואם ל-package.json');
  assert.deepEqual(pkg.overrides, root.overrides, 'אותה גרסה מתוקנת של תלות (simple-git)');
  assert.match(read('tools', 'llm-runtime-deps', '.npmrc'), /^install-strategy=shallow$/m);
  const nm = k => k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const inRoot = new Set(Object.entries(rootLock.packages).filter(([k]) => k).map(([k, v]) => nm(k) + '@' + v.version));
  for (const [k, v] of Object.entries(lock.packages)) {
    if (!k) continue;
    // shallow: הכול מתחת ל-node-llama-cpp — שום חבילה של הפרויקט לא נדרסת
    assert.ok(k === 'node_modules/node-llama-cpp' || k.startsWith('node_modules/node-llama-cpp/node_modules/'), k);
    assert.match(String(v.integrity), /^sha512-/, k + ': integrity');
    // אותן גרסאות שכבר עברו את הבנייה בשורש — לא גרסה שפורסמה אתמול
    assert.ok(inRoot.has(nm(k) + '@' + v.version), k + '@' + v.version + ' לא בקובץ הנעילה של השורש');
  }
});

test('llm-runtime: ההתקנה היא npm ci --ignore-scripts מקובץ הנעילה (לא npm install)', () => {
  assert.deepEqual(R.NPM_CI_ARGS.slice(0, 2), ['ci', '--ignore-scripts']);
  assert.ok(R.NPM_CI_ARGS.includes('--install-strategy=shallow'));
  const src = read('tools', 'llm-runtime.js');
  assert.doesNotMatch(src, /\['install'/, 'אין npm install');
  // pack מעתיק לתיקיית העבודה את קובץ הנעילה ו-.npmrc, ולא כותב package.json משלו
  const project = tmp();
  const deps = path.join(project, 'tools', 'llm-runtime-deps');
  fs.mkdirSync(deps, { recursive: true });
  const lock = JSON.stringify({ packages: { 'node_modules/node-llama-cpp': { version: '3.1.0' } } });
  fs.writeFileSync(path.join(project, 'package-lock.json'), lock);
  fs.writeFileSync(path.join(deps, 'package-lock.json'), lock);
  fs.writeFileSync(path.join(deps, 'package.json'), JSON.stringify({ name: 'd', dependencies: { 'node-llama-cpp': '3.1.0' } }));
  fs.writeFileSync(path.join(deps, '.npmrc'), 'install-strategy=shallow\n');
  let seen = null;
  const r = R.pack(project, path.join(tmp(), 'out'), {
    installer: (work) => {
      seen = fs.readdirSync(work).sort();
      const p = path.join(work, 'node_modules/node-llama-cpp');
      fs.mkdirSync(path.join(p, 'node_modules/@node-llama-cpp/win-x64'), { recursive: true });
      fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ version: '3.1.0' }));
    }
  });
  assert.equal(r.packed, true);
  assert.deepEqual(seen, ['.npmrc', 'package-lock.json', 'package.json']);
});

test('llm-runtime: גרסה או overrides שונים מהשורש — נכשל בגלוי', () => {
  const make = (depsVer, depsOverrides) => {
    const project = tmp();
    const deps = path.join(project, 'tools', 'llm-runtime-deps');
    fs.mkdirSync(deps, { recursive: true });
    fs.writeFileSync(path.join(project, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/node-llama-cpp': { version: '3.1.0' } } }));
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ overrides: { 'simple-git': '4.0.2' } }));
    fs.writeFileSync(path.join(deps, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/node-llama-cpp': { version: depsVer } } }));
    fs.writeFileSync(path.join(deps, 'package.json'), JSON.stringify({ dependencies: { 'node-llama-cpp': depsVer }, overrides: depsOverrides }));
    return project;
  };
  const never = () => { throw new Error('לא אמור להתקין'); };
  assert.throws(() => R.pack(make('3.2.0', { 'simple-git': '4.0.2' }), path.join(tmp(), 'o'), { installer: never }), /3\.2\.0/);
  assert.throws(() => R.pack(make('3.1.0', {}), path.join(tmp(), 'o'), { installer: never }), /overrides/);
});

test('llm-runtime: SHA-256 של העץ הארוז נרשם, ו-install דוחה עץ ששונה', () => {
  const out = path.join(tmp(), 'llm-runtime');
  const project = tmp();
  const deps = path.join(project, 'tools', 'llm-runtime-deps');
  fs.mkdirSync(deps, { recursive: true });
  const lock = JSON.stringify({ packages: { 'node_modules/node-llama-cpp': { version: '3.1.0' } } });
  fs.writeFileSync(path.join(deps, 'package-lock.json'), lock);
  fs.writeFileSync(path.join(deps, 'package.json'), '{}');
  const r = R.pack(project, out, {
    installer: (work) => {
      const p = path.join(work, 'node_modules/node-llama-cpp');
      fs.mkdirSync(path.join(p, 'node_modules/@node-llama-cpp/win-x64'), { recursive: true });
      fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ version: '3.1.0' }));
      fs.writeFileSync(path.join(p, 'index.js'), 'module.exports = 1;');
    }
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'llm-runtime.json'), 'utf8'));
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.sha256, r.sha256);
  assert.equal(manifest.sha256, R.treeHash(path.join(out, 'node_modules')));
  assert.equal(R.install(out, tmp()).version, '3.1.0', 'עץ שלם — מותקן');
  fs.writeFileSync(path.join(out, 'node_modules/node-llama-cpp/index.js'), 'require("child_process");');
  const dest = tmp();
  assert.throws(() => R.install(out, dest), /SHA-256/);
  assert.ok(!fs.existsSync(path.join(dest, 'node_modules/node-llama-cpp')), 'לא הועתק דבר');
  // רכיב ישן בלי טביעה — נדחה (לארוז מחדש)
  delete manifest.sha256;
  fs.writeFileSync(path.join(out, 'llm-runtime.json'), JSON.stringify(manifest));
  assert.throws(() => R.install(out, tmp()), /SHA-256/);
});

test('CI: רכיב ה-AI נארז אחרי ה-Build ובדיקת העלייה (שום קוד של התלויות לא רץ לפני האריזה)', () => {
  const names = stepNames(BUILD_JOB);
  const i = names.indexOf('llm runtime for ci-status');
  assert.ok(i > names.indexOf('Build') && i > names.indexOf('Smoke test (packaged)'), names.join(' | '));
  assert.ok(i < names.indexOf('logs for report'));
  const step = stepText(BUILD_JOB, 'llm runtime for ci-status');
  assert.match(step, /continue-on-error: true/);
  assert.doesNotMatch(step, /secrets\./);
});

/* ---------- בדיקת התלויות השבועית ו-Electron נתמכת ---------- */

test('security.yml: npm audit על כל העץ (גם Electron וכלי הבנייה) ובדיקה מפורשת ש-Electron נתמכת', () => {
  const sec = read('.github', 'workflows', 'security.yml');
  const deps = sec.slice(sec.indexOf('\n  dependencies:'));
  assert.match(deps, /npm audit --audit-level=high/);
  assert.doesNotMatch(deps.replace(/^\s*#.*$/gm, ''), /--omit=dev/);
  assert.match(deps, /cd tools\/llm-runtime-deps && npm audit/);
  assert.match(deps, /node tools\/electron-support\.js "\$\(npm view electron dist-tags\.latest\)"/);
});

test('electron-support: רק שלוש הגרסאות הראשיות האחרונות נתמכות', () => {
  const E = require('../tools/electron-support.js');
  assert.equal(E.supportProblem('45.2.1', '45.2.1'), null);
  assert.equal(E.supportProblem('43.8.6', '45.2.1'), null);
  assert.match(E.supportProblem('42.11.18', '45.2.1'), /כבר לא נתמכת/);
  assert.match(E.supportProblem('38.8.6', '45.2.1'), /38\.8\.6 כבר לא נתמכת \(נתמכות 43–45\)/);
  assert.match(E.supportProblem('', '45.2.1'), /לא נקראה/);
  assert.match(E.supportProblem('45.2.1', 'garbage'), /לא נקראה/);
});

test('Electron: גרסה נתמכת (43 ומעלה), package.json וקובץ הנעילה תואמים', () => {
  const E = require('../tools/electron-support.js');
  const pkg = json('package.json');
  const lock = json('package-lock.json');
  const installed = E.lockedElectron(ROOT);
  assert.ok(Number(installed.split('.')[0]) >= 43, 'Electron ' + installed);
  assert.equal(lock.packages[''].devDependencies.electron, pkg.devDependencies.electron, 'npm ci: קובץ הנעילה תואם');
  assert.equal(pkg.devDependencies.electron.replace(/^\^/, ''), installed);
});

test('Electron 45: ב-preload בארגז חול אין Buffer / setImmediate / require של events, url או timers', () => {
  const files = ['shell/preload.js', 'shell/display-preload.js', 'shell/recovery-preload.js', 'shell/secure-ls-preload.js', 'modules/econ/preload.js'];
  for (const f of files) {
    const src = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /\bBuffer\b|\bsetImmediate\b|\bclearImmediate\b/, f);
    for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) assert.match(m[1], /^electron(\/renderer|\/common)?$/, f + ': ' + m[1]);
    assert.doesNotMatch(src, /\bclipboard\b/, f + ': clipboard הוסר מה-renderer ב-Electron 44');
  }
});

test('npm start: מ-Electron 42 הקובץ נפרס בהפעלה הראשונה (install.js), לא ב-postinstall', () => {
  const { ensureElectronExe } = require('../run-electron');
  const root = tmp();
  const pkgDir = path.join(root, 'node_modules', 'electron');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'install.js'), '');
  const calls = [];
  const exe = ensureElectronExe(root, {
    platform: 'win32',
    spawnSync: (cmd, args) => { calls.push(args[0]); fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true }); fs.writeFileSync(path.join(pkgDir, 'dist', 'electron.exe'), ''); }
  });
  assert.equal(exe, path.join(pkgDir, 'dist', 'electron.exe'));
  assert.deepEqual(calls, [path.join(pkgDir, 'install.js')]);
  // כבר פרוס — בלי הרצה נוספת
  ensureElectronExe(root, { platform: 'win32', spawnSync: () => calls.push('again') });
  assert.equal(calls.length, 1);
});

/* ---------- concurrency: פרסום ממתין לא מתבטל ---------- */

function evalGroup(expr, { ref, inputs = {} }) {
  const startsWith = (s, p) => String(s || '').toLowerCase().startsWith(String(p).toLowerCase());
  const format = (f, ...a) => f.replace(/\{(\d+)\}/g, (_, i) => a[i]);
  return new Function('github', 'inputs', 'startsWith', 'format', '"use strict"; return (' + expr + ');')({ ref }, inputs, startsWith, format);
}

test('build.yml: ריצת פרסום בקבוצת concurrency משלה; דחיפה רגילה לא מבטלת אותה; הדחיפה ל-ci-status בתור', () => {
  const m = /\nconcurrency:\n {2}group: \$\{\{ (.+) \}\}\n {2}cancel-in-progress: false\n/.exec(YML);
  assert.ok(m, 'קבוצה מחושבת ברמת ה-workflow');
  const tag = evalGroup(m[1], { ref: 'refs/tags/v4.1.0' });
  const pub = evalGroup(m[1], { ref: 'refs/heads/master', inputs: { publish: true } });
  const push = evalGroup(m[1], { ref: 'refs/heads/master' });
  const branch = evalGroup(m[1], { ref: 'refs/heads/build/x', inputs: {} });
  assert.equal(push, 'ci-status');
  assert.equal(branch, 'ci-status');
  assert.notEqual(tag, push);
  assert.notEqual(pub, push);
  assert.match(tag, /^publish-/);
  const report = YML.slice(YML.indexOf('\n  report:'));
  assert.match(report, /\n {4}concurrency:\n {6}group: ci-status-push\n {6}cancel-in-progress: false/);
});

/* ---------- זמן קצוב ---------- */

test('run-tests: --test-timeout לכל בדיקה וזמן קצוב להרצה כולה', () => {
  const RT = require('../tools/run-tests.js');
  const args = RT.testArgs({ files: ['tests/a.test.js'] });
  assert.ok(args.includes('--test-timeout=' + RT.TEST_TIMEOUT_MS), args.join(' '));
  assert.ok(RT.TEST_TIMEOUT_MS > 0 && RT.TEST_TIMEOUT_MS <= 10 * 60 * 1000);
  let opts = null;
  const status = RT.run({ files: ['tests/a.test.js'], baseTmp: tmp(), spawn: (cmd, a, o) => { opts = o; return { status: null, error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }) }; } });
  assert.equal(status, 1, 'הרצה שנעצרה — כישלון');
  assert.equal(opts.timeout, RT.RUN_TIMEOUT_MS);
});

test('workflows: timeout-minutes לכל משימה', () => {
  for (const f of ['build.yml', 'security.yml']) {
    const y = read('.github', 'workflows', f);
    const jobs = y.slice(y.indexOf('\njobs:\n'));
    const names = [...jobs.matchAll(/\n {2}([a-z][\w-]*):\n/g)].map(m => m[1]);
    assert.ok(names.length >= 3, f);
    for (const n of names) {
      const start = jobs.indexOf('\n  ' + n + ':\n');
      const head = jobs.slice(start, jobs.indexOf('\n    steps:', start));
      assert.match(head, /\n {4}timeout-minutes: \d+/, f + ': ' + n);
    }
  }
  assert.match(stepText(BUILD_JOB, 'npm test'), /timeout-minutes: \d+/);
});

/* ---------- שרת הממסר: יומנים והגבלת קצב ---------- */

test('docker-compose של שרת הממסר: סבב יומנים לכל שירות ו-Caddy עם הגבלת קצב', () => {
  const dc = read('deploy', 'relay', 'docker-compose.yml');
  assert.match(dc, /x-logging: &logging\n {2}driver: json-file\n {2}options:\n {4}max-size: "10m"\n {4}max-file: "5"/);
  const services = dc.slice(dc.indexOf('\nservices:'), dc.indexOf('\nvolumes:'));
  const names = [...services.matchAll(/\n {2}([a-z]+):\n/g)].map(m => m[1]);
  assert.deepEqual(names, ['relay', 'caddy']);
  const bodies = services.split(/\n {2}[a-z]+:\n/).slice(1);
  assert.equal(bodies.length, 2);
  bodies.forEach((b, i) => assert.match(b, /\n? {4}logging: \*logging/, names[i]));
  assert.match(dc, /dockerfile: Dockerfile\.caddy/);
  assert.match(dc, /\.\/ratelimit:\/etc\/caddy\/ratelimit:ro/);
  assert.doesNotMatch(dc, /image: caddy:2-alpine/, 'התמונה הרגילה בלי התוסף');
  assert.match(read('deploy', 'relay', 'Dockerfile.caddy'), /xcaddy build --with github\.com\/mholt\/caddy-ratelimit@v\d+\.\d+\.\d+/);
  const caddy = read('deploy', 'relay', 'Caddyfile');
  const handle = caddy.slice(caddy.indexOf('handle @relay {'), caddy.indexOf('}', caddy.indexOf('handle @relay {')));
  assert.ok(handle.indexOf('import /etc/caddy/ratelimit/*.caddy') >= 0 && handle.indexOf('import') < handle.indexOf('reverse_proxy'), 'ההגבלה לפני השרת');
  const rl = read('deploy', 'relay', 'ratelimit', 'relay.caddy');
  assert.match(rl, /route \{\s*rate_limit \{\s*zone \w+ \{\s*key \{remote_host\}\s*events \d+\s*window 1m/);
});
