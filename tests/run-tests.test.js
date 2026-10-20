// tools/run-tests.js: הבדיקות רצות בתיקייה זמנית משלהן, והיא נמחקת בסוף — גם כשבדיקה נכשלה.
// (עד 21.10.2026 כל הרצה השאירה מאות תיקיות ב-%TEMP%, ובסוף הכונן התמלא)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const RT = require('../tools/run-tests');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-runtests-'));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

// במקום להריץ את כל הבדיקות: "תהליך בדיקות" מדומה שכותב לתיקייה הזמנית שקיבל
function fakeSpawn(status) {
  const seen = {};
  const spawn = (cmd, args, opts) => {
    seen.args = args;
    seen.env = opts.env;
    fs.mkdirSync(path.join(opts.env.TEMP, 'ss-leftover-abc123', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(opts.env.TEMP, 'ss-leftover-abc123', 'deep', 'db.sqlite'), 'x');
    return { status };
  };
  return { seen, spawn };
}

test('TEMP / TMP / TMPDIR מופנים לתיקייה אחת, והיא נמחקת בסוף', () => {
  const f = fakeSpawn(0);
  assert.equal(RT.run({ baseTmp: base, spawn: f.spawn, files: ['tests/a.test.js'] }), 0);
  assert.equal(f.seen.env.TEMP, f.seen.env.TMP);
  assert.equal(f.seen.env.TEMP, f.seen.env.TMPDIR);
  assert.ok(f.seen.env.TEMP.startsWith(base));
  assert.equal(fs.existsSync(f.seen.env.TEMP), false, 'התיקייה נמחקה');
  assert.deepEqual(fs.readdirSync(base), []);
});

test('בדיקה שנכשלה — קוד היציאה עובר הלאה, והתיקייה בכל זאת נמחקת', () => {
  const f = fakeSpawn(1);
  assert.equal(RT.run({ baseTmp: base, spawn: f.spawn, files: [] }), 1);
  assert.equal(fs.existsSync(f.seen.env.TEMP), false);
});

test('--serial מריץ אחת-אחת; כל קובצי tests/*.test.js נאספים', () => {
  const f = fakeSpawn(0);
  RT.run({ baseTmp: base, spawn: f.spawn, serial: true, files: ['x'] });
  assert.ok(f.seen.args.includes('--test-concurrency=1'));
  const files = RT.testFiles();
  assert.ok(files.includes(path.join('tests', 'run-tests.test.js')));
  assert.ok(files.every(x => x.endsWith('.test.js')));
});

test('npm test עובר דרך tools/run-tests.js', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node tools/run-tests.js');
  assert.equal(pkg.scripts['test:serial'], 'node tools/run-tests.js --serial');
});
