// תמונות הפריטים בשמאות: במחסן המוצפן (localStorage שהמעטפת מחליפה) ולא ב-IndexedDB גלוי,
// ותמונה ישנה מ-IndexedDB מועברת פעם אחת ונמחקת משם רק אחרי שנשמרה.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadShamai, DIR } = require('./helpers/shamai-src');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// IndexedDB מדומה עם חנות images אחת
function fakeIndexedDB(initial = {}) {
  const store = new Map(Object.entries(initial));
  const req = (fn) => { const r = {}; setTimeout(() => { r.result = fn(); r.onsuccess && r.onsuccess(); }, 0); return r; };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx = {
        objectStore: () => ({
          get: (k) => req(() => store.get(k)),
          delete: (k) => { store.delete(k); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); },
        }),
      };
      return tx;
    },
  };
  return { store, api: { open: () => req(() => db) } };
}

function load(idb) {
  const s = loadShamai(['core']);
  if (idb) s.ctx.indexedDB = idb.api;
  return s;
}

test('תמונות שמאות: נשמרות במחסן (localStorage), לא ב-IndexedDB', async () => {
  const s = load();
  await s.run(`ImageDB.save('opp_1', ${JSON.stringify(PNG)})`);
  assert.strictEqual(s.run(`localStorage.getItem('shamai_v2_img_opp_1')`), JSON.stringify(PNG));
  assert.strictEqual(await s.run(`ImageDB.load('opp_1')`), PNG);
  await s.run(`ImageDB.delete('opp_1')`);
  assert.strictEqual(s.run(`localStorage.getItem('shamai_v2_img_opp_1')`), null);
  assert.strictEqual(await s.run(`ImageDB.load('opp_1')`), null);
});

test('תמונות שמאות: קלט שאינו תמונה או גדול מדי — נדחה', async () => {
  const s = load();
  for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,"><img onerror=x>', 'data:image/png;base64,' + 'A'.repeat(500 * 1024)]) {
    await assert.rejects(s.run(`ImageDB.save('x', ${JSON.stringify(bad)})`), /אינה תקינה או גדולה מדי/);
  }
  // ערך זדוני שהגיע למחסן בדרך אחרת — לא מוחזר להצגה
  s.run(`localStorage.setItem('shamai_v2_img_bad', JSON.stringify('data:image/png;base64,x" onerror="alert(1)'))`);
  assert.strictEqual(await s.run(`ImageDB.load('bad')`), null);
});

test('תמונות שמאות: תמונה ישנה מ-IndexedDB מועברת למחסן ונמחקת משם', async () => {
  const idb = fakeIndexedDB({ opp_old: PNG });
  const s = load(idb);
  assert.strictEqual(await s.run(`ImageDB.load('opp_old')`), PNG);
  assert.strictEqual(s.run(`localStorage.getItem('shamai_v2_img_opp_old')`), JSON.stringify(PNG));
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(idb.store.has('opp_old'), false, 'נשאר עותק גלוי ב-IndexedDB');
  // מחיקה מוחקת גם מהישן
  idb.store.set('opp_2', PNG);
  await s.run(`ImageDB.delete('opp_2')`);
  assert.strictEqual(idb.store.has('opp_2'), false);
});

test('תמונות שמאות: בעלייה כל התמונות הישנות מועברות, גם כאלה שלא הוצגו', async () => {
  const idb = fakeIndexedDB({ opp_a: PNG, opp_b: PNG });
  const s = load(idb);
  await s.run(`ImageDB.save('opp_c', ${JSON.stringify(PNG)})`);
  assert.strictEqual(await s.run(`ImageDB.migrateAll(['opp_a', 'opp_b', 'opp_c', 'opp_missing'])`), 2);
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(idb.store.size, 0);
  assert.match(fs.readFileSync(path.join(DIR, 'src', 'navigation.js'), 'utf8'), /ImageDB\.migrateAll\(/, 'אין העברה בעלייה');
});

test('תמונות שמאות: אין מקום במחסן — הישן לא נמחק', async () => {
  const idb = fakeIndexedDB({ opp_old: PNG });
  const s = load(idb);
  s.run(`localStorage.setItem = () => {}`); // מחסן מלא: הכתיבה לא נשמרת
  assert.strictEqual(await s.run(`ImageDB.load('opp_old')`), PNG);
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(idb.store.get('opp_old'), PNG);
  await assert.rejects(s.run(`ImageDB.save('n', ${JSON.stringify(PNG)})`), /אין מקום/);
});

test('תמונות שמאות: אין כתיבה ל-IndexedDB בקוד, והתמונה בטופס מוקטנת ונשמרת', () => {
  const src = fs.readdirSync(path.join(DIR, 'src')).map((f) => fs.readFileSync(path.join(DIR, 'src', f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /\.put\(/, 'כתיבה ל-IndexedDB');
  const nav = fs.readFileSync(path.join(DIR, 'src', 'navigation.js'), 'utf8');
  assert.match(nav, /pendingPhoto = dataUrl/, 'התמונה שנבחרה לא מגיעה לשמירה');
  assert.match(nav, /caseCompressImage\(file\)/, 'התמונה לא מוקטנת');
});
