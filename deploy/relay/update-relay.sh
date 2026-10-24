#!/usr/bin/env bash
# עדכון שרת הרישוי לגרסה עם בדיקה חתומה — מריצים על השרת, מתוך תיקיית הפרויקט (supersuite).
#   שלב 1:  bash deploy/relay/update-relay.sh
#           מעדכן את הקוד, יוצר מפתח שרת (פעם אחת) ומדפיס את המפתח הציבורי.
#           מעתיקים את relay-key.pub.json למחשב של מנהל-העל וחותמים תעודה (docs/LICENSING-ACTIVATION.md שלב 7).
#   שלב 2:  bash deploy/relay/update-relay.sh relay-cert.json
#           מתקין את התעודה בכרך הנתונים ומפעיל את השרת מחדש.
set -euo pipefail
COMPOSE="docker compose -f deploy/relay/docker-compose.yml"

if [ $# -eq 0 ]; then
  git pull --ff-only
  $COMPOSE up -d --build
  # המפתח הפרטי נשאר בכרך relay-data; הפקודה לא דורסת מפתח קיים
  if ! $COMPOSE exec -T relay test -f /data/relay-key.json; then
    $COMPOSE exec -T relay node server/license-relay.js --gen-relay-key /data/relay-key.json
  fi
  $COMPOSE exec -T relay cat /data/relay-key.pub.json > relay-key.pub.json
  echo "נשמר relay-key.pub.json — להעתיק למחשב של מנהל-העל ולחתום תעודה."
  echo "בינתיים השרת עלול לסרב לעלות בלי תעודה; זה צפוי עד שלב 2."
else
  CERT="$1"
  [ -f "$CERT" ] || { echo "קובץ התעודה לא נמצא: $CERT"; exit 1; }
  $COMPOSE cp "$CERT" relay:/data/relay-cert.json
  $COMPOSE restart relay
  sleep 3
  DOMAIN=$(grep -E '^RELAY_DOMAIN=' deploy/relay/.env | cut -d= -f2)
  curl -fsS "https://$DOMAIN/health" && echo && echo "השרת עלה עם התעודה."
fi
