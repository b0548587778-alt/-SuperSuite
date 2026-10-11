# SuperSuite — רשימת תיקונים

מסמך זה מרכז את כל התיקונים הנדרשים בפרויקט, לפי סדר עדיפות.
כל סעיף אומת מול הקוד בפועל (נכון ל-11 באוקטובר 2026, גרסה 2.1.0).

מצב בדיקות נוכחי: 78/78 עוברות. הסעיפים כאן הם שיפורי איכות ואבטחה, לא תקלות פעילות.

> **סטטוס (עודכן 11.10.2026):** סעיפים 1–7 ו-9 **יושמו** ואומתו.
> - סעיף 1: מעבר בין מודולים מתוך מודול עובר עכשיו דרך `shell:open-module` בלבד, עם בדיקה (`tests/nav-guard.test.js`).
> - סעיף 6: קיצורי Ctrl+ספרה לא מחליפים מודול כשהפוקוס בשדה עריכה.
> - סעיף 8 (אייקונים) הושאר כפי שהוא — הפונקציונליות תקינה.
> - סעיף 10 (טסטים טקסטואליים) **טרם הושלם במלואו** — הבדיקות ב-`regressions-r2` עדיין סורקות מחרוזות, כי חלקן דורשות פיצול של `main.js` ליחידות ניתנות לבדיקה.
> - נוסף מעבר לסעיפים המקוריים: שמאי אופליין מלא (כלל 6), ענף CI תוקן ל-`master`, ו-`shell/probe-preload.js` הוסר.

---

## 🔴 אבטחה — עדיפות גבוהה

### 1. `shell:switch` ללא אימות שולח
**קובץ:** `main.js:285`

```js
ipcMain.handle('shell:switch', (_e, id) => switchTo(id));   // ❌
```

כל שאר ה-handlers במעטפת בודקים `e.sender.id !== win.webContents.id`
(שורות 286, 287, 289, 296), ורק זה לא.

**למה זה חשוב:** `modules/econ/preload.js:78` חושף `openModule`, ולכן כל renderer של מודול
יכול לכפות ניווט במעטפת. `switchTo` כן מאמת את ה-`id` מול `MODS` (main.js:98), אז הנזק
מוגבל לניווט כפוי וגניבת פוקוס — אבל זו שבירה של האינווריאנט שהאפליקציה עצמה מצהירה עליו.

**תיקון:**
```js
ipcMain.handle('shell:switch', (e, id) => {
  if (!win || e.sender.id !== win.webContents.id) return false;
  switchTo(id);
  return true;
});
```
גם: תכונת "פתח מודול" של econ צריכה לעבור ב-channel נפרד עם guard משלו.

---

### 2. `URIError` לא מטופל ב-protocol handler
**קובץ:** `main.js:38`

```js
let rel = decodeURIComponent(url.pathname);   // ❌ לא עטוף ב-try/catch
```

**למה זה חשוב:** `decodeURIComponent('/%')` זורק `URIError: URI malformed`. כל בקשה למשאב
עם קידוד אחוזים פגום (למשל `app://econ/%`, `app://tools/%zz`) מפילה את ה-handler החוצה
מ-`protocol.handle` → unhandled rejection ומשאב ריק במקום 400 נקי.

**תיקון:**
```js
let rel;
try { rel = decodeURIComponent(url.pathname); }
catch { return new Response('Bad request', { status: 400 }); }
```

---

### 3. CSP של המעטפת חלקית
**קובץ:** `shell/shell.html:6`

```
default-src 'self'; style-src 'unsafe-inline'; script-src 'self'
```

חסרים `img-src`, `font-src`, `connect-src`, `object-src`, `base-uri`.
ה-econ view (`modules/econ/views/index.html:6`) מחמיר יותר.

