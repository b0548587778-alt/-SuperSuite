# SuperSuite לאנדרואיד (APK)

אפליקציית אנדרואיד שמריצה את **אותם קבצים** של התוכנה השולחנית (`shell/`, `modules/`) בתוך WebView.
אין קוד ממשק כפול: הבנייה מעתיקה את המודולים ומזריקה שכבת התאמה.

## בנייה

```bash
npm run dist:android          # → dist/SuperSuite.apk
npm run dist:android:check    # בדיקה שכל הכלים קיימים
node android/build-apk.js --web   # רק קבצי ה-web (android/build/assets) — לבדיקות
```

**כלים** (בלי Gradle ובלי npm, שחסומים ב-NetFree) — בתיקייה אחת, ברירת מחדל `%USERPROFILE%\android-toolchain`
(או `SS_ANDROID_TOOLCHAIN=<נתיב>`):

| תיקייה | מקור (עבר ב-NetFree) |
|--------|-------------------------|
| `jdk-21.*` | `https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip` |
| `build-tools` | `https://dl.google.com/android/repository/build-tools_r35_windows.zip` (התיקייה בארכיון נקראת `android-15` — לשנות שם) |
| `android-35` | `https://dl.google.com/android/repository/platform-35_r02.zip` |

שלבי הבנייה: `aapt2 link` → `javac` (עם `core-lambda-stubs.jar`) → `d8` → `jar uf` (assets + dex) → `zipalign` → `apksigner`.
אין להשתמש ב-`aapt2 -A` / `aapt add` לקבצי ה-web: ב-Windows הם כותבים נתיבים עם `\` ואנדרואיד לא מוצא אף קובץ
(הסקריפט בודק זאת ב-`assertZipNames`).

**הכי פשוט — לחיצה כפולה על `build-apk.bat`** (בתיקייה הראשית). מקלידים רק את **הסיסמה שעל הנייר**, וזהו.

**מפתח חתימה:** עדכון של אפליקציה מותקנת אפשרי רק עם אותו מפתח. מאיפה הבנייה לוקחת אותו (`resolveSigningKey`):
1. **הגיבוי המוצפן** `DocumentsSuperSuite-android-key-backup.sskey` (או `SS_KEY_BACKUP=<קובץ>`) — מבקשים את סיסמת הגיבוי
   (3 ניסיונות), והמפתח וסיסמת המפתח נפתחים בזיכרון. המפתח נכתב לקובץ זמני רק לחתימה, ונמחק מיד אחריה.
   מחשב חדש: מורידים את הקובץ מ-Google Drive / מהמייל לתיקיית המסמכים — זה הכול.
2. בלי גיבוי — `android/keystore/supersuite-release.jks` עם `SS_KS_PASS`, `password.txt` (אם קיים) או הקלדה.
3. אין מפתח ואין גיבוי — **הבנייה נעצרת, ולא נוצר מפתח חדש.** יצירה מכוונת בלבד: `node android/build-apk.js --new-key`,
   ואז מיד גיבוי: `node tools/android-key-backup.js backup` (שחזור לתיקייה: `restore <קובץ>`).

מפתח בתיקייה ששונה מהמפתח שבגיבוי ← הבנייה נעצרת (לא מנחשים איזה נכון).

## ארכיטקטורה

| קובץ | תפקיד |
|------|--------|
| `app/java/.../MainActivity.java` | WebView יחיד, בוחר קבצים ותיקיות, הדפסה, כפתור "אחורה". פתיחת קובץ — עד 64MB וגם לפי הזיכרון של האפליקציה (`maxOpenBytes`); `OutOfMemoryError` נתפס ומוצגת הודעה |
| `app/java/.../AssetServer.java` | מקבילה ל-`app://`: כל מודול ב-origin `https://<mod>.supersuite.androidplatform.net`, הכול מתוך assets. כל כתובת אחרת נחסמת |
| `app/java/.../Bridge.java` | `window.SuperSuiteBridge`: SQLite, scrypt, AES-GCM, קבצים, שרת הרישוי. **דורש אסימון** שנמסר רק למעטפת |
| `app/java/.../SqlBridge.java` | `node:sqlite` מעל SQLite של אנדרואיד (פיצול פקודות, פרמטרים עם סוג, חלון 64MB) |
| `app/java/.../Scrypt.java` | scrypt תואם Node (נבדק מול `crypto.scryptSync` ומול וקטור RFC 7914) |
| `app/java/.../RelayClient.java` | **הפנייה היחידה לרשת**: POST של JSON ל-`https://<שרת הרישוי>/v1` בלבד, בלי הפניות, זמן קצוב ותקרת גודל |
| `app/java/.../TreeFiles.java` | כתיבה לתיקייה שנבחרה בבוחר התיקיות (קבצים במבנה אחיד), נתיב יחסי בלבד. התיקייה נרשמת ב-`node-shims.js` בשם שלה — אבל לעולם לא `DATA_ROOT` (`/data`, תיקיית הנתונים של הקוד הכלכלי) |
| `web/node-shims.js` | `fs`/`path`/`crypto`/`node:sqlite`/`Buffer` לקוד הכלכלי — מעל הגשר; גם `dialog`/`BrowserWindow` של Electron (`createElectronShims`) |
| `web/relay-fetch.js` | `fetch` לקוד הרישוי: רק `POST https://<שרת>/v1`, דרך הגשר (`relayPost`). כל כתובת אחרת (עדכונים, Google) נדחית |
| `web/host.js` | `ipcMain` מדומה בחלון המעטפת; ה-`ipc.js` המקורי רץ שם כמו שהוא. כל מודול — רק הערוצים שלו (`moduleMayInvoke`) |
| `web/main-android.js` | מקבילה ל-`main.js`: ניווט, היסטוריה, לוח עברי, רישוי ושער המודולים, גיבוי/שחזור מוצפנים |
| `web/frame.js` | מוזרק לכל מודול: `ipcRenderer` מעל postMessage (עם אימות origin), הדפסה, הורדות, ביטול SW, קריאה בלבד בשמאות (כניסה, תפקיד, רישיון) ודיווח פעילות שמאריך את הכניסה |
| `web/mobile.css`, `web/mobile.js` | פס עליון + מגירה בטלפון; סרגל קבוע בטאבלט (≥900px) |
| `lib/bundle.js` | מאגד CommonJS מינימלי (אין esbuild בסביבה המסוננת) |
| `dev/webview-sim.js` | סימולציה של ה-WebView מעל Electron לבדיקה בלי מכשיר |

