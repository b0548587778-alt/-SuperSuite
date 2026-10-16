# שרת הרישוי (server/license-relay.js) בקונטיינר. נבנה מתיקיית השורש של הפרויקט:
#   docker compose -f deploy/relay/docker-compose.yml up -d --build
# ללא תלויות npm — מעתיקים רק את הקבצים שהשרת טוען בפועל.
FROM node:22-alpine

WORKDIR /app
COPY server/ server/
COPY shell/licensing/ shell/licensing/
COPY modules/econ/core/israeliId.js modules/econ/core/israeliId.js

# הנתונים (תיבות הדואר) בכרך נפרד, כדי שלא יימחקו בעדכון הקונטיינר
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

ENV NODE_ENV=production
EXPOSE 8443
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8443/health || exit 1

# TLS מסופק על ידי Caddy שלפני השרת, ולכן --trust-proxy 1 (הגבלת קצב לפי הכתובת האמיתית של הלקוח)
CMD ["node", "server/license-relay.js", "--port", "8443", "--data", "/data", "--trust-proxy", "1"]