**למה זה חשוב:** המעטפת היא ה-renderer בעל ההרשאות הגבוהות ביותר — ראוי שתחמיר לפחות
כמו ה-renderer הפשוט. לא פרצה חיה באפליקציה מקומית, אבל פער עקבי.

**תיקון:**
```
default-src 'self'; style-src 'unsafe-inline'; script-src 'self';
img-src 'self' data:; object-src 'none'; base-uri 'none'
```

---

### 4. ולידציה חסרה על `data.localStorage` בשחזור
**קובץ:** `main.js:226-237`

`restoreAll` בודק רק `data.suite === 'SuperSuite'`, ואז מזריק את תוכן הגיבוי
ל-`executeJavaScript` בלי בדיקת מבנה או גודל.

**למה זה חשוב:** `JSON.stringify` חוסם breakout (הוא מבריח מירכאות) והקוד רץ ב-context
של מודול מבודד — אז זו הגנת עומק, לא פרצה חיה. אבל קובץ גיבוי הוא **קלט חיצוני**,
וערכי ה-localStorage נכתבים ל-3 origins שונים בלי שום בדיקת טיפוס או גודל.

**תיקון:** הוסף בדיקת shape/type/size על `data.localStorage` לפני הכתיבה.

---

## 🟠 נכונות

### 5. `win._normal` — קוד מת
**קובץ:** `main.js:129`

```js
const b = win.isMaximized() ? (win._normal || win.getNormalBounds()) : win.getBounds();
```

`win._normal` לא מוקצה בשום מקום בקודבייס (אומת בחיפוש). הפונקציה תמיד נופלת
ל-`getNormalBounds()`. אין קריסה, אבל זה מטעה.

**תיקון:** או להקצות `win._normal` ב-unmaximize, או למחוק את הענף `|| win._normal`.

---

### 6. Ctrl+1..4 נחטף בתוך שדות טקסט
**קובץ:** `main.js:58`

```js
if (input.control && !input.shift && /^[1-4]$/.test(input.key))
```

רץ גלובלית דרך `before-input-event`, כולל בזמן הקלדה בשדות של המודול הכלכלי.
מחליף מודול באמצע עריכה בלי אישור.

**תיקון:** לדלג על מעבר מודול כש-`input.isAutoRepeat`, או כשהפוקוס ב-element
ניתן לעריכה. (או להחליט במפורש שזו ההתנהגות הרצויה — אבל זו צריכה להיות החלטה מודעת.)

---

## 🟡 אריזה (package.json)

### 7. כפילות ב-`files`
**קובץ:** `package.json:26`

`"modules/tools/calc.js"` כבר נכלל ב-`"modules/**/*"` (שורה 23).
אומת מול `dist/win-unpacked/resources/app.asar` — הקובץ קיים פעם אחת בדיוק.

**תיקון:** מחק את השורה הכפולה.

---

### 8. `build/icon.ico` לא ב-`files`
**קובץ:** `package.json:35,49`

`"icon": "build/icon.ico"` (ב-win וב-top-level) אבל `files` מציין רק `"build/icon.png"`.

**למה זה חשוב:** ה-EXE נבנה תקין — electron-builder קורא את ה-ICO בזמן build
(הקובץ קיים בדיסק, 28472 בייט). לא שובר כלום, אבל הקובץ שממתג את ה-EXE
לא חלק מה-payload, והחלוקה בין שני האייקונים קלה לטעות בה בעריכה הבאה.

**חשוב:** ה-PNG **כן** נדרש בזמן ריצה — `main.js:139` משתמש בו
(`icon: path.join(__dirname,'build','icon.png')`). **אל תמחק אותו.**

---

## 🔵 ניקיון וטסטים