**אנדרואיד 9 ומעלה** (`MIN_SDK = 28` ב-`build-apk.js`): כל אוסף של המודול הכלכלי נשמר כשורה אחת ב-SQLite,
וחלון הקריאה של 64MB (`new CursorWindow(name, size)`) קיים רק מ-API 28. באנדרואיד 8 התקרה 2MB — הכתיבה מצליחה
והטעינה הבאה נכשלת, כלומר הנתונים ננעלים.

### רישוי ורשת (החלטת הבעלים 23.10.2026)

- **הרשאת INTERNET — לשרת הרישוי בלבד.** הקוד היחיד שפותח חיבור הוא `RelayClient.java` (https בלבד, `usesCleartextTraffic="false"`).
  ה-WebView עצמו נשאר חסום לרשת (`setBlockNetworkLoads(true)` ו-`AssetServer`), וב-CSP של המעטפת `connect-src 'self'` בלבד —
  קוד הרישוי (`shell/licensing/remote.js`) מקבל `fetch` מ-`relay-fetch.js`, שמעביר את הבקשה לגשר. כך גם כתובת שרת שהמנהל החליף עובדת,
  וה-WebView לא יכול לפנות לשום מקום אחר. הבדיקה החתומה (`checkin.js`) רצה כמו בשולחן העבודה.
- **שער המודולים** (`shell/licensing/gate.js`) כמו ב-`main.js`: מודול שאינו ברישיון (או מערכת נעולה) לא נפתח — גם לא מתוך מודול אחר,
  ותצוגה כלכלית סגורה עוברת למסך הרישוי. שינוי מצב הרישוי בזמן עבודה מוציא מהמודול שנסגר. ערוצי המודול הכלכלי נבדקים ב-`runGuarded` כרגיל.
- **קריאה בלבד בשמאות** — כמו `secureWriteBlock` ב-`main.js` (ממצא 24): בלי כניסה פעילה, תפקיד בלי `data.edit`
  (צופה / רואה חשבון), ואחר כך הרישיון (סוף תקופת ניסיון, ממתין לתשלום, מושעה, מודול שאינו ברישיון).
  `sessionWriteBlock` + `licenseWriteBlock` ← `syncWriteBlocks` (`main-android.js`) ← `setWriteBlock` (`host.js`, גם בכתובת ה-iframe ‏`ss-ro`) ←
  `frame.js`, שעוטף את `setItem` / `removeItem` / `clear` של `Storage.prototype` וזורק `SecurityError` עם ההודעה בעברית. השחזור מהמעטפת
  (`ls-restore`) עובר. המצב נשלח מחדש בפתיחת מודול, **בכל כניסה / יציאה** (`onAuthChange` — כניסה עם הרשאת עריכה משחררת מיד) ובבדיקה של כל דקה.
- **ניתוק אוטומטי בזמן עבודה בשמאות** (החלטה 24.10.2026): `frame.js` שולח `activity` (לחיצה, מקש, מגע, גלילה — לכל היותר
  פעם ב-2 שניות, בלי פרטים) ו-`main-android.js` מאריך בו את הפגישה (`econ.touchSession`), כמו `touchActivity` ב-`main.js`. לכן פגישה
  פגה רק אחרי זמן הניתוק בלי שום פעולה — ואז הבדיקה של כל דקה חוסמת כתיבה ומעבירה למסך הכניסה; ה-iframe נשאר (מה שהוקלד ולא נשמר
  לא אובד), ואחרי הכניסה חוזרים אליו.
  **לא מכוסה כאן:** החסימה היא באותו iframe, ולכן היא מדיניות ולא גבול אבטחה מול קוד המודול. עד דקה אחרי שינוי תפקיד / חסימת משתמש
  (בלי כניסה או יציאה) הכתיבה עדיין פתוחה — עד הבדיקה הבאה.
