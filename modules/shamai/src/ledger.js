// שמאי — יומן הזדמנויות. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  LEDGER / OPPORTUNITIES
// ─────────────────────────────────────────────────────────────────────────────

const OPP_CATEGORIES = [
  { k: 'general', name: 'כללי' },
  { k: 'gold',    name: 'זהב/כסף' },
  { k: 'diamond', name: 'יהלום' },
  { k: 'watch',   name: 'שעון' },
  { k: 'antique', name: 'עתיקה' },
  { k: 'book',    name: 'ספר' },
  { k: 'coin',    name: 'מטבע' },
  { k: 'phone',   name: 'טלפון' },
  { k: 'art',     name: 'אומנות' },
  { k: 'rug',     name: 'שטיח' },
  { k: 'scrap',   name: 'סקראפ' },
  { k: 'realestate', name: 'נדל"ן' },
  { k: 'vehicle', name: 'רכב' },
  { k: 'nft',     name: 'NFT' },
  { k: 'wine',    name: 'יין' },
  { k: 'bag',     name: 'תיק' },
  { k: 'gbook',   name: 'ספר אספנות' },
];

// מחיר שהוקלד בחלון (טקסט חופשי) ← שקלים מעוגלים לאגורה, או null. "12,500" = 12500 — פעם parseFloat
// קטע אותו ל-12, והרווח יצא שגוי (בדיקת קוד 23.10.2026, ממצא 16). הפסיק נקרא כמו בשאר השדות (normalizeNumText)
function parseMoneyInput(raw) {
  const s = normalizeNumText(raw);
  const n = s === null ? NaN : Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// חיפוש בפנקס מבחוץ (חיפוש כללי, אנשי קשר): הסינון נעשה לפי state.ledger.search — פעם רק הטקסט בשדה
// התעדכן, והרשימה הוצגה בלי סינון. מסנני המצב והקטגוריה מתאפסים — אחרת "נמכר" שנשאר פעיל הסתיר את הפריט שנבחר.
// איש קשר (sellerKey): הסינון לפי המפתח שלו בלבד (contactKeyOf), והטקסט בשדה רק מראה את מי — הקלדה בשדה מבטלת אותו
function showLedgerSearch(query, sellerKey = null) {
  const text = String(query || '');
  state.ledger.filter = 'all';
  state.ledger.catFilter = null;
  state.ledger.sellerKey = sellerKey ? String(sellerKey) : null;
  state.ledger.search = state.ledger.sellerKey ? '' : text;
  $$('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
  const input = $('#opp-search');
  if (input) input.value = text;
  switchView('ledger');
}

// פריט פנקס מקובץ JSON, מ-QR או מהאחסון — קלט לא מהימן (ממצא 18). פריט שאינו אובייקט או בלי שם מדולג,
// ושדה בסוג לא נכון מתוקן או מוסר — כך פריט פגום לא מפיל את המסך הראשי בכל עלייה של המודול.
// שדות פשוטים נוספים (למשל purchaseId) עוברים כמו שהם; אובייקטים ומערכים — רק המוכרים
const OPP_STATUSES = ['watching', 'bought', 'sold'];
function sanitizeOpp(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 300) : '';
  if (!name) return null;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  }
  const id = typeof o.id === 'number' && Number.isFinite(o.id) ? String(o.id) : o.id;
  out.id = typeof id === 'string' && /^[\w-]{1,64}$/.test(id) ? id : uid();
  out.name = name;
  out.status = OPP_STATUSES.includes(o.status) ? o.status : 'watching';
  out.category = OPP_CATEGORIES.some(c => c.k === o.category) ? o.category : 'general';
  // הערות — גם דוח אמיתות מלא (authenticity.js), ולכן תקרה נדיבה
  out.seller = typeof o.seller === 'string' ? o.seller.slice(0, 500) : '';
  out.notes = typeof o.notes === 'string' ? o.notes.slice(0, 20000) : '';
  for (const k of ['asking', 'estimate', 'purchasePrice', 'salePrice']) {
    const n = typeof o[k] === 'string' && o[k].trim() !== '' ? Number(o[k]) : o[k];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e12) out[k] = Math.round(n * 100) / 100;
    else delete out[k];
  }
  for (const k of ['created', 'purchaseDate', 'soldDate']) {
    const t = typeof o[k] === 'string' || typeof o[k] === 'number' ? new Date(o[k]).getTime() : NaN;
    if (Number.isFinite(t)) out[k] = new Date(t).toISOString(); else delete out[k];
  }
  if (!out.created) out.created = new Date().toISOString();
  out.hasPhoto = o.hasPhoto === true;
  for (const k of ['reportNo', 'manualOrder']) if (!(Number.isInteger(o[k]) && o[k] >= 0)) delete out[k];
  if (!(typeof o.reminderAt === 'number' && Number.isFinite(o.reminderAt))) delete out.reminderAt;
  if (!isImageData(o.photo, IMAGE_LEGACY_MAX_CHARS)) delete out.photo;
  if (Array.isArray(o.tags)) out.tags = o.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.slice(0, 50)).slice(0, 50);
  if (Array.isArray(o.details)) out.details = o.details.filter(d => Array.isArray(d) && d.length === 2).map(([l, v]) => [String(l).slice(0, 200), String(v).slice(0, 500)]).slice(0, 60);
  if (Array.isArray(o.audioNotes)) {
    out.audioNotes = o.audioNotes.filter(n => n && typeof n === 'object' && typeof n.id === 'string' && typeof n.data === 'string' && /^data:audio\/[\w.+-]+(;[\w=.+-]+)*;base64,[A-Za-z0-9+/=]+$/.test(n.data))
      .map(n => ({ id: n.id.slice(0, 64), data: n.data, duration: Number(n.duration) || 0, createdAt: Number(n.createdAt) || 0 }));
  }
  // דוח אמיתות שנשמר בפנקס (authenticity.js): קטגוריה, ציון, מסקנה ותוצאה לכל בדיקה — טקסט ומספר בלבד
  const ar = o.authReport;
  if (ar && typeof ar === 'object' && !Array.isArray(ar)) {
    const results = {};
    if (ar.results && typeof ar.results === 'object' && !Array.isArray(ar.results)) {
      for (const [k, v] of Object.entries(ar.results).slice(0, 200)) {
        if (/^[\w-]{1,64}$/.test(k) && typeof v === 'string') results[k] = v.slice(0, 20);
      }
    }
    out.authReport = {
      category: typeof ar.category === 'string' ? ar.category.slice(0, 64) : '',
      score: Number.isFinite(Number(ar.score)) ? Number(ar.score) : 0,
      verdict: typeof ar.verdict === 'string' ? ar.verdict.slice(0, 200) : '',
      results,
    };
  }
  return out;
}

