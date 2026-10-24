# מודול האימונים — קוד המקור בתוך SuperSuite

זה קוד המקור של TrainerPro (React + Vite + Tailwind). הוא נבנה לתוך `modules/trainer`, שממנה התוכנה טוענת את המודול.
את התיקייה הזו **לא** אורזים בתוכנה (`package.json` → `build.files` כולל רק את `modules/`).

## איך בונים
```bash
cd modules-src/trainer
npm install
cd ../..
node tools/build-trainer.js
npm test
```
`node tools/build-trainer.js --check` בודק מה חסר, בלי לבנות.

**מאחורי NetFree** ההורדה של vite נחסמת (418). לכן הבנייה רצה ב-GitHub Actions: בכל דחיפה ל-`master` או לענף `build/**` נבנה המודול והבדיקות רצות. אין Artifacts (ההורדה שלהם חסומה ב-NetFree); המודול הבנוי נשלח לענף `ci-status`, בתיקייה `trainer-module`:
```bash
git fetch origin ci-status
git checkout FETCH_HEAD -- trainer-module
```
ואז מעתיקים את תוכן `trainer-module` אל `modules/trainer` (בלי `preload.js` — הוא נשמר כמו שהוא), ומוציאים את `trainer-module` מהמאגר (`git rm -r --cached trainer-module` ומחיקת התיקייה). הסיכום של הריצה — `summary.txt` ו-`build.log` באותו ענף.

`tools/build-trainer.js` בודק את התוצר (ערכת הצבעים, קובץ השילוב, פנייה לרשת) **לפני** שהוא נוגע ב-`modules/trainer`, ומחליף את התיקייה רק אחרי שהעותק החדש שלם — בנייה שנכשלה משאירה את המודול הקודם.

## מה שונה מהמקור (TrainerPro 1.0.0, אפריל 2026)
הקוד הגיע כ-`TrainerPro-source.zip`. התיקונים שנעשו קודם ידנית בתוך החבילה המהודרת הועברו לכאן, כדי שבנייה חדשה לא תחזיר אותם:
- **אין פנייה לרשת:** הוסרה טעינת Google Fonts (`index.html`, `App.jsx`), שירות ה-QR החיצוני (`qrCodeUrl` ב-`src/lib/sharing.js` — שלח את פרטי המתאמן לשרת זר, ולא היה בשימוש), והמטמון לגופני Google ב-`vite.config.js`.
- **מדיניות אבטחה (CSP)** ב-`index.html`, כמו בכל מסך בתוכנה.
- **גופנים מקומיים** — משתני `--font-display` / `--font-body` ב-`index.html`.
- **ערכת הצבעים של SuperSuite** — `src/theme.css`, מיובאת ב-`main.jsx` אחרי Tailwind ונבנית לתוך החבילה (PLAN.md 6.4). היא ממפה את מחלקות Tailwind הכהות שבקומפוננטות למשתני `--ss-*` של שפת העיצוב. שפת העיצוב וספריית הרכיבים (`/design-tokens.css`, `/ui-kit.css`) מוגשות מהמעטפת ונטענות ב-`index.html` **לפני** החבילה. `tools/build-trainer.js` מוודא את הסדר. **מחלקת צבע חדשה בקומפוננטה** — להוסיף מיפוי ב-`src/theme.css` (`tests/ui-consistency.test.js` מפרט מה חסר).
- **צבע ערכה בהיר** (`theme-color`) במקום הכהה.

## קובץ שילוב (לא חלק מהבנייה)
נמצא ב-`modules/trainer` ונשמר בכל בנייה:
- `preload.js` — ניווט מהסרגל האחיד ודיווח המסך הפעיל (`tests/trainer-nav.test.js`), ושמירה כ-PDF: `savePdf(name)` ב-`src/lib/print.js` שולח `ss:save-pdf`, וה-preload מבקש מהתוכנה (`trainer:save-pdf`). **כפתור הדפסה חדש — דרך `savePdf` / `printNow`, לא `window.print()`**.

**שינוי טקסט בסרגל הפנימי של המודול** — לעדכן את `TRAINER_LABELS` ב-`shell/catalog.js`, אחרת `tests/trainer-nav.test.js` ייכשל.

## זכויות
TrainerPro נכתב על ידי בעל SuperSuite, בעזרת Claude בצ'אט הרגיל (claude.ai), ונכנס לפרויקט כ-`TrainerPro-source.zip` (18.10.2026). לא נלקח קוד ממקור אחר. הספריות החיצוניות (React, Recharts ועוד) — ברישיונות שלהן, ב-`THIRD-PARTY-NOTICES.txt`. המשפט "חופשי לשימוש" שהיה ב-README המקורי הוחלף ב"כל הזכויות שמורות" (PLAN.md 5.2).
