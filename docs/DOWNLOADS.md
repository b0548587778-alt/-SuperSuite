# קישור הורדה קבוע ללקוחות (PLAN.md 1.1)

קוד התוכנה נשאר במאגר **הפרטי**. קובצי ההתקנה עולים למאגר **ציבורי נפרד**, שיש בו רק הורדות.
אחרי ההגדרה, זה הקישור הקבוע שנותנים ללקוחות. הוא תמיד מוביל לגרסה האחרונה:

```
https://github.com/b0548587778-alt/SuperSuite-Downloads/releases/latest/download/SuperSuite-Setup.exe
```

**המהדורות** (`shell/edition.js`, `docs/SPLIT-3-PRODUCTS-PLAN.md`) — כל גרסה מפרסמת את ארבעתן יחד. הקישור למעלה הוא המהדורה המלאה, כמו היום:

| תוכנה | קישור קבוע |
|---|---|
| SuperSuite עמותות | `https://github.com/b0548587778-alt/SuperSuite-Downloads/releases/latest/download/SuperSuite-Amutot-Setup.exe` |
| SuperSuite נדל"ן ועסקים | `https://github.com/b0548587778-alt/SuperSuite-Downloads/releases/latest/download/SuperSuite-Nadlan-Setup.exe` |
| SuperSuite חשבונאות | `https://github.com/b0548587778-alt/SuperSuite-Downloads/releases/latest/download/SuperSuite-Heshbonaut-Setup.exe` |

גרסה ניידת (בלי התקנה) — אותו שם עם `-Portable.exe` במקום `-Setup.exe`. בנייה במחשב: `build-exe.bat` (ארבעתן) או `build-exe.bat npo` (אחת).

## הגדרה — פעם אחת (בכרום, כ-10 דקות)

1. **מאגר ההורדות:** github.com/new
   - Repository name: `SuperSuite-Downloads`
   - לבחור **Public**
   - לסמן **Add a README file** (חובה: אי אפשר לפרסם גרסה במאגר ריק)
   - Create repository
2. **מפתח גישה שמורשה רק למאגר הזה:** github.com/settings/personal-access-tokens/new
   - Token name: `SuperSuite downloads`
   - Expiration: שנה (הכי ארוך שאפשר)
   - Repository access: **Only select repositories** ← `SuperSuite-Downloads`
   - Permissions ← Repository permissions ← **Contents: Read and write**
   - Generate token ← להעתיק (מופיע פעם אחת בלבד)
3. **לשמור את המפתח במאגר הפרטי:** בעמוד המאגר `-SuperSuite` ← Settings ← Secrets and variables ← Actions
   - לשונית **Secrets** ← New repository secret: שם `SS_DOWNLOADS_TOKEN`, ערך: להדביק את המפתח
   - לשונית **Variables** ← New repository variable: שם `SS_DOWNLOADS_REPO`, ערך `b0548587778-alt/SuperSuite-Downloads`

את המפתח לא שולחים לאף אחד, גם לא ל-Claude. הוא נשמר רק ב-GitHub.

## פרסום גרסה

אומרים ל-Claude "תפרסם גרסה". הוא מעלה את מספר הגרסה ב-`package.json` ודוחף תגית (למשל `v3.11.0`), אחרי אישור שלך.
GitHub בונה, בודק שהתוכנה עולה, ומפרסם את `SuperSuite-Setup.exe` ו-`SuperSuite-Portable.exe`.
התוצאה בשורה `publish:` בענף `ci-status` (דף ה-Actions חסום ב-NetFree).

- **בדיקת הפצה קודם:** בכל פרסום (תגית `v*` או הפעלה ידנית עם publish) הבנייה מריצה קודם את `tools/release-check.js`.
  בלי מפתח שורש תקין ב-`shell/licensing/root-keys.js`, או כשכתובת שרת הרישוי (`shell/licensing/default-relay.js`) אינה https —
  הבנייה נכשלת בתוך שניות ולא מפורסם כלום. הסיבה בעברית בקובץ `build.log` בענף `ci-status`. הפעלת המפתח: `docs/LICENSING-ACTIVATION.md`.
- גרסה שכבר פורסמה לא נדרסת: גרסה חדשה = מספר חדש.
- תגית שלא תואמת את `package.json` לא מפורסמת.
- בנייה או בדיקת עלייה שנכשלו: לא מפורסם כלום.

## חשוב לדעת

- **בנייה רגילה בלי רישוי:** דחיפה ל-`master` (או לענף `build/**`) בונה ובודקת גם כש-`root-keys.js` ריק, אבל לא מפרסמת.
  גרסה כזו פתוחה לגמרי (בלי תקופת ניסיון ובלי נעילה), ולכן היא לא מגיעה לקישור ההורדה.
- **מחשבים מסוננים:** NetFree חוסם הורדות מ-GitHub. לקוח מסונן צריך לבקש אישור לכתובת, או לקבל את הקובץ ממך (USB או מייל).
- **אנדרואיד:** ה-APK נבנה רק במחשב שלך (`build-apk.bat`), כי מפתח החתימה לא נמצא ב-GitHub. אפשר להעלות אותו ידנית לגרסה שפורסמה.
- **עדכון אוטומטי** (1.4): ממתין להפעלת הרישוי. עד אז לקוח מעדכן כשמתקין את הגרסה החדשה מהקישור, והנתונים נשמרים.
