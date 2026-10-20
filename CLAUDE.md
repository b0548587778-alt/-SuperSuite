# CLAUDE.md — הנחיות עבודה על SuperSuite

קובץ זה נטען אוטומטית לכל סשן עבודה על הפרויקט. קרא אותו לפני כל שינוי.

---

## מה זה הפרויקט

**SuperSuite** — תוכנה שולחנית (Electron). למשתמש היא נראית כתוכנה אחת עם סרגל אחד; בפנים היא מורכבת מארבעה מודולים:

| מזהה | מודול | תיאור |
|------|-------|--------|
| `econ` | מערכת כלכלית | הנהלת חשבונות כפולה, חשבוניות מס, מע"מ, מחירון, דוחות, תכנון פיננסי, משכנתאות, ייעוץ משכנתאות, עמותות, מודיעין שוק |
| `shamai` | שמאי | הערכת שווי — מיקוד בזהב, תכשיטים ומטלטלין. קוד ב-`modules/shamai/src/*.js`: **סקריפטים רגילים בטווח שמות אחד** לפי סדר התגים ב-`index.html` (`core.js` ראשון, `calc.js` — חישובי השמאות בלי DOM). קובץ חדש — תג ב-`index.html` **וגם** ב-`sw.js`; שם כפול ברמה העליונה נכשל ב-`tests/shamai-report.test.js`. בבדיקות: `tests/helpers/shamai-src.js` (`loadShamai` / `shamaiSource`). **אין `window.open`** (המעטפת חוסמת) — הדפסה דרך `openPrintPreview` ב-`src/report.js`. **מחירים — רק דרך `src/prices.js`** (`applyPriceUpdate`: תאריך ומקור לכל מחיר ב-`prices.meta`, בדיקת טווח); אין `fetch` לרשת (`tests/shamai-prices.test.js`). **קניית זהב מלקוח** — `src/purchase.js` (9.18): חישוב באגורות, שטר ממוספר (`purchaseSeq`, אחרי אישור בלבד), רישום ביומן כ"נקנה". **תיק שמאות מקצועי** (מסך `cases`) — לוגיקה ב-`src/casefile.js` (באגורות; מטבע זר — יחידות שלמות × שער שהוקלד; `finalizeCase` נועל עותק של הערכים והמחירים, שינוי = `reopenCase` עם סיומת למספר הדוח), דוח ב-`src/case-report.js` (עברית או דו-לשוני, טהור), מסך ב-`src/case-ui.js`; תמונות לתיק ב-localStorage המוצפן (`casePhoto_<id>`, עד 400KB). **נדל"ן במסך השמאות** — הערכה גסה בלבד לפי מחיר למ"ר שהשמאי מקליד (`reQuickEstimate` ב-`appraise-assets.js`); אין טבלת מחירים מובנית. שומה מלאה — במסך "שמאות מקרקעין" במודול הכלכלי. **מסך שמאות חדש — בתוך `<section data-view="appraisal">`**: `</div>` עודף מוציא את כל המסכים החוצה (`tests/shamai-report.test.js`) |
| `trainer` | TrainerPro | ניהול אימונים ומתאמנים, וניהול סטודיו (9.11): יומן, מנויים וכרטיסיות, תשלומים, תזכורות ודוח למתאמן. מקור ב-`modules-src/trainer`: האחסון ב-`src/lib/db.js` (`S`, `K`), לוגיקת הסטודיו ב-`src/lib/studio.js` (טהורה, נבדקת ב-`tests/trainer-studio.test.js` דרך `import()`), מחולל התוכניות וחישוב ה-BMI ב-`src/lib/program.js` (`generateProgram(client, { random })`; נבדק ב-`tests/trainer-calc.test.js` עם החישובים מ-`src/data/*`. **תרגיל חדש ב-`data/exercises.js` — כל ערך ב-`contra` וב-`eq` חייב להיות מוכר ב-`data/constants.js`**), המסכים ב-`src/studio.jsx`. חשבונית מס/קבלה לתשלום — מהמערכת הכלכלית (מסך הגבייה, ראו `core/trainerPayments.js`), בלי קוד במודול. **מקומית אין vite** — בדיקת תחביר JSX אפשרית רק בכלי חיצוני; הבנייה בענף `build/**` או ב-master |
| `tools` | ארגז כלים | מחשבונים וכלי עזר (22 כלים), דף אחד: `index.html` + `app.js`; הלוגיקה הטהורה ב-`calc.js` (נבדקת ב-`tests/tools-calc.test.js` ו-`tests/tools-audience.test.js`). **כלים לקהל היעד (9.12):** שכר נטו — טבלת המדרגות המובנית **לא מאומתת** (⚠, שנת תוקף); טבלה חדשה נטענת מקובץ דרך `parseSalaryTable`. מעשרות — חישוב בלבד, עם הפניה לרב |

**קהל היעד:** משתמשים בסביבה חרדית. כל טקסט, דוגמה ונתון לדוגמה חייבים להיות נקיים והולמים.
**סביבת הפעלה:** מחשבים מסוננים (NetFree ואחרים). האפליקציה חייבת לעבוד **מלאה אופליין**, בלי שום תלות ברשת חיצונית.

---

## פקודות

```bash
npm start          # הרצת האפליקציה בפיתוח (run-electron.js — עובד גם בלי path.txt של electron)
npm test           # הרצת כל הבדיקות בתיקיית tests (node --test "tests/*.test.js")
npm run dist       # בניית מתקין NSIS + portable ל-Windows
npm run dist:local # בנייה מהמטמון המקומי בלבד (בלי הורדות) — מומלץ בסביבה מסוננת
npm run dist:check # בדיקה מה קיים מקומית לבנייה, בלי לבנות
```

בנייה למשתמש קצה: `build-exe.bat` (מתקין Node אוטומטית אם חסר, ואז בונה דרך `build-local.js`), או GitHub Actions → `Build Windows installer`.

אנדרואיד: `build-apk.bat` — הבעלים מקליד רק את סיסמת הגיבוי (על נייר); המפתח נפתח בזיכרון מהגיבוי המוצפן ב-Documents (`resolveSigningKey` ב-`android/build-apk.js`). **אין ליצור מפתח חתימה חדש אוטומטית** — מפתח חדש = אי אפשר לעדכן את האפליקציה המותקנת; רק `--new-key` במפורש (`tests/android-key-backup.test.js`). ראו `android/README.md`.

