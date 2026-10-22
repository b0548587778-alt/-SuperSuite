// שמאי — מחירי ייחוס בלי אינטרנט (PLAN.md 9.9). חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד).
'use strict';
// לכל מחיר נשמרים התאריך שלו והמקור (הזנה ידנית / קובץ מחירים), ומחושב "בן כמה ימים".
// אין פנייה לרשת — מחירון מגיע מהמשתמש (הקלדה או קובץ שהוא הוריד/קיבל).

// השדות שאפשר לעדכן. unit לתצוגה; max — הגנה מהקלדה שגויה (למשל מחיר לגרם במקום לאונקיה)
const PRICE_FIELDS = [
  { k: 'gold', name: 'זהב', unit: '$ לאונקיה', min: 500, max: 50000, aliases: ['gold', 'xau', 'au', 'זהב'] },
  { k: 'silver', name: 'כסף', unit: '$ לאונקיה', min: 1, max: 1000, aliases: ['silver', 'xag', 'ag', 'כסף'] },
  { k: 'platinum', name: 'פלטינה', unit: '$ לאונקיה', min: 50, max: 20000, aliases: ['platinum', 'xpt', 'pt', 'פלטינה'] },
  { k: 'palladium', name: 'פלדיום', unit: '$ לאונקיה', min: 50, max: 20000, aliases: ['palladium', 'xpd', 'pd', 'פלדיום'] },
  { k: 'usdIls', name: 'דולר', unit: '₪ לדולר', min: 1, max: 10, aliases: ['usdils', 'usd', 'דולר', 'usd/ils'] },
  { k: 'eurIls', name: 'אירו', unit: '₪ לאירו', min: 1, max: 10, aliases: ['eurils', 'eur', 'אירו', 'eur/ils'] },
  { k: 'gbpIls', name: 'לירה שטרלינג', unit: '₪ לליש״ט', min: 1, max: 12, aliases: ['gbpils', 'gbp', 'ליש״ט', 'לישט', 'לירה', 'gbp/ils'] },
  { k: 'copper', name: 'נחושת', unit: '$ לליברה', min: 0.1, max: 50, aliases: ['copper', 'נחושת'] },
  { k: 'aluminum', name: 'אלומיניום', unit: '$ לליברה', min: 0.05, max: 20, aliases: ['aluminum', 'aluminium', 'אלומיניום'] }
];
// מחירים שמשפיעים ישירות על שמאות זהב ותכשיטים — עליהם מוצגת התזכורת
const KEY_PRICES = ['gold', 'silver', 'usdIls'];
// סף "ישן": מתכות ושער משתנים כל יום — אחרי יומיים כדאי לעדכן, אחרי שבוע זו אזהרה
const PRICE_STALE_DAYS = 2;
const PRICE_OLD_DAYS = 7;
const PRICE_SOURCES = { manual: 'הזנה ידנית', file: 'קובץ מחירים', default: 'ערך ייחוס קבוע' };
const MAX_PRICE_FILE = 64 * 1024;

// תאריך אמיתי בלבד (Date.parse מקבל גם 30 בפברואר)
const isDay = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
// היום לפי השעון המקומי (לא toISOString — בישראל הוא מזיז את היום בין חצות ל-03:00)
function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
const dayDiff = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

// תאריך המחיר: מהרשומה לכל מחיר, ואם אין — מעדכון המחירים הכללי (נתונים מגרסה קודמת)
function priceDateOf(prices, k) {
  const meta = prices && prices.meta && prices.meta[k];
  if (meta && isDay(meta.date)) return meta.date;
  if (prices && prices.lastUpdate && prices.source !== 'default') {
    const d = new Date(prices.lastUpdate);
    if (!Number.isNaN(d.getTime())) return localToday(d);
  }
  return null;
}

// מצב מחיר: fresh / stale / old / unknown (אין תאריך = ערך ייחוס שלא עודכן מעולם)
function priceFreshness(prices, k, today = localToday()) {
  const date = priceDateOf(prices, k);
  const meta = (prices && prices.meta && prices.meta[k]) || {};
  if (!date) return { k, date: null, days: null, state: 'unknown', source: 'default', note: '' };
  const days = Math.max(0, dayDiff(date, today));
  const state = days >= PRICE_OLD_DAYS ? 'old' : days >= PRICE_STALE_DAYS ? 'stale' : 'fresh';
  return { k, date, days, state, source: meta.source || (prices.source === 'manual' ? 'manual' : 'default'), note: meta.note || '' };
}

