// שמאי — שמאות יודאיקה ועתיקות, ספרים ומטבעות. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  ANTIQUE / JUDAICA APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderAntiqueView() {
  $('#cat-grid').innerHTML = ANTIQUE_CATS.map(c => `
    <button class="cat-btn ${state.antique.cat === c.k ? 'active' : ''}" data-cat="${c.k}">${c.name}</button>
  `).join('');
  $('#cond-grid').innerHTML = CONDITIONS.map(c => `
    <button class="cond-btn ${state.antique.condition === c.k ? 'active' : ''}" data-cond="${c.k}">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="cond-dot" style="background:${c.color}"></span>
        <span class="cond-name">${c.name}</span>
      </span>
      <span class="cond-mult">×${c.mult}</span>
    </button>
  `).join('');
  $('#hallmark-grid').innerHTML = HALLMARKS.map(h => `
    <button class="hallmark-btn ${state.antique.hallmark === h.k ? 'active' : ''}" data-hallmark="${h.k}">
      <div>${h.name}</div>
      <div class="purity-sub">×${h.mult}</div>
    </button>
  `).join('');

  $$('#cat-grid .cat-btn').forEach(b => b.addEventListener('click', () => { state.antique.cat = b.dataset.cat; renderAntiqueView(); }));
  $$('#cond-grid .cond-btn').forEach(b => b.addEventListener('click', () => { state.antique.condition = b.dataset.cond; renderAntiqueView(); }));
  $$('#hallmark-grid .hallmark-btn').forEach(b => b.addEventListener('click', () => { state.antique.hallmark = b.dataset.hallmark; renderAntiqueView(); }));

  recalcAntique();
}

function calcSilverFromGrams(grams, purityPpt) {
  return silverIls(grams, purityPpt, state.prices);
}

