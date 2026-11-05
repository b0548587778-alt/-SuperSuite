// שמאי — תאריך עברי, קלט קולי, סנכרון מכשירים והגדרות. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  HEBREW DATE - using simple algorithm (Noda Time-style for Heb cal)
// ─────────────────────────────────────────────────────────────────────────────

const HEB_MONTHS = ['ניסן','אייר','סיון','תמוז','אב','אלול','תשרי','חשון','כסלו','טבת','שבט','אדר','אדר ב\''];
const HEB_DAYS = ['יום ראשון','יום שני','יום שלישי','יום רביעי','יום חמישי','יום שישי','שבת'];

function getHebrewDate() {
  // Use Intl.DateTimeFormat with hebrew calendar - more accurate than manual calc
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    const heb = fmt.format(now);
    const dayName = HEB_DAYS[now.getDay()];
    return `${dayName} · ${heb}`;
  } catch (e) {
    return new Date().toLocaleDateString('he-IL');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PULL-TO-REFRESH
// ─────────────────────────────────────────────────────────────────────────────

function setupPullToRefresh() {
  let startY = 0, currentY = 0, pulling = false;
  const indicator = document.createElement('div');
  indicator.className = 'ptr-indicator';
  indicator.textContent = '↓ משוך לרענון';
  document.body.appendChild(indicator);

  const main = document.querySelector('.main');
  if (!main) return;

  document.addEventListener('touchstart', (e) => {
    if (window.scrollY > 0) return;
    if (state.view !== 'dashboard') return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    currentY = e.touches[0].clientY;
    const distance = currentY - startY;
    if (distance > 0 && distance < 200) {
      indicator.classList.add('visible');
      indicator.textContent = distance > 80 ? '↻ שחרר לרענון' : '↓ משוך לרענון';
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!pulling) return;
    const distance = currentY - startY;
    indicator.classList.remove('visible');
    if (distance > 80) {
      indicator.textContent = '↻ מרענן...';
      indicator.classList.add('visible');
      // אין מקור מחירים ברשת — רענון התצוגה בלבד
      renderHeader();
      renderDashboard();
      setTimeout(() => indicator.classList.remove('visible'), 800);
    }
    pulling = false;
    startY = 0;
    currentY = 0;
  }, { passive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
//  VOICE INPUT
// ─────────────────────────────────────────────────────────────────────────────

// הקלדה בקול — רק ההכתבה של מערכת ההפעלה (Windows: Win+H; טלפון: המיקרופון במקלדת), שמקלידה לתוך כל שדה.
// זיהוי הדיבור שמובנה בדפדפן שולח את הקול לשרת חיצוני — אסור (כלל ברזל 6: אפס רשת) ולא עובד במחשב מסונן,
// ולכן הוסר (סבב 5, תיבת הפקודה). הפונקציה נשארת כי navigation.js קורא לה
function setupVoiceInput() {}


// ─────────────────────────────────────────────────────────────────────────────
//  DEVICE SYNC - העברת פריטי הפנקס ב-QR (לא גיבוי: בלי תיקים, שטרות, מספור ותמונות)
// ─────────────────────────────────────────────────────────────────────────────

async function generateBackupQR() {
  const container = $('#qr-container');
  if (!container) return;

  // Compress all data
  const data = {
    v: '3.0',
    t: Date.now(),
    opps: state.opportunities,
    prices: state.prices,
  };
  const jsonStr = JSON.stringify(data);
  const compressed = LZString.compressToEncodedURIComponent(jsonStr);

  // Calculate size
  const sizeKB = (compressed.length / 1024).toFixed(1);

  // QR code can hold ~2900 chars at version 40 with low correction
  if (compressed.length > 2800) {
    container.hidden = false;
    container.innerHTML = `
      <div class="qr-warning">
        ⚠️ הנתונים גדולים מדי ל-QR יחיד (${sizeKB}KB).
        <br>השתמש ב"ייצוא פריטי הפנקס (JSON)" בהגדרות במקום.
      </div>
    `;
    return;
  }

  try {
    const qr = qrcode(0, 'L'); // auto version, low error correction = max capacity
    qr.addData(compressed);
    qr.make();

    const cellSize = 6;
    const margin = 12;
    const moduleCount = qr.getModuleCount();
    const size = moduleCount * cellSize + margin * 2;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`;
    svg += `<rect width="${size}" height="${size}" fill="white"/>`;
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          svg += `<rect x="${c * cellSize + margin}" y="${r * cellSize + margin}" width="${cellSize}" height="${cellSize}" fill="black"/>`;
        }
      }
    }
    svg += '</svg>';

    container.hidden = false;
    container.innerHTML = `
      <div class="qr-display">
        <div class="qr-title">סרוק את הקוד עם המכשיר השני</div>
        <div class="qr-code">${svg}</div>
        <div class="qr-info">
          📦 ${state.opportunities.length} פריטים · ${sizeKB}KB דחוס
        </div>
        <button class="btn-ghost" id="qr-close">סגור</button>
      </div>
    `;
    $('#qr-close')?.addEventListener('click', () => {
      container.hidden = true;
      container.innerHTML = '';
    });
  } catch (e) {
    container.hidden = false;
    container.innerHTML = `<div class="qr-warning">שגיאה ביצירת QR: ${escapeHtml(e && e.message)}</div>`;
  }
}

async function scanBackupQR() {
  const container = $('#qr-container');
  if (!container) return;

  // Check if BarcodeDetector is supported
  if (!('BarcodeDetector' in window)) {
    // Fallback: paste manually
    container.hidden = false;
    container.innerHTML = `
      <div class="qr-scanner">
        <div class="qr-title">⚠️ סריקה אוטומטית לא נתמכת בדפדפן זה</div>
        <p class="text-faint">הדבק את הטקסט מה-QR כאן:</p>
        <textarea id="qr-paste" rows="4" placeholder="הדבק את הקוד..."></textarea>
        <button class="btn-primary" id="qr-paste-go">קליטת הפריטים</button>
        <button class="btn-ghost" id="qr-paste-close">בטל</button>
      </div>
    `;
    $('#qr-paste-go')?.addEventListener('click', () => {
      const code = $('#qr-paste').value.trim();
      if (code) restoreFromCode(code);
    });
    $('#qr-paste-close')?.addEventListener('click', () => {
      container.hidden = true;
      container.innerHTML = '';
    });
    return;
  }

  // Use camera + BarcodeDetector
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });

    container.hidden = false;
    container.innerHTML = `
      <div class="qr-scanner">
        <div class="qr-title">כוון את המצלמה אל קוד ה-QR</div>
        <video id="qr-video" autoplay playsinline></video>
        <button class="btn-ghost" id="qr-stop">בטל</button>
      </div>
    `;

    const video = $('#qr-video');
    video.srcObject = stream;
    await video.play();

    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    let scanning = true;

    const stopScan = () => {
      scanning = false;
      stream.getTracks().forEach(t => t.stop());
      container.hidden = true;
      container.innerHTML = '';
    };

    $('#qr-stop')?.addEventListener('click', stopScan);

    const tick = async () => {
      if (!scanning) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          stopScan();
          restoreFromCode(codes[0].rawValue);
          return;
        }
      } catch (e) {}
      requestAnimationFrame(tick);
    };
    tick();
  } catch (e) {
    container.hidden = false;
    container.innerHTML = `
      <div class="qr-warning">
        לא ניתן לגשת למצלמה: ${escapeHtml(e && e.message)}
        <br><br>
        אפשרויות חלופיות:
        <br>• "ייבוא פריטים מקובץ JSON" בהגדרות
        <br>• הגיבוי המוצפן של התוכנה (מסך הבית)
      </div>
    `;
  }
}

async function restoreFromCode(code) {
  try {
    const decompressed = LZString.decompressFromEncodedURIComponent(code);
    if (!decompressed) throw new Error('פענוח נכשל');
    const data = JSON.parse(decompressed);
    if (!data || !Array.isArray(data.opps)) throw new Error('פורמט לא תקין');
    // כל פריט נבדק לפני השמירה (sanitizeOpportunities ב-ledger.js): פעם {"opps":[null]} נשמר כמו שהוא,
    // וכל עלייה של המודול נפלה לפני חיבור הכפתורים (בדיקת קוד 23.10.2026, ממצא 18)
    const { items, skipped } = sanitizeOpportunities(data.opps);
    if (!items.length) throw new Error('אין בקוד פריטים תקינים');
    if (!(await ssDialog.confirm(`לטעון ${items.length} פריטים?${skipped ? ` (${skipped} פגומים או כפולים ידולגו)` : ''} פעולה זו תחליף את הנתונים הנוכחיים.`, { danger: true }))) return;
    const before = state.opportunities;
    state.opportunities = items;
    // שמירה שנדחתה — הפנקס חוזר למה שהיה (ההודעה — מ-Storage.save)
    if (!Storage.save('opportunities', state.opportunities)) { state.opportunities = before; return; }
    // מספור הדוחות ממשיך מעל המספרים המיובאים, ותמונות הפריטים שהוחלפו נמחקות (סקירת קוד 2.11.2026)
    bumpReportSeqFrom(state.opportunities);
    dropReplacedPhotos(before, state.opportunities);
    // מחירים — רק דרך prices.js (בדיקת טווח ותאריך), לא כתיבה ישירה מהגיבוי
    if (data.prices && typeof data.prices === 'object') state.prices = restorePrices(state.prices, data.prices).prices;
    Storage.save('prices', state.prices);
    renderHeader();
    renderDashboard();
    toast(`✓ שוחזרו ${items.length} פריטים`, 'success');
    $('#qr-container').hidden = true;
    $('#qr-container').innerHTML = '';
  } catch (e) {
    // שגיאת פענוח של JSON — באנגלית; למשתמש רק הודעה בעברית
    const msg = e && typeof e.message === 'string' && /[֐-׿]/.test(e.message) ? e.message : 'הקוד אינו תקין';
    toast('שחזור נכשל: ' + msg, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CLOUD SYNC - הוסר (אופליין)
// ─────────────────────────────────────────────────────────────────────────────

// סנכרון ענן הוסר: האפליקציה פועלת אופליין. לגיבוי השתמש בקובץ JSON מוצפן.
async function uploadToCloud() {
  const status = $('#cloud-status');
  if (status) status.textContent = 'סנכרון ענן כבוי — השתמש בגיבוי המוצפן של התוכנה (מסך הבית)';
}

async function downloadFromCloud() {
  const status = $('#cloud-status');
  if (status) status.textContent = 'סנכרון ענן כבוי — השחזור דרך הגיבוי המוצפן של התוכנה (מסך הבית)';
}

// ─────────────────────────────────────────────────────────────────────────────
//  SETTINGS STATS - show usage info
// ─────────────────────────────────────────────────────────────────────────────

function renderSettingsStats() {
  const el = $('#settings-stats');
  if (!el) return;
  const opps = state.opportunities;
  const totalSize = JSON.stringify({ opps, prices: state.prices }).length;
  const photos = opps.filter(o => o.photo || o.hasPhoto).length;
  const lastUpdate = state.prices.lastUpdate
    ? new Date(state.prices.lastUpdate).toLocaleString('he-IL')
    : 'לא עודכן';

  el.innerHTML = `
    <div class="r-row"><span class="r-label">סה"כ פריטים</span><span class="r-value">${opps.length}</span></div>
    <div class="r-row"><span class="r-label">פריטים עם תמונה</span><span class="r-value">${photos}</span></div>
    <div class="r-row"><span class="r-label">גודל נתונים</span><span class="r-value">${(totalSize/1024).toFixed(1)} KB</span></div>
    <div class="r-row"><span class="r-label">עדכון מחירים אחרון</span><span class="r-value text-faint" style="font-size:11px">${lastUpdate}</span></div>
    <div class="r-row"><span class="r-label">מקור מחירים</span><span class="r-value">${state.prices.source === 'live' ? '🟢 חי' : state.prices.source === 'manual' ? '🟡 ידני' : '⚪ ברירת מחדל'}</span></div>
  `;
}
