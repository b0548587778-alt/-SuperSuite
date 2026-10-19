// יצירת אייקון התוכנה מ-build/icon.svg (PLAN.md 7.2): build/icon.png (512) ו-build/icon.ico (16–256).
// רץ ב-Electron (בלי חבילות נוספות): node_modules/electron/dist/electron.exe tools/make-icon.js
// ציור אחד ב-512 בחלון נסתר שקוף, והקטנה לכל גודל. קובץ ה-ICO נבנה כאן (PNG בתוך ICO — נתמך מ-Windows Vista).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// ICO: כותרת 6 בתים, רשומה של 16 בתים לכל תמונה, ואחריהן קובצי ה-PNG כמו שהם
function buildIco(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([head, ...entries, ...images.map(i => i.png)]);
}

// קריאת ICO (לבדיקות): גודל ו-PNG לכל רשומה
function readIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('לא קובץ ICO');
  const n = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + 16 * i;
    const size = buf.readUInt8(e) || 256;
    const len = buf.readUInt32LE(e + 8), off = buf.readUInt32LE(e + 12);
    out.push({ size, png: buf.subarray(off, off + len) });
  }
  return out;
}

async function render(BrowserWindow, svg, size) {
  const w = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true, javascript: false } });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">` +
    `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`;
  // חלון offscreen מצייר דרך האירוע paint — לוקחים את הציור האחרון אחרי שהתמונה נטענה
  let last = null;
  w.webContents.on('paint', (_e, _dirty, image) => { last = image; });
  w.webContents.setFrameRate(30);
  await w.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  w.webContents.invalidate();
  await new Promise(r => setTimeout(r, 500));
  const img = last;
  w.destroy();
  if (!img || img.isEmpty()) throw new Error('הציור נכשל בגודל ' + size);
  return img.resize({ width: size, height: size, quality: 'best' }).toPNG();
}

async function main() {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  await app.whenReady();
  const svg = fs.readFileSync(path.join(ROOT, 'build', 'icon.svg'), 'utf8');
  const out = process.argv.find(a => a.startsWith('--out=')) ? process.argv.find(a => a.startsWith('--out=')).slice(6) : path.join(ROOT, 'build');
  fs.mkdirSync(out, { recursive: true });
  // ציור אחד ב-512 והקטנה לכל גודל (חלון קטן מהמינימום של Windows נכשל בטעינה)
  const { nativeImage } = require('electron');
  const big = await render(BrowserWindow, svg, 512);
  fs.writeFileSync(path.join(out, 'icon.png'), big);
  const src = nativeImage.createFromBuffer(big);
  const images = ICO_SIZES.map(size => ({ size, png: src.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(out, 'icon.ico'), buildIco(images));
  console.log('נוצרו icon.png ו-icon.ico ב-' + out);
  app.quit();
}

// ב-Electron, require.main אינו המודול הזה כשהוא קובץ הכניסה — מזהים לפי process.type
if (process.versions.electron && process.type === 'browser') main().catch(e => { console.error(e); process.exit(1); });
module.exports = { buildIco, readIco, ICO_SIZES };
