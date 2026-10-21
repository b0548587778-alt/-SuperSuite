// שמאי — ברקוד, הקלטות, תזכורות, קטלוג וסידור. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  BARCODE SCANNER - using BarcodeDetector API
// ─────────────────────────────────────────────────────────────────────────────

async function scanBarcode() {
  if (!('BarcodeDetector' in window)) {
    toast('סורק ברקוד לא נתמך בדפדפן זה - השתמש בChrome או Edge', 'error');
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'barcode-overlay';
      overlay.innerHTML = `
        <div class="barcode-scanner">
          <div class="scanner-title">סרוק ברקוד</div>
          <video autoplay playsinline></video>
          <div class="scanner-frame"></div>
          <button class="scanner-close" aria-label="סגור">×</button>
        </div>
      `;
      document.body.appendChild(overlay);

      const video = overlay.querySelector('video');
      video.srcObject = stream;
      video.play();

      const detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e', 'itf']
      });

      let scanning = true;
      const cleanup = () => {
        scanning = false;
        stream.getTracks().forEach(t => t.stop());
        overlay.remove();
      };

      overlay.querySelector('.scanner-close').addEventListener('click', () => {
        cleanup();
        resolve(null);
      });

      const tick = async () => {
        if (!scanning) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            cleanup();
            resolve({ value: codes[0].rawValue, format: codes[0].format });
            return;
          }
        } catch (e) {}
        requestAnimationFrame(tick);
      };
      tick();
    });
  } catch (e) {
    toast('לא ניתן לפתוח מצלמה: ' + e.message, 'error');
    return null;
  }
}

async function scanBarcodeForOpp() {
  const result = await scanBarcode();
  if (!result) return;
  // Auto-fill product name with barcode
  $('#no-name').value = `מוצר ${result.value}`;
  $('#no-notes').value = `ברקוד (${result.format}): ${result.value}`;
  toast(`✓ נסרק: ${result.value}`, 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRODUCT LOOKUP - search Google for similar items
// ─────────────────────────────────────────────────────────────────────────────

function lookupOnGoogle(opp) {
  const query = encodeURIComponent(`${opp.name} מחיר`);
  window.open(`https://www.google.com/search?q=${query}&tbm=shop`, '_blank');
}

function lookupOnEbay(opp) {
  const query = encodeURIComponent(opp.name);
  window.open(`https://www.ebay.com/sch/i.html?_nkw=${query}&_sop=15`, '_blank');
}

function lookupOnAuctions(opp) {
  // Israeli auction sites
  const query = encodeURIComponent(opp.name);
  window.open(`https://www.bidspirit.com/ui/search?q=${query}`, '_blank');
}

// ─────────────────────────────────────────────────────────────────────────────
//  AUDIO NOTES - record voice memos for opportunities
// ─────────────────────────────────────────────────────────────────────────────

let activeRecorder = null;

async function recordAudioNote(oppId) {
  if (activeRecorder) {
    toast('כבר מוקלט - לחץ עצור', 'info');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const recorder = new MediaRecorder(stream);
    activeRecorder = recorder;

    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      // Convert to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        const opp = state.opportunities.find(o => o.id === oppId);
        if (!opp) return;
        opp.audioNotes = opp.audioNotes || [];
        opp.audioNotes.push({
          id: uid(),
          data: reader.result,
          duration: Math.round((Date.now() - recordStart) / 1000),
          createdAt: Date.now(),
        });
        Storage.save('opportunities', state.opportunities);
        renderLedger();
        toast('✓ נשמרה הקלטה', 'success');
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(t => t.stop());
      activeRecorder = null;
      document.querySelector('.recording-overlay')?.remove();
    };

    const recordStart = Date.now();
    recorder.start();

    // Show recording UI
    const overlay = document.createElement('div');
    overlay.className = 'recording-overlay';
    overlay.innerHTML = `
      <div class="recording-pulse">🔴</div>
      <div class="recording-time" id="rec-time">0:00</div>
      <button class="recording-stop">⏹ עצור והקלט</button>
    `;
    document.body.appendChild(overlay);

    const updateTime = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordStart) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      const el = document.getElementById('rec-time');
      if (el) el.textContent = `${m}:${String(s).padStart(2, '0')}`;
      if (!activeRecorder) clearInterval(updateTime);
    }, 250);

    overlay.querySelector('.recording-stop').addEventListener('click', () => {
      recorder.stop();
    });
  } catch (e) {
    toast('שגיאה במיקרופון: ' + e.message, 'error');
    activeRecorder = null;
  }
}