function recalcAntique() {
  const r = $('#a-result');
  if (!r) return;
  const a = state.antique;
  a.name = $('#a-name')?.value || '';
  a.market = parseFloat($('#a-market')?.value);
  a.prov = $('#a-prov')?.checked || false;
  a.signed = $('#a-signed')?.checked || false;
  a.rare = $('#a-rare')?.checked || false;
  a.asking = parseFloat($('#a-asking')?.value);

  if (!a.market || a.market <= 0) { r.innerHTML = ''; $('#a-save').hidden = true; return; }

  const { condMult, hallmarkMult, value: adjustedValue, maxPurchase } = antiqueValue(a);

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי משוער (במצב הנוכחי)</span>
      <strong>₪${fmt0(adjustedValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר רכישה מקסימלי לסוחר (55%)</span>
      <span class="r-value gold">₪${fmt0(maxPurchase)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">מצב</span>
      <span class="r-value">×${condMult}</span>
    </div>
    <div class="r-row">
      <span class="r-label">הולמרק/מקור</span>
      <span class="r-value">×${hallmarkMult}</span>
    </div>
  `;
  if (a.prov) html += `<div class="r-row"><span class="r-label">+ Provenance</span><span class="r-value green">+25%</span></div>`;
  if (a.signed) html += `<div class="r-row"><span class="r-label">+ חתימה</span><span class="r-value green">+15%</span></div>`;
  if (a.rare) html += `<div class="r-row"><span class="r-label">+ נדירות</span><span class="r-value green">+50%</span></div>`;

  if (a.asking) {
    const profit = adjustedValue - a.asking;
    const margin = (profit / a.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(a.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">פוטנציאל רווח</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  // "מאין הסכום?" — מחיר השוק והמקדמים, מתוך אותו antiqueValue
  html += explainAntique(a, { condMult, hallmarkMult, value: adjustedValue, maxPurchase });

  html += `
    <div class="tip-box">
      <div class="tip-title">❦ מקורות לבדיקת מחירים</div>
      <div class="tip-body">
        <ul>
          <li>יודאיקה: <strong>Kedem (קדם)</strong>, Sothebys, Tiroche, Winners, Genazym</li>
          <li>שעונים: Chrono24, WatchCharts</li>
          <li>אומנות: Artprice</li>
          <li>מטבעות: NGC Coin Explorer, PCGS Price Guide</li>
        </ul>
        חפש <strong>מכירה שהתבצעה בפועל</strong> (Hammer Price), לא הצעות מחיר נוכחיות.
      </div>
    </div>
  `;
  r.innerHTML = html;
  explainAttach('#a-result');
  $('#a-save').hidden = !a.asking;
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOOK APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderBookView() {
  $('#book-types').innerHTML = BOOK_TYPES.map(t => `
    <button class="cat-btn ${state.book.type === t.k ? 'active' : ''}" data-type="${t.k}">${t.name}</button>
  `).join('');
  $('#book-cond').innerHTML = CONDITIONS.map(c => `
    <button class="cond-btn ${state.book.condition === c.k ? 'active' : ''}" data-cond="${c.k}">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="cond-dot" style="background:${c.color}"></span>
        <span class="cond-name">${c.name}</span>
      </span>
      <span class="cond-mult">×${c.mult}</span>
    </button>
  `).join('');

  $$('#book-types .cat-btn').forEach(b => b.addEventListener('click', () => { state.book.type = b.dataset.type; renderBookView(); }));
  $$('#book-cond .cond-btn').forEach(b => b.addEventListener('click', () => { state.book.condition = b.dataset.cond; renderBookView(); }));

  recalcBook();
}

function recalcBook() {
  const r = $('#b-result');
  if (!r) return;
  const b = state.book;
  b.name = $('#b-name')?.value || '';
  b.edition = $('#b-edition')?.value || '';
  b.year = parseInt($('#b-year')?.value);
  b.complete = $('#b-complete')?.value || 'full';
  b.rabbi = $('#b-rabbi')?.checked || false;
  b.glosses = $('#b-glosses')?.checked || false;
  b.binding = $('#b-binding')?.checked || false;
  b.first = $('#b-first')?.checked || false;
  b.market = parseFloat($('#b-market')?.value);
  b.asking = parseFloat($('#b-asking')?.value);

  if (!b.market || b.market <= 0) { r.innerHTML = ''; $('#b-save').hidden = true; return; }

  const condMult = CONDITIONS.find(c => c.k === b.condition)?.mult ?? 1;
  const completeMult = BOOK_COMPLETE[b.complete]?.mult ?? 1;
  const rabbiMult = b.rabbi ? 1.40 : 1;
  const glossesMult = b.glosses ? 1.15 : 1;
  const bindingMult = b.binding ? 1.20 : 1;
  const firstMult = b.first ? 1.50 : 1;

  const adjustedValue = b.market * condMult * completeMult * rabbiMult * glossesMult * bindingMult * firstMult;
  const maxPurchase = adjustedValue * 0.55;

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי משוער</span>
      <strong>₪${fmt0(adjustedValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר רכישה מקסימלי</span>
      <span class="r-value gold">₪${fmt0(maxPurchase)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">מצב</span>
      <span class="r-value">×${condMult}</span>
    </div>
    <div class="r-row">
      <span class="r-label">שלמות</span>
      <span class="r-value">×${completeMult}</span>
    </div>
  `;
  if (b.first) html += `<div class="r-row"><span class="r-label">+ מהדורה ראשונה</span><span class="r-value green">+50%</span></div>`;
  if (b.rabbi) html += `<div class="r-row"><span class="r-label">+ חתימת רב</span><span class="r-value green">+40%</span></div>`;
  if (b.binding) html += `<div class="r-row"><span class="r-label">+ כריכה מקורית</span><span class="r-value green">+20%</span></div>`;
  if (b.glosses) html += `<div class="r-row"><span class="r-label">+ הגהות</span><span class="r-value green">+15%</span></div>`;

  if (b.asking) {
    const profit = adjustedValue - b.asking;
    const margin = (profit / b.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(b.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">פוטנציאל רווח</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box">
      <div class="tip-title">✡ ספרי קודש - מקורות</div>
      <div class="tip-body">
        <ul>
          <li>Kedem (קדם), Asufa, Genazym, Winner's - מכירות פומביות</li>
          <li>חתימת רב מפורסם או הקדשה לאדם ידוע = הכפלה במחיר</li>
          <li>הגהות בעט של דמות תורנית = פריט נדיר במיוחד</li>
          <li>וילנא ראשונה / ונציה = פי 5-10 ממהדורה רגילה</li>
          <li>תמיד בדוק שלמות - דפים חסרים מורידים 30-60%</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#b-save').hidden = !b.asking;
}

// ─────────────────────────────────────────────────────────────────────────────
//  COIN APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderCoinView() {
  $('#coin-eras').innerHTML = COIN_ERAS.map(e => `
    <button class="cat-btn ${state.coin.era === e.k ? 'active' : ''}" data-era="${e.k}">${e.name}</button>
  `).join('');
  $('#cn-grade').innerHTML = COIN_GRADES.map(g => `
    <button class="scale-btn ${state.coin.grade === g.k ? 'active' : ''}" data-grade="${g.k}">${g.k}</button>
  `).join('');

  $$('#coin-eras .cat-btn').forEach(b => b.addEventListener('click', () => { state.coin.era = b.dataset.era; renderCoinView(); }));
  $$('#cn-grade .scale-btn').forEach(b => b.addEventListener('click', () => { state.coin.grade = b.dataset.grade; renderCoinView(); }));

  recalcCoin();
}

function recalcCoin() {
  const r = $('#cn-result');
  if (!r) return;
  const c = state.coin;
  c.name = $('#cn-name')?.value || '';
  c.year = parseInt($('#cn-year')?.value);
  c.metal = $('#cn-metal')?.value || 'silver';
  c.weight = parseFloat($('#cn-weight')?.value);
  c.purity = parseFloat($('#cn-purity')?.value) || 900;
  // "אין פרמיה" (0) הוא בחירה, לא ערך חסר — פעם `|| 1.5` הפך אותו ל-×1.5 (סקירת קוד 2.11.2026)
  const prem = parseFloat($('#cn-premium')?.value);
  c.premium = Number.isFinite(prem) && prem >= 0 ? prem : 1.5;
  c.market = parseFloat($('#cn-market')?.value);
  c.asking = parseFloat($('#cn-asking')?.value);

  const { meltIls, gradeMult, value: finalValue, maxPurchase } = coinValue(c, state.prices);

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי משוער</span>
      <strong>₪${fmt0(finalValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר רכישה מקסימלי</span>
      <span class="r-value gold">₪${fmt0(maxPurchase)}</span>
    </div>
  `;

  if (!coinIsPrecious(c)) {
    html += c.market > 0
      ? `<div class="r-row sep"><span class="r-label">מחיר שוק שהוקלד</span><span class="r-value">₪${fmt0(c.market)}</span></div>
         <div class="r-row"><span class="r-label">מקדם דירוג</span><span class="r-value">×${gradeMult}</span></div>`
      : `<div class="tip-box"><div class="tip-title">⊞ דרוש מחיר שוק</div><div class="tip-body">מטבע שאינו מזהב או מכסף — אין לו ערך התכה. יש להקליד מחיר שוק למטבע (קטלוג, מכירות פומביות) בשדה "מחיר שוק למטבע".</div></div>`;
  }

  if (meltIls > 0) {
    html += `
      <div class="r-row sep">
        <span class="r-label">ערך התכה</span>
        <span class="r-value">₪${fmt0(meltIls)}</span>
      </div>
      <div class="r-row">
        <span class="r-label">פרמיה נומיסמטית</span>
        <span class="r-value">×${c.premium}</span>
      </div>
      <div class="r-row">
        <span class="r-label">מקדם דירוג</span>
        <span class="r-value">×${gradeMult}</span>
      </div>
    `;
  }

  if (c.asking) {
    const profit = finalValue - c.asking;
    const margin = (profit / c.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(c.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">פוטנציאל רווח</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  // "מאין הסכום?" — שווי ההתכה, הפרמיה והדירוג, מתוך אותו coinValue
  html += explainCoin(c, state.prices, { meltIls, gradeMult, value: finalValue, maxPurchase });

  html += `
    <div class="tip-box">
      <div class="tip-title">◉ מטבעות - טיפים</div>
      <div class="tip-body">
        <ul>
          <li>בדוק NGC Coin Explorer / PCGS Price Guide למטבעות אמריקאים</li>
          <li>מטבעות ישראלים: Negev, רחם פרטי במכירות פומביות</li>
          <li>מטבעות זהב = כמעט תמיד מעל ערך התכה (מספר נדירות)</li>
          <li>סטטוס "Proof" / "Brilliant Uncirculated" = ×2-3 מ-MS רגיל</li>
          <li>חשד לזיוף? תמיד תשקול ובדוק מידות + צליל</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  explainAttach('#cn-result');
  $('#cn-save').hidden = !c.asking;
}
