// אפס פניות לאינטרנט במודולים (PLAN.md 5.3, כלל ברזל 6).
// סורק את כל הקבצים שנארזים בתוכנה ואת קוד המקור של האימונים: כל כתובת חיצונית חייבת להופיע ברשימה המאושרת.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN = ['main.js', 'shell', 'modules', 'modules-src/trainer/src', 'modules-src/trainer/index.html'];
const EXT = /\.(js|jsx|html|css|json|webmanifest|svg)$/i;

// מארח ← למה הוא מותר. "קישור" = נפתח רק בלחיצה, בדפדפן של המשתמש (setWindowOpenHandler ב-main.js).
const ALLOWED = {
  'www.w3.org': 'מרחב שמות של SVG/XML — לא פנייה',
  'www.gov.il': 'קישור לשירות של רשות המסים / הגנת הפרטיות',
  'wa.me': 'קישור לשיתוף בוואטסאפ',
  'www.google.com': 'קישור לחיפוש מחיר (שמאות)',
  'www.ebay.com': 'קישור לחיפוש מחיר (שמאות)',
  'www.bidspirit.com': 'קישור לחיפוש מחיר (שמאות)',
  '127.0.0.1': 'כתובת מקומית לחזרה מכניסת Google',
  '...': 'דוגמה בטקסט עזרה (מסך הגבייה)'
};
// מארחים שמותרים רק בקובץ מסוים: פנייה שהמשתמש הפעיל (כניסת Google, שרת הרישוי) או טקסט בתוך ספרייה
const ALLOWED_IN = {
  'shell/google-signin.js': ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'],
  'shell/licensing/default-relay.js': ['164-90-184-16.sslip.io'],
  'modules/shamai/lib/qrcode.js': ['stackoverflow.com', 'www.d-project.com', 'www.denso-wave.com', 'www.opensource.org'],
  'modules/trainer/workbox-9c191d2f.js': ['bit.ly'],
  'modules/trainer/assets/': ['reactjs.org', 'fb.me']
};
// קבצים שמותר להם לפנות לרשת בפועל (fetch וכדומה)
const FETCH_ALLOWED = [
  'shell/google-signin.js', 'shell/licensing/', 'modules/shamai/sw.js',
  'modules/trainer/sw.js', 'modules/trainer/workbox-', 'modules/trainer/assets/'
];

function files() {
  const out = [];
  const walk = rel => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      for (const n of fs.readdirSync(abs)) if (n !== 'node_modules') walk(rel + '/' + n);
    } else if (EXT.test(rel)) out.push(rel);
  };
  SCAN.forEach(walk);
  return out;
}

const allowedFor = (rel, host) =>
  host in ALLOWED || Object.entries(ALLOWED_IN).some(([p, hosts]) => rel.startsWith(p) && hosts.includes(host));

test('אין כתובת חיצונית שלא ברשימה המאושרת', () => {
  const bad = [];
  for (const rel of files()) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) {
      if (!allowedFor(rel, m[1])) bad.push(`${rel}: ${m[1]}`);
    }
  }
  assert.deepEqual([...new Set(bad)], [], 'כתובת חדשה — להסיר, או להוסיף לרשימה עם סיבה');
});

test('אין גופנים, סקריפטים או סגנונות שנטענים מהרשת', () => {
  const bad = [];
  for (const rel of files()) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (/(src|href)\s*=\s*["']https?:/i.test(text) && /\.(html|svg)$/i.test(rel)) bad.push(rel + ': src/href חיצוני');
    if (/@import\s+(url\()?["']?https?:/i.test(text) || /url\(\s*["']?https?:/i.test(text)) bad.push(rel + ': CSS חיצוני');
    if (/fonts\.(googleapis|gstatic)\.com/.test(text)) bad.push(rel + ': Google Fonts');
  }
  assert.deepEqual(bad, []);
});

test('פנייה לרשת (fetch / XMLHttpRequest / WebSocket) רק בקבצים המאושרים', () => {
  const bad = [];
  for (const rel of files()) {
    if (rel.startsWith('modules-src/') || FETCH_ALLOWED.some(p => rel.startsWith(p))) continue;
    // net.fetch(pathToFileURL(...)) בפרוטוקול app:// קורא קובץ מקומי — לא רשת
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/net\.fetch\(pathToFileURL\(/g, '');
    if (/\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket\s*\(|navigator\.sendBeacon|new\s+EventSource\s*\(/.test(text)) bad.push(rel);
  }
  assert.deepEqual(bad, []);
});

test('ה-service worker של השמאות לא מכיר מקורות מחירים ברשת', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'modules/shamai/sw.js'), 'utf8');
  for (const host of ['gold-api', 'frankfurter', 'coingecko', 'boi.org.il']) assert.doesNotMatch(sw, new RegExp(host));
});

// אנדרואיד (החלטת הבעלים 23.10.2026): הרשאת INTERNET — לשרת הרישוי בלבד. ה-WebView חסום לרשת (setBlockNetworkLoads),
// ולכן בקוד ה-web אין fetch; הבקשה לשרת עוברת ב-relay-fetch.js לגשר, והקובץ היחיד שפותח חיבור הוא RelayClient.java
const ANDROID_SCAN = ['android/web', 'android/lib', 'android/app'];
const ANDROID_ALLOWED = { 'schemas.android.com': 'מרחב שמות של XML באנדרואיד — לא פנייה' };
const ANDROID_NET_FILES = { 'android/app/java/com/bunimseller/supersuite/RelayClient.java': 'שרת הרישוי בלבד: POST https ל-/v1, בלי הפניות' };
test('אנדרואיד: פנייה לרשת רק לשרת הרישוי (RelayClient.java), וקוד ה-web בלי fetch', () => {
  const list = [];
  const walk = rel => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) { for (const n of fs.readdirSync(abs)) walk(rel + '/' + n); return; }
    if (/\.(js|java|xml|html|css)$/i.test(rel)) list.push(rel);
  };
  ANDROID_SCAN.forEach(walk);
  assert.ok(list.some(f => f.endsWith('RelayClient.java')) && list.some(f => f.endsWith('relay-fetch.js')));
  const bad = [];
  for (const rel of list) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) if (!(m[1] in ANDROID_ALLOWED)) bad.push(`${rel}: ${m[1]}`);
    if (/\.js$/.test(rel) && /\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket\s*\(|navigator\.sendBeacon|new\s+EventSource\s*\(/.test(text)) bad.push(rel + ': פנייה לרשת מקוד ה-web');
    if (/\.java$/.test(rel) && !(rel in ANDROID_NET_FILES) && /openConnection|new\s+Socket\s*\(|HttpURLConnection|SocketChannel/.test(text)) bad.push(rel + ': חיבור רשת');
  }
  assert.deepEqual([...new Set(bad)], [], 'פנייה חדשה לרשת באנדרואיד — להסיר, או להוסיף לרשימה עם סיבה');
});
