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
      { id: 'xxl', name: 'ענק' },
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
    // נגישות (סבב 4): מצב פשוט, מטרות לחיצה גדולות, קו תחתון לקישורים, גופן קריא.
    // data-ss-simple="on" הוא חוזה משותף לכל המסכים (ui-kit.css: .ss-advanced מוסתר, .ss-simple-only מוצג, data-ss-help)
    // סדר הרשימה נשאר (off ראשון — המתגים והעיצוב נשענים עליו), אבל מה שהמשתמש מקבל בלי שבחר הוא "on":
    // ראו stored() למטה — "הפשוט הוא הבסיס" (החלטת הבעלים 13.11.2026)
    simple: [
      { id: 'off', name: 'רגיל' },
      { id: 'on', name: 'מצב פשוט', desc: 'רק הפעולות הנפוצות, כפתורים גדולים והסברים' },
    ],
    targets: [
      { id: 'normal', name: 'רגילים' },
      { id: 'large', name: 'גדולים', desc: 'כפתורים ושדות גדולים — קל ללחוץ' },
    ],
    links: [
      { id: 'normal', name: 'רגילים' },
      { id: 'underline', name: 'עם קו תחתון', desc: 'קל לראות מה אפשר ללחוץ' },
    ],
    font: [
      { id: 'normal', name: 'רגיל' },
      { id: 'readable', name: 'קריא במיוחד', desc: 'גופן פשוט ורווח גדול בין אותיות ושורות' },
    ],
  };
  const KEYS = Object.keys(OPTIONS);
  const DEFAULTS = Object.freeze(Object.fromEntries(KEYS.map(k => [k, OPTIONS[k][0].id])));

  // ההגדרות שחלון הנגישות (♿) מציג — והערכים של "הכול בבת אחת"
  const A11Y_KEYS = ['simple', 'text', 'contrast', 'motion', 'targets', 'links', 'font', 'theme'];
  const A11Y_FULL = Object.freeze({ simple: 'on', text: 'xl', contrast: 'high', motion: 'reduced', targets: 'large', links: 'underline', font: 'readable', density: 'spacious' });
  // תשובת "כן" לשאלה בהפעלה הראשונה: פשוט וגדול, בלי לשנות צבעים
  const A11Y_EASY = Object.freeze({ simple: 'on', text: 'lg', targets: 'large', links: 'underline' });

  // ערכות מוכנות — בחירה אחת שממלאת כמה הגדרות
  const PRESETS = [
    { id: 'classic', name: 'קלאסי', desc: 'המראה הרגיל של התוכנה', set: { ...DEFAULTS } },
    { id: 'night', name: 'לילה', desc: 'כהה, בצבע זהב', set: { theme: 'dark', accent: 'gold' } },
    { id: 'office', name: 'משרד', desc: 'צפוף ופינות ישרות — הרבה נתונים במסך', set: { density: 'compact', shape: 'square', accent: 'navy' } },
    { id: 'easy', name: 'קריאה נוחה', desc: 'טקסט גדול, מרווח וניגודיות גבוהה', set: { text: 'lg', density: 'spacious', contrast: 'high' } },
    { id: 'calm', name: 'רגוע', desc: 'ירוק, עגול ובלי אנימציות', set: { accent: 'green', shape: 'round', motion: 'reduced' } },
    { id: 'access', name: 'נגישות מלאה', desc: 'מצב פשוט, טקסט גדול מאוד, ניגודיות גבוהה, בלי אנימציות', set: { ...A11Y_FULL } },
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
    const out = {};
    for (const k of KEYS) out['data-ss-' + k] = k === 'theme' ? theme : s[k];
    return out;
  }

  // כל הגדרות הנגישות בברירת המחדל? (השאלה בהפעלה הראשונה נשאלת רק אז)
  function isPlain(settings) {
    const s = sanitize(settings);
    return A11Y_KEYS.every(k => k === 'theme' || k === 'simple' || s[k] === DEFAULTS[k]); // פשוט / מלא — בחירת תצוגה, לא התאמת נגישות
  }
  // חזרה למצב הרגיל — רק הגדרות הנגישות; ערכה וצבע הדגשה נשארים
  function resetA11y(settings) {
    const s = sanitize(settings);
    for (const k of A11Y_KEYS) if (k !== 'theme') s[k] = DEFAULTS[k];
    s.density = DEFAULTS.density;
    s.simple = 'on'; // "המצב הרגיל" הוא הפשוט (הבסיס); התצוגה המלאה — רק בבחירה מפורשת
    return s;
  }

  // החלה על מסמך (במעטפת ובכל מודול)
  function applyTo(doc, attrs) {
    if (!doc || !doc.documentElement || !attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (/^data-ss-[a-z]+$/.test(k) && typeof v === 'string' && /^[a-z]+$/.test(v)) doc.documentElement.setAttribute(k, v);
    }
  }

  // "הפשוט הוא הבסיס" (13.11.2026): התקנה חדשה נפתחת במצב פשוט, והגדרות שנשמרו לפני השינוי עוברות אליו פעם אחת —
  // גם מי שעבד במסך המלא.
  // displayBase נכתב בכל שמירה, ומאותו רגע הבחירה של המשתמש (גם "תצוגה מלאה") נשמרת כמו שהיא.
  // ui — תוכן ui-settings.json (קלט לא מהימן)
  const BASE_V = 1;
  function stored(ui) {
    const u = ui && typeof ui === 'object' ? ui : {};
    const s = sanitize(u.display);
    if (!(Number(u.displayBase) >= BASE_V)) s.simple = 'on';
    return s;
  }
  function withSaved(ui, input) {
    const u = ui && typeof ui === 'object' ? ui : {};
    return { ...u, display: sanitize(input), displayBase: BASE_V };
  }

  const api = { OPTIONS, KEYS, DEFAULTS, PRESETS, A11Y_KEYS, A11Y_FULL, A11Y_EASY, BASE_V, sanitize, stored, withSaved, applyPreset, attrsFor, applyTo, isPlain, resetA11y };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUITE_DISPLAY = api;
})(typeof window !== 'undefined' ? window : this);
