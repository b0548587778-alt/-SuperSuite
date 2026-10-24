// חתימת קוד לקובץ ההתקנה — ההגדרות נגזרות ממשתני סביבה בזמן הבנייה, ולא נשמרות בפרויקט.
// בלי משתנים: בנייה לא חתומה, בדיוק כמו היום (package.json: signExecutable:false).
// שלוש דרכים, לפי סוג התעודה (docs/CODE-SIGNING.md):
//   SS_SIGN_SHA1      — תעודה שמותקנת ב-Windows (טוקן USB / SimplySign). זו הדרך הנפוצה מאז 2023.
//   CSC_LINK          — קובץ ‎.pfx (ו-CSC_KEY_PASSWORD). electron-builder קורא אותם בעצמו.
//   SS_AZURE_ENDPOINT — Azure Trusted Signing (+ SS_AZURE_ACCOUNT, SS_AZURE_PROFILE, SS_SIGN_PUBLISHER).
// SS_SIGN_REQUIRED=1 — הבנייה נכשלת אם הקובץ לא נחתם (לבנייה לשחרור).
// SS_SIGN_TIMESTAMP — שרת חותמת זמן RFC 3161 (ברירת מחדל של electron-builder אם לא הוגדר).
'use strict';

const SHA1_RE = /^[0-9a-f]{40}$/i;

function httpUrl(name, value) {
  let u;
  try { u = new URL(value); } catch { throw new Error(`${name} אינו כתובת תקינה`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${name} חייב להתחיל ב-http:// או https://`);
  return u.toString();
}

// מחזיר { mode, args } — args הם דגלי -c.* ל-electron-builder. זורק שגיאה בעברית על הגדרה חלקית
function signingArgs(env = process.env) {
  const v = (k) => String(env[k] || '').trim();
  const sha1 = v('SS_SIGN_SHA1').replace(/\s+/g, '');
  const pfx = v('CSC_LINK') || v('WIN_CSC_LINK');
  const azure = v('SS_AZURE_ENDPOINT');
  const chosen = [sha1 && 'store', pfx && 'pfx', azure && 'azure'].filter(Boolean);
  if (chosen.length > 1) throw new Error('הוגדרה יותר מדרך חתימה אחת (SS_SIGN_SHA1 / CSC_LINK / SS_AZURE_ENDPOINT) — יש לבחור אחת');

  const required = v('SS_SIGN_REQUIRED') === '1';
  const mode = chosen[0] || 'none';
  if (mode === 'none') {
    if (required) throw new Error('SS_SIGN_REQUIRED=1 אבל לא הוגדרה תעודת חתימה');
    return { mode, args: [] };
  }

  const args = ['-c.win.signExecutable=true'];
  if (required) args.push('-c.win.forceCodeSigning=true');
  const ts = v('SS_SIGN_TIMESTAMP') ? httpUrl('SS_SIGN_TIMESTAMP', v('SS_SIGN_TIMESTAMP')) : '';

  if (mode === 'store') {
    if (!SHA1_RE.test(sha1)) throw new Error('SS_SIGN_SHA1 חייב להיות טביעת אצבע של 40 תווים הקסדצימליים');
    args.push('-c.win.signtoolOptions.certificateSha1=' + sha1.toUpperCase());
    if (ts) args.push('-c.win.signtoolOptions.rfc3161TimeStampServer=' + ts);
  } else if (mode === 'pfx') {
    if (!v('CSC_KEY_PASSWORD') && !v('WIN_CSC_KEY_PASSWORD')) throw new Error('הוגדר CSC_LINK בלי CSC_KEY_PASSWORD');
    if (ts) args.push('-c.win.signtoolOptions.rfc3161TimeStampServer=' + ts);
  } else {
    const need = { SS_AZURE_ACCOUNT: v('SS_AZURE_ACCOUNT'), SS_AZURE_PROFILE: v('SS_AZURE_PROFILE'), SS_SIGN_PUBLISHER: v('SS_SIGN_PUBLISHER') };
    const missing = Object.keys(need).filter(k => !need[k]);
    if (missing.length) throw new Error('חסרים משתנים ל-Azure Trusted Signing: ' + missing.join(', '));
    args.push('-c.win.azureSignOptions.endpoint=' + httpUrl('SS_AZURE_ENDPOINT', azure));
    args.push('-c.win.azureSignOptions.codeSigningAccountName=' + need.SS_AZURE_ACCOUNT);
    args.push('-c.win.azureSignOptions.certificateProfileName=' + need.SS_AZURE_PROFILE);
    args.push('-c.win.azureSignOptions.publisherName=' + need.SS_SIGN_PUBLISHER);
    if (ts) args.push('-c.win.azureSignOptions.timestampRfc3161=' + ts);
  }
  // ב-CI כל דגל בשורה משלו (--args) — ערך עם ירידת שורה היה מתפרק לשני דגלים
  if (args.some(a => /[\r\n]/.test(a))) throw new Error('ערך בהגדרות החתימה מכיל ירידת שורה');
  return { mode, args };
}

// הפלט של --args: דגל אחד בכל שורה. ב-CI נקרא ב-mapfile למערך — ערך עם רווח (למשל "Bunim Seller") נשאר דגל אחד
function argsText(args) {
  return args.map(a => a + '\n').join('');
}

const MODE_TEXT = { none: 'לא חתום', store: 'תעודה מ-Windows (טוקן)', pfx: 'קובץ PFX', azure: 'Azure Trusted Signing' };

// הרצה ישירה: node tools/code-signing.js --args  → מדפיס את הדגלים, אחד בכל שורה (ל-CI)
if (require.main === module) {
  try {
    const r = signingArgs();
    if (process.argv.includes('--args')) process.stdout.write(argsText(r.args));
    else console.log('חתימת קוד: ' + MODE_TEXT[r.mode] + (r.args.length ? '\n  ' + r.args.join('\n  ') : ''));
  } catch (e) {
    console.error('שגיאה בהגדרות החתימה: ' + e.message);
    process.exitCode = 1;
  }
}

module.exports = { signingArgs, argsText, MODE_TEXT };
