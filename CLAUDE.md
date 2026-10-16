# CLAUDE.md — הנחיות עבודה על SuperSuite

קובץ זה נטען אוטומטית לכל סשן עבודה על הפרויקט. קרא אותו לפני כל שינוי.

---

## מה זה הפרויקט

**SuperSuite** — תוכנה שולחנית (Electron). למשתמש היא נראית כתוכנה אחת עם סרגל אחד; בפנים היא מורכבת מארבעה מודולים:

| מזהה | מודול | תיאור |
|------|-------|--------|
| `econ` | מערכת כלכלית | הנהלת חשבונות כפולה, חשבוניות מס, מע"מ, מחירון, דוחות, תכנון פיננסי, משכנתאות, ייעוץ משכנתאות, עמותות, מודיעין שוק |
| `shamai` | שמאי | הערכת שווי נכסים |
| `trainer` | TrainerPro | ניהול אימונים ומתאמנים |
| `tools` | ארגז כלים | מחשבונים וכלי עזר (13 כלים) |

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
- **מודול האימונים בסרגל האחיד** — תחום `trainer` בקטלוג (`TRAINER_VIEWS` / `TRAINER_LABELS`: תצוגה ← הטקסט של הכפתור בסרגל הפנימי של החבילה המהודרת). `modules/trainer/preload.js` (בלי `contextBridge`) מסתיר את ה-`aside`, לוחץ על הכפתור לפי `trainer:goto` (ושומר את הבקשה עד שהסרגל קיים — מסך הגדרה ראשונית), ומדווח על המסך הפעיל ב-`shell:trainer-view` (נבדק מול `views.trainer`). בנייה חדשה של המודול ששינתה טקסט בסרגל — `tests/trainer-nav.test.js` ייכשל.
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
| `shell.js` | סרגל אחיד, מסך בית, חיפוש, אחרונים, גיבוי/שחזור, זיהוי יעד גיבוי |
| `preload.js` | חשיפת `window.shellAPI` מעל `contextBridge` |
| `google-signin.js` | כניסה עם Google — **אפשרות נוספת, הסיסמה נשארת תמיד** (אופליין). דפדפן המערכת + כתובת מקומית 127.0.0.1, PKCE ו-state, אימות מלא של id_token (RS256, iss, aud, exp, nonce). לא נשמר אסימון — רק `sub` בטבלה `auth_google_links`. ההמתנה לדפדפן (עד 3 דק') רצה **מחוץ** ל-`enqueue` (`handleGoogle` ב-`ipc.js`). מדיניות אופציונלית: `chat:*` רק בפגישה עם `via: 'google'`. מדריך: `docs/GOOGLE-SIGNIN.md` |
| `licensing/activation.js` | **תנאי הפעלה למערכת ברישיון**: רישיון שנתי (365 יום לפחות — `termMs`), חיבור לשרת וכניסה עם Google ב-7 הימים האחרונים. בלי שלושתם — `locked` (`withActivation` ב-`ipc.js`). הזמנים ב-`remote.lastSync` / `remote.lastGoogle` בקובץ הרישוי; בבדיקות — `tests/helpers/activation.js` (`markActivated`). **בקשת אישור למערכת בת דורשת תשלום שנתי להורה** (`requireChildPayment`, דרישה מסוג `license` במסך הגבייה, תשלום אחד לבקשה). ראו docs/LICENSING-DESIGN.md |
| `login-gate.js` | **שמאי ואימונים נפתחים רק אחרי כניסה** (בסיסמה או עם Google; ארגז הכלים פתוח). בלי כניסה ← המודול הכלכלי (מסך הכניסה), והמודול המבוקש נפתח מיד אחרי הכניסה. יציאה/ניתוק במודול נעול ← חזרה למסך הכניסה. נבדק **אחרי** הרישוי (מודול שלא ברישיון לא מבקש כניסה). משותף ל-`main.js` ולאנדרואיד. עבודה במודול נעול מאריכה את הפגישה (`econ.touchSession`); בדיקה שקטה — `peekSession`. `auth:setup` מחבר את המנהל הראשון מיד |

### מודול כלכלי — `modules/econ/`
| קובץ | תפקיד |
|------|--------|
| `ipc.js` | רישום כל ערוצי ה-IPC + אכיפת הרשאות. **כל** ערוץ (מלבד `auth:`) דורש session פעיל. |
| `preload.js` | חשיפת `window.systemAPI` |
| `core/database.js` | SQLite דרך `node:sqlite`. טבלת `collections` (key-value) + טבלאות auth/roles/audit. |
| `core/accounting.js` | לוגיקת הנה"ח כפולה |
| `core/backupCrypto.js` | הצפנת גיבוי AES-256-GCM |
| `core/exports.js` | ייצוא CSV/Excel |
| `core/dataPorts.js` | ייבוא/ייצוא כללי (CSV + vCard) לכל סוגי הנתונים, ולידציה וכפילויות |
| `services/*.js` | שירותים עסקיים — כל אחד מאותחל דרך `initializeAsync(db)` |
| `core/npo.js` + `services/npoService.js` | עמותה: קבלות סעיף 46, קרנות, תמיכות, דוח שנתי. ערוצי `npo:*`. **נפרד מהיומן העסקי** |
| `core/standingOrders.js` | הוראות קבע לעמותה — **מעקב בלבד, בלי פרטי אשראי/חשבון**. סימון "התקבל" מפיק תרומה וקבלה רגילות באותה שמירה; "נכשל" נרשם להיסטוריה. הוראה עם קבלות לא נמחקת (רק חודש סיום). אוסף `npo.standingOrders` |
| `core/donationImport.js` | ייבוא תרומות מקובץ CSV של ערוץ חיצוני (נדרים פלוס, קהילות, Charidy, CauseMatch, דף בנק) — **קבצים בלבד, בלי רשת**. אין פורמט קבוע: זיהוי עמודות לפי כותרות, המשתמש מאשר, וההתאמה נשמרת ב-`npo.settings.importMappings[source]`. כפילויות לפי מספר עסקה (או תאריך+שם+סכום). קבלה של הערוץ נשמרת כ-`receipt.external` עם `number: null` — לא צורכת מספור, אין לה PDF מקומי, ולא נכנסת לדיווח "תרומות ישראל" (הערוץ מדווח). מיון/תצוגה של קבלות דרך `N.byReceipt` / `N.receiptLabel` בלבד |
| `core/privacy.js` + `services/privacyService.js` | כלי עזר לתיקון 13 (לא ייעוץ משפטי) — ערוצי `privacy:*` **למנהל בלבד** (`permissionFor`). מיפוי מאגרים, מזעור נזקקים לא פעילים (תצוגה מקדימה, ואז השרת בודק מחדש כל מזהה — לא מועמד = מדולג), רשימת בדיקה לאירוע. **צפייה** בנזקק חסוי (מסך החסד / כרטיס אדם) נרשמת ביומן `chesed.confidential.view` |
| `core/campaigns.js` | קמפיינים לעמותה: יעד, תקופה, תורם מכפיל (יחס + תקרה חובה). אוסף `npo.campaigns`; תרומה משויכת ב-`campaignId` (ידני וייבוא), ונבדקת מול התקופה ומצב "סגור" בשירות — בייבוא: לכל שורה עם מספר שורה. שגרירים: `ambassadors` בקמפיין (מזהה נשמר לפי קוד/שם בעריכה; שגריר עם תרומות לא מוסר), `ambassadorId` בתרומה; בייבוא — עמודה לפי קוד/שם, לא מוכר = אזהרה. **ההכפלה היא חישוב תצוגה בלבד** — כסף המכפיל נרשם כתרומה רגילה כשהוא מתקבל. קמפיין עם תרומות לא נמחק, ולא ניתן לצמצם את תקופתו כך שתרומות ייצאו ממנה |
| `core/people.js` + `services/peopleService.js` | מאגר אנשים — **קריאה בלבד, בלי אוסף משלו**: נבנה בכל קריאה מעמותה, הוראות קבע, הנצחות, גמ"ח וחסד. שיוך לפי ת.ז; בלי ת.ז — לפי שם רק אם יש בדיוק אדם אחד עם ת.ז בשם זה (אחרת כרטיס נפרד `nameOnly`). נזקק חסוי נכלל רק עם `users.manage` (כמו `maskBeneficiary`). ערוצי `people:*`, תצוגה `people` |
| `core/memorials.js` | הנצחות ויארצייטים לפי תאריך עברי (דרך `core/hebcal`). אוסף `npo.memorials`. **אין פסיקה בקוד**: נפטר באדר של שנה פשוטה — `adarRule` (adar1/adar2/both) נבחר ברשומה לפי המנהג; יום ל׳ שאינו קיים בשנה מסוימת — מוחזרים כ״ט ו-א׳ של החודש הבא עם `uncertain: true` ("לבירור"). ללא Intl עברי — `available: false`, לא קורס |
| `core/israeliId.js` | ספרת ביקורת לת.ז/ח"פ — משמש עמותה, גמ"ח, חסד והוראות קבע. רשומה ישנה עם מספר שגוי ניתנת לעריכה כל עוד המספר לא שונה |
| `core/gemach.js` + `services/gemachService.js` | גמ"ח: הלוואות ללא ריבית, ערבים, לוח סילוקין באגורות (שארית לתשלום האחרון, תאריכים ב-UTC), תשלומים חלקיים, הפקדות, פיגורים ורמת רישוי להערכה. ערוצי `gemach:*`. אוסף `gemach`. **נפרד מהעמותה ומהיומן העסקי** |
| `core/gemachExtra.js` | הרחבות גמ"ח (בשירות `gemachService`): **בקשות הלוואה** `gemach.applications` — draft→interview→verified→approved/rejected; נבדקות ב-`validateLoanInput` כבר בשמירה, אישור יוצר הלוואה באותה שמירה (`applicationId`), שינוי ערבים אחרי אימות מחזיר לראיון. **גמ"ח חפצים** `gemach.items` + `gemach.lendings` — השאלה אחת פתוחה לפריט, פיקדון באגורות, החזרה מעדכנת מצב; פריט עם היסטוריה לא נמחק. **פיגורים לפי ערב** — ייצוא `guarantor-arrears`. אין תזכורות אוטומטיות |
| `core/chesed.js` + `services/chesedService.js` | חסד וחלוקות: נזקקים (רמת חיסיון), מתנדבים (מחלקות none/men/women), סבבי חלוקה — שיוך לפי משפחה/גודל, שיבוץ לפי מחלקת הסבב, מסירה, סגירה. ערוצי `chesed:*`. אוסף `chesed`. **נזקק חסוי מוסתר בצד השרת (`maskBeneficiary`) לכל מי שאין לו `users.manage` — כולל בייצוא** |
| `core/mortgageAdvisor.js` + `services/mortgageAdvisorService.js` | ייעוץ משכנתאות: תיקים, מסלולים ולוח סילוקין באגורות, השוואה, עמלה, מסמכים. ערוצי `madv:*` |
| `core/mixEngine.js` + `core/mortgageRules.js` + `services/mortgageLabService.js` | מעבדת תמהיל (הועבר מ-tamhil): 7 סוגי מסלולים, פריים לפי מסלול ריבית, משתנה לפי עוגן, גרייס, בדיקות 329, סלים אחידים, כושר החזר, מחזור, השוואת אישורים, עמלת פירעון, אופטימייזר ושימור. ערוצי `mlab:*`. אוסף `mortgageLab`. אימות כלל — `users.manage` בלבד |
| `core/collect.js` + `services/collectService.js` | גבייה מלקוחות של הארגון (מסך `collect`): דרישת תשלום לחשבונית / תרומה / תשלום בגמ"ח, עם קישור לדף התשלום של **חשבון הסוחר של הארגון** — הכסף לא עובר דרכנו. **בלי פרטי אשראי ובלי רשת**: הקישור נבנה מתבנית (https בלבד, משתנים מקודדים), והתשלומים נקלטים מדוח CSV של חברת הסליקה — התאמה לפי מספר הדרישה (P00012), אחרת שם+סכום ייחודיים; עסקה שנקלטה לא נרשמת שוב. התשלום נרשם בשירות של התחום (`recordPayment` / `addDonation` / גמ"ח) — ולכן ה-IPC בודק גם את הרישיון של אותו תחום (`COLLECT_DOMAIN`). אוסף `payments`. הגדרת הקישור — `users.manage` |

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
ערוצים ציבוריים מוגדרים ב-`PUBLIC_CHANNELS` — **אל תוסיף לשם בלי סיבה מוצדקת**. (`auth:google-login` ציבורי: הוא מאמת את הזהות מול Google בעצמו, ונכנס רק למשתמש שקושר מראש.)

