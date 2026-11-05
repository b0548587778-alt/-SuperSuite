// תווי כיוון גולמיים (bidi) בקוד נחסמים ב-semgrep (generic.unicode.security.bidi) — רק כ-\u בקוד
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIDI = /[\u202a-\u202e\u2066-\u2069]/;

test('אין תווי כיוון גולמיים בקובצי קוד במאגר', (t) => {
  let files;
  try { files = execFileSync('git', ['ls-files', '*.js', '*.html', '*.css'], { cwd: ROOT }).toString().split('\n').filter(Boolean); }
  catch { t.skip('אין git'); return; }
  const bad = files.filter(f => !f.startsWith('android/build/') && fs.existsSync(path.join(ROOT, f))
    && BIDI.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(bad, []);
});
