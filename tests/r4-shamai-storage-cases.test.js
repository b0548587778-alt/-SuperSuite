'use strict';
// סקירת קוד 2.11.2026, תכנית א — תיקי השמאות: מפתח לכל תיק (case_<id>) ואינדקס (casesIndex) במקום מפתח אחד (cases)
// שנעצר בתקרה של 5MB לערך. העברה בטעינה עם אימות, cases.bak עד הטעינה המוצלחת הבאה, קריאה מהמבנה הישן כשההעברה
// נכשלה, קריסה בין השלבים, גיבוי ישן, יותר מ-1,000 תיקים, מכסה לכל מפתח, "מחק את כל הנתונים" וההקשר לעוזר ה-AI.
// העמוד רץ מעל המחסן האמיתי (shell/secure-store.js) — כמו ב-SuperSuite, כולל התקרה לכל ערך.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const SecureStore = require('../shell/secure-store');
const MC = require('../shell/ai/module-context');
const { loadShamai } = require('./helpers/shamai-src');

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r4-cases-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } } });

const KEY = crypto.randomBytes(32).toString('base64');
const openStore = (dir, extra = {}) => SecureStore.createSecureStore({ fs, dir, mod: 'shamai', getBackupKey: () => KEY,
  schedule: () => 0, retrySchedule: () => 0, pause: () => {}, ...extra });

// localStorage של העמוד מעל המחסן — כמו secure-ls-preload.js: דחייה נזרקת, '\0ss-flush' = כתיבה לדיסק
function storeLS(store, ctl = {}) {
  const commit = (op, k, v) => {
    if (ctl.reject && ctl.reject(op, k)) throw new DOMException('השינוי לא נשמר: לתפקיד שלך יש הרשאת צפייה בלבד', 'SecurityError');
    const r = store.write(op, k, v);
    if (!r.ok) throw new DOMException(r.message, r.name);
  };
  const keys = () => [...Object.keys(store.dataSnapshot()), ...store.blobKeys()];
  return {
    getItem: (k) => store.get(String(k)),
    setItem: (k, v) => commit('set', String(k), String(v)),
    removeItem: (k) => { if (k === '\u0000ss-flush') { if (ctl.failFlush) throw new DOMException('disk', 'SecurityError'); commit('flush'); return; } commit('remove', String(k)); },
    key: (i) => keys()[i] ?? null,
    get length() { return keys().length; },
  };
}

