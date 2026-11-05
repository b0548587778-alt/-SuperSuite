// מיקום תצוגת המודול בחלון, משמאל לסרגל (הסרגל בצד ימין — המעטפת RTL).
// Electron (Chromium views) הופך את ציר ה-x כששפת הממשק של Windows היא שפה מימין לשמאל:
// x נמדד אז מהקצה הימני. בלי התיקון, ב-Windows בעברית המודול כיסה את הסרגל
// ולא הייתה דרך לצאת ממנו למסך הבית.
'use strict';

const RTL_LANGS = /^(he|iw|yi|ji|ar|fa|ur|ps|sd|ug|ckb|dv|syr)\b/i;

function isRtlLocale(locale) {
  const tag = String(locale || '').replace('_', '-');
  if (!tag) return false;
  try {
    const loc = new Intl.Locale(tag);
    const info = typeof loc.getTextInfo === 'function' ? loc.getTextInfo() : loc.textInfo;
    if (info && info.direction) return info.direction === 'rtl';
  } catch { /* תג לא תקין — נופלים לרשימה */ }
  return RTL_LANGS.test(tag);
}

function viewBounds(width, height, sidebar, locale) {
  const w = Math.max(0, width - sidebar);
  return { x: isRtlLocale(locale) ? sidebar : 0, y: 0, width: w, height: Math.max(0, height) };
}

// מיקום החלון השמור מול המסכים המחוברים (סקירת קוד 2.11.2026): אחרי ניתוק מסך שני החלון נפתח מחוץ למסך.
// נשמר רק אם לפחות MIN_VISIBLE פיקסלים מכל ציר נראים באחד המסכים (workArea), אחרת — בלי x/y (Electron ממרכז).
// displays שאינו מערך (לא ידוע) — המיקום נשמר כמו קודם
const MIN_VISIBLE = 100;
function restorePosition(st, displays) {
  const s = st || {};
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return {};
  if (!Array.isArray(displays)) return { x: s.x, y: s.y };
  const w = Number.isFinite(s.width) ? s.width : 0;
  const h = Number.isFinite(s.height) ? s.height : 0;
  const seen = displays.some((d) => {
    const a = d && (d.workArea || d.bounds);
    if (!a) return false;
    const ox = Math.min(s.x + w, a.x + a.width) - Math.max(s.x, a.x);
    const oy = Math.min(s.y + h, a.y + a.height) - Math.max(s.y, a.y);
    return ox >= Math.min(MIN_VISIBLE, w || MIN_VISIBLE) && oy >= Math.min(MIN_VISIBLE, h || MIN_VISIBLE);
  });
  return seen ? { x: s.x, y: s.y } : {};
}

module.exports = { isRtlLocale, viewBounds, restorePosition };
