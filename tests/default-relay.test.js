// כתובת שרת הרישוי שמוגדרת מראש (PLAN.md 4.4): התקנה חדשה מכירה את השרת בלי הגדרה ידנית,
// כתובת שהמנהל בחר גוברת, ומחיקת הכתובת מכבה את החיבור לשרת.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DEFAULT_RELAY_URL } = require('../shell/licensing/default-relay');
const { validateUrl } = require('../shell/licensing/remote');
const { createLicenseStore } = require('../shell/licensing/store');

const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const storeWith = (defaultUrl) => createLicenseStore({ storage: one(), secret: one(), defaultUrl });

test('כתובת ברירת המחדל: https תקינה, בלי נתיב', () => {
  assert.equal(validateUrl(DEFAULT_RELAY_URL), DEFAULT_RELAY_URL);
  assert.match(DEFAULT_RELAY_URL, /^https:\/\//);
});

test('התקנה חדשה: כתובת ברירת המחדל מוחזרת', () => {
  assert.equal(storeWith(DEFAULT_RELAY_URL).getRemoteSettings().url, DEFAULT_RELAY_URL);
});

test('בלי ברירת מחדל (בדיקות, כלים): אין כתובת — כמו קודם', () => {
  assert.equal(storeWith('').getRemoteSettings().url, undefined);
});

test('כתובת שהמנהל שמר גוברת על ברירת המחדל', () => {
  const s = storeWith(DEFAULT_RELAY_URL);
  s.setRemoteSettings({ url: 'https://license.example.co.il' });
  assert.equal(s.getRemoteSettings().url, 'https://license.example.co.il');
});

test('מחיקת הכתובת (ערך ריק) מכבה את החיבור — ברירת המחדל לא חוזרת', () => {
  const s = storeWith(DEFAULT_RELAY_URL);
  s.setRemoteSettings({ url: '' });
  assert.equal(s.getRemoteSettings().url, '');
});

test('הגדרות אחרות נשמרות לצד ברירת המחדל, והיא לא נכתבת לקובץ', () => {
  const storage = one();
  const s = createLicenseStore({ storage, secret: one(), defaultUrl: DEFAULT_RELAY_URL });
  s.setRemoteSettings({ lastSync: 123 });
  const r = s.getRemoteSettings();
  assert.equal(r.url, DEFAULT_RELAY_URL);
  assert.equal(r.lastSync, 123);
  // כתובת שתשתנה בגרסה הבאה תגיע לכל ההתקנות שלא בחרו כתובת
  assert.ok(!String(storage.read()).includes(DEFAULT_RELAY_URL));
  const later = createLicenseStore({ storage, secret: one(), defaultUrl: 'https://new.example.co.il' });
  assert.equal(later.getRemoteSettings().url, 'https://new.example.co.il');
});

test('ipc.js מעביר את ברירת המחדל למחסן הרישוי', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ipc.js'), 'utf8');
  assert.match(src, /relayUrl = DEFAULT_RELAY_URL/);
  assert.match(src, /createLicenseStore\(\{[^}]*defaultUrl: relayUrl/);
});
