// שמאי — אנשי קשר, תבניות, ערכת צבעים ותובנות. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  CONTACTS CRM - track sellers/buyers across deals
// ─────────────────────────────────────────────────────────────────────────────

state.contacts = state.contacts || [];

function getContactsFromOpps() {
  // Auto-build contacts from opportunities
  const map = new Map();
  state.opportunities.forEach(o => {
    if (!o.seller) return;
    const phone = detectPhone(o.seller);
    const key = phone || o.seller.toLowerCase().trim();
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        name: o.seller.replace(/\d[\d\s-]+/g, '').trim() || 'ללא שם',
        phone: phone || '',
        rawSellerText: o.seller,
        deals: [],
        totalSpent: 0,
        totalEarned: 0,
        firstSeen: o.created,
        lastSeen: o.created,
      });
    }
    const c = map.get(key);
    c.deals.push({ id: o.id, name: o.name, status: o.status, asking: o.asking, created: o.created });
    if (o.status === 'bought' || o.status === 'sold') {
      c.totalSpent += (o.purchasePrice || o.asking || 0);
    }
    if (o.status === 'sold') {
      c.totalEarned += (o.salePrice || 0);
    }
    if (o.created < c.firstSeen) c.firstSeen = o.created;
    if (o.created > c.lastSeen) c.lastSeen = o.created;
  });
  return Array.from(map.values()).sort((a, b) => b.deals.length - a.deals.length);
}

