# חתימת קוד לקובץ ההתקנה

**למה:** קובץ לא חתום מקבל ב-Windows את המסך הכחול של SmartScreen ("Windows הגן על המחשב שלך"),
עם "מפרסם לא ידוע". לקוח שמשלם על רישיון לא אמור לראות את זה.

**מה כבר מוכן בפרויקט:** הבנייה חותמת אוטומטית כשמוגדרת תעודה במשתני הסביבה.
בלי תעודה — הבנייה לא חתומה, בדיוק כמו היום. התעודה עצמה **לעולם לא** נשמרת בפרויקט.
הקוד: `tools/code-signing.js` (נבדק ב-`tests/code-signing.test.js`), ומשמש את `build-local.js` ואת ה-CI.

---

## שלב 1 — לקנות תעודה (צריך לעשות בעצמך)

מאז יוני 2023 ספקי תעודות **לא מנפיקים** תעודת חתימת קוד כקובץ ‎.pfx — רק על טוקן USB או בשירות ענן.

| אפשרות | מתאים כש | הערות |
|---|---|---|
| **Certum Open Source / Standard** (SimplySign בענן) | הכי זול, מפתח יחיד | התעודה מופיעה ב-Windows דרך תוכנת SimplySign |
| **Sectigo / SSL.com OV** (טוקן USB) | עסק רשום | הטוקן מגיע בדואר; מתקינים דרייבר |
| **Azure Trusted Signing** | יש מנוי Azure | חודשי, בלי טוקן; עובד גם ב-GitHub Actions |

תעודת **OV** מספיקה. SmartScreen בונה מוניטין לאט — בשבועות הראשונים ייתכן שעדיין תופיע אזהרה,
אבל היא תציג את שם העסק במקום "מפרסם לא ידוע".

## שלב 2 — לבנות חתום

### א. טוקן USB / SimplySign (במחשב שלך)
1. חבר את הטוקן (או התחבר ל-SimplySign). התעודה צריכה להופיע ב-`certmgr.msc` ← אישי ← אישורים.
2. העתק את **טביעת האצבע** (Thumbprint) של התעודה — 40 תווים.
3. הרץ:

```bash
SS_SIGN_SHA1=<טביעת האצבע> SS_SIGN_REQUIRED=1 npm run dist:local
```

הטוקן יבקש את קוד ה-PIN בזמן החתימה.

### ב. קובץ PFX (תעודה ישנה)
```bash
CSC_LINK=C:/path/to/cert.pfx CSC_KEY_PASSWORD=<סיסמה> SS_SIGN_REQUIRED=1 npm run dist:local
```

### ג. Azure Trusted Signing
משתנים: `SS_AZURE_ENDPOINT`, `SS_AZURE_ACCOUNT`, `SS_AZURE_PROFILE`, `SS_SIGN_PUBLISHER`
(שם המפרסם בדיוק כמו בתעודה), ופרטי הכניסה ל-Azure: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.

### ב-GitHub Actions
מגדירים את אותם שמות כ-**Secrets** במאגר (Settings ← Secrets and variables ← Actions).
בלי סודות — ה-CI בונה לא חתום, כמו קודם. טוקן USB לא עובד ב-CI (אפשרויות ב' או ג' בלבד).

## משתנים נוספים

| משתנה | פירוש |
|---|---|
| `SS_SIGN_REQUIRED=1` | הבנייה נכשלת אם הקובץ לא נחתם. **מומלץ בכל בנייה לשחרור.** |
| `SS_SIGN_TIMESTAMP` | שרת חותמת זמן RFC 3161 אחר (למשל של ספק התעודה). |

בדיקה מה ייעשה, בלי לבנות:

```bash
node tools/code-signing.js
```

## בסביבה מסוננת

החתימה עצמה מקומית, אבל **חותמת הזמן** פונה לשרת של ספק התעודה. בלי חותמת זמן החתימה
פגה עם התעודה, ולכן לא מדלגים עליה. אם השרת חסום ב-NetFree — יש לבקש פתיחה של כתובת ה-TSA של הספק
(למשל `time.certum.pl` או `timestamp.sectigo.com`), או לבנות חתום במחשב לא מסונן / ב-CI.

## אחרי הבנייה

לבדוק ב-PowerShell שהחתימה תקינה:

```powershell
Get-AuthenticodeSignature .\dist\SuperSuite-Setup.exe
```

`Status` צריך להיות `Valid`, ו-`SignerCertificate` — שם העסק שלך.
