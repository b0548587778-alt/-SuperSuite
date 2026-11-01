// בדיקת קוד 23.10.2026 — קבוצת "CI, כלים ובדיקות": בדיקות רגרסיה לממצאים 33, 34 ולממצאים הנמוכים
// (חתימה עם רווח, פיצול הסיסמאות, בדיקות שתלויות בסדר).
// ממצא 44 (תאריך קבוע בבדיקה) — ב-tests/integration.test.js; שבת במעטפת — ב-tests/shell-ui.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const TMP = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-ci-' + prefix)); TMP.push(d); return d; };
test.after(() => { for (const d of TMP) fs.rmSync(d, { recursive: true, force: true }); });

// ── build.yml: משימות וצעדים ──
const YML = read('.github', 'workflows', 'build.yml');
const BUILD_JOB = YML.slice(YML.indexOf('\n  build:'), YML.indexOf('\n  publish:'));
const PUBLISH_JOB = YML.slice(YML.indexOf('\n  publish:'), YML.indexOf('\n  report:'));

// הצעדים של משימה, בלי שורות הערה (הערה לפני צעד שייכת בפיצול לצעד הקודם)
function steps(job) {
  const body = job.slice(job.indexOf('\n    steps:\n'));
  return body.split(/\n {6}- /).slice(1).map(t => {
    const text = ('- ' + t).replace(/^\s*#.*$/gm, '');
    const m = /^- (?:name: (.+)|uses: (.+)|run: (.+))/.exec(text);
    return { name: m ? (m[1] || m[2] || m[3]).trim() : '', text };
  });
}
const step = (job, name) => steps(job).find(s => s.name === name);
const ifOf = (text) => { const m = /^\s+if: \$\{\{ (.+?) \}\}\s*$/m.exec(text); return m ? m[1] : null; };

// מעריך מצומצם לביטויי GitHub — רק הצורות שבשימוש ב-build.yml. צורה אחרת: לעדכן את הבדיקה, לא לנחש
function evaluate(expr, ctx) {
  assert.match(expr, /^(?:\s|\|\||&&|\(|\)|==|!=|!|,|'[^']*'|inputs\.\w+|github\.ref|needs\.\w+\.result|startsWith)+$/, 'ביטוי לא מוכר: ' + expr);
  const fn = new Function('inputs', 'github', 'needs', 'startsWith', '"use strict"; return (' + expr + ');');
  return Boolean(fn(ctx.inputs || {}, ctx.github, ctx.needs || {}, (s, p) => String(s ?? '').toLowerCase().startsWith(String(p).toLowerCase())));
}

const SCENARIOS = [
  { name: 'דחיפת תגית v3.11.0', github: { ref: 'refs/tags/v3.11.0' }, inputs: {}, release: true, publish: true },
  { name: 'הפעלה ידנית עם publish', github: { ref: 'refs/heads/master' }, inputs: { release: false, publish: true }, release: true, publish: true },
  { name: 'הפעלה ידנית עם release', github: { ref: 'refs/heads/master' }, inputs: { release: true, publish: false }, release: true, publish: false },
  { name: 'הפעלה ידנית בלי בחירה', github: { ref: 'refs/heads/master' }, inputs: { release: false, publish: false }, release: false, publish: false },
  { name: 'דחיפה ל-master', github: { ref: 'refs/heads/master' }, inputs: {}, release: false, publish: false },
  { name: 'דחיפה לענף build/test', github: { ref: 'refs/heads/build/test' }, inputs: {}, release: false, publish: false },
];

test('ממצא 33: בכל ריצה שמפרסמת (תגית v* או publish) — בדיקת ההפצה רצה; בדחיפה רגילה — לא', () => {
  const releaseIf = ifOf(step(BUILD_JOB, 'Release check').text);
  const installerIf = ifOf(step(BUILD_JOB, 'installer for publish').text);
  const publishIf = ifOf(PUBLISH_JOB.slice(0, PUBLISH_JOB.indexOf('\n    steps:')));
  assert.ok(releaseIf && installerIf && publishIf, 'נמצאו שלושת התנאים');
  for (const sc of SCENARIOS) {
    const ctx = { ...sc, needs: { build: { result: 'success' } } };
    const publishes = evaluate(publishIf, ctx) || evaluate(installerIf, ctx);
    const checked = evaluate(releaseIf, ctx);
    assert.equal(publishes, sc.publish, sc.name + ': פרסום');
    assert.equal(checked, sc.release, sc.name + ': בדיקת ההפצה');
    if (publishes) assert.ok(checked, sc.name + ': מתקין לציבור בלי בדיקת ההפצה');
  }
  // בקרה על המעריך: התנאי הישן (inputs.release בלבד) מפספס את התגית — זה הבאג שתוקן
  const tag = { ...SCENARIOS[0], needs: { build: { result: 'success' } } };
  assert.equal(evaluate('inputs.release', tag), false);
  assert.equal(evaluate(publishIf, tag), true);
  assert.equal(evaluate(publishIf, { ...tag, needs: { build: { result: 'failure' } } }), false, 'בנייה שנכשלה — אין פרסום');
});

test('ממצא 34: סודות החתימה רק בצעד שאין בו התקנת חבילות; אין סודות ברמת המשימה', () => {
  const head = BUILD_JOB.slice(0, BUILD_JOB.indexOf('\n    steps:'));
  assert.doesNotMatch(head.replace(/^\s*#.*$/gm, ''), /secrets\./, 'סוד ברמת המשימה היה זמין גם ל-npm install');
  const all = steps(BUILD_JOB);
  const withSecrets = all.filter(s => /secrets\./.test(s.text));
  assert.ok(withSecrets.length >= 1, 'צעד החתימה קיים');
  for (const s of withSecrets) {
    assert.doesNotMatch(s.text, /\bnpm (?:install|i|ci|exec|run|test)\b|--no-save|tools\/minify\.js/, s.name + ': קוד של חבילות רץ ליד הסודות');
    // npx בלי החבילה מקומית מוריד את הגרסה העדכנית מה-registry (ב-CI בלי שאלה) ומריץ אותה עם הסודות
    assert.doesNotMatch(s.text, /\bnpx\b/, s.name + ': npx ליד הסודות');
  }
  for (const name of ['npm ci (minify)', 'npm install', 'npm test', 'minify']) {
    const s = step(BUILD_JOB, name);
    assert.ok(s, 'צעד ' + name);
    assert.doesNotMatch(s.text, /secrets\./, name + ': בלי סודות');
  }
});

test('ממצא 34: הכיווץ — צעד נפרד בלי סודות, עם esbuild הנעול (tools/minify-deps, בלי npm install --no-save)', () => {
  assert.doesNotMatch(BUILD_JOB, /npm install --no-save/);
  const names = steps(BUILD_JOB).map(s => s.name);
  const minify = step(BUILD_JOB, 'minify');
  assert.match(minify.text, /NODE_PATH: \$\{\{ github\.workspace \}\}\/tools\/minify-deps\/node_modules/);
  assert.match(minify.text, /node tools\/minify\.js/);
  assert.ok(names.indexOf('npm test') < names.indexOf('minify') && names.indexOf('minify') < names.indexOf('Build'), 'אחרי הבדיקות, לפני האריזה');
  // NODE_PATH מוצא את esbuild מקובץ הנעילה של tools/minify-deps (npm ci בצעד קודם, בלי סודות), בגרסה מדויקת
  const pkg = JSON.parse(read('tools', 'minify-deps', 'package.json'));
  const lock = JSON.parse(read('tools', 'minify-deps', 'package-lock.json'));
  const ver = pkg.devDependencies && pkg.devDependencies.esbuild;
  assert.match(String(ver), /^\d+\.\d+\.\d+$/, 'בלי ^ או ~');
  assert.equal(lock.packages['node_modules/esbuild'] && lock.packages['node_modules/esbuild'].version, ver);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies, 'קובץ הנעילה תואם ל-package.json (npm ci)');
  for (const [k, v] of Object.entries(lock.packages)) if (k) assert.match(String(v.integrity), /^sha512-/, k + ': עם integrity');
  const ci = step(BUILD_JOB, 'npm ci (minify)');
  assert.match(ci.text, /working-directory: tools\/minify-deps/);
  assert.match(ci.text, /\bnpm ci\b/);
  assert.doesNotMatch(ci.text, /npm install/);
  assert.ok(names.indexOf('npm ci (minify)') < names.indexOf('minify'));
  assert.match(read('tools', 'minify.js'), /require\('esbuild'\)/);
});

test('ממצא 34: node-llama-cpp בגרסה מדויקת, וקובץ הנעילה של השורש תואם ל-package.json (npm ci)', () => {
  const pkg = JSON.parse(read('package.json'));
  const pin = (pkg.dependencies || {})['node-llama-cpp'] || (pkg.optionalDependencies || {})['node-llama-cpp'];
  assert.match(String(pin), /^\d+\.\d+\.\d+$/, 'בלי ^ או ~: הגרסה נפרסת ל-app.asar.unpacked, מחוץ לבדיקת השלמות');
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.packages['node_modules/node-llama-cpp'].version, pin);
  // npm ci נכשל כשהדרישות בשורש קובץ הנעילה שונות מ-package.json
  for (const k of ['dependencies', 'optionalDependencies', 'devDependencies']) {
    assert.deepEqual(lock.packages[''][k] || {}, pkg[k] || {}, 'קובץ הנעילה מול package.json: ' + k);
  }
  assert.match(step(BUILD_JOB, 'npm install').text, /grep -q '"node_modules\/node-llama-cpp"' package-lock\.json; then CMD="npm ci"/);
});

// ── חתימת קוד: ערך עם רווח ──
const SIGN_KEYS = ['SS_SIGN_SHA1', 'CSC_LINK', 'WIN_CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_KEY_PASSWORD', 'SS_AZURE_ENDPOINT',
  'SS_AZURE_ACCOUNT', 'SS_AZURE_PROFILE', 'SS_SIGN_PUBLISHER', 'SS_SIGN_REQUIRED', 'SS_SIGN_TIMESTAMP'];
const AZURE = { SS_AZURE_ENDPOINT: 'https://weu.codesigning.azure.net', SS_AZURE_ACCOUNT: 'acc', SS_AZURE_PROFILE: 'prof', SS_SIGN_PUBLISHER: 'Bunim Seller' };

test('חתימה: --args מדפיס דגל אחד בכל שורה, ו-mapfile מחזיר אותם כמו שהם — "Bunim Seller" ארגומנט אחד', (t) => {
  const { signingArgs } = require('../tools/code-signing');
  const env = { ...process.env, ...AZURE };
  for (const k of SIGN_KEYS) if (!(k in AZURE)) delete env[k];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'code-signing.js'), '--args'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const expected = signingArgs(AZURE).args;
  assert.ok(expected.includes('-c.win.azureSignOptions.publisherName=Bunim Seller'));
  assert.equal(r.stdout, expected.map(a => a + '\n').join(''));
  // כמו בצעד Build: mapfile -t ARGS ואז "${ARGS[@]}"
  const sh = spawnSync('bash', ['-c', 'mapfile -t A; printf "%s\\0" "${A[@]}"'], { input: r.stdout, encoding: 'utf8' });
  if (sh.error || sh.status !== 0) { t.skip('אין bash במחשב הזה'); return; }
  assert.deepEqual(sh.stdout.split('\0').slice(0, -1), expected);
});

test('חתימה: ערך עם ירידת שורה נדחה (היה מתפרק לשני דגלים), ו-build.yml קורא למערך ולא מפרק על רווחים', () => {
  const { signingArgs } = require('../tools/code-signing');
  assert.throws(() => signingArgs({ ...AZURE, SS_SIGN_PUBLISHER: 'Bunim\nSeller' }), /ירידת שורה/);
  assert.throws(() => signingArgs({ ...AZURE, SS_AZURE_PROFILE: 'a\r\nb' }), /ירידת שורה/);
  const build = step(BUILD_JOB, 'Build').text;
  assert.match(build, /node tools\/code-signing\.js --args > "\$RUNNER_TEMP\/sign-args\.txt"/);
  assert.match(build, /mapfile -t ARGS < "\$RUNNER_TEMP\/sign-args\.txt"/);
  assert.match(build, /node node_modules\/electron-builder\/out\/cli\/cli\.js [^\n]*"\$\{ARGS\[@\]\}"/);
  assert.doesNotMatch(build, /\$\(node tools\/code-signing\.js --args\)/, 'פירוק על רווחים');
  assert.doesNotMatch(build, /\$ARGS\b/);
  assert.match(build, /set -eo pipefail/, 'שגיאה בהגדרות החתימה עוצרת את הצעד');
});

// גוף ה-run: | של צעד (בלי ההזחה של ה-YAML)
function runScript(stepText) {
  const lines = stepText.split('\n');
  const i = lines.findIndex(l => /^\s+run: \|\s*$/.test(l));
  assert.ok(i >= 0, 'run: | בצעד');
  const indent = lines[i].length - lines[i].trimStart().length + 2;
  const body = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() === '') { body.push(''); continue; }
    if (l.length - l.trimStart().length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

test('ממצא 34: צעד Build כמו שהוא — electron-builder מקובץ הנעילה דרך node, בלי npx, ו-"Bunim Seller" ארגומנט אחד', (t) => {
  const { signingArgs } = require('../tools/code-signing');
  const script = runScript(step(BUILD_JOB, 'Build').text);
  const dir = tmp('build-step-').replace(/\\/g, '/');
  // node על cli.js של electron-builder — רושם את הארגומנטים במקום לארוז; כל node אחר — האמיתי. npx — כישלון
  const prelude = [
    'node() { if [ "$1" = node_modules/electron-builder/out/cli/cli.js ]; then shift; printf "%s\\0" "$@" > "$EB_ARGV"; else "$NODE_BIN" "$@"; fi; }',
    'npx() { echo "npx נקרא" >&2; exit 97; }',
  ].join('\n');
  const env = { ...process.env, ...AZURE, RUNNER_TEMP: dir, LOG: dir + '/build.log', EB_ARGV: dir + '/eb-argv',
    NODE_BIN: process.execPath.replace(/\\/g, '/') };
  for (const k of SIGN_KEYS) if (!(k in AZURE)) delete env[k];
  const r = spawnSync('bash', ['-c', prelude + '\n' + script], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
  if (r.error) { t.skip('אין bash במחשב הזה'); return; }
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  const argv = fs.readFileSync(dir + '/eb-argv', 'utf8').split('\0').slice(0, -1);
  assert.deepEqual(argv, ['--win', 'nsis', 'portable', '--publish', 'never', ...signingArgs(AZURE).args]);
  assert.ok(argv.includes('-c.win.azureSignOptions.publisherName=Bunim Seller'));
  assert.match(fs.readFileSync(dir + '/build.log', 'utf8'), /== code-signing[\s\S]*== electron-builder/);
});

test('ממצא 34: הנתיב של electron-builder ב-build.yml הוא החבילה מקובץ הנעילה', (t) => {
  const lock = JSON.parse(read('package-lock.json'));
  const locked = lock.packages['node_modules/electron-builder'];
  assert.ok(locked && /^\d+\.\d+\.\d+$/.test(locked.version), 'electron-builder בקובץ הנעילה');
  const dir = path.join(ROOT, 'node_modules', 'electron-builder');
  if (!fs.existsSync(dir)) { t.skip('electron-builder לא מותקן כאן'); return; }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.version, locked.version);
  assert.ok(fs.existsSync(path.join(dir, 'out', 'cli', 'cli.js')), 'out/cli/cli.js בחבילה');
  // ה-bin הרשמי רק טוען את out/cli/cli.js — אותו קוד, בלי ה-wrapper של npm
  assert.match(fs.readFileSync(path.join(dir, pkg.bin['electron-builder']), 'utf8'), /require\(["']\.\/out\/cli\/cli["']\)/);
});

test('README הראשי: אין הפניה ל-Artifacts — תוצאת הבנייה ב-ci-status, המתקין במאגר ההורדות', () => {
  const md = read('README.md');
  // "ההתקנה תופיע ב-Artifacts" — אין artifacts ב-build.yml, וההורדה שלהם חסומה ב-NetFree
  assert.doesNotMatch(md, /Artifacts/);
  assert.match(md, /git fetch origin ci-status/);
  assert.match(md, /docs\/DOWNLOADS\.md/);
});

test('מדריך ההורדות (ממצא 33): פרסום מריץ את בדיקת ההפצה, ואין הבטחה שאפשר לפרסם עם רישוי כבוי', () => {
  const md = read('docs', 'DOWNLOADS.md');
  const publishing = md.slice(md.indexOf('## פרסום גרסה'), md.indexOf('## חשוב לדעת'));
  assert.match(publishing, /tools\/release-check\.js/);
  assert.match(publishing, /root-keys\.js/);
  assert.match(publishing, /https/);
  assert.match(publishing, /ci-status/);
  // הנוסח הישן: "הרישוי כבוי: מי שמוריד מקבל את התוכנה המלאה" — מאז ממצא 33 גרסה כזו לא מתפרסמת
  assert.doesNotMatch(md, /מי שמוריד מקבל את התוכנה המלאה/);
});

// ── כלי הסיסמאות (Python): חלקים מפיצולים שונים ──
// הספרייה cryptography חסומה בסביבה המסוננת: בלעדיה — Fernet מדומה (XOR עם זרם SHA-256 ו-HMAC),
// כך שנבדקת הלוגיקה של הפיצול וההרכבה. כשהספרייה מותקנת (למשל ב-CI) — הספרייה האמיתית
const FAKE_FERNET = `import base64, hashlib, hmac, os

class InvalidToken(Exception):
    pass

class Fernet:
    def __init__(self, key):
        if isinstance(key, str):
            key = key.encode("ascii")
        try:
            raw = base64.urlsafe_b64decode(key)
        except Exception as exc:
            raise ValueError("bad key") from exc
        if len(raw) != 32:
            raise ValueError("bad key")
        self._k = raw

    @staticmethod
    def generate_key():
        return base64.urlsafe_b64encode(os.urandom(32))

    def _stream(self, iv, n):
        out, c = b"", 0
        while len(out) < n:
            out += hashlib.sha256(self._k + iv + c.to_bytes(4, "big")).digest()
            c += 1
        return out[:n]

    def encrypt(self, data):
        iv = os.urandom(16)
        ct = bytes(a ^ b for a, b in zip(data, self._stream(iv, len(data))))
        mac = hmac.new(self._k, iv + ct, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(b"\\x80" + iv + ct + mac)

    def decrypt(self, token):
        try:
            raw = base64.urlsafe_b64decode(token)
        except Exception as exc:
            raise InvalidToken() from exc
        if len(raw) < 49 or raw[0] != 0x80:
            raise InvalidToken()
        iv, ct, mac = raw[1:17], raw[17:-32], raw[-32:]
        if not hmac.compare_digest(mac, hmac.new(self._k, iv + ct, hashlib.sha256).digest()):
            raise InvalidToken()
        return bytes(a ^ b for a, b in zip(ct, self._stream(iv, len(ct))))
`;
const PY_DRIVER = `import sys, unittest
stub, pw = sys.argv[1], sys.argv[2]
try:
    import cryptography.fernet
    print("fernet: real")
except ImportError:
    sys.path.insert(0, stub)
    print("fernet: stub")
sys.path.insert(0, pw)
suite = unittest.defaultTestLoader.loadTestsFromName("test_encryption")
result = unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
`;

function findPython() {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8', timeout: 20000 });
    if (!r.error && r.status === 0 && r.stdout.trim() === '3') return cmd;
  }
  return null;
}

test('כלי הסיסמאות: חלקים מפיצולים שונים, חלק כפול ומספר חלקים שגוי — נדחים (בדיקות ה-Python)', (t) => {
  const py = findPython();
  if (!py) { t.skip('אין Python 3 במחשב הזה'); return; }
  const dir = tmp('py-');
  fs.mkdirSync(path.join(dir, 'stub', 'cryptography'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'stub', 'cryptography', '__init__.py'), '');
  fs.writeFileSync(path.join(dir, 'stub', 'cryptography', 'fernet.py'), FAKE_FERNET);
  fs.writeFileSync(path.join(dir, 'run.py'), PY_DRIVER);
  // -B: בלי __pycache__ בתיקיית הכלי
  const r = spawnSync(py, ['-B', path.join(dir, 'run.py'), path.join(dir, 'stub'), path.join(ROOT, 'tools', 'passwords')], {
    encoding: 'utf8', timeout: 180000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  t.diagnostic((/fernet: (\w+)/.exec(out) || [])[0] || '');
  assert.equal(r.status, 0, out.slice(-3000));
  for (const name of ['test_parts_from_different_splits_rejected', 'test_duplicate_part_rejected', 'test_n_parts_must_match_the_split',
    'test_token_without_split_header_rejected', 'test_too_many_parts_rejected', 'test_roundtrip_various_n']) {
    assert.match(out, new RegExp(name + '[^\\n]*\\.\\.\\. ok'), name);
  }
});

// ── בדיקות שהיו תלויות בסדר: כל אחת עוברת גם לבדה ──
// לפני התיקון הן נשענו על מצב (כניסה, מסד, חשבוניות, קבצים) שבדיקה קודמת באותו קובץ השאירה
const ISOLATED = [
  ['regressions-r2.test.js', 'אי אפשר לבטל גבייה ישירות'],
  ['regressions-r2.test.js', 'הוצאות אישיות: נשמרות בנפרד'],
  ['restore-module-counters.test.js', 'ממצא 5 (המסך הכלכלי)'],
  ['advisory-invoice-cancel.test.js', 'תיווך (עוסק פטור)'],
  ['campaigns.test.js', 'IPC: תרומה וייבוא עם שגריר'],
  ['licensing-shell.test.js', 'שינוי סטטוס בזמן עבודה'],
  ['ipc-guard.test.js', 'פעולות חשבונאות נרשמות ביומן ביקורת'],
  ['login-required.test.js', 'ערוצי הכניסה הציבוריים'],
  ['backup-econ-failure.test.js', 'גיבוי: כשל בקריאת מודול'],
  ['aiassist-gate.test.js', 'owner:modelSign — מנהל-העל חותם'],
  ['main-behavior.test.js', 'שחזור מהמעטפת: מודול כלכלי מחובר בלי הרשאת שחזור'],
  ['main-behavior.test.js', 'אחורה/קדימה'],
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function runAlone(file, name) {
  // בלי NODE_TEST_CONTEXT: אחרת התהליך מזהה שהוא בתוך הרצת בדיקות ולא מריץ את הקובץ
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return new Promise((resolve) => {
    execFile(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=' + escapeRe(name), path.join(__dirname, file)],
      { cwd: ROOT, env, encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: stdout + stderr }));
  });
}

test('בדיקות שהיו תלויות בסדר עוברות כשהן רצות לבד', async () => {
  const results = await Promise.all(ISOLATED.map(([file, name]) => runAlone(file, name)));
  ISOLATED.forEach(([file, name], i) => {
    const { code, out } = results[i];
    const label = file + ' / ' + name;
    const pass = Number((/^# pass (\d+)/m.exec(out) || [])[1]);
    const fail = Number((/^# fail (\d+)/m.exec(out) || [])[1]);
    assert.equal(fail, 0, label + '\n' + out.slice(-3000));
    assert.equal(code, 0, label + '\n' + out.slice(-3000));
    assert.ok(pass >= 1, label + ': הבדיקה לא נמצאה לפי השם');
    assert.match(out, new RegExp('^ok \\d+ - [^\\n]*' + escapeRe(name), 'm'), label);
  });
});
