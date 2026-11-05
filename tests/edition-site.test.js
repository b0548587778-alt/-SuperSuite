// האתר (שלב 4 בתכנית docs/SPLIT-3-PRODUCTS-PLAN.md): דף אחד עם שלושה כרטיסים — החלטת הבעלים 5.11.2026.
// שמות התוכנות כמו ב-shell/edition.js, ולקוחות קיימים מקבלים הבטחה שהמלאה ממשיכה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Edition = require('../shell/edition');
const EB = require('../tools/edition-build');
const SITE = fs.readFileSync(path.join(ROOT, 'deploy/site/public/index.html'), 'utf8');
const PAGES = fs.readFileSync(path.join(ROOT, 'docs/website/index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'deploy/site/public/styles.css'), 'utf8');
const html = (s) => s.replace(/&quot;/g, '"');

test('האתר: שלושה כרטיסי תוכנה בשמות של edition.js, בכל אחד כותרת וכפתור', () => {
  for (const id of Edition.PARTIAL_IDS) {
    const name = Edition.get(id).name;
    const card = new RegExp(`<article class="card mod prod prod-${id}" aria-labelledby="prod-${id}-h">[\\s\\S]*?<h3 id="prod-${id}-h">${name.replace(/"/g, '"')}</h3>[\\s\\S]*?class="btn[^"]*"[\\s\\S]*?</article>`);
    assert.match(SITE, card, id);
    assert.ok(html(PAGES).includes(name), 'docs/website: ' + name);
    assert.match(SITE, new RegExp(`<article class="card dl prod-${id}">`), 'כרטיס הורדה: ' + id);
    assert.match(SITE, new RegExp(`<article class="card plan prod-${id}">`), 'תכנית: ' + id);
    // הצבע המוביל כמו במהדורה
    assert.ok(CSS.includes(`.prod-${id} { --prod: ${Edition.get(id).color}; }`), 'צבע ' + id);
    assert.ok(PAGES.includes(`.prod-${id} { border-top: 5px solid ${Edition.get(id).color}; }`), 'צבע בדף ב-GitHub Pages: ' + id);
  }
  assert.match(SITE, /כבר עובדים עם SuperSuite כלכלה\? <strong>הכול נשאר כמו שהוא<\/strong>/);
  assert.match(PAGES, /מי שכבר עובד עם SuperSuite כלכלה — ממשיך כרגיל/);
});

test('האתר: אין מחיר קבוע (החלטת הבעלים), ושמות קובצי ההורדה בהערה תואמים לבנייה', () => {
  const pricing = SITE.slice(SITE.indexOf('id="pricing"'), SITE.indexOf('<!-- ===== הורדה ===== -->'));
  assert.doesNotMatch(pricing, /₪\s*\d/);
  for (const id of Edition.PARTIAL_IDS) assert.ok(SITE.includes(path.basename(EB.files(id)[0])), EB.files(id)[0]);
  // בלי משאבים חיצוניים (NetFree) — רק קישורים יחסיים, טלפון ודוא"ל
  for (const m of SITE.matchAll(/(?:src|href)="([^"]+)"/g)) assert.match(m[1], /^(#|[a-z0-9-]+\.(html|css|svg|png)|img\/|tel:|mailto:|downloads\/)/, m[1]);
});