function playAudioNote(audioData) {
  const audio = new Audio(audioData);
  audio.play().catch(e => toast('שגיאה בהשמעה: ' + e.message, 'error'));
}

async function deleteAudioNote(oppId, noteId) {
  const opp = state.opportunities.find(o => o.id === oppId);
  if (!opp || !opp.audioNotes) return;
  if (!(await ssDialog.confirm('למחוק את ההקלטה?', { danger: true }))) return;
  opp.audioNotes = opp.audioNotes.filter(n => n.id !== noteId);
  Storage.save('opportunities', state.opportunities);
  renderLedger();
}

// ─────────────────────────────────────────────────────────────────────────────
//  AUTO REMINDERS - schedule check-back on stale items
// ─────────────────────────────────────────────────────────────────────────────

function setReminderForOpp(oppId, days) {
  const opp = state.opportunities.find(o => o.id === oppId);
  if (!opp) return;
  opp.reminderAt = Date.now() + days * 86400000;
  Storage.save('opportunities', state.opportunities);
  toast(`✓ תזכורת בעוד ${days} ימים`, 'success');
  renderLedger();
}

function clearReminder(oppId) {
  const opp = state.opportunities.find(o => o.id === oppId);
  if (!opp) return;
  delete opp.reminderAt;
  Storage.save('opportunities', state.opportunities);
  renderLedger();
}

function checkReminders() {
  const now = Date.now();
  const due = state.opportunities.filter(o => o.reminderAt && o.reminderAt <= now);
  return due;
}

// Override insights to also include reminders
const originalGenerateInsights = generateInsights;
window.generateInsights = function() {
  const insights = originalGenerateInsights.apply(this, arguments);
  const due = checkReminders();
  if (due.length > 0) {
    insights.unshift({
      icon: '⏰',
      title: `${due.length} תזכורות הגיע מועדן`,
      sub: due.slice(0, 2).map(o => o.name).join(', ') + (due.length > 2 ? ` +${due.length - 2}` : ''),
      action: () => {
        switchView('ledger');
        setTimeout(() => {
          state.ledger.filter = 'watching';
          renderLedger();
        }, 200);
      },
    });
  }
  return insights;
};

// ─────────────────────────────────────────────────────────────────────────────
//  CATALOG PRINT - print full inventory as a catalog
// ─────────────────────────────────────────────────────────────────────────────

