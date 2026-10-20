// שמירת מסך של מודול כ-PDF (shell/print-pdf.js, PLAN.md 6.4)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const P = require('../shell/print-pdf');

test('pdfFileName: שם בטוח — בלי תיקיות, תווים אסורים ותווי בקרה; ברירת מחדל לשם ריק', () => {
  assert.equal(P.pdfFileName('תוכנית אימון — יצחק ברגר'), 'תוכנית אימון — יצחק ברגר.pdf');
  assert.equal(P.pdfFileName('..\\..\\Windows\\x'), 'Windows x.pdf');
  assert.equal(P.pdfFileName('a/b:c*d?"e<f>g|h'), 'a b c d e f g h.pdf');
  assert.equal(P.pdfFileName('שם\u0000\n\tעם בקרה'), 'שם עם בקרה.pdf');
  assert.equal(P.pdfFileName('  ...  '), 'מסמך.pdf');
  assert.equal(P.pdfFileName(''), 'מסמך.pdf');
  assert.equal(P.pdfFileName(null), 'מסמך.pdf');
  assert.equal(P.pdfFileName({ toString: () => 'אובייקט' }), 'אובייקט.pdf');
  const long = P.pdfFileName('א'.repeat(500));
  assert.equal(long, 'א'.repeat(P.MAX_NAME) + '.pdf');
  // השם תמיד בתוך התיקייה שנבחרה
  for (const n of ['../a', '..', 'C:\\x', '/etc/passwd']) {
    const f = P.pdfFileName(n);
    assert.equal(path.basename(f), f, n);
  }
});

test('savePagePdf: חלון שמירה בתיקיית המסמכים, ואז printToPDF של התצוגה; ביטול — בלי הדפסה', async () => {
  const calls = [];
  const written = {};
  const fs = { writeFileSync: (p, d) => { written[p] = d; } };
  const wc = { printToPDF: async (o) => { calls.push(['pdf', o]); return Buffer.from('PDF'); } };
  const dialogFor = (res) => ({ showSaveDialog: async (_w, o) => { calls.push(['dlg', o]); return res; } });

  assert.deepEqual(await P.savePagePdf({ dialog: dialogFor({ canceled: true }), fs, win: {}, wc, name: 'א', dir: 'D' }), { ok: false });
  assert.deepEqual(calls.map(c => c[0]), ['dlg'], 'ביטול — בלי printToPDF');
  assert.equal(calls[0][1].defaultPath, path.join('D', 'א.pdf'));
  assert.deepEqual(calls[0][1].filters, [{ name: 'PDF', extensions: ['pdf'] }]);

  calls.length = 0;
  const r = await P.savePagePdf({ dialog: dialogFor({ canceled: false, filePath: 'C:/out/x.pdf' }), fs, win: {}, wc, name: 'ב', dir: 'D' });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls.map(c => c[0]), ['dlg', 'pdf']);
  assert.deepEqual(calls[1][1], { pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  assert.equal(String(written['C:/out/x.pdf']), 'PDF');
});