**רישוי:** אחרי בדיקת התפקיד, `runGuarded` בודק גם את הרישיון (`shell/licensing/gate.js`). ההרשאה בפועל היא חיתוך של התפקיד עם הרישיון. תחילית ערוצים חדשה לתחום שנפתח בנפרד → להוסיף ל-`ECON_SUB_FEATURES` (ראו docs/LICENSING-DESIGN.md).

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
5. **שינוי בגיבוי?** ודא שההצפנה לא נפגעת ואתה לא כותב טקסט גלוי.
6. **commit** — היסטוריה בעברית, עם attribution של Claude Code בסוף ההודעה.

---

## הוספת מסך חדש — חובה לסנכרון (גם בעבודה מקבילה מכמה סשנים)

התוכנה מוצגת למשתמש כ**תוכנה אחת** עם סרגל אחד (`shell/`). מסך חדש במודול הכלכלי:

1. כפתור ב-`modules/econ/views/index.html` (`<button class="nav" data-view="...">אייקון <span>שם</span></button>`), כותרת ב-`viewTitles` וטעינה/רינדור ב-`unified-ui.js`.
2. **פריט בקטלוג** `shell/catalog.js` בתחום המתאים (כספים / משק בית ותכנון / משכנתאות ונדל"ן / ארגון ועבודה / בריאות וכושר / מערכת), עם `icon`, `name`, `desc` בעברית.
3. ערוצי IPC חדשים — דרך `handle()` ב-`ipc.js` בלבד, וחשיפה ב-`modules/econ/preload.js`.
4. קובץ בדיקות `tests/<name>.test.js` — נאסף אוטומטית.

**רשת ביטחון:** מסך ששלב 2 נשכח בו לא נעלם — `catalog.extrasFromHtml` מזהה אותו מהסרגל הפנימי ו-`main.js` מציג אותו בסרגל האחיד תחת "נוספו לאחרונה". אבל `tests/catalog.test.js` ייכשל עד שיתווסף לקטלוג במקומו הנכון — זו התזכורת.

**עבודה מקבילה:** לפני עריכה של `shell/catalog.js`, `main.js`, `preload.js` או `unified-ui.js` — קרא את הגרסה העדכנית מהדיסק (ייתכן שסשן אחר שינה אותה), ערוך בעריכה נקודתית ולא בכתיבה מחדש של הקובץ כולו, והרץ `npm test` בסוף.

---

## מלכודות נפוצות

- **`contentView.addChild`** אינו קיים — זה `addChildView` (יש בדיקה סטטית שמונעת חזרה לטעות הזו).
- **`WebContentsView`** ולא `BrowserView` — האחרון הוסר מ-Electron.
- **ערוץ ציבורי** שנוסף ל-`PUBLIC_CHANNELS` עוקף אימות — היזהר.
- **`decodeURIComponent`** בפרוטוקול — חייב try/catch, אחרת קובץ בקידוד פגום מפיל את ה-handler.
- **`e.sender.id`** — כל handler רגיש חייב לאמת אותו. ראו את התיקון ב-`shell:switch`.
- **מודול לא מנווט לבד.** אין לחזור ל-`MODS.includes(id)` ב-`shell:switch`: זה עוקף את האימות. מעבר בין מודולים מתוך מודול עובר דרך `shell:open-module` בלבד.
- **קיצורי מקלדת** נתפסים גם בתוך שדות קלט במודולים — יש דילוג על `isAutoRepeat`.
- **מראה אחיד בין המודולים.** מודול האימונים הוא חבילה מהודרת (Tailwind, צבעים כהים קבועים); `modules/trainer/suite-theme.css` נטען אחריה וממפה את מחלקות הצבע לפלטת התוכנה. בנייה חדשה של המודול עם מחלקות צבע חדשות — יש להוסיף אותן לקובץ (`tests/ui-consistency.test.js` ייכשל ויפרט אותן). מודול השמאות: ערכה בהירה כברירת מחדל (`shamai_theme`), בצבעי התוכנה.
- **`[hidden]` מול `display`** — כלל CSS עם `display:flex` גובר על המאפיין `hidden`. רכיב שמוסתר ב-`hidden` צריך גם `.x[hidden]{display:none}`.
- **פרטי קובץ ה-EXE** — `signAndEditExecutable:false` מבטל גם את האייקון, השם והגרסה של הקובץ (הוא נראה כ-"Electron / GitHub, Inc."). אין תעודת חתימה, ולכן `signExecutable:false` — מדלג על החתימה בלבד (נבדק ב-`tests/build-config.test.js`).
- **הרצה עם פרופיל זמני (`--user-data-dir`) לבדיקות** — הגיבוי האוטומטי רץ 15 שניות אחרי העלייה ונכתב ל-`DocumentsSuperSuite-Backups` **האמיתי**, ואז הגיבוי האמיתי של אותו יום מדולג ("כבר קיים"). לפני ההרצה יש לכתוב לפרופיל `backup-settings.json` עם `targetDir` בתוך הפרופיל.
- **תאריכים ושעות למשתמש** — לא `toISOString()` (UTC): בישראל זה מזיז את השעה ב-2–3 שעות ואת התאריך בין חצות ל-03:00. בגיבוי: `localDay` ב-`shell/auto-backup.js`.

---

## הנחיות סגנון

- **הערות:** בעברית, קצרות, במקום שבו הפונקציה אינה טריוויאלית.
- **שמות:** באנגלית ל-code, עברית רק למחרוזות למשתמש.
- **גישה:** פרצות אבטחה, מקרי קצה וביצועים — להצביע לגביהם תמיד, לא לדחות.
- **אל תמציא** שמות פונקציות/ממשקים שאינם קיימים. אם אינך בטוח — אמת בקוד.
