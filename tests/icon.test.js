// אייקון התוכנה (PLAN.md 7.2): קובץ ICO תקין בכל הגדלים, ו-PNG בגודל 512
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildIco, readIco, ICO_SIZES } = require('../tools/make-icon');

const ROOT = path.join(__dirname, '..');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

test('build/icon.ico מכיל את כל הגדלים, כל אחד PNG בגודל הנכון', () => {
  const imgs = readIco(fs.readFileSync(path.join(ROOT, 'build', 'icon.ico')));
  assert.deepEqual(imgs.map(i => i.size), ICO_SIZES);
  for (const { size, png } of imgs) {
    assert.ok(png.subarray(0, 8).equals(PNG_SIG), 'PNG בגודל ' + size);
    assert.deepEqual(pngSize(png), { w: size, h: size });
  }
});

test('build/icon.png בגודל 512', () => {
  const b = fs.readFileSync(path.join(ROOT, 'build', 'icon.png'));
  assert.ok(b.subarray(0, 8).equals(PNG_SIG));
  assert.deepEqual(pngSize(b), { w: 512, h: 512 });
});

test('buildIco ו-readIco הפוכים זה לזה (גם 256 שנרשם כ-0)', () => {
  const a = Buffer.from('aaa'), b = Buffer.from('bbbbb');
  const out = readIco(buildIco([{ size: 16, png: a }, { size: 256, png: b }]));
  assert.equal(out[0].size, 16); assert.ok(out[0].png.equals(a));
  assert.equal(out[1].size, 256); assert.ok(out[1].png.equals(b));
});

test('מקור האייקון קיים ונכלל בבנייה', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'build', 'icon.svg')));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('build/icon.png'));
  assert.equal(pkg.build.win.icon, 'build/icon.ico');
});

test('אנדרואיד: אייקון לכל צפיפות מסך ולוגו למסך הפתיחה', () => {
  const { ANDROID_ICONS, ANDROID_SPLASH } = require('../tools/make-icon');
  for (const [dpi, size] of Object.entries(ANDROID_ICONS)) {
    const b = fs.readFileSync(path.join(ROOT, 'build', 'android', 'mipmap-' + dpi, 'ic_launcher.png'));
    assert.ok(b.subarray(0, 8).equals(PNG_SIG));
    assert.deepEqual(pngSize(b), { w: size, h: size }, dpi);
  }
  const s = fs.readFileSync(path.join(ROOT, 'build', 'android', 'drawable-xxxhdpi', 'splash_logo.png'));
  assert.deepEqual(pngSize(s), { w: ANDROID_SPLASH, h: ANDROID_SPLASH });
});

test('אנדרואיד: מסך פתיחה נייבי במקום לבן, והבנייה מעתיקה את המשאבים', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'android', 'app', 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:theme="@style\/SuperSuite\.Launch"/);
  const styles = fs.readFileSync(path.join(ROOT, 'android', 'app', 'res', 'values', 'styles.xml'), 'utf8');
  assert.match(styles, /windowBackground">@drawable\/launch_bg/);
  const tokens = fs.readFileSync(path.join(ROOT, 'shell', 'design-tokens.css'), 'utf8');
  const navy = styles.match(/name="ss_navy">(#[0-9a-f]{6})/i)[1];
  assert.match(tokens, new RegExp('--ss-navy-1: ' + navy + ';', 'i'), 'אותו נייבי כמו בשפת העיצוב');
  assert.match(fs.readFileSync(path.join(ROOT, 'android', 'app', 'res', 'drawable', 'launch_bg.xml'), 'utf8'), /@drawable\/splash_logo/);
  const build = fs.readFileSync(path.join(ROOT, 'android', 'build-apk.js'), 'utf8');
  assert.match(build, /copyResDir\(path\.join\(ROOT, 'build', 'android'\)/);
  assert.match(build, /copyResDir\(path\.join\(AND, 'app', 'res'\)/);
  const main = fs.readFileSync(path.join(ROOT, 'android', 'app', 'java', 'com', 'bunimseller', 'supersuite', 'MainActivity.java'), 'utf8');
  assert.match(main, /web\.setBackgroundColor\(Color\.TRANSPARENT\)/, 'מסך הפתיחה נראה עד שהעמוד נטען');
  assert.match(main, /onPageFinished[\s\S]*view\.setBackgroundColor\(Color\.parseColor/, 'ואחרי הטעינה — רקע רגיל');
});