**בנייה בסביבה מסוננת:** `build-local.js` מאתר את מה שכבר קיים במחשב ומגיש אותו
ל-electron-builder:
- **ארכיון ה-Electron** — זה החלק הקריטי. electron-builder מחפש את ה-**zip** של Electron
  (`electron-v<version>-win32-x64.zip`), ולא משתמש ב-`node_modules/electron/dist`. אם
  ה-zip קיים במטמון (`%LOCALAPPDATA%\electron\Cache\`), הסקריפט מעביר את תיקייתו
  דרך `-c.electronDist=<dir>` (הגדרה רשמית: "folder of electron zips") — וכך האריזה
  מקומית לגמרי. **בלי זה, electron-builder מוריד את ה-zip ונתקע ב-418 של NetFree.**
- **מטמון כלי האריזה** — `ELECTRON_BUILDER_CACHE` מפנה ל-`...\electron-builder\Cache`
  (nsis, winCodeSign, 7zip).
- הרצה: `npm run dist:local` (או `dist:check` לבדיקה בלבד).
- ה-spawn נעשה בקריאה ישירה ל-`out/cli/cli.js` דרך `process.execPath`, **בלי** `shell:true`:
  נתיב הפרויקט מכיל רווח ("bunim seller"), ו-shell היה מפרק את הפקודה על הרווח.

### כלי עזר ב-Python (אופציונלי)

`tools/passwords/` — מודול נפרד להצפנה ולערבול סיסמאות. **אינו חלק מהאפליקציה ואינו
נטען על ידה.** דורש את הספרייה `cryptography` (ראו `requirements.txt` בתיקייה). הרצת בדיקות:

```bash
cd tools/passwords
python -m unittest test_encryption -v
```

---

## ארכיטקטורה

### תהליך ראשי — `main.js`
הנקודה היחידה שמחזיקה `BrowserWindow`. כל מודול הוא `WebContentsView` נפרד שנטען דרך פרוטוקול מותאם `app://`.

- **`MODS`** (שורה ~10) — רשימת המזהים המותרים. כל ניווט מאומת מולה.
- **`shell/nav-guard.js`** — כללי ההרשאה למעבר בין מודולים (`shell:switch` למעטפת בלבד, `shell:open-module` לתצוגות מודול). נבדק בטסטים.
- **`ENTRY`** — נתיבי הכניסה למודול (`app://econ/views/index.html` וכו').
- **`SIDEBAR = 264`** — רוחב סרגל הצד. חייב להישאר מסונכרן עם `.side{width:264px}` ב-`shell/shell.html`.
- **מיקום התצוגות — `shell/layout.js`**: כששפת הממשק של Windows היא עברית, Electron מודד את x של `setBounds` **מהקצה הימני**. `viewBounds` מתקן לפי `app.getLocale()`. בלי זה המודול מכסה את הסרגל ואין דרך לצאת ממנו (נבדק ב-`tests/layout.test.js`). בדיקה ידנית: `--lang=he` מול `--lang=en-US`.
- **`shell/catalog.js`** — מקור אמת יחיד לכל פריטי הסרגל (תחום → פריט → מודול/תצוגה). `ECON_VIEWS` נגזר ממנו ו-`main.js` מאמת מולו. **תצוגה חדשה במודול הכלכלי חייבת להתווסף גם לקטלוג** (נבדק ב-`tests/catalog.test.js`).
- **`shell:open`** (מעטפת בלבד) — פותח מודול ובמודול הכלכלי גם תצוגה (`econ:goto`). **`shell:overlay`** — מסתיר את המודול בזמן דיאלוג במעטפת. **`shell:econ-view`** — המודול הכלכלי מדווח על התצוגה הפעילה לסימון בסרגל.
- המודול הכלכלי נטען עם `?embedded=1` ומסתיר את הסרגל הפנימי שלו (`.embedded aside`).
- **מודול האימונים בסרגל האחיד** — תחום `trainer` בקטלוג (`TRAINER_VIEWS` / `TRAINER_LABELS`: תצוגה ← הטקסט של הכפתור בסרגל הפנימי של החבילה המהודרת). `modules/trainer/preload.js` (בלי `contextBridge`) מסתיר את ה-`aside`, לוחץ על הכפתור לפי `trainer:goto` (ושומר את הבקשה עד שהסרגל קיים — מסך הגדרה ראשונית), ומדווח על המסך הפעיל ב-`shell:trainer-view` (נבדק מול `views.trainer`). **שמירה כ-PDF** (PLAN.md 6.4): `savePdf(name)` ב-`src/lib/print.js` ← אירוע `ss:save-pdf` ← ה-preload ← `trainer:save-pdf` ב-`main.js` (רק `fromView(e, 'trainer')`; `shell/print-pdf.js`: חלון שמירה ואז `printToPDF` של התצוגה, שם הקובץ מנוקה ב-`pdfFileName`). שגיאה חוזרת לעמוד במאפיין `data-ss-pdf-error` ובאירוע `ss:pdf-error`. בלי הערוץ (אנדרואיד) — `window.print()`. בנייה חדשה של המודול ששינתה טקסט בסרגל — `tests/trainer-nav.test.js` ייכשל.
- **`registerProtocol()`** — מגיש קבצים מ-`modules/<mod>/` בלבד. חוסם path traversal אחרי `path.normalize`.
- **`ensureView(id)`** — יוצר `WebContentsView` עצלן עם `contextIsolation:true, nodeIntegration:false, sandbox:true`.
- **`switchTo` / `goHome`** — ניווט בין מודולים. `goHome` מסתיר את כולם ומחזיר למסך הראשי.
- **`handleShortcut()`** — Ctrl+1..4 (ניווט), Ctrl+K (חיפוש), Ctrl+=/-/0 (זום), F1 (מדריך), Ctrl+Shift+B/R (גיבוי/שחזור).

### מעטפת — `shell/`
| קובץ | תפקיד |
|------|--------|
| `shell.html` | סרגל צד, מסך ראשי, דיאלוגים (סיסמה, מדריך). כולל CSP מחמיר. |
| `catalog.js` | קטלוג התחומים והפריטים — מקור הסרגל, מסך הבית והחיפוש |
| `hebcal.js` | לוח עברי (ICU מובנה), מועדים ודחיית צומות, זמני היום לפי עיר, מצב שבת/יו"ט. משותף ל-main.js ולמעטפת. הגדרות ב-`ui-settings.json` → `calendar` (ערוצי `shell:get-calendar` / `shell:save-calendar`). **במצב שבת אין פעולות אוטומטיות** — הגיבוי האוטומטי נדחה (`reason: 'shabbat'`) |
| `design-tokens.css` | **שפת העיצוב — מקור יחיד לצבעים, גופנים, מרווחים, פינות וצללים** (PLAN.md 7.1), משתני `--ss-*`. נטען ראשון בכל מסך; המודולים מקבלים אותו ב-`app://<מודול>/design-tokens.css` (`registerProtocol` ב-`main.js` מגיש את הקובץ מהמעטפת), באנדרואיד — עותק בבנייה. **אין צבע hex בסגנונות או בממשק הכלכלי** — צבע חדש מוסיפים כאן ומשתמשים ב-`var(--ss-...)` (`tests/ui-consistency.test.js`, עם רשימת חריגים `HEX_ALLOWED`). במודול האימונים: `<link>` ב-`modules-src/trainer/index.html`, לפני החבילה. צילומי מסך: `electron.exe . --smoke --user-data-dir=<תיקייה> --shots=<תיקייה>` (התיקייה `shots/` מחוץ למאגר) |
| `splash.html` + `splash.js` | **מסך פתיחה** (PLAN.md 7.2): נפתח בתחילת `whenReady` (לא ב-`--smoke`), נסגר ב-`did-finish-load`/`did-fail-load` של המעטפת ובכל מקרה אחרי `MAX_MS`. **חלון הודעה חדש בזמן העלייה (לפני `createWindow`) — `closeSplash()` לפניו**, אחרת ההודעה מוסתרת מאחוריו (`tests/splash.test.js`). אייקון התוכנה: מקור `build/icon.svg`; אחרי שינוי — `node_modules/electron/dist/electron.exe tools/make-icon.js` (מייצר `icon.png` ו-`icon.ico`, נבדק ב-`tests/icon.test.js`) |
| מתקין, רישיון ומדריך | **מתקין עם אשף** (PLAN.md 1.3): `build.nsis` (`oneClick:false`, `perMachine:false`, `license: build/eula.txt`). `build/installer.nsh` — `customInstallMode` מכריח התקנה למשתמש הנוכחי, כדי שהשדרוג יגיע לאותה תיקייה של 3.10.0. **קובץ NSIS עם עברית — UTF-8 עם BOM**. **רישיון** (5.1): `UNLICENSED`. `LICENSE.txt`, `THIRD-PARTY-NOTICES.txt` ו-`build/eula.txt` נמצאים גם ב-`extraFiles` (לתיקיית ההתקנה) וגם ב-`files` (מסך "אודות" קורא אותם דרך `shell:get-about`). **רכיב צד שלישי חדש — להוסיף את הרישיון שלו ל-NOTICES.** **מדריך המשתמש** (1.6): `shell/guide/index.html` — חלון בלי JavaScript (`guideWindow`), PDF דרך `shell:save-user-guide-pdf`. אין `<script>`, אין רשת ואין hex; כל `img` חייב להיות קיים (`tests/installer-about.test.js`). צילומים מחדש: `node tools/guide-shots.js` (CDP, פרופיל זמני) |
| נגישות (PLAN.md 7.3) | **צבע טקסט חדש או רקע חדש — להוסיף את הזוג ל-`TEXT_PAIRS` ב-`tests/accessibility.test.js`** (4.5 לפחות). מסגרת המיקוד — רק `:focus-visible` ב-`design-tokens.css` (`--ss-focus-ring`, ועל רקע כהה `--ss-focus-ring-dark`); אין לבטל אותה. כפתור שכל התוכן שלו אייקון — `aria-label` (במסכים הקבועים נבדק; בממשק הכלכלי `title` מספיק — `labelIconButtons`). `<dialog>` חדש — `aria-labelledby` לכותרת. **שדה חדש בשמאות או בארגז הכלים — `<label for="id">` או `aria-label`** (`unlabeledFields`; ערך עם `"` שובר את המאפיין — להשתמש ב-״). אנדרואיד: מסך הפתיחה ב-`android/app/res`, האייקונים ב-`build/android` (נוצרים ב-`tools/make-icon.js`) |
| `display.js` + `display-preload.js` | **הגדרות תצוגה** (PLAN.md 7.4): ערכה (בהיר/כהה/לפי Windows), צבע הדגשה, צפיפות, טקסט, פינות, ניגודיות, תנועה, וערכות מוכנות. נשמר ב-`ui-settings.json` → `display` (`shell:get-display` / `shell:save-display` — מעטפת בלבד; `display:set-theme` — בהיר/כהה בלבד, ממודול או מהמעטפת). ה-preload (לכל ה-session) מציב `data-ss-*` על `<html>` בכל מסך ומקבל `display:changed`; העיצוב — **רק החלפת משתנים** ב-`design-tokens.css`. **צבע קבוע חדש במסך — דרך משתנה `--ss-*`**, אחרת הוא לא יתחלף בכהה; רקע שחייב להישאר כהה תמיד — `--ss-side-top` / `--ss-on-dark`. זוג טקסט/רקע חדש בכהה — ל-`tests/display.test.js` |
| `shell.js` | סרגל אחיד, מסך בית, חיפוש, אחרונים, גיבוי/שחזור, זיהוי יעד גיבוי, חלון "תצוגה" (🎨) |
| `preload.js` | חשיפת `window.shellAPI` מעל `contextBridge` |
| `onboarding.js` | אשף התחלה: פרופילים (עמותה, גמ"ח, עסק...) ← "המסכים שלי" וצעדים ראשונים במסך הבית. מצב ב-`localStorage` (`suite.onboarding`), מנורמל כקלט לא מהימן. **רק סידור מסכים — לא יוצר נתונים.** כל מפתח בו חייב להיות בקטלוג (`tests/onboarding.test.js`). נטען גם באנדרואיד (`android/build-apk.js`) |
| `auto-backup.js` → קוד שחזור | מפתח הגיבוי האוטומטי מוגן ב-DPAPI — בלי קוד שחזור, תקלה במחשב = אובדן כל הגיבויים האוטומטיים. `recoveryCodeFromKey` / `keyFromRecoveryCode`: Base32 של Crockford, 55 תווים עם 2 בתי ביקורת. כפתור 🔑 (`shell:get-recovery-code`, הרשאת `data.backup`); בשחזור — מזוהה לפי הצורה במקום סיסמה. אין באנדרואיד (אין שם גיבוי אוטומטי) |
| `google-signin.js` | כניסה עם Google — **אפשרות נוספת, הסיסמה נשארת תמיד** (אופליין). דפדפן המערכת + כתובת מקומית 127.0.0.1, PKCE ו-state, אימות מלא של id_token (RS256, iss, aud, exp, nonce). לא נשמר אסימון — רק `sub` בטבלה `auth_google_links`. ההמתנה לדפדפן (עד 3 דק') רצה **מחוץ** ל-`enqueue` (`handleGoogle` ב-`ipc.js`). מדיניות אופציונלית: `chat:*` רק בפגישה עם `via: 'google'`. **מזהה מובנה** (PLAN.md 4.7): `shell/google-client.js` — כשיש בו מזהה, הכניסה פעילה בלי הגדרה; `normalizeGoogle` ב-`ipc.js`: הגדרות שנשמרו גוברות (כיבוי, מזהה של הארגון), מזהה ריק = המובנה. **המזהה המובנה והסודות לא יוצאים למסך** (`googleSettingsView`). בבדיקות — `initEcon({ googleClient })`; **אין לבדוק שהקובץ ריק או מלא** — הבעלים ימלא אותו. מדריך: `docs/GOOGLE-SIGNIN.md` |
| `licensing/activation.js` | **תנאי הפעלה למערכת ברישיון**: רישיון שנתי (365 יום לפחות — `termMs`) וחיבור לשרת ב-30 הימים האחרונים (`CHECK_DAYS`). בלי שניהם — `locked` (`withActivation` ב-`ipc.js`). **Google אינו תנאי** (רק אפשרות כניסה). `dueSoon` — תזכורת 7 ימים לפני נעילה. הזמן ב-`remote.lastSync` בקובץ הרישוי; בבדיקות — `tests/helpers/activation.js` (`markActivated`). **בקשת אישור למערכת בת דורשת תשלום שנתי להורה** (`requireChildPayment`, דרישה מסוג `license` במסך הגבייה, תשלום אחד לבקשה). ראו docs/LICENSING-DESIGN.md |
| `licensing/store.js` → תקופת ניסיון | **התקנה עם מפתח שורש ובלי רישיון = ניסיון של 30 יום** (PLAN.md 4.2, `TRIAL_DAYS`). `trialState`: `status: 'active'` + `trial: { startedAt, endsAt, daysLeft, warn }` וכל התחומים (`offer.FEATURES`); אחרי הסוף — `trial_ended`, שב-`gate.js` הוא קריאה בלבד (`READ_ONLY_STATUS`, כמו `pending_payment`). `trialStart` נשמר בקובץ **ובשומר** (המוקדם גובר), הזמן מול `lastSeen` — רק קדימה. `hadLicense` בשומר: אחרי רישיון, קובץ חסר = נעול. **בדיקה ש-`status === 'active'` לא מבדילה בין ניסיון לרישיון** — במקום שזה משנה (תנאי הפעלה ב-`withActivation`, הנפקת מערכות בת) לבדוק `s.trial`. בבדיקות שמצפות לנעילה בלי רישיון — `trialStart` ישן בקובץ (ראו `tests/licensing-ui.test.js`) |
| מסך הרישוי (`econ/ui/licensing.js`) | **כרטיס מצב אחד בראש** (PLAN.md 4.3): `licSummary(st, now)` ← `kind` מתוך trial / active / expiring / limited / locked / unlicensed (המחלקה `lic-<kind>`), `licFixSteps` ← "מה לעשות" לפי `status` ו-`reasons[0].source/step`. **הכפתורים `licInstallBtn` / `licPasteBtn` / `licBuyBtn` בכרטיס המצב בלבד** (בלי רישוי — `licInstallBtn` בפרטי הרישיון); מזהה כפול שובר את הלחיצה. סיבה חדשה עם פתרון משלה — להוסיף ענף ב-`licFixSteps`. שאר הכרטיסים בתוך `<details class="lic-advanced">`. הדבקת קוד = `installLicense` (אותו ערוץ כמו קובץ) |
| `tools/release-check.js` | **בדיקה לפני גרסה להפצה** (PLAN.md 4.5): `releaseProblems(keys, relayUrl)` — `root-keys.js` ריק / מפתח פרטי / פגום, או שרת שאינו https ← יציאה 1. רצה ב-CI **רק** ב-`workflow_dispatch` עם `release: true` (צעד "Release check" לפני Build) — הבנייה הרגילה לא נחסמת כשהרישוי כבוי. **אין לבדוק בטסטים ש-`root-keys.js` ריק או מלא** — הבעלים יפעיל אותו. הזרימה המלאה נבדקת על עותק זמני (`tests/release-guard.test.js`). מדריך לבעלים: `docs/LICENSING-ACTIVATION.md` |
| `licensing/default-relay.js` | **כתובת שרת הרישוי שמוגדרת מראש** (PLAN.md 4.4). `getRemoteSettings` ב-`store.js` מחזיר אותה רק כש-`remote.url` לא נשמר (`undefined`); כתובת שהמנהל שמר גוברת, וכתובת ריקה שנשמרה = החיבור כבוי. **ברירת המחדל לא נכתבת לקובץ** — החלפת הכתובת כאן מגיעה לכל ההתקנות. מועברת דרך `initEcon({ relayUrl })`; `createLicenseStore` בלי `defaultUrl` (בדיקות) — בלי כתובת. בבדיקות שקוראות ל-`initEcon` עם רישיון וקבלה אוטומטית — להזריק `fetchImpl` או `relayUrl: ''`, אחרת תהיה פנייה לשרת האמיתי |
| `db-recovery.js` | **מסד פגום או נעול בעלייה** (PLAN.md 2.3). `classifyDbError` לפי `errcode` של SQLite: 11/26 ← `corrupt`, 5/6 ← `locked`; אחר ← null (השגיאה הישנה). `recoverDatabase` ב-`main.js`: הודעה (`dialogFor`) בלולאה — שחזור מ-`latestAutoBackup` (פענוח ובדיקה **לפני** `setAsideDamaged`, ואז `initEcon` ו-`restore`), תיקיית נתונים, דוח תקלה, נסו שוב, יציאה. **המסד הפגום לא נמחק** (`.damaged-*`). `Database.initialize` סוגר את הקובץ בכל כשל — אחרת Windows לא מאפשר להזיז אותו. **כל קריאה ל-`initEcon` ב-`main.js` — דרך `econInitOptions()`** (`tests/trainer-receipts.test.js`). נבדק מול `main.js` האמיתי בתהליך נפרד (`tests/db-recovery.test.js`) |
| `screen-guard.js` | **רשת ביטחון במסכים** (PLAN.md 2.4) לשמאות, לאימונים ולארגז הכלים: מאזין `error` / `unhandledrejection` ← פס בעברית עם "טען מחדש" (מסך שהתרוקן ← הודעה על כל המסך). `main.js` מגיש אותו ב-`app://<מודול>/screen-guard.js` (כמו `design-tokens.css`), באנדרואיד — עותק בבנייה. **נטען לפני כל סקריפט אחר** בשמאות ובכלים; באימונים — `build-trainer.js` (`fixThemeOrder`) שומר אותו אחרי ערכת הצבעים. צבעים רק `var(--ss-*)` (`tests/screen-guard.test.js`) |
| `ui-kit.css` | **ספריית הרכיבים — מקור אחד לכפתורים, שדות, כרטיסים, טבלאות ותגיות** (`.ss-btn`, `.ss-btn-primary`/`-secondary`/`-danger`/`-ghost`/`-sm`, `.ss-input`, `.ss-card`, `.ss-table`, `.ss-badge` + `-success`/`-warning`/`-danger`/`-info`, כותרת עמוד `.ss-page-head`, מדדים `.ss-kpis`/`.ss-kpi`, לשוניות `.ss-tabs`/`.ss-tab`). **מסך חדש — רק המחלקות האלה למבנה, בלי CSS משלו**. מידות הפקדים `--ss-ctl-*` ב-`design-tokens.css`. נטען אחרי שפת העיצוב בכל מסך (`main.js` מגיש מ-`app://<מודול>/ui-kit.css`, באנדרואיד — עותק; באימונים — `<link>` ב-`index.html` של המקור). כל מודול ממפה את המחלקות שלו בבלוק "ui-kit — מיפוי". **רכיב חדש — כאן, לא בקובץ של מודול** (`tests/ui-kit.test.js`). **מסך צר:** `.ss-stack` היא עמודה `minmax(0, 1fr)` — טבלה רחבה גוללת בתוך `.ss-scroll` ולא מרחיבה את המסך; `@media (max-width: 720px)` בסוף הקובץ. רכיבי מבנה למסך: `.ss-stack`, `.ss-grid`, `.ss-form-grid` (+ `.ss-wide`), `.ss-field` + `.ss-label` + `.ss-input`, `.ss-check(s)`, `.ss-fieldset`, `.ss-section-title`, `.ss-hint`, `.ss-muted`, `.ss-toolbar` (+ `.ss-push`), `.ss-actions`, `.ss-card-warning` / `-info` / `-accent`, `.ss-row` (+ `-total` / `-big`), `.ss-scroll`, `.ss-table-edit`, `.ss-list` + `.ss-list-row` (+ `.ss-grow`), `.ss-photos` + `.ss-photo`. **שמאות מקרקעין ותיק השמאות בנויים רק ממחלקות `ss-*`** (`tests/appraisal-ui-kit.test.js`); בשמאי, בערכה הכהה, `#cs-root` מגדיר מחדש את משתני `--ss-*` לצבעי הערכה הכהה |
| `ss-dialog.js` | **חלון הודעה אחד לכל התוכנה** (במקום `alert` / `confirm` / `prompt` של הדפדפן — `prompt` אינו נתמך ב-Electron). `ssDialog.confirm(msg, { danger })` / `prompt` / `alert` / `choose` — כולם `Promise`, ולכן הפונקציה הקוראת חייבת להיות `async`. נטען במעטפת, בשמאות ובארגז הכלים (`main.js` מגיש מ-`app://<מודול>/ss-dialog.js`, באנדרואיד — עותק), באימונים דרך `src/lib/dialog.js` (`askConfirm` / `showMessage`); במודול הכלכלי — `askConfirm` הקיים ב-`ui/dialogs.js`. **אין `alert(`/`confirm(`/`prompt(` חדש** וגופן רק `var(--ss-font)` / `var(--ss-font-title)` (`tests/ss-dialog.test.js`) |
| אפס רשת (PLAN.md 5.3) | `tests/no-network.test.js` סורק את כל הקבצים הארוזים ואת מקור האימונים. **כתובת חיצונית חדשה — להוסיף ל-`ALLOWED` (או `ALLOWED_IN` לקובץ אחד) עם סיבה**, ו-`fetch` / `XMLHttpRequest` / `WebSocket` רק בקבצים שב-`FETCH_ALLOWED`. קישור שנפתח בלחיצה עובר ב-`setWindowOpenHandler` לדפדפן המערכת — אינו פנייה של התוכנה |
| `crash.js` + `logger.js` | **רשת ביטחון לקריסות ויומן תקלות** (PLAN.md 2.1–2.2). `crash.installProcessHandlers()` בראש `main.js` — שגיאה שלא נתפסה: דיאלוג בעברית (המשך / דוח תקלה / הפעלה מחדש), בלי סגירה. `crash.wireContents` לכל מסך (ב-`wireView` ובמעטפת): קריסה או "לא מגיב" ← טעינה מחדש של אותו מסך בלבד. דיאלוג אחד בכל פעם. היומן `crash.log` בתיקיית הנתונים, מוחלף ב-512KB (3 ישנים), **כל שורה עוברת `redact`** (ת"ז, טלפון, דוא"ל, שם המשתמש בנתיב). `toUserError` ב-`ipc.js` כותב ליומן דרך `setErrorLogger`. דוח תקלה (`shell:save-crash-report`, כפתור במדריך F1) — היומן בלבד, בלי נתונים. **ב-`main.js` אין `console.error`** — רק `logger.error` (נבדק ב-`tests/crash.test.js`) |
| `code-guard.js` + `smoke.js` | **הגנה על הקוד בגרסת הפצה** (PLAN.md 3.5). **כל `webPreferences` חדש — דרך `CodeGuard.guardPrefs(prefs, app.isPackaged)`** (`devTools:false` בהפצה; `tests/code-protection.test.js` בודק כל שורה ב-`main.js`), ו-`wireDevToolsGuard` סוגר כלי מפתחים שנפתחו. פרמטר דיבוג בהפצה ← `app.exit(1)` לפני הכול. מתגי Electron ב-`package.json` → `electronFuses` (בדיקת שלמות של `app.asar`). **כיווץ:** `tools/minify.js` ב-CI בלבד (`CI` חובה — משנה קבצים במקום). קבצים שחולקים שמות גלובליים — `GLOBAL_SCOPE` (רק רווחים); **קובץ חדש כזה — להוסיף שם**, אחרת שמותיו יקוצרו והטעינה תישבר. `--smoke` + `--user-data-dir` (חובה): טוען את המעטפת וכל המודולים, חלונות הודעה נרשמים ולא נפתחים, `smoke.json` ויציאה 0/1, בלי גיבוי אוטומטי. ב-CI: `tools/smoke-packaged.js` על `dist/win-unpacked` — עלייה, ופרמטר דיבוג / `app.asar` ששונה ← מסרבת לעלות (`ci-status` → `smoke.log`). במחשב: `electron.exe . --smoke --user-data-dir=<תיקייה>` |
| `db-key.js` + `econ/core/atRest.js` | **הצפנת מסד הנתונים** (PLAN.md 3.1). `collections.payload` ו-`audit_events.details` נכתבים `SSDB1:` + AES-256-GCM. המפתח = HKDF של מפתח הגיבוי האוטומטי (`autobackup.key`, DPAPI) — **קוד השחזור (🔑) פותח גם את המסד**. `resolveDbKey`: יש נתונים מוצפנים ואין מפתח תקין ← חלון `recovery.html`; **לעולם לא נוצר מפתח חדש מעל נתונים מוצפנים**. בלי קוד ← `setAsideLockedDatabase` (העברה הצידה, לא מחיקה). בלי DPAPI ← גלוי עם אזהרה במסך הבית (`AT_REST_WARNINGS`). המרה של מסד ישן: `beforeEncrypt` (גיבוי מוצפן ומאומת) ← טרנזקציה ← VACUUM; גיבוי שנכשל ← אין המרה (`pending-backup`). **כתיבה חדשה לאוסף או ליומן — רק דרך `save`/`audit`** (שם `cipher.seal`). שגיאת `db-key-*` ב-`load` נזרקת, לא הופכת לנתונים ריקים. באנדרואיד אין `dbOptions` — גלוי. נבדק ב-`tests/at-rest.test.js`, כולל שדרוג ממסד של 3.10.0 |
| `secure-store.js` + `secure-ls-preload.js` | **localStorage מוצפן לשמאות ולאימונים** (PLAN.md 3.2). ה-preload נרשם לכל ה-session (`registerPreloadScript`) ופועל רק ב-`app://shamai` / `app://trainer` במסגרת העליונה: מקבל את הנתונים (`secure-store:load`, sendSync), בפעם הראשונה מעביר את ה-localStorage הישן (`secure-store:migrate` — גיבוי מוצפן לפני, ומחיקה רק אחרי הצלחה), ומחליף את `window.localStorage` בעמוד (`executeInMainWorld`) בעותק בזיכרון ששולח כל שינוי (`secure-store:write`). קובץ `secure-<mod>.bin`, מפתח לכל מודול (HKDF של מפתח הגיבוי). **כל ערוץ בודק `fromModuleView`** — מודול לא ניגש לנתונים של אחר. **בלי כניסה (3.3):** `load` מחזיר `no-session` (ריק, קריאה בלבד) ו-`write` נדחה; `reloadLockedViewsOnSessionChange` טוען מחדש את המודולים הנעולים בכל שינוי כניסה (כולל ניתוק שקט, בטיימר של 20 שניות) ושולח `econ:auth-check` שמרוקן את המסך הכלכלי. הגיבוי קורא את המחסן ישירות. `tests/login-required.test.js` מריץ **כל** ערוץ כלכלי בלי כניסה — ערוץ חדש שלא עובר ב-`handle()` ייכשל שם. קובץ שלא נפתח ← `locked` (קריאה בלבד, לא נדרס). שחזור גיבוי כותב ישירות למחסן. `flush` ב-`will-quit`. **תמונות הפריטים בשמאות** — גם הן במחסן (`ImageDB` ב-`src/core.js`, מפתח `img_<id>`, עד 400KB אחרי `caseCompressImage`); תמונות ישנות מ-IndexedDB מועברות בעליית המודול (`migrateAll`) ונמחקות משם רק אחרי שנשמרו. **אין כתיבה חדשה ל-IndexedDB** (`tests/shamai-images.test.js`). **לא מכוסה:** אנדרואיד |
| `trainer-backup-check.js` | **בדיקת נתוני האימונים לפני שחזור** (PLAN.md 3.4). `checkTrainerItems`: מפתחות מוכרים בלבד (`trainer:profile`, `clients:index`, `studio:plans`, `studio:schedule` (רשימות), ו-`client`/`program`/`sessions`/`measurements`/`assessments`/`memberships` + `:<id>`; אחר מדולג), כל ערך JSON, ו-`clients:index` רשימת מחרוזות. נקרא ב-`restoreAll` (מחשב ואנדרואיד) **לפני חלון האישור ולפני שחזור הכספים** — קובץ פגום לא נוגע בשום דבר. `legacyTrainerBackup` ממיר קובץ JSON ישן של כפתור הייצוא שהוסר מהמודול. **מפתח חדש שהמודול כותב (`K` ב-`src/lib/db.js`) — להוסיף כאן**, אחרת הוא לא ישוחזר. במודול עצמו אין גיבוי/שחזור — רק הגיבוי המוצפן של התוכנה (`tests/trainer-backup.test.js`) |
| `plain-backups.js` | **גיבויים ישנים לא מוצפנים בתיקיית הגיבוי** (PLAN.md 3.6). `scan(dir)` — רק התיקייה עצמה, קבצי `.json` שתחילתם נראית כגיבוי ואז אימות מלא (`isPlainBackupText`: `suite`, גיבוי כלכלי ישן, או אימונים ישן). `encryptFile` — `.ssbk` במפתח הגיבוי האוטומטי ← אימות שהתוכן זהה ← מחיקת המקור; כישלון = המקור נשאר. `deleteFile` — רק קובץ שהוא באמת גיבוי גלוי. שם קובץ מהמעטפת עובר `safeName` (בלי נתיב). ערוצי `shell:plain-backup*` — `shellGuard(e, 'data.backup')`. הספירה נשמרת ב-`backup-settings.json` (`plainBackups`) בכל סבב גיבוי אוטומטי; במסך הבית — `#tgWarn` ← `#pbDlg`. אחרי שחזור מקובץ גלוי — `offerPlainFile`. **אין מחיקה אוטומטית** (`tests/plain-backups.test.js`) |
| `login-gate.js` | **שמאי ואימונים נפתחים רק אחרי כניסה** (בסיסמה או עם Google; ארגז הכלים פתוח). בלי כניסה ← המודול הכלכלי (מסך הכניסה), והמודול המבוקש נפתח מיד אחרי הכניסה. יציאה/ניתוק במודול נעול ← חזרה למסך הכניסה. נבדק **אחרי** הרישוי (מודול שלא ברישיון לא מבקש כניסה). משותף ל-`main.js` ולאנדרואיד. עבודה במודול נעול מאריכה את הפגישה (`econ.touchSession`); בדיקה שקטה — `peekSession`. `auth:setup` מחבר את המנהל הראשון מיד |

### מודול כלכלי — `modules/econ/`
| קובץ | תפקיד |
|------|--------|
| `ipc.js` | רישום כל ערוצי ה-IPC + אכיפת הרשאות. **כל** ערוץ (מלבד `auth:`) דורש session פעיל. |
| `preload.js` | חשיפת `window.systemAPI` |
| מסך כניסה ומצב ריק | **מסך הכניסה והמנהל הראשון** — `askFields(..., { screen: { intro, note } })` ב-`ui/dialogs.js`: מסך מלא עם לוגו וברכה, בלי ביטול ו-Escape; שדה עם `same` = אימות סיסמה. **רשימה ריקה — רק `renderEmpty(message, icon?)`** (`ui/core.js`): "כותרת — הסבר", אייקון מהסרגל, ואזכור של "＋ הוספת רשומה" בתצוגה עם טופס הופך לכפתור. `class="empty"` ידני נכשל ב-`tests/first-screens.test.js` |
| `ui/*.js` | הממשק (לשעבר `unified-ui.js`), קובץ לכל תחום. **סקריפטים רגילים — לא מודולים ולא IIFE**: כולם חולקים טווח שמות גלובלי אחד, לפי סדר תגי ה-`script` ב-`views/index.html`; `boot.js` אחרון. כל שם ברמה העליונה הוא גלובלי — שם כפול בין קבצים מפיל את הטעינה, ושם כמו `open`/`name`/`print` דורס את `window` (`tests/econ-ui-split.test.js`). מחוץ ל-`boot.js` — הצהרות בלבד, בלי קוד שרץ בטעינה. קובץ חדש — להוסיף תג ב-`index.html` לפני `boot.js`. בבדיקות: `tests/helpers/econ-ui.js` (`run(context)` / `source()`) |
| `core/database.js` | SQLite דרך `node:sqlite`. טבלת `collections` (key-value) + טבלאות auth/roles/audit. |
| `core/accounting.js` | לוגיקת הנה"ח כפולה |
| `core/backupCrypto.js` | הצפנת גיבוי AES-256-GCM |
| `core/exports.js` | ייצוא CSV/Excel ומסמכי HTML להדפסה / PDF (חשבונית, קבלות, סיכום שנתי לתורם, תיק תורם, דף חשבון ללווה, כרטסת לקוח). מסמך שמשולב בקובץ אחר נבנה מ-CSS וגוף נפרדים (`htmlDoc`), והעיצוב שלו מעוגן תחת מחלקה (`scopeCss`) |
| `core/dataPorts.js` | ייבוא/ייצוא כללי (CSV + vCard) לכל סוגי הנתונים, ולידציה וכפילויות |
| `services/*.js` | שירותים עסקיים — כל אחד מאותחל דרך `initializeAsync(db)` |
| `core/npo.js` + `services/npoService.js` | עמותה: קבלות סעיף 46, קרנות, תמיכות, דוח שנתי. ערוצי `npo:*`. **נפרד מהיומן העסקי**. **"תרומות ישראל" — נתיב ידני** (הוראת ביצוע 11/2025, דרך 2; PLAN.md 9.14א): מעקב סטטוס ומספר רישום שמוקלד. `donorType` (anonymous / foreign; ברירת מחדל — לא נשמר = תושב ישראל) ← `reportId`: 999999999 / 888888888 בדיווח ובייצוא `tax`, **ולא נשמר כ-`donorId`** (אחרת כל התרומות בעילום שם מתאחדות לתורם אחד). על הקבלה — "פרטי התרומה דווחו לרשות המסים" ומספר האישור, **רק אחרי שנרשם דיווח** ורק בסעיף 46 (`donationReportBlock` ב-`exports.js`) |
| המחאות דחויות (`npo.js` + `ui/npo-cheques.js`) | **קבלה נפרדת לכל שנת מס לפי תאריך הפירעון** ("תרומות ישראל", סעיף 2.3.2; PLAN.md 9.14א). חבילת המחאות = **תרומה וקבלה לכל שנה**, כולן בשמירה אחת (`addChequeDonation`; לא `addDonation` בלולאה). `date`: בשנת הקבלה — `receivedDate`, בשנה אחרת — הפירעון הראשון בה (`chequeYearDate`) — כך כל הסיכומים השנתיים (`inYear(d.date)`) נכונים בלי שינוי. שדות רשות: `cheques: [{ number, bank, branch, dueDate, amountAg }]` (רק של אותה שנה, **בלי מספר חשבון**), `receivedDate`, `chequeGroupId`; אחרי המחאה שחזרה — `bouncedCheque` / `replacedBy` בקבלה שבוטלה, `replacesId` / `replacesReceipt` בחלופית. **קמפיין נבדק מול `receivedDate`** (גם בצמצום תקופה ב-`saveCampaign`). אישור סעיף 46 שפג לפני שנה מסוימת — אזהרה `sec46-lapsed`, הפקה רק עם `confirmWarnings: true`. ערוצים: `npo:addChequeDonation` (`{ preview: true }` — בלי שמירה ובלי מספרים; `generate` — חלוקה שווה בשרת) ו-`npo:cancelCheque` (`data.delete`: ביטול + קבלה ליתרה). **חישובי הכסף רק בשרת** — אין `toAg` בממשק (`tests/new-cards-view.test.js`). ביומן הפעולות רק מספרי קבלות. במזעור תורם נמחקים מספר ההמחאה, הבנק והסניף. **שדה חדש בהמחאה** — להוסיף ל-`validateCheques`, למזעור ב-`privacy.js` ולתווית ב-`privacyDocs.js`. נבדק ב-`tests/postdated-cheques.test.js` |
| `core/standingOrders.js` | הוראות קבע לעמותה — **בלי פרטי אשראי**; פרטי חשבון רק בהוראה בנקאית שמחויבת במס"ב (`bankAccount`, ראו `core/masav.js`). סימון "התקבל" מפיק תרומה וקבלה רגילות באותה שמירה; "נכשל" נרשם להיסטוריה. הוראה עם קבלות לא נמחקת (רק חודש סיום). אוסף `npo.standingOrders` |
| `core/donationImport.js` | ייבוא תרומות מקובץ CSV של ערוץ חיצוני (נדרים פלוס, קהילות, Charidy, CauseMatch, דף בנק) — **קבצים בלבד, בלי רשת**. אין פורמט קבוע: זיהוי עמודות לפי כותרות, המשתמש מאשר, וההתאמה נשמרת ב-`npo.settings.importMappings[source]`. כפילויות לפי מספר עסקה (או תאריך+שם+סכום). קבלה של הערוץ נשמרת כ-`receipt.external` עם `number: null` — לא צורכת מספור, אין לה PDF מקומי, ולא נכנסת לדיווח "תרומות ישראל" (הערוץ מדווח). מיון/תצוגה של קבלות דרך `N.byReceipt` / `N.receiptLabel` בלבד |
| `core/privacy.js` + `core/privacyDocs.js` + `services/privacyService.js` | כלי עזר לתיקון 13 (לא ייעוץ משפטי; PLAN.md 9.15) — ערוצי `privacy:*` **למנהל בלבד** (`permissionFor`). מיפוי מאגרים, `suggestLevel` (רמת אבטחה), רשימת בדיקה לאירוע. **מזעור לפי סוג** (`RETENTION_KINDS`: beneficiaries / donors (מינימום 7 שנים) / borrowers / mortgageClients) — `candidatesFor` לתצוגה מקדימה ו-`applyRetention` שבודק מחדש כל מזהה (לא מועמד = מדולג). `privacyDocs`: מסמך הגדרות מאגר, נוהל אבטחה, הודעת יידוע, ודוח זכות עיון לפי ת"ז (`subjectReport` — דרך `people.group`, **רק `peopleSources` של הרישיון, חשבוניות רק כש-`acct` פתוח**, חסוי רק עם `canSeeConfidential`). שדה חדש ברשומה של אדם — להוסיף תווית ב-`LABELS` (אחרת יוצג בשמו הפנימי). יומן בקשות — אוסף `privacy.requests`. **צפייה** בנזקק חסוי (מסך החסד / כרטיס אדם) נרשמת ביומן `chesed.confidential.view` |
| `core/campaigns.js` | קמפיינים לעמותה: יעד, תקופה, תורם מכפיל (יחס + תקרה חובה). אוסף `npo.campaigns`; תרומה משויכת ב-`campaignId` (ידני וייבוא), ונבדקת מול התקופה ומצב "סגור" בשירות — בייבוא: לכל שורה עם מספר שורה. שגרירים: `ambassadors` בקמפיין (מזהה נשמר לפי קוד/שם בעריכה; שגריר עם תרומות לא מוסר), `ambassadorId` בתרומה; בייבוא — עמודה לפי קוד/שם, לא מוכר = אזהרה. **ההכפלה היא חישוב תצוגה בלבד** — כסף המכפיל נרשם כתרומה רגילה כשהוא מתקבל. קמפיין עם תרומות לא נמחק, ולא ניתן לצמצם את תקופתו כך שתרומות ייצאו ממנה |
| `core/people.js` + `services/peopleService.js` | מאגר אנשים — **קריאה בלבד, בלי אוסף משלו**: נבנה בכל קריאה מעמותה, הוראות קבע, הנצחות, גמ"ח וחסד. שיוך לפי ת.ז; בלי ת.ז — לפי שם רק אם יש בדיוק אדם אחד עם ת.ז בשם זה (אחרת כרטיס נפרד `nameOnly`). נזקק חסוי נכלל רק עם `users.manage` (כמו `maskBeneficiary`). ערוצי `people:*`, תצוגה `people` |
| `core/memorials.js` | הנצחות ויארצייטים לפי תאריך עברי (דרך `core/hebcal`). אוסף `npo.memorials`. **אין פסיקה בקוד**: נפטר באדר של שנה פשוטה — `adarRule` (adar1/adar2/both) נבחר ברשומה לפי המנהג; יום ל׳ שאינו קיים בשנה מסוימת — מוחזרים כ״ט ו-א׳ של החודש הבא עם `uncertain: true` ("לבירור"). ללא Intl עברי — `available: false`, לא קורס |
| `core/israeliId.js` | ספרת ביקורת לת.ז/ח"פ — משמש עמותה, גמ"ח, חסד והוראות קבע. רשומה ישנה עם מספר שגוי ניתנת לעריכה כל עוד המספר לא שונה |
| `core/gemach.js` + `services/gemachService.js` | גמ"ח: הלוואות ללא ריבית, ערבים, לוח סילוקין באגורות (שארית לתשלום האחרון, תאריכים ב-UTC), תשלומים חלקיים, הפקדות, פיגורים ורמת רישוי להערכה. ערוצי `gemach:*`. אוסף `gemach`. **נפרד מהעמותה ומהיומן העסקי** |
| `core/gemachExtra.js` | הרחבות גמ"ח (בשירות `gemachService`): **בקשות הלוואה** `gemach.applications` — draft→interview→verified→approved/rejected; נבדקות ב-`validateLoanInput` כבר בשמירה, אישור יוצר הלוואה באותה שמירה (`applicationId`), שינוי ערבים אחרי אימות מחזיר לראיון. **גמ"ח חפצים** `gemach.items` + `gemach.lendings` — השאלה אחת פתוחה לפריט, פיקדון באגורות, החזרה מעדכנת מצב; פריט עם היסטוריה לא נמחק. **פיגורים לפי ערב** — ייצוא `guarantor-arrears`. אין תזכורות אוטומטיות |
| `core/chesed.js` + `services/chesedService.js` | חסד וחלוקות: נזקקים (רמת חיסיון), מתנדבים (מחלקות none/men/women), סבבי חלוקה — שיוך לפי משפחה/גודל, שיבוץ לפי מחלקת הסבב, מסירה, סגירה. ערוצי `chesed:*`. אוסף `chesed`. **נזקק חסוי מוסתר בצד השרת (`maskBeneficiary`) לכל מי שאין לו `users.manage` — כולל בייצוא** |
| `core/mortgageAdvisor.js` + `services/mortgageAdvisorService.js` | ייעוץ משכנתאות: תיקים, מסלולים ולוח סילוקין באגורות, השוואה, עמלה, מסמכים. ערוצי `madv:*` |
| `core/realEstateAppraisal.js` + `services/realEstateService.js` + `ui/realestate.js` | **שמאות מקרקעין** (PLAN.md 9.20). תיק שומה, עסקאות השוואה (הקלדה או CSV — `parseComparablesCsv`, בלי רשת), טבלת התאמות בנקודות בסיס, גישות השוואה / הכנסות / עלות ושקלול, הכול באגורות. נעילה (`finalizeCase` מקפיא את `computeCase` ב-`frozen`) וגרסה מתוקנת (`reopenCase`, סיומת למספר הדוח). דוח — `renderReportHtml` (צבעים בשם, הכול עובר `esc`). ערוצי `realestate:*`, תחום רישוי `econ.realestate` — **רישיון "נדל"ן" אחד: שמאות מקרקעין ותיווך ויזמים (`rlty:*`)** (החלטת הבעלים 20.10.2026; שם המפתח לא משתנה), אוסף `realEstate`. **בממשק סכומים בשקלים ואחוזים כטקסט; ההמרה רק בשרת** (`toAg` — מספר = אגורות, מחרוזת = שקלים). ספי האזהרה (`WARN`) — של התוכנה, לא של תקן. **צילומים** — אוסף נפרד `realEstatePhotos` (`addPhoto` / `deletePhoto`, טיוטה בלבד, תקרות `PHOTO_MAX_CHARS` / `PHOTOS_PER_CASE` / `PHOTOS_TOTAL_CHARS` — כל שמירה כותבת את כל האוספים); מחיקת תיק מוחקת אותם. **דוח דו-לשוני** — `reportLang: 'he-en'` בתיק; תווית קבועה חדשה בדוח — דרך `L()` ולהוסיף ל-`EN`, ערך רשימה חדש — ל-`EN_VALUES`. **ניתוח רגישות** (`sensitivity`, 9.21) — חלק מ-`computeCase`, לבחינה בלבד; תיק נעול ישן — מחושב מ-`frozen`. **יומן שומות** — `registerExport` ← `realestate:exportRegister` (CSV) |
| `core/realty.js` + `core/brokerage.js` + `core/realtyInvest.js` + `core/devProject.js` + `core/dealMortgage.js` + `services/realtyService.js` + `ui/realty.js` | **נדל"ן ותיווך ויזמים** (PLAN.md 9.22, `docs/MORTGAGE-REALTY-PLAN.md`). אוסף `realty` (נכסים, לקוחות, עסקאות, הזמנות תיווך, טבלאות מס רכישה, ניתוחים, פרויקטים). ערוצי `rlty:*` ← **אותו רישיון "נדל"ן" של שמאות המקרקעין** (`econ.realestate`, `gate.js`). פונקציות טהורות, באגורות. **אין פסיקה משפטית**: הזמנת שירותי תיווך מציגה רק "חסר: ..." (`brokerage.js`); **מס רכישה — אין מדרגות בקוד**, טבלה לכל שנה מוקלדת או מקובץ, ובלי אימות של מנהל (`rlty:verifyTaxTable`, `users.manage`) — "הערכה". עסקה ↔ תיק משכנתא (`dealMortgage.js`: `deal.mortgageCaseId` / `client.realtyDealId`, בלי פעולה אוטומטית; כל צד מוצג רק עם הרישיון שלו). ערכים לא מאומתים — `docs/RULES-TO-VERIFY.md` |
| `core/allocation.js` | **מספר הקצאה — נתיב ידני, בלי רשת** (PLAN.md 9.2א, ה1). הסף לפי תאריך החשבונית (`THRESHOLDS`: 20,000 ב-2025, 10,000 מ-1.1.2026, 5,000 מ-1.6.2026; **"גבוה מ-"**, באגורות; לפני 2025 — לא נבדק). `allocationState`: assigned / waived / pending / not-required — **מחושב, לא נשמר** (`getInvoices` מוסיף `allocation`). בעל העסק מבקש את המספר בשירות של רשות המסים ומקליד (`acct:setAllocation` — לא נוגע ביומן, ולכן מותר גם בתקופה נעולה; מספר כפול נדחה; החלפה נרשמת ביומן הפעולות). "לא נדרש" (`acct:waiveAllocation`) — הלקוח אינו עוסק מורשה או לא דרש. על החשבונית: "הקצאה מספר:" + 9 הספרות הימניות; ממתינה — "אין לנכות מס תשומות בגין חשבונית זו". לוח הבוקר מציג ממתינות רק כשהרישיון פותח את `acct`. **חיבור אוטומטי לרשות (9.2ב) — לא, עד החלטת בעלים** |
| `core/uniformFile.js` | **קבצים במבנה אחיד** (הוראות 1.31, PLAN.md 9.1) — פונקציות טהורות. `LAYOUTS`: [מספר שדה, N/X/S, אורך] לכל רשומה; **שדה חדש — לבדוק שהסכום עדיין שווה ל-`RECORD_LENGTHS`** (נבדק). N = אפסים משמאל, X = רווחים מימין, S = סימן + ספרות באגורות. קידוד ידני ל-ISO-8859-8 (ניקוד מוסר, תו לא מוכר ← "?"). רב-שנתי (1011=2): חתך לפי תאריך המסמך / תאריך הערך, ואותו תאריך קובע את יתרת הפתיחה ב-B110. סוג מסמך: 305 / 300 (פטור) / 320 (חשבונית מס/קבלה), ומ-`salesDocs` לפי `SD.KINDS[kind].code` (100/200/330/400; הצעת מחיר — בלי קוד, לא בקובץ). **בלי `zlib` ובלי `crypto.randomInt` ברמה העליונה** — ה-bundler של אנדרואיד מספק רק את התחליפים ב-`android/web/node-shims.js` (`tests/android-port.test.js`). המספור — `settings.invoiceSeq` (`nextInvoiceNumber(invoices, seq)`), לא חוזר אחורה |
| `core/salesDocs.js` | **מסמכי מכירה** (PLAN.md 9.3) — אוסף `salesDocs`, מספור לכל סוג ב-`settings.docSeq` (לא חוזר אחורה). הצעת מחיר / הזמנה (100) / תעודת משלוח (200) **לא ביומן** (מותרות בתקופה נעולה); `convertSalesDoc` מעביר את הפריטים כמו שהם — **הסכומים תמיד דרך `A.computeInvoice`**, כדי שהמרה תצא זהה עד האגורה. זיכוי (330): מלא = העתק מדויק של סכומי החשבונית, חלקי = באותו שיעור מע"מ של המקור, עד היתרה (`creditedAg`); רשומת יומן משלו, שלא מבוטלת ידנית. קבלה (400) נוצרת בכל `recordPayment` (`_payIn`, `issueReceipt`), עם `method` (קוד D120 בשדה 1306) ו-`reference`; `unrecordPayment` מבטל אותה. גבייה = היתרה אחרי זיכויים. `paidNow` ב-`createInvoice` = חשבונית מס/קבלה בשמירה אחת, בלי קבלה נפרדת. הדפסה: `renderInvoiceHtml` לכל המסמכים חוץ מקבלה (`kindLabel` = לא חשבונית — בלי מספר הקצאה), `renderReceiptHtml` לקבלה. מיתוג ב-`business`: `brandColor` (#rrggbb בלבד), `signature`, `logo` (data:image בלבד, דרך `acct:setLogo` — לא מהטופס) |
| `core/pcn874.js` | **דוח מע"מ מפורט — PCN874** (PLAN.md 9.16) — פונקציות טהורות, קריאה בלבד. נספח א' של רשות המסים (2010): O = 131, תנועה = 60, X = 10 תווים, CRLF, **שקלים שלמים** (עיגול לכל רשומה), סכום חיובי + שדה סימן; בכותרת — סכום הרשומות שבקובץ. `buildPcn874({ data, business, month, months })`: S = מסמך ללקוח עם ע.מ (9 ספרות), L = מצטבר ללקוחות לא מזוהים (חייבות / פטורות), T = רשומת יומן עם מע"מ תשומות **ו-`vatDoc.supplierTaxId`** (בלי — ל-`issues`, לא לקובץ). ביטול חשבונית — מינוס בתאריך `cancelledAt`; היפוך יומן — פרטי הספק מהמקור. `vatDoc` (ספק, אסמכתה, תאריך, ציוד) נשמר ב-`createEntry` רק כשיש שורת `1300`. `difference` = מול `vatReport` (עיגול או `issues`). מספר הקצאה בשדה העתידי |
| `core/bankReconcile.js` | **התאמת בנק** (PLAN.md 9.4). דף בנק מקובץ CSV בלבד, בלי רשת. אוסף `bankLines` עם `amountAg` (אגורות עם סימן: זכות חיובי) ו-`key`: תאריך, סכום, אסמכתא, תיאור ו-`#n` (מספר המופע בקובץ), כך שקליטה חוזרת לא יוצרת כפילויות. ההתאמה שמורה ב-`settings.bankMapping`. `view` מחשב מצב (`lineStatus`: רשומה שבוטלה = פתוחה) והצעות (`suggest`: חשבונית ביתרה זהה או רשומה בחשבון 1000). `matchBankLine` מסוג invoice גובה דרך `_payIn` בשמירה אחת. מסך `acct-bank` |
| `core/masav.js` | **מס"ב — חיוב בהרשאה, קבצים בלבד** (PLAN.md 9.17, ה4). לפי המפרט הרשמי של מס"ב: חיובים = 128 תווים + CRLF (K / 1 סוג 504 / 5 — **סכום ב-37, מספר ב-59**, הפוך מקובץ הזיכויים / שורת 9), החזרות = 220 (R / 1 / 6). הקובץ נכתב ב-`latin1` (תו = בית). עברית: `textField` — "קוד ישן" (0x60) או CP862 (0x80), בסדר חזותי; **הכיוון נקבע לפי התו המקורי**, כי בקוד הישן אות עברית = אות לטינית קטנה. משותף לעמותה (`npo.masav`) ולגמ"ח (`gemach.masav`): `settings`, `batches`, `refSeq`. **`bankAccount` לא יוצא לממשק** — רק `maskAccount` (`withoutBank` ב-`npoService`, וגם `getLoan` / `recordPayment` בגמ"ח); נמחק בביטול הלוואה ובמזעור. אצווה נשמרת רק אחרי בחירת קובץ (`preview`). חיוב לא נכלל בשתי אצוות (`busyKeys`), החזרה לא נקלטת פעמיים (`returnKey`), וסגירה לא כופלת סימון ידני. ערוצים: לולאה אחת ב-`ipc.js` ל-`npo`/`gemach`; ב-preload `masavChannel` דוחה תחום אחר. **לא נבדק בסימולטור בנק** |
| `core/recurring.js` | **חשבונית חוזרת חודשית ועבודה מהירה** (PLAN.md 9.6). אוסף `recurringInvoices` (תבניות עם `issued: {month: invoiceId}` ו-`skipped`). **הטיוטות מחושבות (`drafts` / `pendingMonths`) ולא נשמרות — אין שום יצירה אוטומטית** (כלל השבת); חודש שהתוכנה לא נפתחה בו מופיע, עד `MAX_BACKLOG`. הפקה רק ב-`issueRecurring` (חשבונית רגילה + סימון החודש בשמירה אחת); תבנית עם הפקות לא נמחקת. `today` בשירות — `localDay` (לא UTC). גם `customerDirectory` (השלמת לקוחות), `searchDocuments` ו-`getDuplicateInput`. `openSubForm` מריץ את `schema.afterRender`. קיצורים במסך החשבוניות: `acctInvoiceKeys` (נרשם פעם אחת — `state.acctKeysBound`) |
| `core/bizReports.js` + `ui/biz-reports.js` | **דוחות לעסק** (PLAN.md 9.5) — פונקציות טהורות, **קריאה בלבד**, באגורות: `customerLedger` / `customerBalances` (לפי שם הלקוח, כמו `customerDirectory`), `advancesReport` (מחזור בלי מע"מ פחות זיכויים; חשבונית שבוטלה — מינוס ב-`cancelledAt`; מקדמה = מחזור × `advanceRateBp` / 10,000), `cashForecast` (יתרת 1000 + חשבוניות פתוחות לפי `paymentTermsDays` + תבניות חוזרות − מע"מ ומקדמות לפי `periodOf` − ממוצע הוצאות) ו-`dashboardSummary`. הגדרות ב-`settings.reports` (`normalizeSettings` — קלט לא מהימן). מסך `biz-reports` עם לשוניות (`state.biz`); כרטיס בלוח הבקרה — `renderBizDashCard` (`attachBizDashHandlers`). ערוצי `acct:get*Biz*`/`getCashForecast`/`getCustomerLedger`/`getAdvancesReport` — "היום" בשרת. שינוי במבנה חשבונית/זיכוי/גבייה — לבדוק את הכרטסת (`tests/biz-reports.test.js`) |
| `core/sampleData.js` + `services/sampleService.js` + `ui/sample.js` | **נתוני דוגמה** (PLAN.md 1.5) — רק בבחירה (כרטיס בלוח הבקרה), רק לתחומים ברישיון (`availableKinds`). כל רשומה `sample: true`; תרומה — קבלה חיצונית עם `source: 'sample'` ובלי מספר (`receiptLabel` ← "דוגמה"). **אוסף חדש שהדוגמה כותבת אליו — להוסיף גם ל-`remove` ול-`counts`**, אחרת "מחיקת נתוני הדוגמה" תשאיר אותו. ערוצי `sample:getStatus` / `sample:add` / `sample:deleteAll`. פס הדוגמה — במסכים שב-`SAMPLE_VIEWS` |
| `core/dashboard.js` | לוח בוקר למנהל העמותה (`morningBrief`): תמיכות, "תרומות ישראל", הוראות קבע, פיגורי גמ"ח, חפצים באיחור, בקשות, סבבי חלוקה ויארצייט בשבוע הקרוב — ממוין לפי דחיפות, כל שורה עם `view` למסך שלה. **קריאה בלבד, בלי פנייה אוטומטית.** `sources` = התחומים הפתוחים ברישיון. ערוץ `dashboard:getMorningBrief` (`data.view`), מוצג בראש לוח הבקרה (`renderMorningBrief` ב-`ui/views-general.js`) רק כשיש פריטים |
| `core/mixEngine.js` + `core/mortgageRules.js` + `services/mortgageLabService.js` | מעבדת תמהיל (הועבר מ-tamhil): 7 סוגי מסלולים, פריים לפי מסלול ריבית, משתנה לפי עוגן, גרייס, בדיקות 329, סלים אחידים, כושר החזר, מחזור, השוואת אישורים, עמלת פירעון, אופטימייזר ושימור. ערוצי `mlab:*`. אוסף `mortgageLab`. אימות כלל — `users.manage` בלבד |
| `core/collect.js` + `services/collectService.js` | גבייה מלקוחות של הארגון (מסך `collect`): דרישת תשלום לחשבונית / תרומה / תשלום בגמ"ח, עם קישור לדף התשלום של **חשבון הסוחר של הארגון** — הכסף לא עובר דרכנו. **בלי פרטי אשראי ובלי רשת**: הקישור נבנה מתבנית (https בלבד, משתנים מקודדים), והתשלומים נקלטים מדוח CSV של חברת הסליקה — התאמה לפי מספר הדרישה (P00012), אחרת שם+סכום ייחודיים; עסקה שנקלטה לא נרשמת שוב. התשלום נרשם בשירות של התחום (`recordPayment` / `addDonation` / גמ"ח) — ולכן ה-IPC בודק גם את הרישיון של אותו תחום (`COLLECT_DOMAIN`). אוסף `payments`. הגדרת הקישור — `users.manage`. **תשלומי אימונים ← חשבונית מס/קבלה** (`core/trainerPayments.js`, ערוצי `collect:getTrainerPayments` / `collect:issueTrainerReceipt`): הנתונים מ-`trainerDataForEcon` ב-`main.js` (מוזרק כ-`trainerData` ל-`initEcon`) — רק לתצוגת המודול הכלכלי (`fromView`), עם רישיון לאימונים וממחסן מוצפן, קריאה בלבד. הממשק שולח רק מפתח (`client/membership/payment`); הסכום נקרא שוב מהמחסן. **בלי `confirmed: true` אין הפקה**; חשבונית אחת לתשלום (`trainerPayment.key`). `exempt: true` (עוסק פטור) ← חשבונית עסקה בלי מע"מ + קבלה (400); אחרת חשבונית מס/קבלה. שינוי במבנה התשלום במודול (`studio.js` → `addPayment`) — לעדכן גם את `readPayments` |

---

## כללי ברזל — אין לחרוג מהם

### 1. כספים בשלמי אגורות
חישובי כסף חייבים להיעשות ב**שלמי אגורות** (מספרים שלמים) או בעיגול מפורש `Math.round(x * 100) / 100`.
אל תשתמש בנקודה צפה גולמית לסכומים — זה מייצר שגיאות עיגול בחשבוניות ובמע"מ.

### 2. כל ערוץ IPC דורש הרשאה
ב-`modules/econ/ipc.js` כל ערוץ חדש חייב לעבור דרך `handle()` שעוטף באכיפת הרשאות.
ההרשאה נגזרת משם הפעולה (`permissionFor`):
- `data.view` — קריאה (`get*`, `list*`, `report*`)
- `data.edit` — כתיבה (ברירת מחדל)
- `data.delete` — מחיקה/ביטול (`delete*`, `reverse*`, `cancel*`)
- `data.backup` / `data.restore` / `data.export`
- `users.manage` — `users:*`, `audit:*`, `settings:saveAdvanced` (מנהל בלבד)
- תפקידים (`core/database.js` → `ROLES`): `admin`, `editor`, `viewer`, `accountant` (רואה חשבון — `data.view` + `data.export` בלבד)
ערוצים ציבוריים מוגדרים ב-`PUBLIC_CHANNELS` — **אל תוסיף לשם בלי סיבה מוצדקת**. (`auth:google-login` ציבורי: הוא מאמת את הזהות מול Google בעצמו, ונכנס רק למשתמש שקושר מראש.)

**רישוי:** אחרי בדיקת התפקיד, `runGuarded` בודק גם את הרישיון (`shell/licensing/gate.js`). ההרשאה בפועל היא חיתוך של התפקיד עם הרישיון. תחילית ערוצים חדשה לתחום שנפתח בנפרד → להוסיף ל-`ECON_SUB_FEATURES` (ראו docs/LICENSING-DESIGN.md).
**קובץ הרישוי גלוי, השומר מוצפן:** `license-key.bin` (DPAPI) מחזיק `{ v: 2, key, guard: { lastSeen, notices } }` — מזהי ההודעות שקובעות את מצב המערכת הזו. כל כתיבה דרך `save()` ב-`store.js` מעדכנת אותו; **אל תכתוב ל-`storage` של הרישוי ישירות** (חוץ מ-lastSeen ב-`compute`, שמעדכן גם את השומר). הודעה שחסרה בקובץ אבל קיימת בשומר = נעול (`tests/licensing-tamper.test.js`).
**מסך שמצרף נתונים מכמה תחומים** (מאגר אנשים, לוח בוקר) — חייב לסנן לפי `gate.peopleSources(licenseState())`, אחרת הוא עוקף את הרישיון של התחומים הסגורים.

### 3. אטומיות במסד הנתונים
כל פעולה על ה-DB עוברת דרך `enqueue()` — תור שמבטיח הרצה סדרתית.
הרצה במקביל דורסת עדכונים ומייצרת מספרי חשבונית כפולים. **אל תעקוף את `enqueue`**.

### 4. מעטפת בלבד רשאית לנווט/לגבות
ב-`main.js` כל handler של המעטפת חייב לאמת `e.sender.id === win.webContents.id`
לפני ביצוע פעולה רגישה. מודול לא יכול לגבות/לשחזר בשם המשתמש.

### 5. לעולם לא טקסט גלוי בגיבוי
גיבוי נכתב רק אחרי הצפנה (`SSBK1:` prefix). גיבוי אוטומטי דורש `safeStorage` זמין —
אם אין הצפנת מערכת, פשוט לא נכתב גיבוי. **אל תוסיף מסלול כתיבה לא מוצפן.**

### 6. אפס תלות ברשת
אין לקרוא לשום CDN, API חיצוני, פונט מותאם או תלות אונליין.
האפליקציה רצה בסביבה מסוננת — כל משאב חייב להיות מקומי.

### 7. CSP מחמיר בכל חלון
לכל חלון/תצוגה יש מדיניות אבטחת תוכן. אין `unsafe-eval`, ואין טעינת סקריפט חיצוני.

### 8. עברית ו-RTL
- כל טקסט למשתמש בעברית, `dir="rtl"`.
- שגיאות IPC מוצגות למשתמש בעברית, לא באנגלית ובקוד.
- אין להשתמש בתוכן לועזי/חילוני בדוגמאות.

---

## בדיקות

- מסגרת: `node --test`. אין Jest/Vitest — רק מודול `test` המובנה.
- **כל קובץ `tests/*.test.js` רץ אוטומטית** ב-`npm test` — אין צורך לרשום קובץ חדש ב-package.json. כולן חייבות לעבור לפני סיום עבודה.
- קבצים עיקריים: `accounting`, `integration`, `ipc-guard`, `exports`, `backupCrypto`, `pricing`, `regressions`, `security`, `features`, `regressions-r2`, `tools-calc`, `nav-guard`, `main-behavior`, `shell-ui`, `ui-nav`, `fitness-view`, `catalog`, `npo`, `gemach`, `chesed`, `chesed-gemach-view`.
- כל תיקון באג חייב לקבל בדיקת רגרסיה מלווה.
- בדיקות ה-UI מריצות את הרינדור ב-Chromium עם API מדומה (ללא שגיאות JS).
- `tests/main-behavior.test.js` טוען את `main.js` האמיתי עם Electron מדומה — הבדיקות שם בודקות התנהגות, לא טקסט.
- `tools/passwords/test_encryption.py` — בדיקות Python נפרדות (`python -m unittest`), אינן חלק מ-`npm test`.

**ידוע ולא מכוסה בבדיקות:** הרצת Electron עצמו, בנייה NSIS/portable, DPAPI, וחיבור USB אמיתי — דורשים בדיקה ידנית ב-Windows.

**לא ניתן להריץ בסביבה המסוננת הזו:** בדיקות `tools/passwords` דורשות את הספרייה
`cryptography`, שאינה ניתנת להתקנה מכאן (PyPI חסום). הן נכתבו ואומתו מבחינת תחביר
וקריאות API, אך **טרם הורצו בפועל** — יש להריץ אותן במחשב שבו הספרייה מותקנת.

---

## מבנה קבצים

```
main.js                  — תהליך ראשי, חלון, פרוטוקול app://, גיבוי, קיצורים
package.json             — scripts, electron-builder config
TODO-FIXES.md            — רשימת תיקונים מתועדת (רוב הסעיפים בוצעו)
README.md                — תיעוד משתמש + יומן גרסאות
CLAUDE.md                — הקובץ הזה
build-exe.bat            — בנייה למשתמש קצה
build-local.js           — בנייה מהמטמון המקומי (בלי הורדות; בסביבה מסוננת)
run-dev.bat              — הרצה בפיתוח
.github/workflows/       — CI: בנייה אוטומטית ל-Windows
build/                   — icon.ico (לבנייה) + icon.png (לזמן ריצה)
shell/                   — המעטפת: html, js, preload
modules/<mod>/           — מודול בודד, נטען כ-WebContentsView
modules-src/trainer/     — קוד המקור של מודול האימונים (React+Vite). נבנה ל-modules/trainer דרך tools/build-trainer.js. לא נארז בתוכנה
modules/econ/core/       — לוגיקת ליבה: db, accounting, crypto, exports
modules/econ/services/   — שירותים עסקיים
shell/nav-guard.js       — כללי מעבר מודולים (נבדקים ב-tests/nav-guard.test.js)
shell/auto-backup.js     — לוגיקת הגיבוי האוטומטי, מפתח DPAPI וסטטוס (tests/auto-backup.test.js)
run-electron.js          — הפעלת electron.exe ישירות (npm start)
tools/passwords/         — כלי Python נפרד: הצפנה וערבול סיסמאות (לא חלק מהאפליקציה)
tests/                   — בדיקות
```

---

## זרימת עבודה מומלצת

1. **קרא לפני שאתה נוגע** — `main.js`, `modules/econ/ipc.js`, `shell/shell.js` הם הלב.
2. **הרץ `npm test`** לפני ואחרי כל שינוי.
3. **שינוי בהרשאות?** עדכן גם את `permissionFor` וגם את הבדיקה ב-`tests/ipc-guard.test.js`.
4. **שינוי ב-UI?** ודא שה-CSP לא נשבר ושה-RTL נשמר.
5. **שינוי בגיבוי או במסד?** ודא שההצפנה לא נפגעת ואתה לא כותב טקסט גלוי — גם לא SQL ישיר ל-`collections`/`audit_events` שעוקף את `cipher.seal`.
6. **commit** — היסטוריה בעברית, עם attribution של Claude Code בסוף ההודעה.

---

## הוספת מסך חדש — חובה לסנכרון (גם בעבודה מקבילה מכמה סשנים)

התוכנה מוצגת למשתמש כ**תוכנה אחת** עם סרגל אחד (`shell/`). מסך חדש במודול הכלכלי:

1. כפתור ב-`modules/econ/views/index.html` (`<button class="nav" data-view="...">אייקון <span>שם</span></button>`), כותרת ב-`viewTitles` (`ui/core.js`) וטעינה/רינדור בקובץ התחום ב-`modules/econ/ui/` (או קובץ חדש שם — ראו `ui/*.js` למעלה).
2. **פריט בקטלוג** `shell/catalog.js` בתחום המתאים (כספים / משק בית ותכנון / משכנתאות ונדל"ן / ארגון ועבודה / בריאות וכושר / מערכת), עם `icon`, `name`, `desc` בעברית.
3. ערוצי IPC חדשים — דרך `handle()` ב-`ipc.js` בלבד, וחשיפה ב-`modules/econ/preload.js`.
4. קובץ בדיקות `tests/<name>.test.js` — נאסף אוטומטית.

**רשת ביטחון:** מסך ששלב 2 נשכח בו לא נעלם — `catalog.extrasFromHtml` מזהה אותו מהסרגל הפנימי ו-`main.js` מציג אותו בסרגל האחיד תחת "נוספו לאחרונה". אבל `tests/catalog.test.js` ייכשל עד שיתווסף לקטלוג במקומו הנכון — זו התזכורת.

**עבודה מקבילה:** לפני עריכה של `shell/catalog.js`, `main.js`, `preload.js` או `modules/econ/ui/*.js` — קרא את הגרסה העדכנית מהדיסק (ייתכן שסשן אחר שינה אותה), ערוך בעריכה נקודתית ולא בכתיבה מחדש של הקובץ כולו, והרץ `npm test` בסוף.

---

## מלכודות נפוצות

- **`contentView.addChild`** אינו קיים — זה `addChildView` (יש בדיקה סטטית שמונעת חזרה לטעות הזו).
- **`WebContentsView`** ולא `BrowserView` — האחרון הוסר מ-Electron.
- **ערוץ ציבורי** שנוסף ל-`PUBLIC_CHANNELS` עוקף אימות — היזהר.
- **`decodeURIComponent`** בפרוטוקול — חייב try/catch, אחרת קובץ בקידוד פגום מפיל את ה-handler.
- **`e.sender.id`** — כל handler רגיש חייב לאמת אותו. ראו את התיקון ב-`shell:switch`.
- **מודול לא מנווט לבד.** אין לחזור ל-`MODS.includes(id)` ב-`shell:switch`: זה עוקף את האימות. מעבר בין מודולים מתוך מודול עובר דרך `shell:open-module` בלבד.
- **קיצורי מקלדת** נתפסים גם בתוך שדות קלט במודולים — יש דילוג על `isAutoRepeat`.
- **מודול האימונים — לשנות רק את המקור.** קוד המקור ב-`modules-src/trainer` (ראו `README-SUPERSUITE.md` שם). **אין לערוך ידנית את `modules/trainer/assets/*`** — בנייה הבאה דורסת. בנייה: `npm run build:trainer` (vite נחסם ב-NetFree ← GitHub Actions, משימת `trainer`). הסקריפט שומר את `preload.js`, בודק ששפת העיצוב נטענת לפני ה-CSS של החבילה (`checkThemeOrder`), ונכשל על פנייה לרשת (`tests/trainer-source.test.js`). **המודול הבנוי מגיע למחשב דרך `ci-status`:** `git fetch origin ci-status` ואז `git checkout FETCH_HEAD -- trainer-module`, והעתקה ל-`modules/trainer` (הורדת artifact חסומה ב-NetFree).
- **מראה אחיד בין המודולים.** הקומפוננטות של מודול האימונים כתובות במחלקות Tailwind כהות; `modules-src/trainer/src/theme.css` (מיובא ב-`main.jsx` אחרי Tailwind, PLAN.md 6.4) ממפה אותן לפלטת התוכנה ונבנה לתוך החבילה. **מחלקת צבע חדשה בקומפוננטה — להוסיף מיפוי שם** (`tests/ui-consistency.test.js` ייכשל ויפרט אותה). שפת העיצוב וספריית הרכיבים נטענות **לפני** החבילה, אחרת ui-kit גובר על המיפוי. מודול השמאות: ערכה בהירה כברירת מחדל (`shamai_theme`), בצבעי התוכנה.
- **`[hidden]` מול `display`** — כלל CSS עם `display:flex` גובר על המאפיין `hidden`. רכיב שמוסתר ב-`hidden` צריך גם `.x[hidden]{display:none}`.
- **פרטי קובץ ה-EXE** — `signAndEditExecutable:false` מבטל גם את האייקון, השם והגרסה של הקובץ (הוא נראה כ-"Electron / GitHub, Inc."). אין תעודת חתימה, ולכן `signExecutable:false` — מדלג על החתימה בלבד (נבדק ב-`tests/build-config.test.js`).
- **הרצה עם פרופיל זמני (`--user-data-dir`) לבדיקות** — הגיבוי האוטומטי רץ 15 שניות אחרי העלייה ונכתב ל-`DocumentsSuperSuite-Backups` **האמיתי**, ואז הגיבוי האמיתי של אותו יום מדולג ("כבר קיים"). לפני ההרצה יש לכתוב לפרופיל `backup-settings.json` עם `targetDir` בתוך הפרופיל. (במצב `--smoke` אין גיבוי אוטומטי.)
- **הבדיקות לא רצות על הקוד המכווץ** — חלק מהן קוראות את טקסט הקוד. הגרסה המכווצת נבדקת רק ב-`--smoke` ב-CI; שגיאה שמופיעה רק אחרי כיווץ תופיע ב-`smoke.log`.
- **תאריכים ושעות למשתמש** — לא `toISOString()` (UTC): בישראל זה מזיז את השעה ב-2–3 שעות ואת התאריך בין חצות ל-03:00. בגיבוי: `localDay` ב-`shell/auto-backup.js`.

---

## הנחיות סגנון

- **הערות:** בעברית, קצרות, במקום שבו הפונקציה אינה טריוויאלית.
- **שמות:** באנגלית ל-code, עברית רק למחרוזות למשתמש.
- **גישה:** פרצות אבטחה, מקרי קצה וביצועים — להצביע לגביהם תמיד, לא לדחות.
- **אל תמציא** שמות פונקציות/ממשקים שאינם קיימים. אם אינך בטוח — אמת בקוד.
