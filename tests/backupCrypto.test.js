const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../modules/econ/core/backupCrypto');

test('הצפנה והפענוח מחזירים את אותו תוכן (כולל עברית)', () => {
  const plain = JSON.stringify({ suite: 'SuperSuite', note: 'שלום עולם ₪' });
  const enc = C.encryptBackup(plain, 'correct-horse');
  assert.ok(C.isEncryptedBackup(enc));
  assert.ok(!enc.includes('SuperSuite'), 'הטקסט המקורי לא נראה בקובץ המוצפן');
  assert.equal(C.decryptBackup(enc, 'correct-horse'), plain);
});

test('סיסמה שגויה נדחית, וגם שינוי של בייט אחד בקובץ נדחה', () => {
  const enc = C.encryptBackup('{"a":1}', 'pass-word-1');
  assert.throws(() => C.decryptBackup(enc, 'wrong-password'), /שגויה|פגום/);
  const raw = Buffer.from(enc.slice(6), 'base64').toString('utf8');
  const obj = JSON.parse(raw);
  const d = Buffer.from(obj.data, 'base64'); d[0] ^= 1; obj.data = d.toString('base64');
  const tampered = 'SSBK1:' + Buffer.from(JSON.stringify(obj)).toString('base64');
  assert.throws(() => C.decryptBackup(tampered, 'pass-word-1'), /שגויה|פגום/);
});

test('סיסמה קצרה מדי נדחית, ושני הצפנות של אותו תוכן שונות (salt אקראי)', () => {
  assert.throws(() => C.encryptBackup('x', 'short'), /לפחות/);
  const a = C.encryptBackup('same', 'long-enough-1');
  const b = C.encryptBackup('same', 'long-enough-1');
  assert.notEqual(a, b);
});

test('פענוח קובץ לא מוצפן נדחה במפורש', () => {
  assert.throws(() => C.decryptBackup('{"suite":"SuperSuite"}', 'anything-1'), /אינו מוצפן/);
});