function priceAgeLabel(f) {
  if (!f || f.days === null) return 'לא עודכן — ערך ייחוס קבוע';
  if (f.days === 0) return 'עודכן היום';
  if (f.days === 1) return 'בן יום אחד';
  return `בן ${f.days} ימים`;
}

// המצב הכולל של המחירים החשובים: הגרוע מביניהם קובע
function priceSummary(prices, today = localToday()) {
  const order = { fresh: 0, stale: 1, old: 2, unknown: 3 };
  const list = KEY_PRICES.map(k => priceFreshness(prices, k, today));
  const worst = list.reduce((w, f) => (order[f.state] > order[w.state] ? f : w), list[0]);
  return { state: worst.state, worst, list };
}

// אימות ערך אחד: מספר חיובי בטווח הסביר לשדה
function checkPrice(k, raw) {
  const field = PRICE_FIELDS.find(f => f.k === k);
  if (!field) throw new Error('שדה מחיר לא מוכר');
  const s = normalizeNumText(raw);
  if (s === null) throw new Error(`${field.name}: יש להזין מספר`);
  const v = Number(s);
  if (!(v >= field.min && v <= field.max)) throw new Error(`${field.name}: ${v} מחוץ לטווח הסביר (${field.min}–${field.max} ${field.unit})`);
  return v;
}

// מחירים מגיבוי (QR / קובץ) — כל מחיר דרך applyPriceUpdate: בדיקת טווח, ותאריך מהגיבוי רק אם הוא תקין ולא עתידי.
// פעם המחירים נכתבו כמו שהם, כולל "עודכן היום" מזויף (בדיקת קוד 23.10.2026). מחזיר { prices, changed, skipped }
function restorePrices(prices, incoming, { today = localToday() } = {}) {
  let next = prices;
  const changed = [], skipped = [];
  const meta = (incoming && incoming.meta) || {};
  for (const f of PRICE_FIELDS) {
    const raw = incoming && incoming[f.k];
    if (raw === undefined || raw === null || raw === '') continue;
    const d = meta[f.k] && meta[f.k].date;
    try {
      const r = applyPriceUpdate(next, { [f.k]: raw }, { date: isDay(d) && d <= today ? d : today, source: 'file', note: 'שחזור מגיבוי', today });
      next = r.prices;
      changed.push(...r.changed);
    } catch { skipped.push(f.k); }
  }
  return { prices: next, changed, skipped };
}

// עדכון מחירים: מחזיר עותק חדש עם הערך, התאריך והמקור של כל מחיר שעודכן. תאריך עתידי נדחה
function applyPriceUpdate(prices, values, { date, source = 'manual', note = '', today = localToday() } = {}) {
  const day = date || today;
  if (!isDay(day)) throw new Error('תאריך המחירים אינו תקין');
  if (day > today) throw new Error('תאריך המחירים אחרי היום');
  if (!PRICE_SOURCES[source]) throw new Error('מקור מחירים לא מוכר');
  const entries = Object.entries(values || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined);
  if (!entries.length) throw new Error('יש להזין מחיר אחד לפחות');
  const next = { ...prices, meta: { ...((prices && prices.meta) || {}) } };
  const changed = [];
  for (const [k, raw] of entries) {
    const v = checkPrice(k, raw);
    const prev = next.meta[k];
    // מחיר ישן יותר מזה שכבר שמור לא דורס אותו
    if (prev && isDay(prev.date) && prev.date > day) continue;
    next[k] = v;
    next.meta[k] = { date: day, source, ...(note ? { note: String(note).slice(0, 80) } : {}) };
    changed.push(k);
  }
  if (changed.length) {
    next.lastUpdate = new Date().toISOString();
    next.source = source;
  }
  return { prices: next, changed };
}

