// לוח עברי וזמני שבת (shell/hebcal.js): תאריכים, מועדים, דחיית צומות, זמנים ומצב שבת.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const H = require(path.join(__dirname, '..', 'shell', 'hebcal'));

const names = (d, o) => H.holidays(d, o).map(x => x.name);
const JLM = { city: 'jerusalem' };
const at = iso => Date.parse(iso);

test('לוח עברי זמין במנוע (ICU)', () => assert.equal(H.available(), true));

test('גימטריה: ט"ו/ט"ז, גרש וגרשיים, שנה בלי אלפים', () => {
  assert.equal(H.gematria(1), 'א׳');
  assert.equal(H.gematria(15), 'ט״ו');
  assert.equal(H.gematria(16), 'ט״ז');
  assert.equal(H.gematria(30), 'ל׳');
  assert.equal(H.gematria(5787), 'תשפ״ז');
});

test('תאריך עברי', () => {
  assert.equal(H.hebrewDate('2026-10-14').text, 'ג׳ בחשוון תשפ״ז');
  assert.equal(H.hebrewDate('2027-03-23').text, 'י״ד באדר ב׳ תשפ״ז');
});

test('חגים בארץ ישראל ובחוץ לארץ', () => {
  assert.deepEqual(names('2026-09-12'), ['ראש השנה']);
  assert.deepEqual(names('2026-09-21'), ['יום הכיפורים']);
  assert.deepEqual(names('2027-04-22'), ['פסח']);
  assert.ok(names('2027-04-23').includes('חול המועד פסח'), 'ט"ז בניסן בארץ — חול המועד');
  assert.ok(names('2027-04-23', { diaspora: true }).includes('פסח (יום שני)'));
  assert.equal(H.isYomTov('2027-04-23'), false);
  assert.equal(H.isYomTov('2027-04-23', { diaspora: true }), true);
});

test('פורים בשנה מעוברת — באדר ב׳, ופורים קטן באדר א׳', () => {
  assert.deepEqual(names('2027-03-23'), ['פורים']);
  assert.ok(names('2027-02-21').includes('פורים קטן'));
});

test('חנוכה: שמונה נרות, גם כשכסלו חסר', () => {
  assert.ok(names('2026-12-05').includes('חנוכה — נר א׳'));
  assert.ok(names('2026-12-12').includes('חנוכה — נר ח׳'));
  assert.ok(!names('2026-12-13').some(n => n.startsWith('חנוכה')));
});

test('צום שחל בשבת נדחה ליום ראשון', () => {
  // ט׳ באב תשפ"ט חל בשבת (21.7.2029) — הצום ביום ראשון
  assert.ok(!names('2029-07-21').includes('תשעה באב'));
  assert.ok(names('2029-07-22').includes('תשעה באב'));
  // ט׳ באב תשפ"ו ביום חמישי — במקומו
  assert.ok(names('2026-07-23').includes('תשעה באב'));
  // צום גדליה תשפ"ז: ג׳ בתשרי ביום שני — במקומו
  assert.ok(names('2026-09-14').includes('צום גדליה'));
});

test('ספירת העומר ול"ג בעומר', () => {
  assert.ok(names('2027-05-25').includes('ל״ג בעומר'));
  assert.ok(names('2027-05-25').includes('היום ל״ג לעומר'));
});

test('זמני ירושלים קרובים ללוח (סטייה של עד 3 דקות)', () => {
  const z = H.zmanim('2026-10-16', JLM);
  const hm = ms => H.formatTime(ms).split(':').map(Number);
  const near = (ms, h, m) => { const [a, b] = hm(ms); assert.ok(Math.abs(a * 60 + b - (h * 60 + m)) <= 3, H.formatTime(ms)); };
  near(z.sunset, 18, 6);
  near(z.candles, 17, 26);
});

test('דקות הדלקה לפי העיר, ואפשר לשנות', () => {
  assert.equal(H.resolveSettings({ city: 'jerusalem' }).candles, 40);
  assert.equal(H.resolveSettings({ city: 'bnei-brak' }).candles, 20);
  assert.equal(H.resolveSettings({ city: 'bnei-brak', candles: 30 }).candles, 30);
  assert.equal(H.resolveSettings({ city: 'nowhere' }).city, 'jerusalem');
});

test('מצב שבת: מהדלקת הנרות ועד הצאת', () => {
  assert.equal(H.shabbatStatus(at('2026-10-16T13:00:00+03:00'), JLM).active, false);
  const st = H.shabbatStatus(at('2026-10-16T17:30:00+03:00'), JLM);
  assert.equal(st.active, true);
  assert.equal(st.name, 'שבת קודש');
  assert.equal(H.shabbatStatus(at('2026-10-17T12:00:00+03:00'), JLM).active, true);
  assert.equal(H.shabbatStatus(at('2026-10-17T19:30:00+03:00'), JLM).active, false);
});

test('שבת שמחוברת לראש השנה — רצף אחד עד מוצאי החג', () => {
  const st = H.shabbatStatus(at('2026-09-11T19:00:00+03:00'), JLM);
  assert.equal(st.name, 'שבת וראש השנה');
  assert.ok(H.formatTime(st.endsAt) > '19:00');
  const end = new Date(st.endsAt).toISOString().slice(0, 10);
  assert.equal(end, '2026-09-13', 'מסתיים במוצאי היום השני');
});

test('השבת הקרובה והתאריך העברי מתחלף בשקיעה', () => {
  const n = H.nextHoly(at('2026-10-14T10:00:00+03:00'), JLM);
  assert.equal(n.name, 'שבת קודש');
  assert.equal(new Date(n.erev).toISOString().slice(0, 10), '2026-10-16');
  const ev = H.hebrewToday(at('2026-10-14T19:00:00+03:00'), JLM);
  assert.equal(ev.text, 'ד׳ בחשוון תשפ״ז');
  assert.equal(ev.night, true);
});