// רשימת פריטים ← { items, skipped }: פריטים תקינים בלבד, ומזהה כפול ברשימה עצמה — הראשון נשאר
function sanitizeOpportunities(list) {
  const items = [], seen = new Set();
  let skipped = 0;
  for (const o of Array.isArray(list) ? list : []) {
    const s = sanitizeOpp(o);
    if (!s || seen.has(s.id)) { skipped++; continue; }
    seen.add(s.id);
    items.push(s);
  }
  return { items, skipped };
}

// אחרי ייבוא (JSON / QR): מונה מספרי הדוח לא יורד מתחת למספר הגבוה בפנקס — אחרת דוח חדש היה מקבל מספר
// שכבר שייך לפריט מיובא (סקירת קוד 2.11.2026). false — המחסן דחה (ההודעה — מ-Storage.save)
function bumpReportSeqFrom(opps) {
  let max = 0;
  for (const o of opps || []) if (o && Number.isInteger(o.reportNo) && o.reportNo > max) max = o.reportNo;
  const cur = Number(Storage.load('reportSeq', 0)) || 0;
  return max > cur ? Storage.save('reportSeq', max) : true;
}

// החלפת הפנקס בייבוא: תמונות של פריטים שיצאו מהפנקס נמחקות (פעם נשארו באחסון בלי פריט). קוראים רק אחרי
// שהפנקס החדש נשמר
function dropReplacedPhotos(oldOpps, newOpps) {
  const keep = new Set((newOpps || []).filter(o => o && o.hasPhoto).map(o => o.id));
  const gone = (oldOpps || []).filter(o => o && o.hasPhoto && !keep.has(o.id)).map(o => o.id);
  for (const id of gone) ImageDB.delete(`opp_${id}`).catch(() => {});
  return gone.length;
}

