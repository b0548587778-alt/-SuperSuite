// שמאי — לוח הבקרה. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERING - HEADER & DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

function renderHeader() {
  const html = `
    <button class="mini-stat" id="btn-refresh" title="עדכון מחירים" aria-label="עדכון מחירים">
      <div class="mini-label">↻</div>
    </button>
    <div class="mini-stat">
      <div class="mini-label">Au</div>
      <div class="mini-value">$${fmt0(state.prices.gold)}</div>
    </div>
    <div class="mini-stat">
      <div class="mini-label">Ag</div>
      <div class="mini-value">$${fmt1(state.prices.silver)}</div>
    </div>
  `;
  $('#hdr-stats').innerHTML = html;
  $('#btn-refresh').addEventListener('click', openPricePanel);

  // מצב המחירים: התאריך, ותזכורת כשהמחיר ישן (PLAN.md 9.9)
  const st = priceStatusText(state.prices);
  $('#hdr-stats').insertAdjacentHTML('beforeend', `<button class="mini-stat price-age ${st.cls}" id="btn-price-age" title="עדכון מחירים">${escapeHtml(st.text)}</button>`);
  $('#btn-price-age').addEventListener('click', openPricePanel);
  const ftr = $('#footer-status');
  ftr.textContent = st.cls === 'ok' ? `${st.text} · הערכות לפי נסחאות מקובלות, לא תחליף לבדיקה מקצועית` : `⚠ ${st.text} — עדכנו את המחירים לפני שמאות`;
}

function renderDashboard() {
  // Greeting — אותם גבולות שעה כמו בברכה של המעטפת (shell.js), כדי שלא יוצגו שתי ברכות שונות
  const hr = new Date().getHours();
  let greet = 'בוקר טוב';
  if (hr >= 12 && hr < 17) greet = 'צהריים טובים';
  else if (hr >= 17 && hr < 21) greet = 'ערב טוב';
  else if (hr >= 21 || hr < 5) greet = 'לילה טוב';
  $('#hero-greet').textContent = greet;

  // Stats
  const opps = state.opportunities;
  const watching = opps.filter(o => o.status === 'watching');
  const sold = opps.filter(o => o.status === 'sold');
  const thisMonth = sold.filter(o => {
    const d = new Date(o.soldDate || o.created);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  const potential = watching.reduce((sum, o) => sum + Math.max(0, (o.estimate || 0) - (o.asking || 0)), 0);
  const monthlyProfit = thisMonth.reduce((sum, o) => sum + ((o.salePrice || 0) - (o.purchasePrice || o.asking || 0)), 0);

  $('#hero-active').textContent = watching.length;
  $('#hero-potential').textContent = '₪' + fmt0(potential);
  $('#hero-monthly').textContent = '₪' + fmt0(monthlyProfit);

  // Market cards
  const usdIls = state.prices.usdIls;
  $('#market-cards').innerHTML = `
    <div class="card gold-accent">
      <div class="c-sym">Au</div>
      <div class="c-name">זהב</div>
      <div class="c-price">$${fmt(state.prices.gold)}</div>
      <div class="c-sub">/oz · ₪${fmt0(state.prices.gold * usdIls / TROY_OZ)} לגרם</div>
      <div class="c-spark">${renderSparkline('gold')}</div>
    </div>
    <div class="card">
      <div class="c-sym">Ag</div>
      <div class="c-name">כסף</div>
      <div class="c-price">$${fmt(state.prices.silver)}</div>
      <div class="c-sub">/oz · ₪${fmt(state.prices.silver * usdIls / TROY_OZ)} לגרם</div>
      <div class="c-spark">${renderSparkline('silver')}</div>
    </div>
    <div class="card">
      <div class="c-sym">Pt</div>
      <div class="c-name">פלטינה</div>
      <div class="c-price">$${fmt(state.prices.platinum)}</div>
      <div class="c-sub">/oz · ₪${fmt0(state.prices.platinum * usdIls / TROY_OZ)} לגרם</div>
      <div class="c-spark">${renderSparkline('platinum')}</div>
    </div>
    <div class="card">
      <div class="c-sym">Ratio</div>
      <div class="c-name">זהב/כסף</div>
      <div class="c-price">${fmt1(state.prices.gold / state.prices.silver)}</div>
      <div class="c-sub">${state.prices.gold/state.prices.silver > 80 ? 'כסף זול' : state.prices.gold/state.prices.silver < 50 ? 'זהב זול' : 'נורמלי'}</div>
    </div>
  `;

  // Crypto cards
  const cryptoHtml = CRYPTO_COINS.slice(0, 4).map(c => {
    const price = state.prices[c.id];
    const change = state.prices[c.id + 'Change'];
    return `
      <div class="card">
        <div class="c-sym">${c.symbol}</div>
        <div class="c-name">${c.name}</div>
        <div class="c-price">$${fmt0(price)}</div>
        <div class="c-sub">
          ₪${fmt0(price * usdIls)}
          ${typeof change === 'number' ? `<span class="c-change ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${fmt1(change)}%</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
  $('#crypto-cards').innerHTML = cryptoHtml;

  // FX row - prefer direct stored values, fallback to fxRates calculation
  const fx = state.prices.fxRates || {};
  const eurIls = state.prices.eurIls || (fx.EUR ? state.prices.usdIls / fx.EUR : 0);
  const gbpIls = state.prices.gbpIls || (fx.GBP ? state.prices.usdIls / fx.GBP : 0);
  $('#fx-row').innerHTML = `
    <div class="metric">
      <div class="metric-label">USD/ILS</div>
      <div class="metric-value">₪${fmt(state.prices.usdIls, 3)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">EUR/ILS</div>
      <div class="metric-value">₪${fmt(eurIls, 3)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">GBP/ILS</div>
      <div class="metric-value">₪${fmt(gbpIls, 3)}</div>
    </div>
  `;

  renderReminders();
}

function renderReminders() {
  const reminders = [];
  const now = Date.now();
  // מחיר הזהב / הכסף / הדולר ישן — ראשון ברשימה
  const pr = priceReminder(state.prices);
  if (pr) reminders.push({ title: escapeHtml(pr.title), sub: escapeHtml(pr.sub), cls: pr.cls, prices: true });

  // Items watched > 30 days
  state.opportunities.filter(o => o.status === 'watching').forEach(o => {
    const days = daysSince(o.created);
    if (days >= 30) {
      reminders.push({
        title: `${escapeHtml(o.name)}`,
        sub: `במעקב ${days} יום - הזמן להחליט`,
      });
    }
  });

  // Bought items not yet sold > 90 days
  state.opportunities.filter(o => o.status === 'bought').forEach(o => {
    const days = daysSince(o.purchaseDate || o.created);
    if (days >= 90) {
      reminders.push({
        title: `${escapeHtml(o.name)}`,
        sub: `במלאי ${days} יום - שקול תמחור מחדש`,
      });
    }
  });

  const list = $('#reminders-list');
  if (reminders.length === 0) {
    list.innerHTML = '<div class="reminders-empty">אין תזכורות פעילות</div>';
  } else {
    list.innerHTML = reminders.slice(0, 5).map(r => `
      <div class="reminder${r.cls ? ' ' + r.cls : ''}"${r.prices ? ' data-open-prices' : ''}>
        <div class="reminder-title">${r.title}</div>
        <div class="reminder-sub">${r.sub}</div>
      </div>
    `).join('');
    list.querySelector('[data-open-prices]')?.addEventListener('click', openPricePanel);
  }
}
