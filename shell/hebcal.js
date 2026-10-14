// לוח עברי וזמני שבת/יום טוב — פונקציות טהורות, אופליין, בלי ספריות חיצוניות.
// התאריך העברי מגיע מלוח השנה העברי המובנה במנוע (Intl, ICU). זמני השמש מחושבים במשוואת הזריחה הסטנדרטית
// (דיוק של כדקה). נטען גם ב-main.js (require) וגם במעטפת (window.SUITE_HEBCAL).
(function (root) {
  const DAY = 86400000;
  const TZ = 'Asia/Jerusalem';

  const MONTHS = {
    Tishri: 'תשרי', Heshvan: 'חשוון', Kislev: 'כסלו', Tevet: 'טבת', Shevat: 'שבט', Adar: 'אדר',
    'Adar I': 'אדר א׳', 'Adar II': 'אדר ב׳', Nisan: 'ניסן', Iyar: 'אייר', Sivan: 'סיוון', Tamuz: 'תמוז', Av: 'אב', Elul: 'אלול'
  };
  const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  // ערים: קואורדינטות, ודקות הדלקה ברירת מחדל (ירושלים 40, חיפה 30, אחרות 20). ניתן לשנות בהגדרות לפי מנהג המקום.
  const CITIES = [
    { id: 'jerusalem',    name: 'ירושלים',        lat: 31.7683, lon: 35.2137, candles: 40 },
    { id: 'bnei-brak',    name: 'בני ברק',        lat: 32.0807, lon: 34.8338, candles: 20 },
    { id: 'beit-shemesh', name: 'בית שמש',        lat: 31.7470, lon: 34.9881, candles: 20 },
    { id: 'modiin-illit', name: 'מודיעין עילית',  lat: 31.9327, lon: 35.0436, candles: 20 },
    { id: 'beitar-illit', name: 'ביתר עילית',     lat: 31.6966, lon: 35.1167, candles: 40 },
    { id: 'elad',         name: 'אלעד',           lat: 32.0522, lon: 34.9510, candles: 20 },
    { id: 'petah-tikva',  name: 'פתח תקווה',      lat: 32.0871, lon: 34.8875, candles: 20 },
    { id: 'ashdod',       name: 'אשדוד',          lat: 31.8044, lon: 34.6553, candles: 20 },
    { id: 'netanya',      name: 'נתניה',          lat: 32.3215, lon: 34.8532, candles: 20 },
    { id: 'rehovot',      name: 'רחובות',         lat: 31.8928, lon: 34.8113, candles: 20 },
    { id: 'haifa',        name: 'חיפה',           lat: 32.7940, lon: 34.9896, candles: 30 },
    { id: 'tzfat',        name: 'צפת',            lat: 32.9646, lon: 35.4960, candles: 20 },
    { id: 'tiberias',     name: 'טבריה',          lat: 32.7922, lon: 35.5312, candles: 20 },
    { id: 'beer-sheva',   name: 'באר שבע',        lat: 31.2518, lon: 34.7913, candles: 20 }
  ];
  const DEFAULTS = { city: 'jerusalem', candles: null, shabbatMode: true, diaspora: false };

  let FMT = null;
  try { FMT = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { FMT = null; }
  const available = () => !!FMT && /Tishri|Heshvan|Nisan/.test(FMT.format(new Date(Date.UTC(2026, 8, 12, 12))));

  /* ---------- תאריך אזרחי ---------- */
  // ייצוג פנימי: חותמת זמן של 12:00 UTC ביום האזרחי (בלי תלות באזור הזמן של המחשב)
  function civil(d) {
    if (typeof d === 'number') return d;
    if (typeof d === 'string') { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd, 12); }
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  }
  // היום האזרחי בירושלים של רגע נתון (ms)
  function civilAt(ms) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
    return civil(p);
  }
  const weekday = t => new Date(t).getUTCDay();

  /* ---------- גימטריה ---------- */
  function gematria(n) {
    const L = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'],
      [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
    let s = '';
    n %= 1000;
    for (const [v, ch] of L) {
      // ט"ו / ט"ז במקום צירוף השם
      if (n === 15) { s += 'טו'; n = 0; break; }
      if (n === 16) { s += 'טז'; n = 0; break; }
      while (n >= v) { s += ch; n -= v; }
    }
    if (!s) return '';
    return s.length === 1 ? s + '׳' : s.slice(0, -1) + '״' + s.slice(-1);
  }

  /* ---------- תאריך עברי ---------- */
  function parts(t) {
    const p = FMT.formatToParts(new Date(t));
    const g = k => (p.find(x => x.type === k) || {}).value;
    return { day: +g('day'), month: g('month'), year: +g('year') };
  }
  const isAdar = m => m === 'Adar' || m === 'Adar II';

  function hebrewDate(d) {
    if (!available()) return null;
    const t = civil(d);
    const p = parts(t);
    const monthName = MONTHS[p.month] || p.month;
    return {
      day: p.day, month: p.month, year: p.year, monthName, weekday: weekday(t),
      text: `${gematria(p.day)} ${'ב' + monthName} ${gematria(p.year)}`,
      short: `${gematria(p.day)} ${monthName}`
    };
  }

  /* ---------- חגים, צומות ומועדים ---------- */
  function yomTovName(p, diaspora) {
    const { month: m, day: d } = p;
    if (m === 'Tishri') {
      if (d === 1 || d === 2) return 'ראש השנה';
      if (d === 10) return 'יום הכיפורים';
      if (d === 15) return 'סוכות';
      if (d === 16 && diaspora) return 'סוכות (יום שני)';
      if (d === 22) return diaspora ? 'שמיני עצרת' : 'שמיני עצרת ושמחת תורה';
      if (d === 23 && diaspora) return 'שמחת תורה';
    }
    if (m === 'Nisan') {
      if (d === 15) return 'פסח';
      if (d === 16 && diaspora) return 'פסח (יום שני)';
      if (d === 21) return 'שביעי של פסח';
      if (d === 22 && diaspora) return 'אחרון של פסח';
    }
    if (m === 'Sivan') {
      if (d === 6) return 'שבועות';
      if (d === 7 && diaspora) return 'שבועות (יום שני)';
    }
    return null;
  }

  // רשימת מועדים ליום אזרחי: [{ name, kind: 'yomtov'|'fast'|'holiday'|'rosh-chodesh'|'erev'|'chol-hamoed'|'info' }]
  function holidays(d, opts = {}) {
    if (!available()) return [];
    const diaspora = !!opts.diaspora;
    const t = civil(d);
    const p = parts(t);
    const wd = weekday(t);
    const { month: m, day: dd } = p;
    const out = [];
    const add = (name, kind) => out.push({ name, kind });

    const yt = yomTovName(p, diaspora);
    if (yt) add(yt, 'yomtov');

    // ראש חודש: יום ל׳ של החודש הקודם ויום א׳ (חוץ מתשרי)
    if (dd === 30) add('ראש חודש ' + (MONTHS[parts(t + DAY).month] || ''), 'rosh-chodesh');
    if (dd === 1 && m !== 'Tishri') add('ראש חודש ' + (MONTHS[m] || ''), 'rosh-chodesh');

    // חול המועד והושענא רבה
    if (m === 'Tishri' && dd >= (diaspora ? 17 : 16) && dd <= 20) add('חול המועד סוכות', 'chol-hamoed');
    if (m === 'Tishri' && dd === 21) add('הושענא רבה', 'chol-hamoed');
    if (m === 'Nisan' && dd >= (diaspora ? 17 : 16) && dd <= 20) add('חול המועד פסח', 'chol-hamoed');

    // ערבי חג
    if (m === 'Elul' && dd === 29) add('ערב ראש השנה', 'erev');
    if (m === 'Tishri' && dd === 9) add('ערב יום הכיפורים', 'erev');
    if (m === 'Tishri' && dd === 14) add('ערב סוכות', 'erev');
    if (m === 'Nisan' && dd === 14) add('ערב פסח', 'erev');
    if (m === 'Sivan' && dd === 5) add('ערב שבועות', 'erev');

    // צומות, כולל דחייה כשהם חלים בשבת
    if (m === 'Tishri' && ((dd === 3 && wd !== 6) || (dd === 4 && wd === 0))) add('צום גדליה', 'fast');
    if (m === 'Tevet' && dd === 10) add('עשרה בטבת', 'fast');
    if (isAdar(m) && ((dd === 13 && wd !== 6) || (dd === 11 && wd === 4))) add('תענית אסתר', 'fast');
    if (m === 'Tamuz' && ((dd === 17 && wd !== 6) || (dd === 18 && wd === 0))) add('שבעה עשר בתמוז', 'fast');
    if (m === 'Av' && ((dd === 9 && wd !== 6) || (dd === 10 && wd === 0))) add('תשעה באב', 'fast');

    // חנוכה: מכ״ה בכסלו, שמונה ימים (כסלו יכול להיות 29 או 30 יום)
    let chanuka = 0;
    if (m === 'Kislev' && dd >= 25) chanuka = dd - 24;
    if (m === 'Tevet') chanuka = parts(t - dd * DAY).day - 24 + dd;
    if (chanuka >= 1 && chanuka <= 8) add('חנוכה — נר ' + gematria(chanuka), 'holiday');

    if (m === 'Shevat' && dd === 15) add('ט״ו בשבט', 'holiday');
    if (m === 'Adar I' && dd === 14) add('פורים קטן', 'holiday');
    if (isAdar(m) && dd === 14) add('פורים', 'holiday');
    if (isAdar(m) && dd === 15) add('שושן פורים', 'holiday');
    if (m === 'Iyar' && dd === 18) add('ל״ג בעומר', 'holiday');
    if (m === 'Av' && dd === 15) add('ט״ו באב', 'holiday');

    // ספירת העומר (לפי היום העברי)
    let omer = 0;
    if (m === 'Nisan' && dd >= 16) omer = dd - 15;
    if (m === 'Iyar') omer = 15 + dd;
    if (m === 'Sivan' && dd <= 5) omer = 44 + dd;
    if (omer) add('היום ' + gematria(omer) + ' לעומר', 'info');

    return out;
  }

  function isYomTov(d, opts = {}) {
    if (!available()) return false;
    return !!yomTovName(parts(civil(d)), !!opts.diaspora);
  }
  // יום שאסור בו במלאכה: שבת או יום טוב
  function isHoly(d, opts) { return weekday(civil(d)) === 6 || isYomTov(d, opts); }

  /* ---------- זמני השמש ---------- */
  const rad = x => x * Math.PI / 180;
  const deg = x => x * 180 / Math.PI;
  // משוואת הזריחה: מחזיר [זריחה, שקיעה] ב-ms (UTC) עבור זווית השמש alt (במעלות; שלילי = מתחת לאופק)
  function sunAt(d, lat, lon, alt) {
    const t = civil(d);
    const jd = t / DAY + 2440587.5;
    const n = Math.round(jd - 2451545.0 + 0.0008);
    const Jstar = n - lon / 360;
    const M = (357.5291 + 0.98560028 * Jstar) % 360;
    const C = 1.9148 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 0.0003 * Math.sin(rad(3 * M));
    const lambda = (M + C + 180 + 102.9372) % 360;
    const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(rad(M)) - 0.0069 * Math.sin(rad(2 * lambda));
    const sinDec = Math.sin(rad(lambda)) * Math.sin(rad(23.4397));
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosW = (Math.sin(rad(alt)) - Math.sin(rad(lat)) * sinDec) / (Math.cos(rad(lat)) * cosDec);
    if (cosW < -1 || cosW > 1) return [NaN, NaN];
    const w = deg(Math.acos(cosW));
    const toMs = J => Math.round((J - 2440587.5) * DAY);
    return [toMs(Jtransit - w / 360), toMs(Jtransit + w / 360)];
  }

  function resolveSettings(s = {}) {
    const merged = { ...DEFAULTS, ...s };
    const city = CITIES.find(c => c.id === merged.city) || CITIES[0];
    const candles = Number.isInteger(merged.candles) && merged.candles >= 0 && merged.candles <= 60 ? merged.candles : city.candles;
    return { ...merged, city: city.id, cityObj: city, candles };
  }

  // זמני היום: זריחה, שקיעה, הדלקת נרות, צאת הכוכבים (8.5°) וצאת לפי רבנו תם (72 דקות אחרי השקיעה)
  function zmanim(d, settings) {
    const s = resolveSettings(settings);
    const { lat, lon } = s.cityObj;
    const [sunrise, sunset] = sunAt(d, lat, lon, -0.833);
    const [, tzeit] = sunAt(d, lat, lon, -8.5);
    return { sunrise, sunset, candles: sunset - s.candles * 60000, tzeit, tzeitRT: sunset + 72 * 60000 };
  }

  /* ---------- שבת ויום טוב ---------- */
  // שם הקדושה של יום: "שבת קודש", שם החג, או שניהם
  function holyName(d, opts) {
    const t = civil(d);
    const yt = isAvailableYT(t, opts);
    if (weekday(t) === 6) return yt ? 'שבת ו' + yt : 'שבת קודש';
    return yt || '';
  }
  function isAvailableYT(t, opts) { return available() ? yomTovName(parts(t), !!(opts && opts.diaspora)) : null; }

  // סוף רצף ימי קדושה שמתחיל ב-t: צאת (המאוחר מבין 8.5° ורבנו תם) של היום האחרון
  function holyEnd(t, s) {
    let last = t;
    while (isHoly(last + DAY, s)) last += DAY;
    const z = zmanim(last, s);
    return Math.max(z.tzeit, z.tzeitRT);
  }

  // האם עכשיו שבת או יום טוב: מהדלקת הנרות בערב ועד הצאת המאוחר במוצאי היום
  function shabbatStatus(nowMs, settings) {
    const s = resolveSettings(settings);
    const today = civilAt(nowMs);
    const zt = zmanim(today, s);
    let start = null;
    if (isHoly(today, s) && nowMs < Math.max(zt.tzeit, zt.tzeitRT)) start = today;
    else if (isHoly(today + DAY, s) && nowMs >= zt.candles) start = today + DAY;
    else if (isHoly(today, s) && isHoly(today + DAY, s)) start = today + DAY; // בין יום טוב לשבת שאחריו
    if (start === null) return { active: false };
    return { active: true, name: holyName(start, s), endsAt: holyEnd(start, s) };
  }

  // השבת/החג הקרובים: זמן הדלקת נרות וזמני צאת
  function nextHoly(nowMs, settings) {
    const s = resolveSettings(settings);
    let t = civilAt(nowMs);
    for (let i = 0; i < 40; i++, t += DAY) {
      if (isHoly(t, s) || !isHoly(t + DAY, s)) continue;
      const z = zmanim(t, s);
      if (z.candles < nowMs - 36 * 3600000) continue;
      let last = t + DAY;
      while (isHoly(last + DAY, s)) last += DAY;
      const ze = zmanim(last, s);
      return { erev: t, candles: z.candles, name: holyName(t + DAY, s), endDay: last, tzeit: ze.tzeit, tzeitRT: ze.tzeitRT };
    }
    return null;
  }

  // היום העברי מתחלף בשקיעה: אחרי השקיעה מציגים את התאריך של מחר ("אור ל...")
  function hebrewToday(nowMs, settings) {
    const s = resolveSettings(settings);
    const today = civilAt(nowMs);
    const z = zmanim(today, s);
    const night = nowMs >= z.sunset;
    const h = hebrewDate(night ? today + DAY : today);
    return h ? { ...h, night } : null;
  }

  function formatTime(ms) {
    if (!Number.isFinite(ms)) return '—';
    return new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(new Date(ms));
  }

  const api = {
    CITIES, DEFAULTS, WEEKDAYS, available, civil, civilAt, gematria, hebrewDate, hebrewToday, holidays,
    isYomTov, isHoly, zmanim, shabbatStatus, nextHoly, resolveSettings, formatTime
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUITE_HEBCAL = api;
})(typeof window !== 'undefined' ? window : this);
