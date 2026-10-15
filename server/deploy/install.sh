#!/usr/bin/env bash
# התקנת שרת הממסר של SuperSuite על שרת Ubuntu (22.04 / 24.04) חדש.
# הרצה (כ-root), מתוך התיקייה שחולצה מהחבילה:
#   sudo bash server/deploy/install.sh relay.example.co.il
# מה הסקריפט עושה: Node.js 22, משתמש מערכת ssrelay, שירות systemd, Caddy עם HTTPS אוטומטי, וחומת אש (22/80/443).
# הרצה חוזרת = עדכון גרסה: הקוד מוחלף, הנתונים ב-/var/lib/supersuite-relay נשמרים.
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" || ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "שימוש: sudo bash server/deploy/install.sh <דומיין>   (למשל relay.example.co.il)" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then echo "יש להריץ כ-root (עם sudo)" >&2; exit 1; fi
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
APP=/opt/supersuite-relay
DATA=/var/lib/supersuite-relay

echo "==> חבילות מערכת"
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> משתמש ותיקיות"
id ssrelay >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin ssrelay
mkdir -p "$APP" "$DATA" /var/log/caddy
chown ssrelay:ssrelay "$DATA"
chmod 700 "$DATA"

echo "==> קוד השרת"
rm -rf "$APP.new"
mkdir -p "$APP.new"
cp -r "$SRC/server" "$SRC/shell" "$SRC/modules" "$APP.new/"
rm -rf "$APP.old"
[[ -d "$APP" ]] && mv "$APP" "$APP.old"
mv "$APP.new" "$APP"
chown -R root:root "$APP"

echo "==> שירות"
install -m 644 "$SRC/server/deploy/supersuite-relay.service" /etc/systemd/system/supersuite-relay.service
systemctl daemon-reload
systemctl enable supersuite-relay
systemctl restart supersuite-relay

echo "==> HTTPS (Caddy) עבור $DOMAIN"
sed "s/__DOMAIN__/$DOMAIN/" "$SRC/server/deploy/Caddyfile.template" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "==> חומת אש"
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> בדיקה"
sleep 2
curl -fsS http://127.0.0.1:8443/health && echo
echo
echo "✔ השרת מותקן. כתובת לתוכנה: https://$DOMAIN"
echo "  בדיקה מבחוץ (אחרי שה-DNS מצביע לשרת): https://$DOMAIN/health"
echo "  יומן: journalctl -u supersuite-relay -f"