function renderContactsView() {
  const c = $('#contacts-view');
  if (!c) return;
  const contacts = getContactsFromOpps();

  if (contacts.length === 0) {
    c.innerHTML = `
      <div class="empty">
        <div class="empty-icon">👥</div>
        <div class="empty-msg">אין אנשי קשר עדיין</div>
        <div class="empty-sub">הוסף פריטים לפנקס עם שם המוכר ואנשי הקשר יבנו אוטומטית</div>
      </div>
    `;
    return;
  }

  c.innerHTML = `
    <div class="text-faint" style="margin-bottom:12px;font-size:12px">
      ${contacts.length} אנשי קשר · ${state.opportunities.length} עסקאות
    </div>
    ${contacts.map(c => `
      <div class="contact-card" data-contact="${c.id}">
        <div class="contact-head">
          <div class="contact-name">${escapeHtml(c.name)}</div>
          ${c.phone ? `<div class="contact-phone">${escapeHtml(c.phone)}</div>` : ''}
        </div>
        <div class="contact-stats">
          <span class="cs-pill">${c.deals.length} עסקאות</span>
          ${c.totalSpent > 0 ? `<span class="cs-pill warning">קניות: ₪${fmt0(c.totalSpent)}</span>` : ''}
          ${c.totalEarned > 0 ? `<span class="cs-pill profit">מכירות: ₪${fmt0(c.totalEarned)}</span>` : ''}
        </div>
        <div class="contact-actions">
          ${c.phone ? `
            <button data-act="contact-call" data-phone="${c.phone}">📞 חייג</button>
            <button data-act="contact-wa" data-phone="${c.phone}" data-name="${escapeHtml(c.name)}">💬 WhatsApp</button>
          ` : ''}
          <button data-act="contact-deals" data-contact="${c.id}">📋 ${c.deals.length} עסקאות</button>
        </div>
      </div>
    `).join('')}
  `;

  // Wire up
  $$('.contact-actions button').forEach(b => {
    b.addEventListener('click', () => {
      const action = b.dataset.act;
      if (action === 'contact-call') callPhone(b.dataset.phone);
      else if (action === 'contact-wa') {
        const cleaned = b.dataset.phone.replace(/[^\d+]/g, '');
        const intl = cleaned.startsWith('+') ? cleaned : cleaned.startsWith('0') ? '+972' + cleaned.substring(1) : '+972' + cleaned;
        const msg = `שלום ${b.dataset.name}, מתעדכן בנוגע לעסקה...`;
        window.open(`https://wa.me/${intl.replace('+', '')}?text=${encodeURIComponent(msg)}`, '_blank');
      } else if (action === 'contact-deals') {
        // Switch to ledger and filter by this seller
        switchView('ledger');
        setTimeout(() => {
          const contact = contacts.find(c => c.id === b.dataset.contact);
          if (contact) {
            $('#opp-search').value = contact.name.split(' ')[0];
            renderLedger();
          }
        }, 200);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  TEMPLATES - save common items for fast re-entry
// ─────────────────────────────────────────────────────────────────────────────

state.templates = Storage.load('templates') || [];

async function saveAsTemplate(opp) {
  const name = await ssDialog.prompt('שם התבנית (לדוגמה: "ש"ס וילנא 1890"):');
  if (!name) return;
  const template = {
    id: uid(),
    name,
    category: opp.category,
    asking: opp.asking,
    estimate: opp.estimate,
    notes: opp.notes,
    seller: opp.seller,
    photo: opp.photo,
    createdAt: Date.now(),
  };
  state.templates.unshift(template);
  Storage.save('templates', state.templates);
  toast('✓ תבנית נשמרה', 'success');
}

function applyTemplate(templateId) {
  const t = state.templates.find(x => x.id === templateId);
  if (!t) return;
  $('#no-name').value = t.name;
  $('#no-asking').value = t.asking || '';
  $('#no-est').value = t.estimate || '';
  $('#no-cat').value = t.category;
  $('#no-seller').value = t.seller || '';
  $('#no-notes').value = t.notes || '';
  if (isImageData(t.photo)) {
    $('#no-photo-preview').innerHTML = `<img src="${t.photo}" alt="תצוגה" /><button class="remove-photo" aria-label="הסר">×</button>`;
    $('#no-photo-preview').hidden = false;
    pendingPhoto = t.photo;
    photoRemoved = false;
  }
  toast('✓ תבנית הוטענה', 'success');
}

async function deleteTemplate(templateId) {
  if (!(await ssDialog.confirm('למחוק את התבנית?', { danger: true }))) return;
  state.templates = state.templates.filter(x => x.id !== templateId);
  Storage.save('templates', state.templates);
  renderTemplatesList();
}

function renderTemplatesList() {
  const el = $('#templates-list');
  if (!el) return;
  if (state.templates.length === 0) {
    el.innerHTML = `<div class="text-faint" style="text-align:center;padding:16px;font-size:12px">אין תבניות עדיין. שמור פריט כתבנית מתוך הפנקס</div>`;
    return;
  }
  el.innerHTML = state.templates.map(t => `
    <div class="template-row">
      <button class="template-apply" data-tpl="${t.id}">
        <span class="tpl-name">${escapeHtml(t.name)}</span>
        <span class="tpl-meta">${OPP_CATEGORIES.find(c => c.k === t.category)?.name || ''} · ₪${fmt0(t.asking || 0)}</span>
      </button>
      <button class="template-del" data-tpl-del="${t.id}" aria-label="מחק">×</button>
    </div>
  `).join('');
  $$('.template-apply').forEach(b => b.addEventListener('click', () => applyTemplate(b.dataset.tpl)));
  $$('.template-del').forEach(b => b.addEventListener('click', () => deleteTemplate(b.dataset.tplDel)));
}

// ─────────────────────────────────────────────────────────────────────────────
//  THEME TOGGLE - dark/light
// ─────────────────────────────────────────────────────────────────────────────

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('shamai_theme', theme);
  state.settings = state.settings || {};
  state.settings.theme = theme;
  Storage.save('settings', state.settings);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

// ─────────────────────────────────────────────────────────────────────────────
//  TODAY'S INSIGHTS - smart suggestions
// ─────────────────────────────────────────────────────────────────────────────

function generateInsights() {
  const insights = [];
  const opps = state.opportunities;
  const watching = opps.filter(o => o.status === 'watching');
  const bought = opps.filter(o => o.status === 'bought');
  const sold = opps.filter(o => o.status === 'sold');

  // 1. Stale items
  const staleItems = watching.filter(o => daysSince(o.created) > 30);
  if (staleItems.length > 0) {
    insights.push({
      icon: '⏰',
      title: `${staleItems.length} פריטים במעקב מעל 30 יום`,
      sub: 'שווה לבדוק אם הם עוד רלוונטיים',
      action: () => {
        switchView('ledger');
        setTimeout(() => {
          state.ledger.sort = 'oldest';
          $('#opp-sort').value = 'oldest';
          renderLedger();
        }, 200);
      },
    });
  }

  // 2. High potential profit watching
  const bigOps = watching.filter(o => o.estimate && o.asking && (o.estimate - o.asking) > 5000);
  if (bigOps.length > 0) {
    const totalPotential = bigOps.reduce((s, o) => s + (o.estimate - o.asking), 0);
    insights.push({
      icon: '💰',
      title: `${bigOps.length} הזדמנויות ברוח 5K+ ₪`,
      sub: `פוטנציאל כולל: ₪${fmt0(totalPotential)}`,
      action: () => {
        switchView('ledger');
        setTimeout(() => {
          state.ledger.sort = 'profit-desc';
          $('#opp-sort').value = 'profit-desc';
          renderLedger();
        }, 200);
      },
    });
  }

  // 3. Inventory sitting too long (bought but not sold)
  const oldInventory = bought.filter(o => daysSince(o.purchaseDate || o.created) > 60);
  if (oldInventory.length > 0) {
    insights.push({
      icon: '📦',
      title: `${oldInventory.length} פריטים במלאי מעל 60 יום`,
      sub: 'שווה לחשוב על אסטרטגיית מכירה',
      action: () => {
        switchView('ledger');
        setTimeout(() => {
          state.ledger.filter = 'bought';
          $$('.filter-btn').forEach(x => x.classList.remove('active'));
          document.querySelector('.filter-btn[data-filter="bought"]')?.classList.add('active');
          renderLedger();
        }, 200);
      },
    });
  }

  // 4. Recent profit milestone
  const recentSold = sold.filter(o => daysSince(o.soldDate || o.created) <= 30);
  if (recentSold.length > 0) {
    const profit = recentSold.reduce((s, o) => s + ((o.salePrice || 0) - (o.purchasePrice || o.asking || 0)), 0);
    if (profit > 0) {
      insights.push({
        icon: '🎉',
        title: `רווח של ₪${fmt0(profit)} בחודש האחרון`,
        sub: `${recentSold.length} עסקאות סגורות`,
        action: () => switchView('tools'),
      });
    }
  }

  // 5. Price changes alert (gold)
  const goldHist = (Storage.load(PRICE_HISTORY_KEY) || {}).gold;
  if (goldHist && goldHist.length >= 2) {
    const latest = goldHist[goldHist.length - 1].v;
    const earliest = goldHist[0].v;
    const change = ((latest - earliest) / earliest) * 100;
    if (Math.abs(change) > 5) {
      insights.push({
        icon: change > 0 ? '📈' : '📉',
        title: `זהב ${change > 0 ? 'עלה' : 'ירד'} ב-${fmt(Math.abs(change), 1)}%`,
        sub: `מ-$${fmt0(earliest)} ל-$${fmt0(latest)} (לפי המעקב שלך)`,
        action: () => switchView('dashboard'),
      });
    }
  }

  // 6. Best category (most profit)
  if (sold.length >= 3) {
    const byCat = {};
    sold.forEach(o => {
      const cat = o.category || 'general';
      if (!byCat[cat]) byCat[cat] = { count: 0, profit: 0 };
      byCat[cat].count++;
      byCat[cat].profit += (o.salePrice || 0) - (o.purchasePrice || o.asking || 0);
    });
    const best = Object.entries(byCat).sort((a, b) => b[1].profit - a[1].profit)[0];
    if (best && best[1].profit > 0) {
      const catName = OPP_CATEGORIES.find(c => c.k === best[0])?.name || best[0];
      insights.push({
        icon: '🏆',
        title: `${catName} - הקטגוריה הרווחית ביותר`,
        sub: `₪${fmt0(best[1].profit)} ב-${best[1].count} עסקאות`,
        action: () => {
          switchView('tools');
          setTimeout(() => switchSubView('tools', 'analytics'), 200);
        },
      });
    }
  }

  // 7. Default - if no insights, suggest action
  if (insights.length === 0) {
    if (opps.length === 0) {
      insights.push({
        icon: '👋',
        title: 'ברוך הבא לשמאי',
        sub: 'התחל בהוספת פריט ראשון לפנקס',
        action: () => { switchView('appraisal'); },
      });
    } else {
      insights.push({
        icon: '✨',
        title: 'הכל מסודר',
        sub: `${opps.length} פריטים בפנקס. כל הכבוד!`,
        action: () => switchView('ledger'),
      });
    }
  }

  return insights;
}

function renderInsights() {
  const el = $('#insights-list');
  if (!el) return;
  const insights = generateInsights();
  el.innerHTML = insights.map((ins, i) => `
    <button class="insight-card" data-insight="${i}">
      <div class="ins-icon">${ins.icon}</div>
      <div class="ins-body">
        <div class="ins-title">${escapeHtml(ins.title)}</div>
        <div class="ins-sub">${escapeHtml(ins.sub)}</div>
      </div>
    </button>
  `).join('');
  $$('.insight-card').forEach((b, i) => {
    b.addEventListener('click', insights[i].action);
  });
}


// ─────────────────────────────────────────────────────────────────────────────
//  WIRE NEW v5 EVENTS
// ─────────────────────────────────────────────────────────────────────────────

(function wireV5() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(wireV5, 250));
    return;
  }
  setTimeout(() => {
    // Theme
    const savedTheme = localStorage.getItem('shamai_theme') || 'light';
    setTheme(savedTheme);
    $('#btn-theme')?.addEventListener('click', () => {
      toggleTheme();
      const btn = $('#btn-theme');
      if (btn) btn.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '☀️' : '🌙';
    });
    // Set initial theme button icon
    const themeBtn = $('#btn-theme');
    if (themeBtn) themeBtn.textContent = savedTheme === 'light' ? '☀️' : '🌙';

    // Render templates when new opp form opens
    const newOppBtn = $('#btn-new-opp');
    if (newOppBtn) {
      const original = newOppBtn.onclick;
      newOppBtn.addEventListener('click', () => {
        setTimeout(() => renderTemplatesList(), 100);
      });
    }

    // Render insights on dashboard
    const renderDash = window.renderDashboard;
    if (renderDash) {
      window.renderDashboard = function() {
        renderDash.apply(this, arguments);
        renderInsights();
      };
    }
    renderInsights();
  }, 400);
})();

// ─────────────────────────────────────────────────────────────────────────────
//  Add "save as template" action to opp cards
// ─────────────────────────────────────────────────────────────────────────────

const oldOppActionV5 = oppAction;
window.oppAction = async function(id, action) {
  if (action === 'template') {
    const opp = state.opportunities.find(o => o.id === id);
    if (opp) saveAsTemplate(opp);
    return;
  }
  return oldOppActionV5.apply(this, arguments);
};
