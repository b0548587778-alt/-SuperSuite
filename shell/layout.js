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

module.exports = { isRtlLocale, viewBounds };
