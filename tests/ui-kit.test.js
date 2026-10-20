// ספריית הרכיבים המשותפת (shell/ui-kit.css): מקור אחד לכפתורים, שדות וכרטיסים בכל המסכים.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KIT = read('shell/ui-kit.css');

test('ui-kit: ערכים רק ממשתני --ss-*, בלי צבע hex', () => {
  assert.doesNotMatch(KIT, /#[0-9a-f]{3,8}\b/i);
  for (const c of ['.ss-btn', '.ss-btn-primary', '.ss-btn-secondary', '.ss-btn-danger', '.ss-btn-ghost', '.ss-input', '.ss-card', '.ss-table', '.ss-badge'])
    assert.ok(KIT.includes(c), 'חסר רכיב: ' + c);
});

test('ui-kit: כל מסך טוען את הספרייה אחרי שפת העיצוב', () => {
  const pages = {
    'shell/shell.html': 'ui-kit.css',
    'modules/econ/views/index.html': '/ui-kit.css',
    'modules/shamai/index.html': '/ui-kit.css',
    'modules/tools/index.html': '/ui-kit.css',
  };
  for (const [p, href] of Object.entries(pages)) {
    const html = read(p);
    const kit = html.indexOf(`href="${href}"`);
    assert.ok(kit > 0, p + ': לא טוען את ui-kit.css');
    assert.ok(html.indexOf('design-tokens.css') < kit, p + ': ui-kit.css לפני design-tokens.css');
  }
  for (const p of ['modules-src/trainer/index.html', 'modules/trainer/index.html']) {
    const html = read(p);
    const kit = html.indexOf('href="/ui-kit.css"');
    assert.ok(kit > 0 && html.indexOf('href="/design-tokens.css"') < kit, p + ': ui-kit לא נטען אחרי שפת העיצוב');
  }
});

test('ui-kit: מוגש מהמעטפת לכל מודול ומועתק לאנדרואיד', () => {
  assert.match(read('main.js'), /rel === '\/ui-kit\.css'/);
  const apk = read('android/build-apk.js');
  assert.match(apk, /'ui-kit\.css'\), path\.join\(dst, 'ui-kit\.css'\)/);
  assert.match(apk, /'design-tokens\.css', 'ui-kit\.css'/);
});

test('ui-kit: כל מודול ממפה את הכפתורים, השדות והכרטיסים שלו לאותם ערכים', () => {
  const maps = {
    'modules/econ/styles.css': ['--ss-ctl-h', '--ss-ctl-radius', '--ss-focus', '--ss-radius-lg'],
    'modules/shamai/style.css': ['--ss-ctl-h', '--ss-ctl-radius', '--ss-focus'],
    'modules/tools/index.html': ['--ss-ctl-h', '--ss-ctl-radius', '--ss-focus', '--ss-radius-lg'],
    'shell/shell.html': ['--ss-ctl-h', '--ss-ctl-radius', '--ss-focus'],
    'modules-src/trainer/src/theme.css': ['--ss-ctl-h', '--ss-ctl-radius', '--ss-focus', '--ss-radius-lg'],
  };
  for (const [p, vars] of Object.entries(maps)) {
    const src = read(p);
    const i = src.indexOf('ui-kit — מיפוי');
    assert.ok(i >= 0, p + ': חסר בלוק המיפוי');
    const block = src.slice(i);
    for (const v of vars) assert.ok(block.includes(`var(${v})`), `${p}: המיפוי לא משתמש ב-${v}`);
    assert.doesNotMatch(block.split('</style>')[0], /#[0-9a-f]{3,8}\b/i, p + ': צבע hex בבלוק המיפוי');
  }
});

test('ui-kit: כותרת עמוד, מדדים, לשוניות ותגיות מצב — רכיב אחד לכל התוכנה', () => {
  for (const c of ['.ss-page-head', '.ss-kpis', '.ss-kpi', '.ss-tabs', '.ss-tab', '.ss-badge-success', '.ss-badge-warning', '.ss-badge-danger', '.ss-badge-info'])
    assert.ok(KIT.includes(c), 'חסר רכיב: ' + c);
  // כל מודול ממפה גם את הכותרות והמדדים לאותם ערכים
  const second = {
    'modules/econ/styles.css': ['--ss-fs-xl', '--ss-shadow-sm', '--ss-surface-2'],
    'modules/shamai/style.css': ['--ss-fs-xl', '--ss-shadow-sm'],
    'modules/tools/index.html': ['--ss-fs-xl'],
    'modules-src/trainer/src/theme.css': ['--ss-fs-xl'],
  };
  for (const [p, vars] of Object.entries(second)) {
    const src = read(p);
    const i = src.indexOf('ui-kit — מיפוי 2');
    assert.ok(i >= 0, p + ': חסר בלוק המיפוי של הכותרות והמדדים');
    const block = src.slice(i).split('</style>')[0];
    for (const v of vars) assert.ok(block.includes(`var(${v})`), `${p}: המיפוי לא משתמש ב-${v}`);
    assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i, p + ': צבע hex בבלוק המיפוי');
  }
});
