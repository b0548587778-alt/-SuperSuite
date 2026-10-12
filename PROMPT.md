# פרומפט מרוכז — SuperSuite

עותק אחד של כל הדרישות שהועלו בשיחה, מוכן להעתקה כפרומפט לסשן עבודה חדש.

---

## הפרומפט

אני עובד על **SuperSuite** — חבילת עבודה שולחנית ב-Electron שמאחדת ארבעה מודולים תחת מעטפת אחת:

| מזהה | מודול | תיאור |
|------|-------|--------|
| `econ` | מערכת כלכלית | הנהלת חשבונות כפולה, חשבוניות מס, מע"מ, מחירון, דוחות, תכנון פיננסי, משכנתאות, מודיעין שוק |
| `shamai` | שמאי | הערכת שווי נכסים |
| `trainer` | TrainerPro | ניהול אימונים ומתאמנים |
| `tools` | ארגז כלים | מחשבונים וכלי עזר (13 כלים) |

### המיקום והמצב

- **הפרויקט:** `C:\Users\bunim seller\Projects\SuperSuite`
- **git:** מאותחל, שישה commits, ענף `master` (HEAD = `a6c5406`)
- **בדיקות:** 87/87 עוברות (`npm test`)
- **חבילה מוכנה להעלאה:** `C:\Users\bunim seller\Projects\SuperSuite-repo.bundle`

### מה ביקשתי לעשות — לפי הסדר

**1. תיעוד כל התיקונים בפרומפט/קובץ הוראות לקלוד**
לסרוק את הקוד, לזהות בעיות אמיתיות, ולתעד אותן מסודר לפי עדיפות. ✅ בוצע — `TODO-FIXES.md`.

**2. ליישם את התיקונים**
לבצע בפועל את כל מה שתועד, לא רק לרשום. ✅ בוצע — **כל עשרת הסעיפים**:
- `shell/nav-guard.js` — מעבר מודולים מתוך מודול עובר ב-`shell:open-module` בלבד (סעיף 1, הפתרון המלא)
- `main.js` — `try/catch` סביב `decodeURIComponent` → 400 במקום unhandled rejection
- `main.js` — ולידציית shape/size על `localStorage` בשחזור גיבוי
- `main.js` — הסרת קוד מת (`win._normal`)
- `main.js` — דילוג על קיצורי מקלדת בזמן הקלדה בשדה עריכה ובחזרות אוטומטיות
- `shell.html` — השלמת CSP (`img-src`, `object-src`, `base-uri`, `form-action`)
- `package.json` — הסרת כניסה כפולה מ-`files`
- מחיקת סקריפטי פרוּב מזמניים משורש הפרויקט
- `tests/main-behavior.test.js`, `shell-ui`, `ui-nav`, `nav-guard` — בדיקות **התנהגות** במקום סריקת מחרוזות
- **שמאי אופליין מלא** — הוסרו בקשות לשירותים חיצוניים
- ענף ה-CI תוקן ל-`master`

**3. להעביר את הפרויקט למקום קבוע**
מ-`AppData\Local\Temp` (תיקייה שנמחקת) למקום בטוח. ✅ בוצע — `C:\Users\bunim seller\Projects\SuperSuite`.

**4. לאתחל git ולהעלות ל-GitHub**
✅ git אותחל עם `.gitignore` מתאים (מסנן `node_modules`, `dist`, `dist-prev`).
❌ **העלאה ל-GitHub לא בוצעה** — הסינון (NetFree) חוסם push מאומת (מתקבל `418`), אין `gh` CLI, ואין TTY להזנת טוקן. **אין לעקוף את הסינון — זו דרישה מוחלטת.**

**5. לכתוב קובץ הוראות לקלוד (`CLAUDE.md`)**
✅ בוצע — כולל ארכיטקטורה, 8 כללי ברזל, בדיקות, מלכודות נפוצות, וזרימת עבודה מומלצת.

**6. לקבץ את כל הדרישות לפרומפט אחד (`PROMPT.md`)**
✅ בוצע — המסמך הזה.

