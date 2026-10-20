/* הגדרות תצוגה לכל התוכנה (PLAN.md 7.4): ערכת צבע, צבע הדגשה, צפיפות, גודל טקסט, פינות, ניגודיות ותנועה.
   משותף ל-main.js (שמירה ב-ui-settings.json → display) ולמעטפת (חלון "תצוגה").
   ההגדרות הופכות למאפייני data-ss-* על <html> בכל מסך (shell/display-preload.js), והעיצוב עצמו — ב-design-tokens.css. */
(function (root) {
  'use strict';

  // ערך ראשון בכל רשימה = ברירת המחדל (המראה הקיים)
  const OPTIONS = {
    theme: [
      { id: 'light', name: 'בהיר', desc: 'רקע לבן — המראה הרגיל' },
      { id: 'dark', name: 'כהה', desc: 'רקע כהה — נוח בערב ובתאורה חלשה' },
      { id: 'system', name: 'לפי Windows', desc: 'בהיר או כהה לפי הגדרת המחשב' },
    ],
    accent: [
      { id: 'blue', name: 'כחול' },
      { id: 'navy', name: 'כחול כהה' },
      { id: 'teal', name: 'טורקיז' },
      { id: 'green', name: 'ירוק' },
      { id: 'purple', name: 'סגול' },
      { id: 'burgundy', name: 'בורדו' },
      { id: 'gold', name: 'זהב' },
    ],
    density: [
      { id: 'comfortable', name: 'רגיל' },
      { id: 'compact', name: 'צפוף', desc: 'יותר מידע במסך' },
      { id: 'spacious', name: 'מרווח', desc: 'כפתורים ושדות גדולים' },
    ],
    text: [
      { id: 'md', name: 'רגיל' },
      { id: 'sm', name: 'קטן' },
      { id: 'lg', name: 'גדול' },
      { id: 'xl', name: 'גדול מאוד' },
    ],
    shape: [
      { id: 'rounded', name: 'מעוגל' },
      { id: 'square', name: 'ישר' },
      { id: 'round', name: 'עגול מאוד' },
    ],
    contrast: [
      { id: 'normal', name: 'רגילה' },
      { id: 'high', name: 'גבוהה', desc: 'קווים וטקסט חזקים יותר' },
    ],
    motion: [
      { id: 'normal', name: 'רגילה' },
      { id: 'reduced', name: 'מופחתת', desc: 'בלי אנימציות ומעברים' },
    ],
  };
  const KEYS = Object.keys(OPTIONS);
  const DEFAULTS = Object.freeze(Object.fromEntries(KEYS.map(k => [k, OPTIONS[k][0].id])));

  // ערכות מוכנות — בחירה אחת שממלאת כמה הגדרות
  const PRESETS = [
    { id: 'classic', name: 'קלאסי', desc: 'המראה הרגיל של התוכנה', set: { ...DEFAULTS } },
    { id: 'night', name: 'לילה', desc: 'כהה, בצבע זהב', set: { theme: 'dark', accent: 'gold' } },
    { id: 'office', name: 'משרד', desc: 'צפוף ופינות ישרות — הרבה נתונים במסך', set: { density: 'compact', shape: 'square', accent: 'navy' } },
    { id: 'easy', name: 'קריאה נוחה', desc: 'טקסט גדול, מרווח וניגודיות גבוהה', set: { text: 'lg', density: 'spacious', contrast: 'high' } },
    { id: 'calm', name: 'רגוע', desc: 'ירוק, עגול ובלי אנימציות', set: { accent: 'green', shape: 'round', motion: 'reduced' } },
  ];

  // קלט לא מהימן (מהמעטפת או מהקובץ) ← הגדרות תקינות בלבד; ערך לא מוכר ← ברירת המחדל
  function sanitize(input) {
    const s = input && typeof input === 'object' ? input : {};
    const out = {};
    for (const k of KEYS) out[k] = OPTIONS[k].some(o => o.id === s[k]) ? s[k] : DEFAULTS[k];
    return out;
  }

  // ערכה מוכנה ← הגדרות מלאות (מה שלא בערכה — ברירת מחדל)
  function applyPreset(id) {
    const p = PRESETS.find(x => x.id === id);
    return p ? sanitize({ ...DEFAULTS, ...p.set }) : null;
  }

  // ההגדרות ← מאפייני ה-HTML. "לפי Windows" נפתר כאן לפי systemDark
  function attrsFor(settings, systemDark) {
    const s = sanitize(settings);
    const theme = s.theme === 'system' ? (systemDark ? 'dark' : 'light') : s.theme;
    return { 'data-ss-theme': theme, 'data-ss-accent': s.accent, 'data-ss-density': s.density, 'data-ss-text': s.text,
      'data-ss-shape': s.shape, 'data-ss-contrast': s.contrast, 'data-ss-motion': s.motion };
  }

  // החלה על מסמך (במעטפת ובכל מודול)
  function applyTo(doc, attrs) {
    if (!doc || !doc.documentElement || !attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (/^data-ss-[a-z]+$/.test(k) && typeof v === 'string' && /^[a-z]+$/.test(v)) doc.documentElement.setAttribute(k, v);
    }
  }

  const api = { OPTIONS, KEYS, DEFAULTS, PRESETS, sanitize, applyPreset, attrsFor, applyTo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUITE_DISPLAY = api;
})(typeof window !== 'undefined' ? window : this);
