// שמאי — ניתוח תיק והשוואה. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  ANALYTICS - Portfolio Analytics
// ─────────────────────────────────────────────────────────────────────────────

function renderAnalytics() {
  const ops = state.opportunities;
  if (ops.length === 0) {
    $('#analytics-summary').innerHTML = `<div class="empty"><div class="empty-icon">▤</div><div class="empty-msg">אין נתונים להצגה</div><div class="empty-sub">הוסף פריטים לפנקס כדי לראות אנליטיקה</div></div>`;
    $('#analytics-bycat').innerHTML = '';
    $('#analytics-bystatus').innerHTML = '';
    $('#analytics-history').innerHTML = '';
    $('#analytics-details').hidden = true;
    return;
  }
  $('#analytics-details').hidden = false;

  const watching = ops.filter(o => o.status === 'watching');
  const bought = ops.filter(o => o.status === 'bought');
  const sold = ops.filter(o => o.status === 'sold');
  const totalRevenue = sold.reduce((s, o) => s + (o.salePrice || 0), 0);
  const totalCost = sold.reduce((s, o) => s + (o.purchasePrice || o.asking || 0), 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = sold.length ? sold.reduce((s, o) => {
    const cost = o.purchasePrice || o.asking || 1;
    const profit = (o.salePrice || 0) - cost;
    return s + (profit / cost * 100);
  }, 0) / sold.length : 0;
  const potentialProfit = watching.reduce((s, o) => s + Math.max(0, (o.estimate || 0) - (o.asking || 0)), 0);
  const inventoryValue = bought.reduce((s, o) => s + (o.estimate || o.asking || 0), 0);

  $('#analytics-summary').innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(2,1fr); gap:10px">
      <div class="stat-cell">
        <div class="sc-value" style="color:var(--gold)">₪${fmt0(totalRevenue)}</div>
        <div class="sc-label">הכנסות מכירות</div>
      </div>
      <div class="stat-cell">
        <div class="sc-value" style="color:${totalProfit >= 0 ? 'var(--green)' : 'var(--red)'}">${totalProfit >= 0 ? '+' : ''}₪${fmt0(totalProfit)}</div>
        <div class="sc-label">רווח כולל</div>
      </div>
      <div class="stat-cell">
        <div class="sc-value" style="color:${avgMargin >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(avgMargin, 1)}%</div>
        <div class="sc-label">מרווח ממוצע</div>
      </div>
      <div class="stat-cell">
        <div class="sc-value">${sold.length}</div>
        <div class="sc-label">עסקאות סגורות</div>
      </div>
      <div class="stat-cell">
        <div class="sc-value" style="color:var(--purple)">₪${fmt0(potentialProfit)}</div>
        <div class="sc-label">רווח פוטנציאלי (מעקב)</div>
      </div>
      <div class="stat-cell">
        <div class="sc-value" style="color:var(--yellow)">₪${fmt0(inventoryValue)}</div>
        <div class="sc-label">שווי מלאי</div>
      </div>
    </div>
  `;

  // By category - bar chart-style
  const byCat = {};
  ops.forEach(o => {
    const cat = o.category || 'general';
    if (!byCat[cat]) byCat[cat] = { count: 0, profit: 0, value: 0 };
    byCat[cat].count++;
    byCat[cat].value += (o.estimate || o.asking || 0);
    if (o.status === 'sold') byCat[cat].profit += (o.salePrice || 0) - (o.purchasePrice || o.asking || 0);
  });

  const catEntries = Object.entries(byCat).sort((a, b) => b[1].count - a[1].count);
  const maxCount = Math.max(...catEntries.map(e => e[1].count));

  $('#analytics-bycat').innerHTML = catEntries.map(([k, d]) => {
    const cat = OPP_CATEGORIES.find(c => c.k === k);
    const name = cat?.name || k;
    const pct = (d.count / maxCount) * 100;
    return `
      <div class="bar-row">
        <div class="bar-name">${name}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%"></div>
          <div class="bar-text">${d.count} פריטים · ₪${fmt0(d.value)}${d.profit !== 0 ? ` · רווח: ${d.profit >= 0 ? '+' : ''}₪${fmt0(d.profit)}` : ''}</div>
        </div>
      </div>
    `;
  }).join('');

  // By status
  const total = ops.length;
  $('#analytics-bystatus').innerHTML = `
    <div class="bar-row">
      <div class="bar-name">במעקב</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(watching.length / total) * 100}%; background:var(--purple)"></div>
        <div class="bar-text">${watching.length} (${fmt(watching.length / total * 100, 0)}%)</div>
      </div>
    </div>
    <div class="bar-row">
      <div class="bar-name">במלאי</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(bought.length / total) * 100}%; background:var(--yellow)"></div>
        <div class="bar-text">${bought.length} (${fmt(bought.length / total * 100, 0)}%)</div>
      </div>
    </div>
    <div class="bar-row">
      <div class="bar-name">נמכר</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(sold.length / total) * 100}%; background:var(--green)"></div>
        <div class="bar-text">${sold.length} (${fmt(sold.length / total * 100, 0)}%)</div>
      </div>
    </div>
  `;

  // History - last 10 sales
  const history = sold
    .filter(o => o.soldDate || o.created)
    .sort((a, b) => new Date(b.soldDate || b.created) - new Date(a.soldDate || a.created))
    .slice(0, 10);

  if (history.length) {
    $('#analytics-history').innerHTML = history.map(o => {
      const profit = (o.salePrice || 0) - (o.purchasePrice || o.asking || 0);
      const margin = profit / (o.purchasePrice || o.asking || 1) * 100;
      return `
        <div class="history-row">
          <div class="hist-name">${escapeHtml(o.name || '')}</div>
          <div class="hist-meta">${shortDate(o.soldDate || o.created)} · ${OPP_CATEGORIES.find(c => c.k === o.category)?.name || ''}</div>
          <div class="hist-profit ${profit >= 0 ? 'profit' : 'loss'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt(margin, 0)}%)</div>
        </div>
      `;
    }).join('');
  } else {
    $('#analytics-history').innerHTML = '<div class="empty"><div class="empty-msg">אין עדיין עסקאות סגורות</div></div>';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMPARE - Compare 2-3 items side by side
// ─────────────────────────────────────────────────────────────────────────────

state.compareSelection = state.compareSelection || [];

function renderCompare() {
  const ops = state.opportunities;
  if (ops.length === 0) {
    $('#compare-picker').innerHTML = `<div class="empty"><div class="empty-icon">⇄</div><div class="empty-msg">אין פריטים</div><div class="empty-sub">הוסף לפחות 2 פריטים לפנקס כדי להשוות</div></div>`;
    $('#compare-result').innerHTML = '';
    return;
  }

  // Picker - all opportunities with checkboxes
  $('#compare-picker').innerHTML = `
    <div class="compare-list">
      ${ops.map(o => {
        const checked = state.compareSelection.includes(o.id);
        const disabled = !checked && state.compareSelection.length >= 3;
        return `
          <label class="compare-pick ${checked ? 'active' : ''} ${disabled ? 'disabled' : ''}">
            <input type="checkbox" data-cmp="${o.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
            <span class="cmp-name">${escapeHtml(o.name || '')}</span>
            <span class="cmp-cat">${OPP_CATEGORIES.find(c => c.k === o.category)?.name || ''}</span>
          </label>
        `;
      }).join('')}
    </div>
  `;

  $$('#compare-picker input[data-cmp]').forEach(c => {
    c.addEventListener('change', e => {
      const id = e.target.dataset.cmp;
      if (e.target.checked) {
        if (!state.compareSelection.includes(id)) state.compareSelection.push(id);
      } else {
        state.compareSelection = state.compareSelection.filter(x => x !== id);
      }
      renderCompare();
    });
  });

  // Result
  if (state.compareSelection.length < 2) {
    $('#compare-result').innerHTML = `<div class="text-faint" style="text-align:center;padding:20px">בחר ${2 - state.compareSelection.length} פריטים נוספים להשוואה</div>`;
    return;
  }

  const items = state.compareSelection.map(id => ops.find(o => o.id === id)).filter(Boolean);
  const cols = items.length;
  const profit = (o) => (o.estimate || 0) - (o.asking || 0);
  const margin = (o) => o.asking ? (profit(o) / o.asking * 100) : 0;

  $('#compare-result').innerHTML = `
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `
        <div class="cmp-col">
          <div class="cmp-title">${escapeHtml(o.name || '')}</div>
          <div class="cmp-cat-label">${OPP_CATEGORIES.find(c => c.k === o.category)?.name || ''}</div>
        </div>
      `).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `<div class="cmp-cell"><div class="cmp-label">מבוקש</div><div class="cmp-value">₪${fmt0(o.asking)}</div></div>`).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `<div class="cmp-cell"><div class="cmp-label">משוער</div><div class="cmp-value">₪${fmt0(o.estimate || 0)}</div></div>`).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => {
        const p = profit(o);
        return `<div class="cmp-cell"><div class="cmp-label">פוטנציאל</div><div class="cmp-value ${p >= 0 ? 'profit' : 'loss'}">${p >= 0 ? '+' : ''}₪${fmt0(p)}</div></div>`;
      }).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => {
        const m = margin(o);
        return `<div class="cmp-cell"><div class="cmp-label">% רווח</div><div class="cmp-value ${m >= 0 ? 'profit' : 'loss'}">${fmt(m, 1)}%</div></div>`;
      }).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `<div class="cmp-cell"><div class="cmp-label">סטטוס</div><div class="cmp-value">${{watching:'במעקב',bought:'במלאי',sold:'נמכר'}[o.status]}</div></div>`).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `<div class="cmp-cell"><div class="cmp-label">מוכר</div><div class="cmp-value cmp-text">${escapeHtml(o.seller || '—')}</div></div>`).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `<div class="cmp-cell"><div class="cmp-label">תאריך</div><div class="cmp-value cmp-text">${shortDate(o.created)}</div></div>`).join('')}
    </div>
    <div style="margin-top:16px;padding:12px;background:var(--surface);border-radius:8px;text-align:center;font-size:13px">
      ${(() => {
        const winner = items.reduce((best, o) => margin(o) > margin(best) ? o : best, items[0]);
        return `<strong style="color:var(--gold)">המומלץ:</strong> ${escapeHtml(winner.name)} (${fmt(margin(winner), 1)}%)`;
      })()}
    </div>
    <button class="btn-ghost" id="cmp-clear" style="margin-top:12px">נקה בחירה</button>
  `;

  $('#cmp-clear')?.addEventListener('click', () => {
    state.compareSelection = [];
    renderCompare();
  });
}
