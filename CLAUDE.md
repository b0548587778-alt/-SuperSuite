# CLAUDE.md — הנחיות עבודה על SuperSuite

קובץ זה נטען אוטומטית לכל סשן עבודה על הפרויקט. קרא אותו לפני כל שינוי.

---

## מה זה הפרויקט

**SuperSuite** — חבילת עבודה שולחנית (Electron) שמאחדת ארבעה מודולים תחת מעטפת אחת:

| מזהה | מודול | תיאור |
|------|-------|--------|
| `econ` | מערכת כלכלית | הנהלת חשבונות כפולה, חשבוניות מס, מע"מ, מחירון, דוחות, תכנון פיננסי, משכנתאות, מודיעין שוק |
| `shamai` | שמאי | הערכת שווי נכסים |
| `trainer` | TrainerPro | ניהול אימונים ומתאמנים |
| `tools` | ארגז כלים | מחשבונים וכלי עזר (13 כלים) |

**קהל היעד:** משתמשים בסביבה חרדית. כל טקסט, דוגמה ונתון לדוגמה חייבים להיות נקיים והולמים.
**סביבת הפעלה:** מחשבים מסוננים (NetFree ואחרים). האפליקציה חייבת לעבוד **מלאה אופליין**, בלי שום תלות ברשת חיצונית.

---

## פקודות

```bash
npm start          # הרצת האפליקציה בפיתוח (electron .)
npm test           # הרצת 99 הבדיקות (node --test)
npm run dist       # בניית מתקין NSIS + portable ל-Windows
```

בנייה למשתמש קצה: `build-exe.bat` (מתקין Node אוטומטית אם חסר), או GitHub Actions → `Build Windows installer`.

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
- **`SIDEBAR = 200`** — רוחב סרגל הצד. חייב להישאר מסונכרן עם `.side{width:200px}` ב-`shell/shell.html`.
- **`registerProtocol()`** — מגיש קבצים מ-`modules/<mod>/` בלבד. חוסם path traversal אחרי `path.normalize`.
- **`ensureView(id)`** — יוצר `WebContentsView` עצלן עם `contextIsolation:true, nodeIntegration:false, sandbox:true`.
- **`switchTo` / `goHome`** — ניווט בין מודולים. `goHome` מסתיר את כולם ומחזיר למסך הראשי.
- **`handleShortcut()`** — Ctrl+1..4 (ניווט), Ctrl+=/-/0 (זום), F1 (מדריך), Ctrl+Shift+B/R (גיבוי/שחזור).

### מעטפת — `shell/`
| קובץ | תפקיד |
|------|--------|
| `shell.html` | סרגל צד, מסך ראשי, דיאלוגים (סיסמה, מדריך). כולל CSP מחמיר. |
| `shell.js` | בניית רשימת המודולים, טיפול בגיבוי/שחזור, זיהוי יעד גיבוי |
| `preload.js` | חשיפת `window.shellAPI` מעל `contextBridge` |

### מודול כלכלי — `modules/econ/`
| קובץ | תפקיד |
|------|--------|
| `ipc.js` | רישום כל ערוצי ה-IPC + אכיפת הרשאות. **כל** ערוץ (מלבד `auth:`) דורש session פעיל. |
| `preload.js` | חשיפת `window.systemAPI` |
| `core/database.js` | SQLite דרך `node:sqlite`. טבלת `collections` (key-value) + טבלאות auth/roles/audit. |
| `core/accounting.js` | לוגיקת הנה"ח כפולה |
| `core/backupCrypto.js` | הצפנת גיבוי AES-256-GCM |
| `core/exports.js` | ייצוא CSV/Excel |
| `services/*.js` | שירותים עסקיים — כל אחד מאותחל דרך `initializeAsync(db)` |

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
ערוצים ציבוריים מוגדרים ב-`PUBLIC_CHANNELS` — **אל תוסיף לשם בלי סיבה מוצדקת**.

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
- **99 בדיקות** ב-`tests/`, כולן חייבות לעבור לפני סיום עבודה.
- קבצים עיקריים: `accounting`, `integration`, `ipc-guard`, `exports`, `backupCrypto`, `pricing`, `regressions`, `security`, `features`, `regressions-r2`, `tools-calc`, `nav-guard`, `main-behavior`, `shell-ui`, `ui-nav`, `fitness-view`.
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
run-dev.bat              — הרצה בפיתוח
.github/workflows/       — CI: בנייה אוטומטית ל-Windows
build/                   — icon.ico (לבנייה) + icon.png (לזמן ריצה)
shell/                   — המעטפת: html, js, preload
modules/<mod>/           — מודול בודד, נטען כ-WebContentsView
modules/econ/core/       — לוגיקת ליבה: db, accounting, crypto, exports
modules/econ/services/   — שירותים עסקיים
shell/nav-guard.js       — כללי מעבר מודולים (נבדקים ב-tests/nav-guard.test.js)
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

## מלכודות נפוצות

- **`contentView.addChild`** אינו קיים — זה `addChildView` (יש בדיקה סטטית שמונעת חזרה לטעות הזו).
- **`WebContentsView`** ולא `BrowserView` — האחרון הוסר מ-Electron.
- **ערוץ ציבורי** שנוסף ל-`PUBLIC_CHANNELS` עוקף אימות — היזהר.
- **`decodeURIComponent`** בפרוטוקול — חייב try/catch, אחרת קובץ בקידוד פגום מפיל את ה-handler.
- **`e.sender.id`** — כל handler רגיש חייב לאמת אותו. ראו את התיקון ב-`shell:switch`.
- **מודול לא מנווט לבד.** אין לחזור ל-`MODS.includes(id)` ב-`shell:switch`: זה עוקף את האימות. מעבר בין מודולים מתוך מודול עובר דרך `shell:open-module` בלבד.
- **קיצורי מקלדת** נתפסים גם בתוך שדות קלט במודולים — יש דילוג על `isAutoRepeat`.

---

## הנחיות סגנון

- **הערות:** בעברית, קצרות, במקום שבו הפונקציה אינה טריוויאלית.
- **שמות:** באנגלית ל-code, עברית רק למחרוזות למשתמש.
- **גישה:** פרצות אבטחה, מקרי קצה וביצועים — להצביע לגביהם תמיד, לא לדחות.
- **אל תמציא** שמות פונקציות/ממשקים שאינם קיימים. אם אינך בטוח — אמת בקוד.