**7. לשלב את מודול ה-Python לתוך הפרויקט**
✅ בוצע — `tools/passwords/` עם `encryption.py`, `test_encryption.py`, `requirements.txt`
ו-`README.md` (כולל אזהרה שלא לאחסן סיסמאות של אחרים, והוראות התקנה בסביבה מסוננת).
⚠️ **הבדיקות טרם הורצו** — הספרייה `cryptography` אינה ניתנת להתקנה מהסביבה המסוננת הזו.
יש להריץ `python -m unittest test_encryption -v` במחשב שבו הספרייה מותקנת.

### דרישות קבועות לפרויקט הזה

- **סביבה חרדית:** כל טקסט, דוגמה ונתון לדוגמה — נקיים והולמים.
- **סביבה מסוננת:** האפליקציה רצה **מלאה אופליין**. אפס תלות ברשת, אפס CDN, אפס API חיצוני. **אסור לעקוף סינון, ואסור להציע לעקוף.**
- **עברית ו-RTL:** כל טקסט למשתמש בעברית, שגיאות IPC בעברית, `dir="rtl"`.
- **כספים בשלמי אגורות:** בלי נקודה צפה גולמית לסכומים.
- **כל ערוץ IPC דורש הרשאה:** דרך `handle()` ב-`modules/econ/ipc.js`.
- **אטומיות:** כל פעולה על ה-DB דרך `enqueue()`.
- **המעטפת בלבד** רשאית לנווט/לגבות — אימות `e.sender.id`.
- **גיבוי:** לעולם לא טקסט גלוי. הצפנת AES-256-GCM בלבד.

### מה נשאר לעשות

**א. העלאת GitHub** — צריך להריץ אצלי בטרמינל (אין אימות מהסביבה הזו):
```bash
cd "C:\Users\bunim seller\Projects\SuperSuite"
git remote add origin https://github.com/<המשתמש-שלך>/SuperSuite.git
git push -u origin master
```
או לשחזר מהחבילה בכל מחשב אחר:
```bash
git clone "C:\Users\bunim seller\Projects\SuperSuite-repo.bundle" SuperSuite
cd SuperSuite
git remote set-url origin https://github.com/<המשתמש-שלך>/SuperSuite.git
git push -u origin master
```

**ב. הרצת בדיקות ה-Python** — פעם אחת במחשב שבו `cryptography` מותקנת:
```bash
cd tools/passwords
python -m unittest test_encryption -v
```

**ג. סעיף 8 ב-`TODO-FIXES.md`** — בהירות בנושא האייקונים ב-`package.json`
(לא שובר כלום, הושאר במכוון).

### פקודות

```bash
npm start          # הרצה בפיתוח
npm test           # 87 בדיקות
npm run dist       # בניית NSIS + portable
```

---

## ניסוח קצר (לשימוש מהיר)

> אני עובד על SuperSuite — חבילת Electron עם 4 מודולים (`econ` מערכת כלכלית, `shamai` שמאי, `trainer` TrainerPro, `tools` ארגז כלים). הפרויקט ב-`C:\Users\bunim seller\Projects\SuperSuite`, git מאותחל, 69/69 בדיקות עוברות.
>
> תסרוק את הקוד, תזהה בעיות אמיתיות, תתעד אותן ב-`TODO-FIXES.md` לפי עדיפות, ותיישם אותן בפועל. תכתוב/תעדכן את `CLAUDE.md` עם כל מה שצריך לדעת על הפרויקט.
>
> דרישות קבועות: סביבה חרדית (תוכן נקי), סביבה מסוננת (אפס תלות ברשת, **אסור לעקוף סינון**), עברית ו-RTL מלאים, כספים בשלמי אגורות, כל ערוץ IPC דורש הרשאה, אטומיות DB דרך `enqueue()`, המעטפת בלבד רשאית לנווט/לגבות, גיבוי תמיד מוצפן.
>
> הרץ `npm test` לפני ואחרי כל שינוי, וסיים ב-commit בעברית.