// טעינה חדשה של עמוד השמאי מעל המחסן
function page(store, ctl, { withNavigation = false } = {}) {
  const s = loadShamai(['core', 'calc', 'prices', 'ledger', 'report', 'purchase', 'casefile', 'case-report']);
  s.ctx.DOMException = DOMException;
  s.ctx.console = { ...console, error() {} };
  s.ctx.localStorage = storeLS(store, ctl);
  if (withNavigation) {
    // clearAllShamaiData — בלי init של המסך (העמוד "עוד נטען")
    s.ctx.document.readyState = 'loading';
    s.run(fs.readFileSync(path.join(__dirname, '..', 'modules', 'shamai', 'src', 'navigation.js'), 'utf8'));
  }
  return s;
}
const mkCase = (i, extra = {}) => ({ id: 'c' + i, no: i, rev: 0, status: 'draft', created: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T08:00:00.000Z`,
  client: { name: 'לקוח ' + i, idNumber: '' }, purpose: 'insurance', basis: 'replacement', currency: 'ILS', effectiveDate: '2026-10-01', items: [], history: [], ...extra });
const raw = (store, k) => store.dataSnapshot()['shamai_v2_' + k];

test('העברה: cases ← מפתח לכל תיק + אינדקס, באותו סדר; cases.bak נשאר עד הטעינה הבאה, ואז נמחק', () => {
  const store = openStore(tmp());
  const legacy = [mkCase(3), mkCase(2, { status: 'final', frozen: { totalAg: 12345 } }), mkCase(1)];
  store.write('set', 'shamai_v2_cases', JSON.stringify(legacy));
  const p = page(store);
  const loaded = JSON.parse(p.run('JSON.stringify(loadCases())'));
  assert.deepEqual(loaded, legacy, 'אותם תיקים, אותו סדר');
  for (const c of legacy) assert.equal(raw(store, 'case_' + c.id), JSON.stringify(c));
  const idx = JSON.parse(raw(store, 'casesIndex'));
  assert.deepEqual(idx.ids, ['c3', 'c2', 'c1']);
  assert.equal(idx.rows.find(r => r.id === 'c2').totalAg, 12345);
  assert.equal(idx.rows.find(r => r.id === 'c1').totalAg, null, 'טיוטה — לפי המחירים של היום');
  assert.equal(raw(store, 'cases'), undefined, 'המפתח הישן הוסר');
  assert.equal(raw(store, 'cases.bak'), JSON.stringify(legacy));
  assert.ok(raw(store, 'casesMigratedAt'));
  // נכתב לדיסק (flushStore)
  assert.deepEqual(openStore(path.dirname(store.file)).dataSnapshot(), store.dataSnapshot());
  // באותה טעינה — cases.bak נשאר
  p.run('loadCases()');
  assert.ok(raw(store, 'cases.bak'));
  // טעינה נוספת: הכול תקין ← cases.bak נמחק, והתיקים זהים
  const p2 = page(store);
  assert.deepEqual(JSON.parse(p2.run('JSON.stringify(loadCases())')), legacy);
  assert.equal(raw(store, 'cases.bak'), undefined);
  // אידמפוטנטי
  const snap = store.dataSnapshot();
  page(store).run('loadCases()');
  assert.deepEqual(store.dataSnapshot(), snap);
});

test('העברה שנכשלה (צפייה בלבד, או כתיבה לדיסק שנכשלה): התיקים נקראים מהמבנה הישן, שום דבר לא נמחק, וניסיון חוזר בטעינה הבאה', () => {
  const store = openStore(tmp());
  const legacy = [mkCase(2), mkCase(1)];
  store.write('set', 'shamai_v2_cases', JSON.stringify(legacy));
  // צפייה בלבד: כל כתיבה נדחית
  const viewer = page(store, { reject: () => true });
  assert.deepEqual(JSON.parse(viewer.run('JSON.stringify(loadCases())')), legacy);
  assert.equal(viewer.run(`findCase('c1').no`), 1);
  assert.equal(raw(store, 'cases'), JSON.stringify(legacy));
  assert.equal(raw(store, 'casesIndex'), undefined);
  assert.ok(!viewer.el('#toast').textContent, 'העברה ברקע — בלי הודעה');
  // הכתיבה לדיסק נכשלה (flushStore): המקור נשאר, לא נוצר cases.bak
  const disk = page(store, { failFlush: true });
  assert.deepEqual(JSON.parse(disk.run('JSON.stringify(loadCases())')), legacy, 'בלי כפילויות');
  assert.equal(raw(store, 'cases'), JSON.stringify(legacy));
  assert.equal(raw(store, 'cases.bak'), undefined);
  // טעינה רגילה — מועבר
  const ok = page(store);
  assert.deepEqual(JSON.parse(ok.run('JSON.stringify(loadCases())')), legacy);
  assert.equal(raw(store, 'cases'), undefined);
  // ערך ישן פגום (לא רשימה) — לא מועבר ולא נמחק
  const store2 = openStore(tmp());
  store2.write('set', 'shamai_v2_cases', '{"פגום":1}');
  assert.equal(page(store2).run('loadCases().length'), 0);
  assert.equal(raw(store2, 'cases'), '{"פגום":1}');
});

test('קריסה בין השלבים: תיק בלי אינדקס — נוסף; רשומת אינדקס בלי תיק — נמחקת; cases ו-cases.bak יחד — העברה חוזרת בלי כפילויות', () => {
  const store = openStore(tmp());
  const p = page(store);
  p.run(`saveCase(${JSON.stringify(mkCase(1))}); saveCase(${JSON.stringify(mkCase(2))});`);
  // שמירה: התיק נכתב, האינדקס לא (קריסה)
  store.write('set', 'shamai_v2_case_c3', JSON.stringify(mkCase(3, { created: '2026-10-30T08:00:00.000Z' })));
  // מחיקה: התיק נמחק, האינדקס לא (קריסה)
  store.write('remove', 'shamai_v2_case_c1');
  const p2 = page(store);
  assert.deepEqual(JSON.parse(p2.run('JSON.stringify(loadCases().map(c => c.id))')), ['c3', 'c2']);
  assert.deepEqual(JSON.parse(raw(store, 'casesIndex')).ids, ['c3', 'c2'], 'האינדקס תוקן ונשמר');
  // קריסה אחרי cases.bak ולפני הסרת cases: שניהם קיימים — הטעינה מגירה שוב, בלי כפילויות
  const legacy = [mkCase(3), mkCase(4)];
  store.write('set', 'shamai_v2_cases', JSON.stringify(legacy));
  store.write('set', 'shamai_v2_cases.bak', JSON.stringify(legacy));
  const p3 = page(store);
  assert.deepEqual(JSON.parse(p3.run('JSON.stringify(loadCases().map(c => c.id))')).sort(), ['c2', 'c3', 'c4']);
  assert.equal(JSON.parse(p3.run(`JSON.stringify(findCase('c3'))`)).created, '2026-10-30T08:00:00.000Z', 'תיק שכבר במבנה החדש — גובר על העותק הישן');
  assert.equal(raw(store, 'cases'), undefined);
});

test('שמירה ומחיקה של תיק אחד; מחיקה מוחקת גם מהמבנה הישן כשההעברה לא הסתיימה', () => {
  const store = openStore(tmp());
  const p = page(store);
  assert.equal(p.run(`saveCase(${JSON.stringify(mkCase(1))})`), true);
  assert.equal(p.run(`saveCase(${JSON.stringify(mkCase(2))})`), true);
  assert.deepEqual(JSON.parse(p.run('JSON.stringify(loadCases().map(c => c.id))')), ['c2', 'c1'], 'חדש — בראש');
  assert.equal(p.run(`saveCase({ ...findCase('c1'), status: 'final', frozen: { totalAg: 500 } })`), true);
  assert.deepEqual(JSON.parse(p.run('JSON.stringify(loadCases().map(c => c.id))')), ['c2', 'c1'], 'עדכון לא משנה את הסדר');
  assert.equal(JSON.parse(raw(store, 'casesIndex')).rows.find(r => r.id === 'c1').totalAg, 500);
  assert.equal(p.run(`removeCase('c2')`), true);
  assert.equal(raw(store, 'case_c2'), undefined);
  assert.deepEqual(JSON.parse(raw(store, 'casesIndex')).ids, ['c1']);
  // ההעברה נכשלה (צפייה בלבד בטעינה) ואחר כך — מחיקה בהרשאה: גם מ-cases
  const s2 = openStore(tmp());
  s2.write('set', 'shamai_v2_cases', JSON.stringify([mkCase(5), mkCase(6)]));
  let reject = true;
  const q = page(s2, { reject: () => reject });
  assert.equal(q.run('loadCases().length'), 2);
  assert.equal(q.run(`removeCase('c5')`), false, 'צפייה בלבד');
  reject = false;
  assert.equal(q.run(`removeCase('c5')`), true);
  assert.deepEqual(JSON.parse(q.run('JSON.stringify(loadCases().map(c => c.id))')), ['c6']);
});

test('יותר מ-1,000 תיקים: מעבר לתקרה של מפתח אחד (5MB) — כל התיקים נשמרים ונטענים; תיק אחד גדול מדי נדחה בלי לפגוע באחרים', () => {
  const store = openStore(tmp());
  const pad = 'פ'.repeat(4400);
  const legacy = Array.from({ length: 1000 }, (_, i) => mkCase(1000 - i, { scopeNote: pad }));
  const legacyJson = JSON.stringify(legacy);
  assert.ok(legacyJson.length < SecureStore.MAX_VALUE, 'הישן עוד נכנס במפתח אחד');
  store.write('set', 'shamai_v2_cases', legacyJson);
  const p = page(store);
  assert.equal(p.run('loadCases().length'), 1000);
  // עוד 300 תיקים — יחד מעבר ל-5MB, שבמבנה הישן לא היה נשמר
  p.ctx.__pad = pad;
  assert.equal(p.run(`(() => { for (let i = 1001; i <= 1300; i++) if (!saveCase({ ...findCase('c1'), id: 'c' + i, no: i, scopeNote: __pad })) return false; return true; })()`), true);
  const all = JSON.parse(p.run('JSON.stringify(loadCases().map(c => c.id))'));
  assert.equal(all.length, 1300);
  assert.ok(JSON.stringify(JSON.parse(p.run('JSON.stringify(loadCases())'))).length > SecureStore.MAX_VALUE, 'סך התיקים מעל התקרה של ערך אחד');
  assert.ok(raw(store, 'casesIndex').length < SecureStore.MAX_VALUE / 10, 'האינדקס קטן');
  assert.equal(store.write('set', 'shamai_v2_cases', p.run('JSON.stringify(loadCases())')).reason, 'too-large', 'במבנה הישן — היה נדחה');
  // מכסה לכל מפתח: תיק אחד גדול מדי
  p.ctx.__huge = 'x'.repeat(SecureStore.MAX_VALUE);
  assert.equal(p.run(`saveCase({ ...findCase('c7'), scopeNote: __huge })`), false);
  assert.equal(p.run(`findCase('c7').scopeNote.length`), pad.length, 'התיק הקודם לא נפגע');
  assert.equal(page(store).run('loadCases().length'), 1300, 'אחרי טעינה מחדש');
});

test('"מחק את כל הנתונים": מוחק תיקים, אינדקס, cases ו-cases.bak — המספור נשמר, ושום תיק לא חוזר בטעינה', () => {
  const store = openStore(tmp());
  store.write('set', 'shamai_v2_cases', JSON.stringify([mkCase(1), mkCase(2)]));
  const p = page(store, undefined, { withNavigation: true });
  p.run('loadCases()');
  p.run(`Storage.save('caseSeq', 2); Storage.save('cases', [${JSON.stringify(mkCase(3))}]);`);
  assert.equal(p.run('clearAllShamaiData()'), true);
  assert.deepEqual(Object.keys(store.dataSnapshot()), ['shamai_v2_caseSeq']);
  assert.equal(page(store).run('loadCases().length'), 0);
  assert.equal(p.run('nextCaseNo()'), 3);
});

test('גיבוי ישן (עם cases) ← שחזור למחסן ← הטעינה מגירה; גיבוי חדש משוחזר כמו שהוא — הפורמט לא השתנה', () => {
  const dir = tmp();
  const store = openStore(dir);
  store.write('set', 'shamai_v2_case_zz', JSON.stringify(mkCase(99)));
  // מה שהשחזור עושה (main.js → applyRestore): replaceAll ואז flush
  const old = { shamai_v2_cases: JSON.stringify([mkCase(2), mkCase(1)]), shamai_v2_caseSeq: '2', shamai_v2_casePhoto_p1: 'data:image/png;base64,AAAA' };
  assert.deepEqual(store.replaceAll(old), { ok: true });
  assert.equal(store.flush(), true);
  const p = page(openStore(dir));
  assert.deepEqual(JSON.parse(p.run('JSON.stringify(loadCases().map(c => c.id))')), ['c2', 'c1'], 'תיק שלא היה בגיבוי — לא נשאר');
  const reopened = openStore(dir);
  assert.equal(reopened.dataSnapshot().shamai_v2_cases, undefined);
  assert.ok(reopened.dataSnapshot().shamai_v2_case_c1);
  // גיבוי חדש (snapshot — כל הפריטים, גם התמונות) ← מחסן נקי ← אותם תיקים בלי העברה
  const backup = reopened.snapshot();
  assert.equal(backup.shamai_v2_casePhoto_p1, 'data:image/png;base64,AAAA');
  const fresh = openStore(tmp());
  assert.deepEqual(fresh.replaceAll(backup), { ok: true });
  assert.deepEqual(JSON.parse(page(fresh).run('JSON.stringify(loadCases().map(c => c.id))')), ['c2', 'c1']);
  // cases.bak (הגיבוי נלקח בטעינה של ההעברה) — נמחק בטעינה המוצלחת שאחרי; כל השאר — כמו בגיבוי
  const { 'shamai_v2_cases.bak': bak, ...rest } = backup;
  assert.ok(bak);
  assert.deepEqual(fresh.snapshot(), rest);
});

test('עוזר ה-AI: ההערכה האחרונה — מהמפתחות של כל תיק, וגם מהמבנה הישן כשלא הועבר (בלי כפילות)', () => {
  const fin = (i, at, total) => mkCase(i, { status: 'final', finalizedAt: at, reportDate: at.slice(0, 10), frozen: { totalAg: total }, items: [{}] });
  const items = {
    shamai_v2_case_c1: JSON.stringify(fin(1, '2026-10-01T08:00:00.000Z', 1000)),
    shamai_v2_case_c2: JSON.stringify(fin(2, '2026-10-05T08:00:00.000Z', 2000)),
    shamai_v2_casesIndex: JSON.stringify({ v: 1, ids: ['c2', 'c1'], rows: [] }),
  };
  assert.equal(MC.shamaiContext(items).valueAg, 2000);
  // תיק במבנה הישן בלבד (ההעברה לא הצליחה) — נכלל; אותו מזהה — המבנה החדש גובר
  const mixed = { ...items, shamai_v2_cases: JSON.stringify([fin(3, '2026-10-09T08:00:00.000Z', 3000), fin(2, '2026-12-01T08:00:00.000Z', 9999)]) };
  assert.equal(MC.shamaiContext(mixed).valueAg, 3000);
  assert.match(MC.shamaiContext(mixed).label, /^תיק 3/);
  assert.equal(MC.shamaiContext({ shamai_v2_case_c9: '{"id":"other"}' }), null, 'מפתח שלא תואם למזהה — מדולג');
  assert.equal(MC.shamaiContext({}), null);
});