### 9. סקריפטי פרוּב/סריקה בשורש הפרויקט
**קבצים בשורש:** `fitness-probe.js`, `fitness-real.js`, `probe-detail.js`, `probe-shell.js`,
`probe2.js`, `probe3.js`, `scan-all.js`, `scan-dbg.js`, `scan-dbg2.js`, `shot.js`,
`shot-real.js`, `sm1.js`..`sm10.js`, `title-check.js`, `verify-modules.js`,
`verify-real.js`, `verify-real2.js`, וקבצי ה-`.json`/`.log` שלהם, וכן `shell-shot.png`.

לא נשלחים לחבילה (לא ב-`files`), אבל מזהמים את עץ המקור עם סקריפטים חד-פעמיים
שלא עברו ביקורת.

**תיקון:** להעביר ל-`scripts/` או למחוק.

---

### 10. טסטים שהם השוואת מחרוזות
**קובץ:** `tests/regressions-r2.test.js:25-66, 191-222`

חלק מה"טסטים" רק בודקים ב-regex שמחרוזת מופיעה בקוד המקור
(למשל שורות 27-31 בודקות ש-`contentView.addChildView(` מופיע).

**למה זה חשוב:** הם יעברו/ייפלו על עריכות פורמט שלא שינו התנהגות, ו**לא** יתפסו
רגרסיה אמיתית (למשל אם `shellGuard` נקרא אבל `assertAccess` נחלש). זו פער איכות,
לא הצהרה כוזבת — שאר הקובץ (שורות 68-182) בודק התנהגות בפועל.

**תיקון:** להמיר גם את הבדיקות הטקסטואליות לבדיקות התנהגותיות.

---

## ✅ נבדק ותקין — אין צורך בתיקון

- **הצפנת גיבוי** (`modules/econ/core/backupCrypto.js`): AES-256-GCM עם scrypt (N=16384),
  salt של 16 בייט ו-IV של 12 בייט אקראיים לכל הצפנה, `getAuthTag`/`setAuthTag`,
  מינימום 8 תווים לסיסמה, שגיאות מעורפלות בכוונה.
- **`autoBackupKey`** (`main.js:176-182`): 32 בייטים אקראיים, נחתם עם `safeStorage` (DPAPI).
- **כתיבה מוצפנת** (`features.js:148`): כותב `.tmp` ואז `renameSync` (אטומי), לא כותב
  טקסט גלוי אף פעם, ו-`autoBackup` מסרב לרוץ כשאין `safeStorage` (main.js:188).
- **מניעת path traversal** (`registerProtocol`, `main.js:33-43`): אומת ש-
  `/../../../Windows/win.ini` ו-`/%2e%2e/%2e%2e/secret.txt` מנורמלים מחוץ ל-root
  ונחסמים עם 403.
- **כל 4 המודולים ב-`MODS`** (`main.js:10`) קיימים בדיסק וב-`app.asar`.
  כל נתיבי `ENTRY` (`main.js:12-17`) מצביעים לקבצים אמיתיים.

---

## סיכום — מה לתקן בפועל

| # | קובץ | שורה | תיאור | עדיפות |
|---|------|------|-------|--------|
| 1 | `main.js` | 285 | guard ל-`shell:switch` | 🔴 |
| 2 | `main.js` | 38 | try/catch סביב `decodeURIComponent` → 400 | 🔴 |
| 3 | `shell/shell.html` | 6 | השלמת ה-CSP | 🔴 |
| 4 | `main.js` | 226-237 | ולידציה על `data.localStorage` | 🔴 |
| 5 | `main.js` | 129 | הסרת `win._normal` המת | 🟠 |
| 6 | `main.js` | 58 | Ctrl+1..4 בשדות עריכה | 🟠 |
| 7 | `package.json` | 26 | הסרת כפילות `calc.js` | 🟡 |
| 8 | `package.json` | 35,49 | בהירות בנושא האייקונים | 🟡 |
| 9 | שורש | — | מחיקת סקריפטי פרוּב | 🔵 |
| 10 | `tests/regressions-r2.test.js` | 25-66,191-222 | טסטים התנהגותיים במקום טקסטואליים | 🔵 |
