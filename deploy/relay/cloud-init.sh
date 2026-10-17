#!/bin/bash
# סקריפט הפעלה ראשונה לשרת חדש (Ubuntu 24.04) — מודבק ב-"Startup scripts" ביצירת השרת.
# מתקין Docker וחומת אש (22, 80, 443 בלבד). את הקוד ואת הדומיין מעלים אחר כך (deploy/relay/README.md).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl ufw unattended-upgrades

# עדכוני אבטחה אוטומטיים
dpkg-reconfigure -f noninteractive unattended-upgrades

# Docker מהמאגר הרשמי
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# חומת אש: SSH, ‏HTTP (אימות התעודה), ‏HTTPS
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

mkdir -p /opt/supersuite
touch /opt/supersuite/.cloud-init-done