function printCatalog(filter = 'all') {
  let items = state.opportunities;
  if (filter === 'watching') items = items.filter(o => o.status === 'watching');
  else if (filter === 'bought') items = items.filter(o => o.status === 'bought');
  else if (filter === 'sold') items = items.filter(o => o.status === 'sold');

  if (items.length === 0) {
    toast('אין פריטים להדפסה', 'error');
    return;
  }

  const today = new Date().toLocaleDateString('he-IL');
  const totalValue = items.reduce((s, o) => s + (o.estimate || o.asking || 0), 0);
  const totalProfit = items.reduce((s, o) => {
    if (o.status === 'sold') return s + ((o.salePrice || 0) - (o.purchasePrice || o.asking || 0));
    return s + Math.max(0, (o.estimate || 0) - (o.asking || 0));
  }, 0);

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>קטלוג שמאי - ${today}</title>
  <style>
    @page { margin: 1.5cm; }
    body { font-family: 'David', 'Times New Roman', serif; line-height: 1.4; color: #000; }
    h1 { color: #b8860b; border-bottom: 3px solid #b8860b; padding-bottom: 8px; margin-bottom: 4px; }
    .summary { background: #f5f5f5; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; display: flex; justify-content: space-between; flex-wrap: wrap; }
    .sum-cell { font-size: 13px; }
    .sum-cell strong { font-size: 18px; color: #b8860b; display: block; }
    .item { border: 1px solid #ccc; border-radius: 6px; padding: 12px; margin-bottom: 12px; page-break-inside: avoid; display: flex; gap: 12px; }
    .item-photo { width: 80px; height: 80px; flex-shrink: 0; border: 1px solid #ddd; background: #f9f9f9; display: flex; align-items: center; justify-content: center; color: #999; font-size: 24px; }
    .item-photo img { width: 100%; height: 100%; object-fit: cover; }
    .item-body { flex: 1; }
    .item-name { font-weight: bold; font-size: 15px; margin-bottom: 4px; }
    .item-meta { font-size: 11px; color: #666; margin-bottom: 6px; }
    .item-prices { display: flex; gap: 16px; font-size: 13px; }
    .item-price { background: #f0f0f0; padding: 4px 8px; border-radius: 4px; }
    .price-profit { color: #2d8659; font-weight: bold; }
    .price-loss { color: #b91c1c; font-weight: bold; }
    .item-notes { font-size: 11px; color: #555; margin-top: 6px; padding-top: 6px; border-top: 1px dotted #ccc; }
    .footer { margin-top: 30px; padding-top: 15px; border-top: 2px solid #b8860b; font-size: 11px; color: #666; text-align: center; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <h1>קטלוג מלאי - שמאי</h1>
  <div style="font-size:13px;color:#666;margin-bottom:16px">${today} · ${{all:'כל הפריטים',watching:'במעקב',bought:'במלאי',sold:'נמכרים'}[filter] || ''}</div>

  <div class="summary">
    <div class="sum-cell"><strong>${items.length}</strong>פריטים</div>
    <div class="sum-cell"><strong>₪${fmt0(totalValue)}</strong>שווי כולל</div>
    <div class="sum-cell"><strong>₪${fmt0(totalProfit)}</strong>${filter === 'sold' ? 'רווח' : 'פוטנציאל'}</div>
  </div>

  ${items.map(o => {
    const profit = o.status === 'sold' ?
      (o.salePrice || 0) - (o.purchasePrice || o.asking || 0) :
      (o.estimate || 0) - (o.asking || 0);
    const cat = OPP_CATEGORIES.find(c => c.k === o.category)?.name || '';
    return `
    <div class="item">
      <div class="item-photo">${isImageData(o.photo, IMAGE_LEGACY_MAX_CHARS) ? `<img src="${escapeHtml(o.photo)}" alt="" />` : '📷'}</div>
      <div class="item-body">
        <div class="item-name">${escapeHtml(o.name || '—')}</div>
        <div class="item-meta">
          ${cat} · ${{watching:'במעקב',bought:'במלאי',sold:'נמכר'}[o.status]} · ${shortDate(o.created)}
          ${o.seller ? ` · ${escapeHtml(o.seller)}` : ''}
        </div>
        <div class="item-prices">
          ${o.asking ? `<span class="item-price">מבוקש: ₪${fmt0(o.asking)}</span>` : ''}
          ${o.estimate ? `<span class="item-price">משוער: ₪${fmt0(o.estimate)}</span>` : ''}
          ${o.purchasePrice ? `<span class="item-price">קנייה: ₪${fmt0(o.purchasePrice)}</span>` : ''}
          ${o.salePrice ? `<span class="item-price">מכירה: ₪${fmt0(o.salePrice)}</span>` : ''}
          ${profit !== 0 ? `<span class="${profit >= 0 ? 'price-profit' : 'price-loss'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)}</span>` : ''}
        </div>
        ${o.notes ? `<div class="item-notes">${escapeHtml(o.notes)}</div>` : ''}
      </div>
    </div>
  `;
  }).join('')}

  <div class="footer">
    הופק מ-שמאי | ${today} | ${items.length} פריטים
  </div>
</body>
</html>`;

  openPrintPreview(html);
}


// ─────────────────────────────────────────────────────────────────────────────
//  WIRE v6 EVENTS
// ─────────────────────────────────────────────────────────────────────────────

(function wireV6() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(wireV6, 300));
    return;
  }
  setTimeout(() => {
    // Barcode scanner button
    $('#btn-scan-barcode')?.addEventListener('click', scanBarcodeForOpp);
    // Catalog print
    $('#btn-print-catalog')?.addEventListener('click', () => {
      const filter = state.ledger?.filter || 'all';
      printCatalog(filter);
    });
  }, 500);
})();

// Override oppAction to handle new actions
const oldOppActionV6 = oppAction;
window.oppAction = async function(id, action, ...args) {
  if (action === 'audio') {
    recordAudioNote(id);
    return;
  }
  if (action === 'play-audio') {
    const opp = state.opportunities.find(o => o.id === id);
    if (!opp || !opp.audioNotes) return;
    const note = opp.audioNotes.find(n => n.id === args[0]);
    if (note) playAudioNote(note.data);
    return;
  }
  if (action === 'delete-audio') {
    deleteAudioNote(id, args[0]);
    return;
  }
  if (action === 'remind') {
    const days = parseInt(await ssDialog.prompt('בכמה ימים להזכיר?', '7', { type: 'number' }));
    if (!isNaN(days) && days > 0) setReminderForOpp(id, days);
    return;
  }
  if (action === 'clear-remind') {
    clearReminder(id);
    return;
  }
  if (action === 'lookup-google') {
    const opp = state.opportunities.find(o => o.id === id);
    if (opp) lookupOnGoogle(opp);
    return;
  }
  if (action === 'lookup-ebay') {
    const opp = state.opportunities.find(o => o.id === id);
    if (opp) lookupOnEbay(opp);
    return;
  }
  if (action === 'save-template') {
    const opp = state.opportunities.find(o => o.id === id);
    if (opp) saveAsTemplate(opp);
    return;
  }
  return oldOppActionV6.apply(this, arguments);
};


// ─────────────────────────────────────────────────────────────────────────────
//  DRAG & DROP - reorder opportunities in ledger
// ─────────────────────────────────────────────────────────────────────────────

let dragSrcId = null;

function enableDragDrop() {
  // Set draggable + handlers on each opp card
  document.querySelectorAll('.opp-card').forEach(card => {
    if (card.dataset.dragWired) return;
    card.dataset.dragWired = '1';
    card.draggable = true;

    card.addEventListener('dragstart', e => {
      dragSrcId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSrcId);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.opp-card').forEach(c => c.classList.remove('drag-over'));
      dragSrcId = null;
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (card.dataset.id !== dragSrcId) {
        card.classList.add('drag-over');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const targetId = card.dataset.id;
      if (!dragSrcId || !targetId || dragSrcId === targetId) return;
      // Reorder in state.opportunities
      const srcIdx = state.opportunities.findIndex(o => o.id === dragSrcId);
      const tgtIdx = state.opportunities.findIndex(o => o.id === targetId);
      if (srcIdx === -1 || tgtIdx === -1) return;
      const [moved] = state.opportunities.splice(srcIdx, 1);
      state.opportunities.splice(tgtIdx, 0, moved);
      // Add manualOrder timestamp so sort=manual works
      state.opportunities.forEach((o, i) => { o.manualOrder = i; });
      Storage.save('opportunities', state.opportunities);
      // Switch to manual sort if not already
      if (state.ledger?.sort !== 'manual') {
        state.ledger.sort = 'manual';
        const sortSelect = $('#opp-sort');
        if (sortSelect) sortSelect.value = 'manual';
      }
      renderLedger();
      toast('✓ הסדר עודכן', 'success');
    });
  });
}

// Hook into renderLedger to enable drag-drop after each render
const originalRenderLedger = renderLedger;
window.renderLedger = function() {
  originalRenderLedger.apply(this, arguments);
  setTimeout(enableDragDrop, 50);
};

// Add manual sort option dynamically
(function addManualSort() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(addManualSort, 600));
    return;
  }
  setTimeout(() => {
    const sortSelect = $('#opp-sort');
    if (sortSelect && !sortSelect.querySelector('option[value="manual"]')) {
      const opt = document.createElement('option');
      opt.value = 'manual';
      opt.textContent = 'סדר ידני (גרור)';
      sortSelect.appendChild(opt);
    }
  }, 700);
})();

// Extend the sort logic to handle manual
const _originalSortLogic = window.sortOpps || null;
// We'll patch it by wrapping renderLedger - the manual sort needs to read manualOrder