function renderLedger() {
  // Stats
  const opps = state.opportunities;
  const watching = opps.filter(o => o.status === 'watching');
  const bought = opps.filter(o => o.status === 'bought');
  const sold = opps.filter(o => o.status === 'sold');
  const totalProfit = sold.reduce((s, o) => s + ((o.salePrice || 0) - (o.purchasePrice || o.asking || 0)), 0);

  $('#opp-stats').innerHTML = `
    <div class="stat-cell">
      <div class="sc-value">${opps.length}</div>
      <div class="sc-label">סה"כ</div>
    </div>
    <div class="stat-cell">
      <div class="sc-value" style="color:var(--yellow)">${watching.length}</div>
      <div class="sc-label">במעקב</div>
    </div>
    <div class="stat-cell">
      <div class="sc-value" style="color:var(--blue)">${bought.length}</div>
      <div class="sc-label">במלאי</div>
    </div>
    <div class="stat-cell">
      <div class="sc-value" style="color:${totalProfit >= 0 ? 'var(--green)' : 'var(--red)'}">${totalProfit >= 0 ? '+' : ''}₪${fmt0(totalProfit)}</div>
      <div class="sc-label">רווח</div>
    </div>
  `;

  // Category select for new opp — הבחירה בטופס פתוח נשמרת: פעם כל רינדור של הפנקס (שינוי סינון, מחיר) איפס אותה,
  // והשמירה כתבה "כללי" (סקירת קוד 2.11.2026)
  const catSel = $('#no-cat');
  const catKeep = catSel.value;
  catSel.innerHTML = OPP_CATEGORIES.map(c => `<option value="${c.k}">${c.name}</option>`).join('');
  if (catKeep && OPP_CATEGORIES.some(c => c.k === catKeep)) catSel.value = catKeep;

  // Cat filter row
  $('#cat-filter-row').innerHTML = `
    <button class="cat-filter-btn ${!state.ledger.catFilter ? 'active' : ''}" data-cat-filter="">כולם</button>
    ${OPP_CATEGORIES.map(c => `
      <button class="cat-filter-btn ${state.ledger.catFilter === c.k ? 'active' : ''}" data-cat-filter="${c.k}">${c.name}</button>
    `).join('')}
  `;
  $$('#cat-filter-row .cat-filter-btn').forEach(b => {
    b.addEventListener('click', () => {
      state.ledger.catFilter = b.dataset.catFilter || null;
      renderLedger();
    });
  });

  // Filter & sort & search
  let filtered = opps.slice();
  if (state.ledger.filter !== 'all') {
    filtered = filtered.filter(o => o.status === state.ledger.filter);
  }
  if (state.ledger.catFilter) {
    filtered = filtered.filter(o => o.category === state.ledger.catFilter);
  }
  // "עסקאות" של איש קשר: באותו מפתח שלפיו אנשי הקשר מקובצים (contactKeyOf ב-contacts.js), לא לפי שם —
  // פעם המילה הראשונה בשם הציגה גם עסקאות של מוכר אחר באותו שם פרטי
  if (state.ledger.sellerKey) {
    filtered = filtered.filter(o => o.seller && contactKeyOf(o.seller) === state.ledger.sellerKey);
  }
  if (state.ledger.search) {
    const q = state.ledger.search.toLowerCase();
    filtered = filtered.filter(o =>
      (o.name || '').toLowerCase().includes(q) ||
      (o.notes || '').toLowerCase().includes(q) ||
      (o.seller || '').toLowerCase().includes(q)
    );
  }
  // Sort
  switch (state.ledger.sort) {
    case 'oldest':      filtered.sort((a, b) => new Date(a.created) - new Date(b.created)); break;
    case 'profit-desc': filtered.sort((a, b) => oppProfit(b) - oppProfit(a)); break;
    case 'profit-pct':  filtered.sort((a, b) => oppMargin(b) - oppMargin(a)); break;
    case 'name':        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he')); break;
    // סדר ידני (גרירה, inventory.js): סדר הרשימה עצמה. פעם נפל ל"חדש קודם" והגרירה לא השפיעה
    case 'manual':      break;
    default:            filtered.sort((a, b) => new Date(b.created) - new Date(a.created)); break;
  }

  // Render
  const list = $('#opp-list');
  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">◎</div>
        <div>${state.ledger.search || state.ledger.catFilter || state.ledger.sellerKey || state.ledger.filter !== 'all' ? 'אין התאמות' : 'אין הזדמנויות עדיין'}</div>
        <div class="text-faint" style="margin-top:8px;font-size:13px">השתמש בכלי השמאות ושמור פריטים שאתה שוקל לקנות</div>
      </div>
    `;
  } else {
    list.innerHTML = filtered.map(renderOppCard).join('');
    // Wire up actions
    $$('.opp-card').forEach(card => {
      const id = card.dataset.id;
      $$('button[data-act]', card).forEach(b => {
        b.addEventListener('click', () => oppAction(id, b.dataset.act));
      });
      // Load image if exists
      if (card.dataset.hasPhoto === 'true') {
        ImageDB.load(`opp_${id}`).then(dataUrl => {
          if (dataUrl) {
            const ph = card.querySelector('.opp-photo');
            if (ph) ph.innerHTML = `<img src="${dataUrl}" alt="" />`;
          }
        });
      }
    });
  }

  // Update tab badge
  const badge = $('#ledger-badge');
  if (watching.length > 0) {
    badge.textContent = watching.length;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

// מעוגל לאגורה: הפרש של סכומים עשרוניים משאיר שאריות נקודה צפה (0.1 + 0.2), שהגיעו לייצוא ה-CSV
function oppProfit(o) {
  if (o.status === 'sold' && o.salePrice) {
    return roundMoney(o.salePrice - (o.purchasePrice || o.asking || 0));
  }
  return roundMoney((o.estimate || 0) - (o.asking || 0));
}
function oppMargin(o) {
  const ref = o.status === 'sold' ? (o.purchasePrice || o.asking || 1) : (o.asking || 1);
  return (oppProfit(o) / ref) * 100;
}

function renderOppCard(o) {
  const cat = OPP_CATEGORIES.find(c => c.k === o.category) || OPP_CATEGORIES[0];
  const days = daysSince(o.created);
  const aging = days > 60 ? 'warn' : '';

  let pricesHtml = '';
  if (o.status === 'sold' && o.salePrice) {
    const profit = o.salePrice - (o.purchasePrice || o.asking || 0);
    pricesHtml = `
      <div class="opp-price-item">קנייה: ₪${fmt0(o.purchasePrice || o.asking)}</div>
      <div class="opp-price-item">מכירה: ₪${fmt0(o.salePrice)}</div>
      <div class="opp-price-item ${profit >= 0 ? 'profit' : 'loss'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)}</div>
    `;
  } else if (o.status === 'bought') {
    pricesHtml = `
      <div class="opp-price-item">שולם: ₪${fmt0(o.purchasePrice || o.asking)}</div>
      ${o.estimate ? `<div class="opp-price-item">צפי: ₪${fmt0(o.estimate)}</div>` : ''}
    `;
  } else {
    const profit = (o.estimate || 0) - (o.asking || 0);
    pricesHtml = `
      <div class="opp-price-item">מבוקש: ₪${fmt0(o.asking)}</div>
      ${o.estimate ? `<div class="opp-price-item">משוער: ₪${fmt0(o.estimate)}</div>` : ''}
      ${o.estimate && o.asking ? `<div class="opp-price-item ${profit >= 0 ? 'profit' : 'loss'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)}</div>` : ''}
    `;
  }

  let actions = '';
  const hasPhone = detectPhone(o.seller);
  const phoneActions = hasPhone ? `
      <button data-act="call" class="phone">📞 חייג</button>
      <button data-act="wa" class="whatsapp">💬 WhatsApp</button>
  ` : '';
  if (o.status === 'watching') {
    actions = `
      <button data-act="bought" class="primary">סומן כנקנה</button>
      ${phoneActions}
      <button data-act="share" class="share">שתף</button>
      <button data-act="pdf" class="pdf">PDF</button>
      <button data-act="edit">ערוך</button>
      <button data-act="delete" class="danger">מחק</button>
    `;
  } else if (o.status === 'bought') {
    actions = `
      <button data-act="sold" class="primary">סומן כנמכר</button>
      ${phoneActions}
      <button data-act="share" class="share">שתף</button>
      <button data-act="pdf" class="pdf">PDF</button>
      <button data-act="edit">ערוך</button>
      <button data-act="delete" class="danger">מחק</button>
    `;
  } else {
    actions = `
      <button data-act="share" class="share">שתף</button>
      <button data-act="pdf" class="pdf">PDF</button>
      <button data-act="edit">ערוך</button>
      <button data-act="delete" class="danger">מחק</button>
    `;
  }

  return `
    <div class="opp-card ${escapeHtml(o.status)}" data-id="${escapeHtml(o.id)}" data-has-photo="${!!o.hasPhoto}">
      <div class="opp-photo ${!o.hasPhoto ? 'empty' : ''}">${!o.hasPhoto ? '📷' : ''}</div>
      <div class="opp-body">
        <div class="opp-row1">
          <div class="opp-name">${escapeHtml(o.name)}</div>
          <span class="status-pill ${escapeHtml(o.status)}">${{watching:'במעקב',bought:'נקנה',sold:'נמכר'}[o.status]}</span>
        </div>
        <div class="opp-meta">${cat.name} · ${shortDate(o.created)} ${o.seller ? '· ' + escapeHtml(o.seller) : ''}</div>
        <div class="opp-prices">${pricesHtml}</div>
        ${o.notes ? `<div class="opp-meta" style="margin-top:4px;color:var(--text)">${escapeHtml(o.notes)}</div>` : ''}
        <div class="opp-aging ${aging}">${days === 0 ? 'היום' : `לפני ${days} יום`}</div>
        <div class="opp-actions">${actions}</div>
      </div>
    </div>
  `;
}

async function oppAction(id, action) {
  const opp = state.opportunities.find(o => o.id === id);
  if (!opp) return;

  if (action === 'delete') {
    if (!(await ssDialog.confirm(`למחוק "${opp.name}"?`, { danger: true }))) return;
    state.opportunities = state.opportunities.filter(o => o.id !== id);
    await ImageDB.delete(`opp_${id}`);
    Storage.save('opportunities', state.opportunities);
    renderLedger();
    toast('נמחק', 'success');
    return;
  }

  if (action === 'bought') {
    const actualPrice = await ssDialog.prompt(`כמה שילמת בפועל? (מבוקש: ₪${fmt0(opp.asking)})`, String(opp.asking || ''));
    if (actualPrice === null) return;
    const price = parseMoneyInput(actualPrice);
    if (price === null) { toast('מחיר לא תקין', 'error'); return; }
    opp.status = 'bought';
    opp.purchasePrice = price;
    opp.purchaseDate = new Date().toISOString();
    Storage.save('opportunities', state.opportunities);
    renderLedger();
    toast(`סומן כנקנה ב-₪${fmt0(price)}`, 'success');
    return;
  }

  if (action === 'sold') {
    const salePrice = await ssDialog.prompt(`באיזה מחיר מכרת? (קנית ב-₪${fmt0(opp.purchasePrice)})`, '');
    if (salePrice === null) return;
    const price = parseMoneyInput(salePrice);
    if (price === null) { toast('מחיר לא תקין', 'error'); return; }
    opp.status = 'sold';
    opp.salePrice = price;
    opp.soldDate = new Date().toISOString();
    Storage.save('opportunities', state.opportunities);
    renderLedger();
    const profit = price - (opp.purchasePrice || opp.asking || 0);
    toast(`רווח: ${profit >= 0 ? '+' : ''}₪${fmt0(profit)}`, profit >= 0 ? 'success' : 'error');
    return;
  }

  if (action === 'edit') {
    openEditOpp(opp);
    return;
  }

  if (action === 'share') {
    const cat = OPP_CATEGORIES.find(c => c.k === opp.category)?.name || '';
    const profit = (opp.estimate || 0) - (opp.asking || 0);
    let text = `📋 ${opp.name}\n`;
    text += `קטגוריה: ${cat}\n`;
    if (opp.asking) text += `💰 מחיר מבוקש: ₪${fmt0(opp.asking)}\n`;
    if (opp.estimate) text += `📊 שווי משוער: ₪${fmt0(opp.estimate)}\n`;
    if (opp.asking && opp.estimate) {
      text += `${profit >= 0 ? '✅' : '⚠️'} פוטנציאל: ${profit >= 0 ? '+' : ''}₪${fmt0(profit)}\n`;
    }
    if (opp.seller) text += `📞 ${opp.seller}\n`;
    if (opp.notes) text += `📝 ${opp.notes}\n`;
    text += `\n— נשלח משמאי`;

    // Try Web Share API first (works on mobile)
    if (navigator.share) {
      navigator.share({ title: opp.name, text }).catch(() => {
        // Fallback to WhatsApp on cancel/error
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      });
    } else {
      // Open WhatsApp directly
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
    return;
  }
}

function openEditOpp(opp) {
  // מצב התמונה של הפריט הקודם לא עובר לפריט הזה: פעם pendingPhoto / photoRemoved נשארו, ושמירה מחקה או דרסה
  // תמונה של פריט אחר (סקירת קוד 2.11.2026)
  pendingPhoto = null;
  photoRemoved = false;
  $('#no-photo').value = '';
  $('#no-photo-preview').innerHTML = '';
  $('#no-photo-preview').hidden = true;
  // Pre-fill the new opp form with values
  const f = $('#new-opp-form');
  f.hidden = false;
  $('.new-box-title', f).textContent = 'עריכת פריט';
  $('#no-name').value = opp.name;
  $('#no-asking').value = opp.asking || '';
  $('#no-est').value = opp.estimate || '';
  $('#no-cat').value = opp.category || 'general';
  $('#no-seller').value = opp.seller || '';
  $('#no-notes').value = opp.notes || '';
  $('#no-add').dataset.editId = opp.id;
  $('#no-add').textContent = 'שמור שינויים';
  // Load current photo
  if (opp.hasPhoto) {
    ImageDB.load(`opp_${opp.id}`).then(dataUrl => {
      // בינתיים נפתח פריט אחר, או שנבחרה תמונה חדשה — לא מציגים את התמונה הזו
      if ($('#no-add').dataset.editId !== opp.id || pendingPhoto || photoRemoved) return;
      if (dataUrl) {
        const preview = $('#no-photo-preview');
        preview.innerHTML = `<img src="${dataUrl}" alt="" />
          <button class="remove-photo" aria-label="הסר">×</button>`;
        preview.hidden = false;
      }
    });
  }
}

function clearOppForm() {
  $('#new-opp-form').hidden = true;
  $('.new-box-title').textContent = 'פריט חדש';
  $('#no-name').value = '';
  $('#no-asking').value = '';
  $('#no-est').value = '';
  $('#no-cat').value = 'general';
  $('#no-seller').value = '';
  $('#no-notes').value = '';
  $('#no-photo').value = '';
  $('#no-photo-preview').innerHTML = '';
  $('#no-photo-preview').hidden = true;
  delete $('#no-add').dataset.editId;
  $('#no-add').textContent = 'הוסף';
  pendingPhoto = null;
  photoRemoved = false;
}

let pendingPhoto = null; // תמונה מוקטנת (data:image) שממתינה לשמירה
let photoRemoved = false; // בעריכה: המשתמש הסיר את התמונה הקיימת

async function saveOppFromForm() {
  const name = $('#no-name').value.trim();
  // מעוגל לאגורה, כמו בשמירה מהשמאות (roundMoney ב-calc.js)
  const asking = roundMoney(parseFloat($('#no-asking').value));
  const estimate = roundMoney(parseFloat($('#no-est').value));
  if (!name || !(asking > 0)) { toast('נדרש שם ומחיר', 'error'); return; }

  const editId = $('#no-add').dataset.editId;
  if (editId) {
    // Update existing
    const opp = state.opportunities.find(o => o.id === editId);
    if (!opp) return;
    opp.name = name;
    opp.asking = asking;
    opp.estimate = estimate || null;
    opp.category = $('#no-cat').value;
    opp.seller = $('#no-seller').value.trim();
    opp.notes = $('#no-notes').value.trim();
    try {
      if (pendingPhoto) {
        await ImageDB.save(`opp_${editId}`, pendingPhoto);
        opp.hasPhoto = true;
      } else if (photoRemoved) {
        await ImageDB.delete(`opp_${editId}`);
        opp.hasPhoto = false;
      }
    } catch (e) { toast(e.message, 'error'); return; }
    Storage.save('opportunities', state.opportunities);
    toast('נשמר', 'success');
  } else {
    // Create new
    const id = uid();
    const opp = {
      id,
      name,
      asking,
      estimate: estimate || null,
      category: $('#no-cat').value,
      seller: $('#no-seller').value.trim(),
      notes: $('#no-notes').value.trim(),
      status: 'watching',
      created: new Date().toISOString(),
      hasPhoto: !!pendingPhoto,
    };
    if (pendingPhoto) {
      try { await ImageDB.save(`opp_${id}`, pendingPhoto); }
      catch (e) { toast(e.message, 'error'); return; }
    }
    state.opportunities.unshift(opp);
    Storage.save('opportunities', state.opportunities);
    toast('נוסף', 'success');
  }

  clearOppForm();
  renderLedger();
}

// Save current appraisal as opp
function saveCurrentAsOpp(category) {
  const id = uid();
  let opp = {
    id, category, status: 'watching',
    created: new Date().toISOString(),
    hasPhoto: false,
  };

  switch (category) {
    case 'gold': {
      const g = state.gold;
      const w = parseFloat($('#g-weight').value);
      const unit = $('#g-unit').value;
      const spotUsd = g.metal === 'gold' ? state.prices.gold : state.prices.silver;
      // כמו במסך: במצב סקראפ — מחיר הרכישה כסקראפ (70%), אחרת שווי ההתכה
      const scrap = !!$('#g-scrap-mode')?.checked;
      opp.name = `${g.metal === 'gold' ? 'זהב' : 'כסף'} ${(g.purity*1000).toFixed(0)}/1000 - ${w}${unit}`;
      opp.asking = g.asking;
      opp.estimate = goldValue({ weight: w, unit, purity: g.purity, spotUsd, usdIls: state.prices.usdIls, scrap }).payIls;
      break;
    }
    case 'diamond': {
      const d = state.diamond;
      const carat = parseFloat($('#d-carat').value);
      opp.name = `יהלום ${d.origin === 'lab' ? 'מעבדה ' : ''}${carat}ct ${d.color}/${d.clarity}/${d.cut}`;
      opp.asking = d.currency === 'USD' ? d.asking * state.prices.usdIls : d.asking;
      const dv = diamondValue(d, carat, state.prices.usdIls);
      if (dv) opp.estimate = dv.wholesaleIls;
      break;
    }
    case 'watch': {
      const w = state.watch;
      opp.name = `${WATCH_BRANDS.find(b => b.k === w.brand)?.name || ''} ${w.model || ''}`.trim();
      opp.asking = w.asking;
      // כמו במסך: הרווח מחושב מול מחיר הרכישה לסוחר
      opp.estimate = watchValue(w).wholesale;
      break;
    }
    case 'antique': {
      const a = state.antique;
      opp.name = a.name || ANTIQUE_CATS.find(c => c.k === a.cat)?.name;
      opp.asking = a.asking;
      opp.estimate = antiqueValue(a).value;
      break;
    }
    case 'book': {
      const b = state.book;
      opp.name = b.name || BOOK_TYPES.find(t => t.k === b.type)?.name;
      opp.asking = b.asking;
      const condMult = CONDITIONS.find(c => c.k === b.condition)?.mult ?? 1;
      const compMult = BOOK_COMPLETE[b.complete]?.mult ?? 1;
      const rabbiMult = b.rabbi ? 1.40 : 1;
      const glossesMult = b.glosses ? 1.15 : 1;
      const bindingMult = b.binding ? 1.20 : 1;
      const firstMult = b.first ? 1.50 : 1;
      opp.estimate = b.market * condMult * compMult * rabbiMult * glossesMult * bindingMult * firstMult;
      break;
    }
    case 'coin': {
      const c = state.coin;
      opp.name = c.name || `מטבע ${c.year || ''}`.trim();
      opp.asking = c.asking;
      opp.estimate = coinValue(c, state.prices).value;
      break;
    }
    case 'phone': {
      const p = state.phone;
      opp.name = `${PHONE_BRANDS.find(b => b.k === p.brand)?.name} ${p.model}`.trim();
      opp.asking = p.asking;
      opp.estimate = phoneValue(p).estValue;
      break;
    }
    case 'art': {
      const a = state.art;
      opp.name = a.artist || 'יצירת אומנות';
      opp.asking = a.asking;
      opp.estimate = artValue(a).estValue;
      break;
    }
    case 'rug': {
      const rg = state.rug;
      opp.name = `שטיח ${RUG_REGIONS.find(r => r.k === rg.region)?.name} ${rg.length}×${rg.width}`;
      opp.asking = rg.asking;
      opp.estimate = rugValue(rg).estValue;
      break;
    }
    case 'scrap': {
      const s = state.scrap;
      opp.name = SCRAP_TYPES.find(t => t.k === s.type)?.name + ` ${s.weight}${s.unit}`;
      opp.asking = s.asking;
      // כמו במסך: מה שהסוחר משלם, לפי המחיר לק"ג שהוקלד (אם הוקלד)
      opp.estimate = scrapValue(s, state.prices)?.dealerPay;
      break;
    }
    case 'realestate': {
      const re = state.realestate;
      const typeName = RE_TYPES.find(t => t.k === re.type)?.name || 'נכס';
      opp.name = `${typeName} ${re.size || ''}מ"ר ${re.rooms || ''} חד'`.trim();
      opp.asking = re.asking;
      const q = reQuickEstimate(re);
      opp.estimate = q ? q.value : 0;
      break;
    }
    case 'vehicle': {
      const v = state.vehicleAppraisal;
      const brandName = VEHICLE_BRANDS.find(b => b.k === v.brand)?.name || '';
      opp.name = `${brandName} ${v.model || ''} ${v.year || ''}`.trim();
      opp.asking = v.asking;
      // אותה פונקציה של המסך (vehicleValue ב-calc.js)
      opp.estimate = vehicleValue(v).estValue;
      break;
    }
    case 'nft': {
      const n = state.nft;
      const typeName = NFT_TYPES.find(t => t.k === n.type)?.name || 'NFT';
      opp.name = `${typeName} ${n.name || ''}`.trim();
      // Convert asking to ILS
      const ethToUsd = state.prices.ethereum || 3500;
      const usdIls = state.prices.usdIls || 3.6;
      if (n.currency === 'ETH') opp.asking = n.asking * ethToUsd * usdIls;
      else if (n.currency === 'USD') opp.asking = n.asking * usdIls;
      else opp.asking = n.asking;
      // Estimate
      const typeMult = NFT_TYPES.find(t => t.k === n.type)?.base ?? 1;
      let rarityMult = 1;
      if (n.rarity) {
        if (n.rarity <= 100) rarityMult = 5;
        else if (n.rarity <= 500) rarityMult = 2.5;
        else if (n.rarity <= 1000) rarityMult = 1.5;
      }
      const oneMult = n.oneOfOne ? 6 : 1;
      const celebMult = n.celeb ? 3 : 1;
      const utilityMult = n.utility ? 1.5 : 1;
      const histMult = n.historic ? 2 : 1;
      opp.estimate = (n.floor || 0) * typeMult * rarityMult * oneMult * celebMult * utilityMult * histMult * ethToUsd * usdIls;
      break;
    }
    case 'wine': {
      const w = state.wine;
      opp.name = `${w.name || 'יין'} ${w.vintage || ''}`.trim();
      opp.asking = w.asking;
      const baseRetail = parseFloat(document.querySelector('#wn-retail')?.value) || 0;
      opp.estimate = wineValue(w, baseRetail).estValue;
      break;
    }
    case 'bag': {
      const b = state.bag;
      const brand = BAG_BRANDS.find(x => x.k === b.brand);
      opp.name = `${brand?.name || ''} ${b.model || ''}`.trim();
      opp.asking = b.asking;
      const cond = CONDITIONS.find(x => x.k === b.condition);
      const authMult = b.authenticated ? 1.20 : 0.85;
      let categoryMult = 1;
      if (b.brand === 'hermes' && b.model.match(/birkin|kelly/i)) categoryMult = 1.5;
      else if (b.brand === 'chanel' && b.model.match(/classic|2\.55/i)) categoryMult = 1.2;
      opp.estimate = (b.retail || 0) * (brand?.liquidity ?? 0.5) * (cond?.mult ?? 1) * authMult * categoryMult;
      break;
    }
    case 'gbook': {
      const g = state.gbook;
      const type = BOOK_GEN_TYPES.find(t => t.k === g.type);
      opp.name = `${g.name || 'ספר'} - ${g.author || ''}`.trim();
      opp.asking = g.asking;
      const cond = CONDITIONS.find(c => c.k === g.condition);
      const age = g.year ? new Date().getFullYear() - g.year : 0;
      let ageMult = 1;
      if (age >= 100) ageMult = 3;
      else if (age >= 50) ageMult = 1.8;
      else if (age >= 25) ageMult = 1.2;
      opp.estimate = (g.retail || 0) * (type?.base ?? 1) * (cond?.mult ?? 1) * ageMult;
      break;
    }
  }

  // סכומים ביומן — מעוגלים לאגורה (פעם נשמרו בנקודה צפה גולמית)
  opp.asking = roundMoney(opp.asking);
  opp.estimate = roundMoney(opp.estimate);
  if (!opp.name || !(opp.asking > 0)) {
    toast('חסרים פרטים - הזן שם ומחיר', 'error');
    return;
  }
  // פרטי השמאות לדוח (9.8) — נשמרים עכשיו, כי המסך משתנה אחר כך
  const details = appraisalDetails(category);
  if (details.length) opp.details = details.map(([l, v]) => [String(l), String(v)]);

  state.opportunities.unshift(opp);
  Storage.save('opportunities', state.opportunities);
  toast('נשמר בפנקס', 'success');
  // Don't navigate - just update badge
  renderHeader();
  if (state.view === 'dashboard') renderDashboard();
}