// קובץ מחירים: JSON ({ date, source?, prices: { gold: 4650, ... } } או שטוח) או CSV/טקסט ("זהב,4650" בכל שורה, "תאריך,2026-10-19")
function parsePriceFile(text) {
  const raw = String(text || '').replace(/^﻿/, '');
  if (!raw.trim()) throw new Error('הקובץ ריק');
  if (raw.length > MAX_PRICE_FILE) throw new Error('הקובץ גדול מדי לקובץ מחירים');
  const keyOf = (name) => {
    const n = String(name || '').trim().toLowerCase().replace(/["']/g, '');
    const f = PRICE_FIELDS.find(x => x.k.toLowerCase() === n || x.aliases.includes(n));
    return f ? f.k : null;
  };
  const toDay = (v) => {
    const s = String(v || '').trim();
    if (isDay(s)) return s;
    const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
  };
  const values = {}, unknown = [];
  let date = null, note = '';
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    let data;
    try { data = JSON.parse(trimmed); } catch (e) { throw new Error('קובץ ה-JSON אינו תקין'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('מבנה הקובץ אינו מוכר');
    date = data.date != null ? toDay(data.date) : null;
    if (data.date != null && !date) throw new Error('התאריך בקובץ אינו תקין');
    note = typeof data.source === 'string' ? data.source : '';
    const body = data.prices && typeof data.prices === 'object' ? data.prices : data;
    for (const [name, v] of Object.entries(body)) {
      if (['date', 'source', 'prices'].includes(name)) continue;
      const k = keyOf(name);
      if (k) values[k] = v; else unknown.push(name);
    }
  } else {
    for (const line of raw.split(/\r?\n/)) {
      // גרשיים סביב תא (ייצוא מאקסל) — מוסרים
      const cells = line.split(/[,;\t]/).map(c => c.trim().replace(/^"(.*)"$/, '$1').trim()).filter(Boolean);
      if (cells.length < 2) continue;
      const [name, v] = cells;
      if (/^(date|תאריך)$/i.test(name)) {
        date = toDay(v);
        if (!date) throw new Error('התאריך בקובץ אינו תקין');
        continue;
      }
      if (/^(source|מקור)$/i.test(name)) { note = v; continue; }
      const k = keyOf(name);
      if (k) values[k] = v; else if (!/^(name|שם|מחיר|price)$/i.test(name)) unknown.push(name);
    }
  }
  if (!Object.keys(values).length) throw new Error('לא נמצאו מחירים מוכרים בקובץ (זהב, כסף, דולר...)');
  // בדיקה מוקדמת של כל ערך — קובץ עם ערך שגוי לא נקלט בכלל
  for (const [k, v] of Object.entries(values)) checkPrice(k, v);
  return { date, note: String(note || '').slice(0, 80), values, unknown };
}

// ─────────────────────────────────────────────────────────────────────────────
//  ממשק: לוח עדכון המחירים, שורת המצב והתזכורת
// ─────────────────────────────────────────────────────────────────────────────

const PRICE_STATE_CLASS = { fresh: 'ok', stale: 'warn', old: 'bad', unknown: 'bad' };

// שורה קצרה לכותרת / לבאנר: "זהב: בן 3 ימים" — לפי המחיר הכי ישן מבין החשובים
function priceStatusText(prices, today = localToday()) {
  const s = priceSummary(prices, today);
  if (s.state === 'fresh') return { cls: 'ok', text: `מחירים מ-${shortDay(s.worst.date)}` };
  const name = PRICE_FIELDS.find(f => f.k === s.worst.k).name;
  return { cls: PRICE_STATE_CLASS[s.state], text: `${name}: ${priceAgeLabel(s.worst)}` };
}
const shortDay = (d) => (d ? `${Number(d.slice(8))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}` : '');

// תזכורת למסך הבית ולרשימת התזכורות, או null כשהמחירים עדכניים
function priceReminder(prices, today = localToday()) {
  const s = priceSummary(prices, today);
  if (s.state === 'fresh') return null;
  const names = s.list.filter(f => f.state !== 'fresh').map(f => PRICE_FIELDS.find(x => x.k === f.k).name);
  if (s.state === 'unknown') return { title: 'מחירי הזהב והכסף לא עודכנו', sub: `${names.join(', ')} — ערכי ייחוס קבועים. עדכנו לפני שמאות`, cls: 'bad' };
  return { title: `המחיר בן ${s.worst.days} ימים`, sub: `${names.join(', ')} — כדאי לעדכן לפני שמאות`, cls: PRICE_STATE_CLASS[s.state] };
}

function renderPricePanel() {
  const list = $('#pp-list'), form = $('#pp-form');
  if (!list || !form) return;
  const today = localToday();
  list.innerHTML = PRICE_FIELDS.map(f => {
    const fr = priceFreshness(state.prices, f.k, today);
    return `<div class="pp-row ${PRICE_STATE_CLASS[fr.state]}">
      <span class="pp-name">${escapeHtml(f.name)}</span>
      <span class="pp-val">${fmt(state.prices[f.k], /Ils$/.test(f.k) ? 3 : 2)} <small>${escapeHtml(f.unit)}</small></span>
      <span class="pp-age">${escapeHtml(priceAgeLabel(fr))}${fr.date ? ` · ${shortDay(fr.date)}` : ''}${fr.source !== 'default' ? ` · ${escapeHtml(PRICE_SOURCES[fr.source] || '')}` : ''}${fr.note ? ` (${escapeHtml(fr.note)})` : ''}</span>
    </div>`;
  }).join('');
  form.innerHTML = PRICE_FIELDS.map(f => `<label>${escapeHtml(f.name)} <small>${escapeHtml(f.unit)}</small>
    <input type="text" inputmode="decimal" id="pp-${f.k}" autocomplete="off" placeholder="${fmt(state.prices[f.k], /Ils$/.test(f.k) ? 3 : 2)}" /></label>`).join('');
  const date = $('#pp-date');
  if (date) { date.max = today; if (!date.value) date.value = today; }
}

function storePrices(prices, changed, how) {
  state.prices = prices;
  Storage.save('prices', state.prices);
  renderHeader();
  renderDashboard();
  renderPricePanel();
  if (typeof injectLivePriceBanners === 'function') injectLivePriceBanners();
  const names = changed.map(k => PRICE_FIELDS.find(f => f.k === k).name).join(', ');
  toast(changed.length ? `${how}: ${names} ✓` : 'לא עודכן דבר — המחירים השמורים חדשים יותר', changed.length ? 'success' : 'info');
}

function savePriceForm() {
  const values = {};
  for (const f of PRICE_FIELDS) {
    const v = ($('#pp-' + f.k)?.value || '').trim();
    if (v) values[f.k] = v;
  }
  try {
    const { prices, changed } = applyPriceUpdate(state.prices, values, { date: $('#pp-date')?.value || undefined, source: 'manual', note: $('#pp-note')?.value || '' });
    storePrices(prices, changed, 'המחירים נשמרו');
    const note = $('#pp-note'); if (note) note.value = '';
  } catch (e) {
    toast(e.message, 'error');
  }
}

// קובץ מחירים מהמחשב: נקרא מקומית (FileReader), בלי רשת. תאריך מהקובץ גובר על השדה; בלי תאריך — מאשרים את תאריך השדה
async function importPriceFile(file) {
  if (!file) return;
  try {
    if (file.size > MAX_PRICE_FILE) throw new Error('הקובץ גדול מדי לקובץ מחירים');
    const text = await file.text();
    const parsed = parsePriceFile(text);
    const date = parsed.date || $('#pp-date')?.value || localToday();
    const names = Object.keys(parsed.values).map(k => PRICE_FIELDS.find(f => f.k === k).name).join(', ');
    const extra = parsed.unknown.length ? `\nשורות שלא זוהו ידולגו: ${parsed.unknown.slice(0, 5).join(', ')}` : '';
    if (!(await ssDialog.confirm(`לעדכן ${names} לפי הקובץ, בתאריך ${shortDay(date)}${parsed.date ? '' : ' (אין תאריך בקובץ)'}?${extra}`))) return;
    const { prices, changed } = applyPriceUpdate(state.prices, parsed.values, { date, source: 'file', note: parsed.note || file.name });
    storePrices(prices, changed, 'נטען מהקובץ');
  } catch (e) {
    toast('הקובץ לא נקלט: ' + e.message, 'error');
  }
}

function attachPricePanel() {
  $('#btn-save-manual')?.addEventListener('click', savePriceForm);
  $('#btn-price-file')?.addEventListener('click', () => $('#price-file')?.click());
  $('#price-file')?.addEventListener('change', (e) => { importPriceFile(e.target.files && e.target.files[0]); e.target.value = ''; });
  $('#price-panel')?.addEventListener('toggle', renderPricePanel);
}
