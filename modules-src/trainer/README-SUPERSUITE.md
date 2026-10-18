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

**מאחורי NetFree** ההורדה של vite נחסמת (418). לכן הבנייה רצה ב-GitHub Actions: בכל דחיפה ל-`master` נבנה המודול, הבדיקות רצות, והתוצר זמין להורדה (Artifacts → `trainer-module`).

## מה שונה מהמקור (TrainerPro 1.0.0, אפריל 2026)
הקוד הגיע כ-`TrainerPro-source.zip`. התיקונים שנעשו קודם ידנית בתוך החבילה המהודרת הועברו לכאן, כדי שבנייה חדשה לא תחזיר אותם:
- **אין פנייה לרשת:** הוסרה טעינת Google Fonts (`index.html`, `App.jsx`), שירות ה-QR החיצוני (`qrCodeUrl` ב-`src/lib/sharing.js` — שלח את פרטי המתאמן לשרת זר, ולא היה בשימוש), והמטמון לגופני Google ב-`vite.config.js`.
- **מדיניות אבטחה (CSP)** ב-`index.html`, כמו בכל מסך בתוכנה.
- **גופנים מקומיים** — משתני `--font-display` / `--font-body` ב-`index.html`.
- **ערכת הצבעים של SuperSuite** — `modules/trainer/suite-theme.css`, נטענת אחרי ה-CSS המהודר. `tools/build-trainer.js` מוודא את הסדר.
- **צבע ערכה בהיר** (`theme-color`) במקום הכהה.

## קבצי שילוב (לא חלק מהבנייה)
נמצאים ב-`modules/trainer` ונשמרים בכל בנייה:
- `preload.js` — ניווט מהסרגל האחיד ודיווח המסך הפעיל (`tests/trainer-nav.test.js`).
- `suite-theme.css` — מיפוי הצבעים (`tests/ui-consistency.test.js`).

**שינוי טקסט בסרגל הפנימי של המודול** — לעדכן את `TRAINER_LABELS` ב-`shell/catalog.js`, אחרת `tests/trainer-nav.test.js` ייכשל.

## זכויות
ב-README המקורי של TrainerPro כתוב רק "חופשי לשימוש אישי ומקצועי". לפני מכירה יש לברר ולתעד את הזכויות (PLAN.md 5.2).
