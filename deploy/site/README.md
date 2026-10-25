# אתר השיווק של SuperSuite

אתר סטטי בעברית (`public/`): HTML ו-CSS בלבד. אין JavaScript, אין גופנים או CDN חיצוניים, אין עוגיות ואין כלי מעקב, ולכן הוא נטען מהר ועובד גם במחשבים מסוננים.
אפשר לפתוח את `public/index.html` ישירות בדפדפן לבדיקה.

## מה למלא לפני פרסום

פרטי הקשר (טלפון ודוא"ל) ומדיניות הפרטיות (`privacy.html`) — כמו באתר ב-GitHub Pages (`docs/website`). מה שנשאר מסומן ב-`index.html` בהערה `<!-- EDIT: ... -->`:

| מה | איפה |
|---|---|
| קישורי הורדה | מקטע `#download`. עד שהקבצים עולים לתיקייה `public/downloads/` הכפתורים מובילים ל"צור קשר" |
| מחירים | אין מחירים באתר — "הצעת מחיר" ו-30 יום ניסיון. מחיר קבוע מוסיפים בכרטיסי `#pricing` |

**שינוי ב-`styles.css`:** להעלות את מספר הגרסה (`styles.css?v=2`) בכל קובצי ה-HTML — Caddy שומר את הקובץ במטמון של הדפדפן לשבוע.

## קובצי ההתקנה

מעתיקים לשרת, לתיקייה `deploy/site/public/downloads/`:
`SuperSuite-Setup.exe`, `SuperSuite-Portable.exe`, `SuperSuite.apk`.
הקבצים לא נכנסים למאגר (`.gitignore`). כדי לתת קישור ישיר ל-GitHub במקום זה, מחליפים את ה-`href` (`docs/DOWNLOADS.md`). שימו לב ש-NetFree חוסם את GitHub, ולכן הורדה מהאתר עדיפה ללקוחות מסוננים.

## הפעלה בשרת (Docker, לצד שרת הרישוי)

האתר רץ באותו Caddy של `deploy/relay`. ‏`deploy/relay/Caddyfile` טוען כל קובץ `*.caddy` מ-`/etc/caddy/sites/`, והתוספת `docker-compose.site.yml` מחברת לשם את `site.caddy` ואת `public/`.

```bash
# 1. דומיין: רשומת A לאותו שרת, ואז
cp deploy/site/.env.example deploy/site/.env
nano deploy/site/.env        # SITE_DOMAIN=supersuite.example.co.il

# 2. הפעלה (משורש הפרויקט)
docker compose -f deploy/relay/docker-compose.yml -f deploy/site/docker-compose.site.yml up -d --build
```

בלי התוספת, שרת הרישוי עובד בדיוק כמו קודם. עדכון תוכן האתר: `git pull`. אין צורך להפעיל מחדש, כי Caddy מגיש את הקבצים ישירות מהתיקייה.

**בלי Docker:** מעתיקים את `site.caddy` ל-`/etc/caddy/sites/`, מחליפים בו את `{$SITE_DOMAIN}` בדומיין ואת `/srv/site` בנתיב של `public`, ומוסיפים את שורת ה-`import` שבסוף `deploy/relay/Caddyfile` ל-`/etc/caddy/Caddyfile`. אחר כך: `systemctl reload caddy`.

**סינון:** כמו בשרת הרישוי, מבקשים מ-NetFree ומספקי סינון אחרים לאשר את דומיין האתר.

## אבטחה

`site.caddy` שולח כותרות אבטחה, ביניהן CSP שמתיר רק משאבים מאותו מקור ובלי סקריפטים. אם מוסיפים בעתיד סקריפט או טופס, צריך לעדכן את ה-CSP.
