// רגרסיה (סקירת אבטחה 10.2026, ממצא 10): הורדת עדכון נעצרת בגודל שבתעודה גם בלי content-length
const test = require('node:test');
const assert = require('node:assert/strict');
const UP = require('../shell/licensing/update');

// זרם שמייצר נתונים בלי סוף, וסופר כמה נקרא
function endless() {
  let read = 0, cancelled = false;
  const body = new ReadableStream({
    pull(ctrl) { read += 1024; ctrl.enqueue(new Uint8Array(1024)); },
    cancel() { cancelled = true; },
  });
  return { res: { ok: true, headers: new Headers(), body }, stats: () => ({ read, cancelled }) };
}

test('זרם בלי סוף: נעצר מעט אחרי התקרה ומבוטל', async () => {
  const { res, stats } = endless();
  await assert.rejects(UP.readCapped(res, 10 * 1024), /גדול מהצפוי/);
  assert.ok(stats().read <= 12 * 1024, 'לא נקרא הרבה מעבר לתקרה');
  assert.equal(stats().cancelled, true);
});

test('זרם בגודל הנכון: מוחזר בשלמותו', async () => {
  const bytes = new Uint8Array(3000).map((_, i) => i % 251);
  const res = new Response(bytes);
  const got = await UP.readCapped(res, 3000);
  assert.deepEqual(Buffer.from(got), Buffer.from(bytes));
});

test('בלי זרם (מימוש fetch פשוט): נבדק אחרי הקריאה', async () => {
  const res = { arrayBuffer: async () => new Uint8Array(20).buffer };
  await assert.rejects(UP.readCapped(res, 10), /גדול מהצפוי/);
  assert.equal((await UP.readCapped(res, 20)).length, 20);
});
