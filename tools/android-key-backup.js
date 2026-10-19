// גיבוי מוצפן של מפתח החתימה של האנדרואיד (PLAN.md 0.1).
//   node tools/android-key-backup.js backup  [קובץ יעד]   ← מצפין את android/keystore לקובץ אחד
//   node tools/android-key-backup.js restore <קובץ>       ← משחזר ל-android/keystore (לא דורס קבצים קיימים)
// הסיסמה מוקלדת במסוף בלבד, בלי הצגה על המסך. היא לא נשמרת בשום מקום — בלעדיה אי אפשר לפתוח את הגיבוי.
// הצפנה: scrypt (N=2^17) ← AES-256-GCM. אחרי הגיבוי הקובץ נפתח מחדש ונבדק מול המקור (SHA-256).
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const KEY_DIR = path.join(ROOT, 'android', 'keystore');
const MAGIC = Buffer.from('SSKEY1');
const SCRYPT = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const MIN_PASSWORD = 10;

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const derive = (password, salt) => crypto.scryptSync(password, salt, 32, SCRYPT);

function encrypt(files, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const plain = Buffer.from(JSON.stringify({ v: 1, created: new Date().toISOString(), files }), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', derive(password, salt), iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

function decrypt(buf, password) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('הקובץ אינו גיבוי של מפתח האנדרואיד');
  let o = MAGIC.length;
  const salt = buf.subarray(o, o += 16);
  const iv = buf.subarray(o, o += 12);
  const tag = buf.subarray(o, o += 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', derive(password, salt), iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    return JSON.parse(Buffer.concat([decipher.update(buf.subarray(o)), decipher.final()]).toString('utf8'));
  } catch {
    throw new Error('סיסמה שגויה, או שהקובץ פגום');
  }
}

// קלט סיסמה בלי הצגה (כוכביות בלבד)
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('יש להריץ במסוף (לא דרך צינור), כדי שהסיסמה לא תוצג'));
    process.stdout.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = ch => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        value += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function readKeyFiles() {
  if (!fs.existsSync(KEY_DIR)) throw new Error('לא נמצאה התיקייה ' + KEY_DIR);
  const files = {};
  for (const name of fs.readdirSync(KEY_DIR)) {
    const p = path.join(KEY_DIR, name);
    if (fs.statSync(p).isFile()) files[name] = fs.readFileSync(p).toString('base64');
  }
  if (!Object.keys(files).some(n => n.endsWith('.jks'))) throw new Error('בתיקייה אין קובץ .jks');
  return files;
}

async function backup(target) {
  const files = readKeyFiles();
  const out = target || path.join(os.homedir(), 'Documents', 'SuperSuite-android-key-backup.sskey');
  if (fs.existsSync(out)) throw new Error('הקובץ כבר קיים, ולא נדרס: ' + out);
  console.log('גיבוי מוצפן של מפתח האנדרואיד. קבצים: ' + Object.keys(files).join(', '));
  console.log(`בחרו סיסמה של ${MIN_PASSWORD} תווים לפחות, ו**רשמו אותה על נייר**. בלעדיה אי אפשר לפתוח את הגיבוי.\n`);
  const p1 = await askHidden('סיסמה: ');
  if (p1.length < MIN_PASSWORD) throw new Error(`הסיסמה קצרה מדי (לפחות ${MIN_PASSWORD} תווים)`);
  const p2 = await askHidden('שוב את אותה סיסמה: ');
  if (p1 !== p2) throw new Error('הסיסמאות לא זהות. לא נוצר גיבוי');
  console.log('מצפין... (כמה שניות)');
  fs.writeFileSync(out, encrypt(files, p1), { flag: 'wx' });
  // בדיקה: פותחים את מה שנכתב לדיסק ומשווים כל קובץ למקור
  const back = decrypt(fs.readFileSync(out), p1).files;
  for (const [name, b64] of Object.entries(files)) {
    if (!back[name] || sha(Buffer.from(back[name], 'base64')) !== sha(Buffer.from(b64, 'base64'))) {
      fs.rmSync(out, { force: true });
      throw new Error('הבדיקה נכשלה בקובץ ' + name + '. הגיבוי נמחק — נסו שוב');
    }
  }
  console.log('\n✔ הגיבוי נוצר ונבדק: נפתח בהצלחה, וכל הקבצים זהים למקור.');
  console.log('  ' + out);
  console.log('\nעכשיו: להעלות את הקובץ ל-Google Drive או לשלוח למייל שלך. את הסיסמה — רק על נייר, לא באותו מקום.');
}

async function restore(file) {
  if (!file || !fs.existsSync(file)) throw new Error('יש לציין את קובץ הגיבוי');
  const buf = fs.readFileSync(file);
  const password = await askHidden('סיסמת הגיבוי: ');
  console.log('פותח...');
  const { files, created } = decrypt(buf, password);
  fs.mkdirSync(KEY_DIR, { recursive: true });
  for (const [name, b64] of Object.entries(files)) {
    const p = path.join(KEY_DIR, path.basename(name));
    if (fs.existsSync(p)) { console.log('דילוג — כבר קיים: ' + p); continue; }
    fs.writeFileSync(p, Buffer.from(b64, 'base64'), { flag: 'wx' });
    console.log('✔ שוחזר: ' + p);
  }
  console.log('הגיבוי נוצר ב-' + created);
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const run = cmd === 'backup' ? backup(arg) : cmd === 'restore' ? restore(arg) : Promise.reject(new Error('שימוש: backup [יעד] | restore <קובץ>'));
  run.catch(e => { console.error('\n✖ ' + e.message); process.exit(1); });
}

module.exports = { encrypt, decrypt, askHidden, MAGIC };