- **תשלום על הרשמה ועדכוני גרסה** — אין `shell` באנדרואיד: `license:openPayment` ו-`update:install` דוחים בעברית ("התשלום נפתח רק
  בגרסת המחשב" / "מתקינים את קובץ ה-APK ידנית"), ובמסך הרישוי (לפי `platform` של `update:getStatus`) אין כפתור תשלום, הורדה, קובץ או התקנה.
- סנכרון עם שרת הרישוי כל 3 דקות (רק במערכת ברישיון או עם קבלת הודעות אוטומטית), ולא בשבת ויום טוב כשמצב שבת פעיל.
- כתובות אחרות — הורדת עדכון, כניסה עם Google — נדחות בעברית ("באנדרואיד מותרת פנייה לרשת רק לשרת הרישוי").

### ערוצים לכל מודול

כל iframe מפעיל רק את הערוצים של ה-preload שלו בשולחן העבודה (`moduleMayInvoke` ב-`main-android.js`): המודול הכלכלי — את ערוצי
`ipc.js` ו-`shell:econ-view` / `shell:open-module`; השמאות וארגז הכלים — אף ערוץ.
תשובות הגיבוי/השחזור (`ls`) מתקבלות רק מהמסגרת שנשאלה. ערוץ של המעטפת שאין לו מקבילה כאן (`NOT_ON_ANDROID`) מחזיר הודעה בעברית.

## בדיקות

- `tests/android-port.test.js` (חלק מ-`npm test`): הקוד הכלכלי מעל ה-shims, תאימות גיבוי לשולחן העבודה, הרשאות מעטפת, הזרקה ו-CSP.
- `tests/audit-android.test.js`: `host.js` ו-`frame.js` עצמם בתוך `vm` (ערוצים לכל מודול, תשובות גיבוי, ייצוא מבנה אחיד), קידוד בכתיבת
  קבצים (מס"ב), שער הרישוי וקריאה בלבד בשמאות, `relay-fetch.js` מעל `remote.js`, ושחזור כשאין מקום ב-localStorage.
- `tests/no-network.test.js`: באנדרואיד — רק `RelayClient.java` פותח חיבור, ובקוד ה-web אין `fetch`.
- סימולציה מלאה עם צילומי מסך:
  ```bash
  node android/build-apk.js --web
  node_modules/electron/dist/electron.exe android/dev/webview-sim.js --auto <תיקיית-פלט>
  ```
- **לא נבדק אוטומטית:** קוד ה-Java על מכשיר אמיתי (SQLite של אנדרואיד, בוחר הקבצים, מסך ההדפסה).

## הבדלים מגרסת שולחן העבודה

- **גיבוי אוטומטי — אין** (אין DPAPI), ולכן גם אין קוד שחזור (🔑) ויעד גיבוי. גיבוי ושחזור ידניים מוצפנים בלבד (⬇ / ↥ בסרגל),
  לקובץ שבוחרים — למנהל בלבד, כמו בשולחן העבודה. קובץ `.ssbk` עובר בין המחשב לטלפון בשני הכיוונים.
  מודול שהנתונים שלו מהמחשב גדולים מהמקום ב-localStorage של המכשיר — נשאר עם הנתונים הקודמים שלו, ושאר השחזור (כולל הכספים)
  מושלם, עם הודעה שמפרטת מה לא שוחזר. כל כשל אחר מחזיר את הכול למצב שלפני השחזור.
- **PDF** (חשבונית, קבלה, הדפסה במודולים) — נפתח מסך ההדפסה של אנדרואיד, ושם "שמירה כ-PDF".
- **קבצים במבנה אחיד** — בוחר התיקיות של אנדרואיד; `OPENFRMT/...` עם `INI.TXT` ו-`BKMVDATA.zip` (בלי דחיסה — אין zlib), ודוח ההפקה במסך ההדפסה.
  קובץ מס"ב ו-PCN874 נכתבים בית לכל תו (`latin1` / `ascii`), כמו בשולחן העבודה.
- **לא זמין באנדרואיד:** הגדרות תצוגה, דוח תקלה, מדריך המשתמש, סנכרון בין מכשירים, הצפנת גיבויים ישנים — הכפתורים מוסתרים, והערוצים מחזירים הודעה בעברית.
- **קיצורי מקלדת** — אין; ניווט דרך המגירה וכפתור "אחורה".
- **קישורים חיצוניים** (wa.me וכו') — לא נפתחים.
- מצלמה/מיקרופון — חסומים.
