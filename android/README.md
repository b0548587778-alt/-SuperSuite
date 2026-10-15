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

**מפתח חתימה:** `android/keystore/` נוצר בבנייה הראשונה (לא נכנס ל-git). **יש לגבות אותו** —
עדכון של אפליקציה מותקנת אפשרי רק עם אותו מפתח. בלעדיו יש להסיר ולהתקין מחדש (והנתונים במכשיר נמחקים).

## ארכיטקטורה

| קובץ | תפקיד |
|------|--------|
| `app/java/.../MainActivity.java` | WebView יחיד, בוחר קבצים, הדפסה, כפתור "אחורה" |
| `app/java/.../AssetServer.java` | מקבילה ל-`app://`: כל מודול ב-origin `https://<mod>.supersuite.androidplatform.net`, הכול מתוך assets. כל כתובת אחרת נחסמת |
| `app/java/.../Bridge.java` | `window.SuperSuiteBridge`: SQLite, scrypt, AES-GCM, קבצים. **דורש אסימון** שנמסר רק למעטפת |
| `app/java/.../SqlBridge.java` | `node:sqlite` מעל SQLite של אנדרואיד (פיצול פקודות, פרמטרים עם סוג, חלון 64MB) |
| `app/java/.../Scrypt.java` | scrypt תואם Node (נבדק מול `crypto.scryptSync` ומול וקטור RFC 7914) |
| `web/node-shims.js` | `fs`/`path`/`crypto`/`node:sqlite`/`Buffer` לקוד הכלכלי — מעל הגשר |
| `web/host.js` | `ipcMain` מדומה בחלון המעטפת; ה-`ipc.js` המקורי רץ שם כמו שהוא |
| `web/main-android.js` | מקבילה ל-`main.js`: ניווט, היסטוריה, לוח עברי, גיבוי/שחזור מוצפנים |
| `web/frame.js` | מוזרק לכל מודול: `ipcRenderer` מעל postMessage (עם אימות origin), הדפסה, הורדות, ביטול SW |
| `web/mobile.css`, `web/mobile.js` | פס עליון + מגירה בטלפון; סרגל קבוע בטאבלט (≥900px) |
| `lib/bundle.js` | מאגד CommonJS מינימלי (אין esbuild בסביבה המסוננת) |
| `dev/webview-sim.js` | סימולציה של ה-WebView מעל Electron לבדיקה בלי מכשיר |

**אין הרשאת INTERNET** במניפסט — מערכת ההפעלה עצמה מונעת גישה לרשת.

## בדיקות

- `tests/android-port.test.js` (חלק מ-`npm test`): הקוד הכלכלי מעל ה-shims, תאימות גיבוי לשולחן העבודה, הרשאות מעטפת, הזרקה ו-CSP.
- סימולציה מלאה עם צילומי מסך:
  ```bash
  node android/build-apk.js --web
  node_modules/electron/dist/electron.exe android/dev/webview-sim.js --auto <תיקיית-פלט>
  ```
- **לא נבדק אוטומטית:** קוד ה-Java על מכשיר אמיתי (SQLite של אנדרואיד, בוחר הקבצים, מסך ההדפסה).

## הבדלים מגרסת שולחן העבודה

- **גיבוי אוטומטי — אין** (אין DPAPI). גיבוי ושחזור ידניים מוצפנים בלבד (⬇ / ↥ בסרגל), לקובץ שבוחרים.
  קובץ `.ssbk` עובר בין המחשב לטלפון בשני הכיוונים.
- **PDF** (חשבונית, קבלה, הדפסה במודולים) — נפתח מסך ההדפסה של אנדרואיד, ושם "שמירה כ-PDF".
- **קיצורי מקלדת** — אין; ניווט דרך המגירה וכפתור "אחורה".
- **קישורים חיצוניים** (wa.me וכו') — לא נפתחים.
- מצלמה/מיקרופון — חסומים.
