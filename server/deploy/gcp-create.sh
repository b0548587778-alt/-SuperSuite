#!/usr/bin/env bash
# יצירת שרת הממסר ב-Google Cloud והתקנתו — פקודה אחת מהמחשב שלך.
# דרוש: חשבון Google Cloud עם חיוב מופעל, gcloud מותקן, וכניסה (gcloud auth login).
#   bash server/deploy/gcp-create.sh <project-id> <דומיין>
#   bash server/deploy/gcp-create.sh my-project relay.example.co.il
# יוצר שרת e2-micro (במסלול החינמי של גוגל — בארה"ב בלבד), דיסק Standard של 30GB, כתובת IP קבועה,
# ופתיחת פורטים 80/443. הרצה חוזרת = עדכון גרסה בשרת הקיים (לא יוצר שרת נוסף).
set -euo pipefail

PROJECT="${1:-}"
DOMAIN="${2:-}"
REGION="${SS_GCP_REGION:-us-central1}"   # המסלול החינמי: us-central1 / us-east1 / us-west1 בלבד
ZONE="${REGION}-a"
VM=supersuite-relay
IP_NAME=supersuite-relay-ip
GC="$(command -v gcloud || command -v gcloud.cmd || true)"

if [[ -z "$PROJECT" || -z "$DOMAIN" ]]; then
  echo "שימוש: bash server/deploy/gcp-create.sh <project-id> <דומיין>" >&2; exit 1
fi
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then echo "הדומיין אינו תקין: $DOMAIN" >&2; exit 1; fi
case "$REGION" in us-central1|us-east1|us-west1) ;; *) echo "⚠ האזור $REGION אינו במסלול החינמי של גוגל — ייגבה תשלום" >&2 ;; esac
if [[ -z "$GC" ]]; then echo "gcloud אינו מותקן. התקנה: https://cloud.google.com/sdk/docs/install" >&2; exit 1; fi
if [[ -z "$("$GC" auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ]]; then
  echo "יש להיכנס קודם: gcloud auth login" >&2; exit 1
fi
g() { "$GC" --project "$PROJECT" --quiet "$@"; }

cd "$(dirname "$0")/../.."
echo "==> אריזת השרת"
node tools/pack-relay.js | tail -1

echo "==> הפעלת Compute Engine בפרויקט (בפעם הראשונה לוקח דקה)"
g services enable compute.googleapis.com

echo "==> כתובת IP קבועה"
g compute addresses describe "$IP_NAME" --region "$REGION" >/dev/null 2>&1 || g compute addresses create "$IP_NAME" --region "$REGION"
IP="$(g compute addresses describe "$IP_NAME" --region "$REGION" --format='value(address)')"

echo "==> פתיחת פורטים 80/443"
g compute firewall-rules describe supersuite-relay-web >/dev/null 2>&1 || \
  g compute firewall-rules create supersuite-relay-web --allow tcp:80,tcp:443 --target-tags supersuite-relay --source-ranges 0.0.0.0/0

echo "==> השרת"
if ! g compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1; then
  g compute instances create "$VM" --zone "$ZONE" --machine-type e2-micro \
    --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
    --boot-disk-size 30GB --boot-disk-type pd-standard \
    --tags supersuite-relay --address "$IP"
  echo "    ממתין שהשרת יעלה..."
  sleep 40
fi

echo "==> העלאה והתקנה"
g compute scp dist/supersuite-relay.tar.gz "$VM":~/ --zone "$ZONE"
g compute ssh "$VM" --zone "$ZONE" --command \
  "rm -rf supersuite-relay && tar -xzf supersuite-relay.tar.gz && sudo bash supersuite-relay/server/deploy/install.sh '$DOMAIN'"

echo
echo "✔ השרת פועל. כתובת ה-IP הקבועה: $IP"
echo "  1. אצל ספק הדומיין: רשומת A  $DOMAIN → $IP"
echo "  2. אחרי שה-DNS מתעדכן (עד שעה): https://$DOMAIN/health"
echo "     תעודת ה-HTTPS נוצרת לבד ברגע שהדומיין מצביע לשרת."
