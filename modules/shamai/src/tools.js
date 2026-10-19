// שמאי — כלים, ייצוא וייבוא. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS
// ─────────────────────────────────────────────────────────────────────────────

function recalcROI() {
  const buy = parseFloat($('#r-buy')?.value);
  const sell = parseFloat($('#r-sell')?.value);
  const fees = parseFloat($('#r-fees')?.value) || 0;
  const feesType = $('#r-fees-type')?.value || 'pct';
  const days = parseFloat($('#r-days')?.value) || 0;
  const r = $('#r-result');
  if (!r) return;

  if (!buy || !sell) { r.innerHTML = ''; return; }

  const feesAmount = feesType === 'pct' ? sell * (fees / 100) : fees;
  const netSell = sell - feesAmount;
  const profit = netSell - buy;
  const roi = (profit / buy) * 100;
  const annualized = days > 0 ? (Math.pow(1 + (profit / buy), 365 / days) - 1) * 100 : null;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">רווח נטו</span>
      <strong style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">ROI</span>
      <span class="r-value ${profit >= 0 ? 'green' : 'red'}">${profit >= 0 ? '+' : ''}${fmt(roi)}%</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">עמלות / מסים</span>
      <span class="r-value">₪${fmt0(feesAmount)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">קבלה נטו</span>
      <span class="r-value">₪${fmt0(netSell)}</span>
    </div>
    ${annualized !== null ? `
    <div class="r-row sep">
      <span class="r-label">תשואה שנתית מקבילה</span>
      <span class="r-value gold">${fmt(annualized)}%</span>
    </div>` : ''}
    <div class="tip-box">
      <div class="tip-title">∞ ROI - מקדמי השוואה</div>
      <div class="tip-body">
        תשואה שנתית: שוק 10-12% · נדל"ן 4-7% · אג"ח 4-5% · פק"מ 3-4%
      </div>
    </div>
  `;
}

function recalcMortgage() {
  const amount = parseFloat($('#mt-amount')?.value);
  const rate = parseFloat($('#mt-rate')?.value);
  const years = parseInt($('#mt-years')?.value);
  const type = $('#mt-type')?.value || 'spitzer';
  const r = $('#mt-result');
  if (!r) return;
  if (!amount || !rate || !years) { r.innerHTML = ''; return; }

  const months = years * 12;
  const monthlyRate = rate / 100 / 12;

  let monthly, totalPaid, totalInterest, firstMonthly, lastMonthly;
  if (type === 'spitzer') {
    monthly = amount * monthlyRate * Math.pow(1 + monthlyRate, months) / (Math.pow(1 + monthlyRate, months) - 1);
    totalPaid = monthly * months;
    totalInterest = totalPaid - amount;
    firstMonthly = monthly;
    lastMonthly = monthly;
  } else {
    // Equal Principal
    const principalMonthly = amount / months;
    firstMonthly = principalMonthly + (amount * monthlyRate);
    lastMonthly = principalMonthly + (principalMonthly * monthlyRate);
    monthly = (firstMonthly + lastMonthly) / 2;
    // Total interest in equal principal: sum of (remaining * rate)
    totalInterest = 0;
    for (let i = 0; i < months; i++) {
      const remaining = amount - (principalMonthly * i);
      totalInterest += remaining * monthlyRate;
    }
    totalPaid = amount + totalInterest;
  }

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">החזר חודשי ${type === 'equal-principal' ? 'ראשון' : ''}</span>
      <strong>₪${fmt0(firstMonthly)}</strong>
    </div>
    ${type === 'equal-principal' ? `
    <div class="r-row">
      <span class="r-label">החזר חודשי אחרון</span>
      <span class="r-value">₪${fmt0(lastMonthly)}</span>
    </div>` : ''}
    <div class="r-row sep">
      <span class="r-label">סה"כ ישולם</span>
      <span class="r-value">₪${fmt0(totalPaid)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">סה"כ ריבית</span>
      <span class="r-value yellow">₪${fmt0(totalInterest)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">% ריבית מסך ההלוואה</span>
      <span class="r-value">${fmt((totalInterest/amount)*100)}%</span>
    </div>
    <div class="tip-box">
      <div class="tip-title">⌂ משכנתא בישראל</div>
      <div class="tip-body">
        <ul>
          <li><strong>שפיצר:</strong> החזר קבוע, רוב הריבית בהתחלה</li>
          <li><strong>קרן שווה:</strong> החזר יורד עם הזמן, פחות ריבית כללית</li>
          <li>הקטנת תקופה ב-5 שנים → חיסכון של 20-30% בריבית כוללת</li>
          <li>פירעון מוקדם בלי קנס: לרוב 10% בשנה מהקרן</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcRental() {
  const price = parseFloat($('#rn-price')?.value);
  const rent = parseFloat($('#rn-rent')?.value);
  const vaad = parseFloat($('#rn-vaad')?.value) || 0;
  const arnona = parseFloat($('#rn-arnona')?.value) || 0;
  const insurance = parseFloat($('#rn-insurance')?.value) || 0;
  const maint = parseFloat($('#rn-maint')?.value) || 0;
  const vacancy = parseFloat($('#rn-vacancy')?.value) || 0;
  const r = $('#rn-result');
  if (!r) return;
  if (!price || !rent) { r.innerHTML = ''; return; }

  const annualRent = rent * (12 - vacancy);
  const annualExpenses = (vaad * 12) + (arnona * 12) + insurance + maint;
  const netAnnual = annualRent - annualExpenses;
  const grossYield = (rent * 12 / price) * 100;
  const netYield = (netAnnual / price) * 100;
  const capRate = netYield;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">תשואה נטו שנתית</span>
      <strong style="color:${netYield >= 4 ? 'var(--green)' : 'var(--yellow)'}">${fmt(netYield)}%</strong>
    </div>
    <div class="r-row">
      <span class="r-label">תשואה ברוטו</span>
      <span class="r-value">${fmt(grossYield)}%</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">הכנסה שנתית (אחרי ריקנות)</span>
      <span class="r-value green">₪${fmt0(annualRent)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">הוצאות שנתיות</span>
      <span class="r-value red">₪${fmt0(annualExpenses)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">הכנסה נטו שנתית</span>
      <span class="r-value">₪${fmt0(netAnnual)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">הכנסה נטו חודשית</span>
      <span class="r-value gold">₪${fmt0(netAnnual / 12)}</span>
    </div>
    <div class="tip-box">
      <div class="tip-title">▦ תשואה - מה נחשב טוב?</div>
      <div class="tip-body">
        <ul>
          <li>פחות מ-3% נטו: עסקה חלשה (אלא אם פוטנציאל השבחה)</li>
          <li>3-4% נטו: ממוצע שוק ישראלי</li>
          <li>4-6% נטו: עסקה טובה</li>
          <li>6%+ נטו: יוצאת דופן (בדוק שלא חסר משהו)</li>
        </ul>
      </div>
    </div>
  `;
}

function calcPurchaseTax(value, status) {
  let brackets;
  if (status === 'single') brackets = PURCHASE_TAX_SINGLE;
  else brackets = PURCHASE_TAX_ADDITIONAL;

  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    if (value <= b.upTo) {
      tax += (value - prev) * b.rate;
      break;
    }
    tax += (b.upTo - prev) * b.rate;
    prev = b.upTo;
  }

  // New immigrant gets reduced rates (simplified)
  if (status === 'new-immigrant') {
    tax = tax * 0.5;
  }
  return tax;
}

function recalcReTax() {
  const mode = state.tools.rePurchase;
  if (mode === 'purchase') {
    const value = parseFloat($('#tx-value')?.value);
    const status = $('#tx-status')?.value || 'additional';
    const r = $('#tx-result');
    if (!r) return;
    if (!value) { r.innerHTML = ''; return; }

    const tax = calcPurchaseTax(value, status);
    const effective = (tax / value) * 100;

    // Show breakdown
    let bracketsHtml = '';
    const brackets = status === 'single' ? PURCHASE_TAX_SINGLE : PURCHASE_TAX_ADDITIONAL;
    let prev = 0;
    for (const b of brackets) {
      if (value <= prev) break;
      const portion = Math.min(value, b.upTo) - prev;
      const portionTax = portion * b.rate;
      bracketsHtml += `<div class="r-row"><span class="r-label">₪${fmt0(prev)} - ₪${b.upTo === Infinity ? '∞' : fmt0(b.upTo)} (${(b.rate*100).toFixed(2)}%)</span><span class="r-value">₪${fmt0(portionTax)}</span></div>`;
      prev = b.upTo;
      if (value <= b.upTo) break;
    }

    r.innerHTML = `
      <div class="r-row big">
        <span class="r-label">מס רכישה</span>
        <strong>₪${fmt0(tax)}</strong>
      </div>
      <div class="r-row">
        <span class="r-label">שיעור אפקטיבי</span>
        <span class="r-value">${fmt(effective)}%</span>
      </div>
      <div class="r-row sep">
        <span class="r-label">סה"כ עלות הנכס</span>
        <span class="r-value gold">₪${fmt0(value + tax)}</span>
      </div>
      <div class="r-row sep" style="font-weight:700">פירוק לפי מדרגות:</div>
      ${bracketsHtml}
      <div class="tip-box">
        <div class="tip-title">₪ מס רכישה 2026</div>
        <div class="tip-body">
          ${status === 'single' ? 'דירה יחידה: פטור עד 1.97M, אחר כך 3.5%-10% במדרגות' : status === 'additional' ? 'דירה נוספת: 8% עד 6M, 10% מעבר לכך' : 'עולה חדש: הקלה ~50% במדרגות'}
        </div>
      </div>
    `;
  } else {
    // Appreciation tax (מס שבח)
    const buy = parseFloat($('#ap-buy')?.value);
    const sell = parseFloat($('#ap-sell')?.value);
    const expenses = parseFloat($('#ap-expenses')?.value) || 0;
    const years = parseFloat($('#ap-years')?.value) || 1;
    const single = $('#ap-single')?.checked;
    const r = $('#ap-result');
    if (!r) return;
    if (!buy || !sell) { r.innerHTML = ''; return; }

    const grossGain = sell - buy - expenses;
    let tax = 0;
    let rate = 0;
    if (single) {
      rate = 0;
    } else {
      // Simplified: 25% on real gain (after inflation adjustment ~2-3%/yr)
      const realGain = grossGain * Math.pow(0.97, years); // rough inflation adjustment
      rate = 25;
      tax = Math.max(0, realGain * 0.25);
    }
    const netProfit = grossGain - tax;

    r.innerHTML = `
      <div class="r-row big">
        <span class="r-label">מס שבח</span>
        <strong>₪${fmt0(tax)}</strong>
      </div>
      <div class="r-row">
        <span class="r-label">שבח ברוטו</span>
        <span class="r-value">₪${fmt0(grossGain)}</span>
      </div>
      <div class="r-row">
        <span class="r-label">שיעור מס</span>
        <span class="r-value">${rate}%</span>
      </div>
      <div class="r-row sep">
        <span class="r-label">רווח נטו</span>
        <span class="r-value gold">₪${fmt0(netProfit)}</span>
      </div>
      <div class="tip-box">
        <div class="tip-title">₪ מס שבח</div>
        <div class="tip-body">
          ${single ? 'דירה יחידה - פטור מלא (אם עומדים בתנאים)' : '25% מהשבח הריאלי (אחרי הצמדה למדד). ייתכן זכאות להקלות.'}
          <br><strong>חשוב:</strong> קח ייעוץ ספציפי - יש המון פטורים והקלות.
        </div>
      </div>
    `;
  }
}

function recalcVehicle() {
  const buy = parseFloat($('#v-buy')?.value);
  const sell = parseFloat($('#v-sell')?.value);
  const years = parseFloat($('#v-years')?.value) || 1;
  const insurance = parseFloat($('#v-insurance')?.value) || 0;
  const test = parseFloat($('#v-test')?.value) || 0;
  const fuel = parseFloat($('#v-fuel')?.value) || 0;
  const service = parseFloat($('#v-service')?.value) || 0;
  const r = $('#v-result');
  if (!r) return;
  if (!buy) { r.innerHTML = ''; return; }

  const depreciation = buy - sell;
  const annualDep = depreciation / years;
  const annualOps = (insurance + test) + (fuel * 12) + service;
  const totalAnnual = annualDep + annualOps;
  const monthlyTotal = totalAnnual / 12;
  const perKm = totalAnnual / 15000; // assume 15K km/year

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">עלות חודשית כוללת</span>
      <strong>₪${fmt0(monthlyTotal)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">עלות שנתית</span>
      <span class="r-value">₪${fmt0(totalAnnual)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">פיחות שנתי</span>
      <span class="r-value red">₪${fmt0(annualDep)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">תפעול שנתי</span>
      <span class="r-value">₪${fmt0(annualOps)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">דלק שנתי</span>
      <span class="r-value">₪${fmt0(fuel * 12)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">עלות לקילומטר (15K/שנה)</span>
      <span class="r-value gold">₪${fmt(perKm)}</span>
    </div>
    <div class="tip-box">
      <div class="tip-title">⚙ עלות רכב אמיתית</div>
      <div class="tip-body">
        רוב האנשים מתעלמים מהפיחות - אבל זו ההוצאה הגדולה ביותר ברכב.
        <br>רכב חדש מאבד 20-30% בשנה הראשונה!
      </div>
    </div>
  `;
}

function recalcCurrency() {
  const amount = parseFloat($('#cu-amount')?.value);
  const from = $('#cu-from')?.value || 'USD';
  const to = $('#cu-to')?.value || 'ILS';
  const r = $('#cu-result');
  if (!r) return;
  if (!amount) { r.innerHTML = ''; return; }

  // Convert via USD as base
  const usdIls = state.prices.usdIls;
  const fx = state.prices.fxRates || {};
  // fx.X = how many X per 1 USD
  const fromToUsd = from === 'USD' ? 1 : from === 'ILS' ? 1 / usdIls : (1 / fx[from]);
  const usdToTarget = to === 'USD' ? 1 : to === 'ILS' ? usdIls : fx[to];

  const usdAmount = amount * fromToUsd;
  const result = usdAmount * usdToTarget;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">${amount} ${from}</span>
      <strong>${fmt(result, to === 'JPY' ? 0 : 2)} ${to}</strong>
    </div>
    <div class="r-row sep">
      <span class="r-label">שער</span>
      <span class="r-value">1 ${from} = ${fmt(result/amount, 4)} ${to}</span>
    </div>
    <div class="r-row">
      <span class="r-label">בדולרים</span>
      <span class="r-value">$${fmt(usdAmount)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">בשקלים</span>
      <span class="r-value">₪${fmt0(usdAmount * usdIls)}</span>
    </div>
  `;
}

function renderCryptoFull() {
  const usdIls = state.prices.usdIls;
  $('#crypto-full').innerHTML = CRYPTO_COINS.map(c => {
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
  recalcCryptoConvert();
}

function recalcCryptoConvert() {
  const amount = parseFloat($('#cr-amount')?.value);
  const coinId = $('#cr-coin')?.value;
  const r = $('#cr-convert');
  if (!r) return;
  if (!amount || !coinId) { r.innerHTML = ''; return; }

  const price = state.prices[coinId];
  const symbol = CRYPTO_COINS.find(c => c.id === coinId)?.symbol;
  const usdIls = state.prices.usdIls;
  const usd = amount * price;
  const ils = usd * usdIls;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">${amount} ${symbol}</span>
      <strong>$${fmt0(usd)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">בשקלים</span>
      <span class="r-value gold">₪${fmt0(ils)}</span>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPORT / IMPORT
// ─────────────────────────────────────────────────────────────────────────────

function exportJSON() {
  const data = {
    version: '2.0',
    exported: new Date().toISOString(),
    opportunities: state.opportunities,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shamai-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('יוצא JSON', 'success');
}

function exportCSV() {
  if (state.opportunities.length === 0) { toast('אין מה לייצא', 'error'); return; }
  const headers = ['שם', 'קטגוריה', 'סטטוס', 'מבוקש', 'משוער', 'נקנה', 'נמכר', 'רווח', 'מוכר', 'תאריך', 'הערות'];
  const rows = state.opportunities.map(o => [
    o.name || '',
    OPP_CATEGORIES.find(c => c.k === o.category)?.name || '',
    {watching:'במעקב',bought:'נקנה',sold:'נמכר'}[o.status] || '',
    o.asking || '',
    o.estimate || '',
    o.purchasePrice || '',
    o.salePrice || '',
    o.salePrice ? (o.salePrice - (o.purchasePrice || o.asking || 0)) : '',
    o.seller || '',
    shortDate(o.created),
    (o.notes || '').replace(/[\n,"]/g, ' '),
  ]);
  const csv = '\ufeff' + [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shamai-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('יוצא CSV', 'success');
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.opportunities || !Array.isArray(data.opportunities)) throw new Error('פורמט לא תקין');
      const mode = await ssDialog.choose(`לייבא ${data.opportunities.length} פריטים?`, [
        { label: 'להוסיף לקיים', value: 'merge' }, { label: 'להחליף את הקיים', value: 'replace', kind: 'danger' }]);
      if (!mode) return;
      if (mode === 'merge') {
        state.opportunities = [...data.opportunities, ...state.opportunities];
      } else {
        if (!(await ssDialog.confirm('להחליף את כל הנתונים הקיימים?', { danger: true }))) return;
        state.opportunities = data.opportunities;
      }
      Storage.save('opportunities', state.opportunities);
      renderLedger();
      toast(`יובא ${data.opportunities.length} פריטים`, 'success');
    } catch (err) {
      toast('שגיאה: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}


// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS - ROI, Mortgage, Rental, Tax, Vehicle, Currency, Crypto, Settings
// ─────────────────────────────────────────────────────────────────────────────

function recalcROI() {
  const r = $('#r-result');
  if (!r) return;
  const buy = parseFloat($('#r-buy').value) || 0;
  const sell = parseFloat($('#r-sell').value) || 0;
  const fees = parseFloat($('#r-fees').value) || 0;
  const feesType = $('#r-fees-type').value;
  const days = parseInt($('#r-days').value) || 0;

  if (!buy || !sell) { r.innerHTML = ''; return; }

  const feesAbs = feesType === 'pct' ? sell * (fees / 100) : fees;
  const netSell = sell - feesAbs;
  const profit = netSell - buy;
  const roi = (profit / buy) * 100;
  const annualROI = days > 0 ? roi * (365 / days) : 0;

  r.innerHTML = `
    <div class="r-row"><span class="r-label">השקעה</span><span class="r-value">₪${fmt0(buy)}</span></div>
    <div class="r-row"><span class="r-label">תקבול ברוטו</span><span class="r-value">₪${fmt0(sell)}</span></div>
    <div class="r-row"><span class="r-label">(-) עמלות</span><span class="r-value">₪${fmt0(feesAbs)}</span></div>
    <div class="r-row sep"><span class="r-label">תקבול נטו</span><span class="r-value">₪${fmt0(netSell)}</span></div>
    <div class="r-row big">
      <span class="r-label">רווח נקי</span>
      <strong style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)}</strong>
    </div>
    <div class="r-row"><span class="r-label">תשואה (ROI)</span><span class="r-value" style="color:${roi >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(roi, 1)}%</span></div>
    ${days > 0 ? `<div class="r-row"><span class="r-label">תשואה שנתית מתוקננת</span><span class="r-value">${fmt(annualROI, 1)}%</span></div>` : ''}
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">∞ סוגי עמלות לזכור</div>
      <div class="tip-body">
        <ul>
          <li>Sotheby's/Christies: 25% קונה +15% מוכר</li>
          <li>Kedem: 22% קונה, 12-18% מוכר</li>
          <li>eBay: 13% מהמוכר</li>
          <li>Chrono24: 6.5%</li>
          <li>מס רווח הון בישראל: 25%</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcMortgage() {
  const r = $('#mt-result');
  if (!r) return;
  const P = parseFloat($('#mt-amount').value) || 0;
  const annualRate = parseFloat($('#mt-rate').value) || 0;
  const years = parseInt($('#mt-years').value) || 0;
  const type = $('#mt-type').value;

  if (!P || !years || annualRate < 0) { r.innerHTML = ''; return; }

  const months = years * 12;
  const monthlyRate = (annualRate / 100) / 12;
  let monthly, totalInterest, totalPaid;

  if (type === 'spitzer') {
    if (monthlyRate === 0) {
      monthly = P / months;
    } else {
      monthly = P * monthlyRate * Math.pow(1 + monthlyRate, months) / (Math.pow(1 + monthlyRate, months) - 1);
    }
    totalPaid = monthly * months;
    totalInterest = totalPaid - P;
  } else {
    // Equal principal
    const principalPerMonth = P / months;
    let totalInt = 0;
    let firstPayment = 0;
    let remaining = P;
    for (let i = 0; i < months; i++) {
      const intPart = remaining * monthlyRate;
      totalInt += intPart;
      if (i === 0) firstPayment = principalPerMonth + intPart;
      remaining -= principalPerMonth;
    }
    totalInterest = totalInt;
    totalPaid = P + totalInt;
    monthly = firstPayment; // first month
  }

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">החזר חודשי${type === 'equal-principal' ? ' (ראשון)' : ''}</span>
      <strong>₪${fmt0(monthly)}</strong>
    </div>
    <div class="r-row sep"><span class="r-label">סה"כ ריבית לאורך התקופה</span><span class="r-value">₪${fmt0(totalInterest)}</span></div>
    <div class="r-row"><span class="r-label">סה"כ תשלום</span><span class="r-value gold">₪${fmt0(totalPaid)}</span></div>
    <div class="r-row"><span class="r-label">יחס ריבית/קרן</span><span class="r-value">${fmt(totalInterest / P * 100, 1)}%</span></div>
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">⌂ טיפים</div>
      <div class="tip-body">
        <ul>
          <li>שפיצר: החזר חודשי קבוע, מתחילים בעיקר ריבית</li>
          <li>קרן שווה: החזר חודשי יורד, חיסכון בריבית כוללת</li>
          <li>ריבית פריים בישראל ~5-6.5% (2026)</li>
          <li>פירעון מוקדם חוסך ריבית - אבל יש קנס מסלול</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcRental() {
  const r = $('#rn-result');
  if (!r) return;
  const price = parseFloat($('#rn-price').value) || 0;
  const rent = parseFloat($('#rn-rent').value) || 0;
  const vaad = parseFloat($('#rn-vaad').value) || 0;
  const arnona = parseFloat($('#rn-arnona').value) || 0;
  const insurance = parseFloat($('#rn-insurance').value) || 0;
  const maint = parseFloat($('#rn-maint').value) || 0;
  const vacancy = parseFloat($('#rn-vacancy').value) || 0;

  if (!price || !rent) { r.innerHTML = ''; return; }

  const grossYearly = rent * 12;
  const expensesYearly = (vaad * 12) + (arnona * 12) + insurance + maint;
  const vacancyLoss = rent * vacancy;
  const netYearly = grossYearly - expensesYearly - vacancyLoss;

  const grossYield = (grossYearly / price) * 100;
  const netYield = (netYearly / price) * 100;
  const monthlyNet = netYearly / 12;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">תשואה שנתית נטו</span>
      <strong style="color:var(--gold)">${fmt(netYield, 2)}%</strong>
    </div>
    <div class="r-row"><span class="r-label">תשואה גולמית (Cap Rate)</span><span class="r-value">${fmt(grossYield, 2)}%</span></div>
    <div class="r-row sep"><span class="r-label">הכנסה שנתית גולמית</span><span class="r-value">₪${fmt0(grossYearly)}</span></div>
    <div class="r-row"><span class="r-label">(-) הוצאות שנתיות</span><span class="r-value">₪${fmt0(expensesYearly)}</span></div>
    <div class="r-row"><span class="r-label">(-) ריקנות צפויה</span><span class="r-value">₪${fmt0(vacancyLoss)}</span></div>
    <div class="r-row big sep"><span class="r-label">הכנסה שנתית נטו</span><strong>₪${fmt0(netYearly)}</strong></div>
    <div class="r-row"><span class="r-label">לחודש (נטו)</span><span class="r-value">₪${fmt0(monthlyNet)}</span></div>
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">▦ Cap Rate בישראל</div>
      <div class="tip-body">
        <ul>
          <li>מרכז ת"א: 2-3% (יקר, פוטנציאל עליית ערך)</li>
          <li>פריפריה: 5-7% (זול, פוטנציאל עליית ערך נמוך)</li>
          <li>ירושלים: 3-4.5%</li>
          <li>5%+ נחשב סביר להשקעה</li>
          <li>חישוב לא כולל עליית ערך עתידית או מינוף</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcPurchaseTax() {
  const r = $('#tx-result');
  if (!r) return;
  const value = parseFloat($('#tx-value').value) || 0;
  const status = $('#tx-status').value;

  if (!value) { r.innerHTML = ''; return; }

  const brackets = status === 'single' ? PURCHASE_TAX_SINGLE : PURCHASE_TAX_ADDITIONAL;
  let totalTax = 0;
  let bracketDetails = [];
  let remaining = value;

  for (const b of brackets) {
    if (remaining <= 0) break;
    const inThisBracket = Math.min(remaining, b.limit ? b.limit - (b.from || 0) : Infinity);
    if (inThisBracket > 0) {
      const taxFromBracket = inThisBracket * b.rate;
      totalTax += taxFromBracket;
      if (b.rate > 0) {
        bracketDetails.push(`${(b.rate * 100).toFixed(1)}% על ₪${fmt0(inThisBracket)} = ₪${fmt0(taxFromBracket)}`);
      }
      remaining -= inThisBracket;
    }
  }

  const effectiveRate = (totalTax / value) * 100;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">סה"כ מס רכישה</span>
      <strong>₪${fmt0(totalTax)}</strong>
    </div>
    <div class="r-row"><span class="r-label">שיעור אפקטיבי</span><span class="r-value">${fmt(effectiveRate, 2)}%</span></div>
    <div class="r-row sep"><span class="r-label">שווי הנכס</span><span class="r-value">₪${fmt0(value)}</span></div>
    <div class="r-row"><span class="r-label">סה"כ עלות (כולל מס)</span><span class="r-value gold">₪${fmt0(value + totalTax)}</span></div>
    ${bracketDetails.length ? `
      <div class="tip-box" style="margin-top:14px">
        <div class="tip-title">פירוט מדרגות</div>
        <div class="tip-body">
          ${bracketDetails.map(d => `<div>• ${d}</div>`).join('')}
        </div>
      </div>` : ''}
  `;
}

function recalcAppreciation() {
  const r = $('#ap-result');
  if (!r) return;
  const buy = parseFloat($('#ap-buy').value) || 0;
  const sell = parseFloat($('#ap-sell').value) || 0;
  const expenses = parseFloat($('#ap-expenses').value) || 0;
  const years = parseInt($('#ap-years').value) || 0;
  const single = $('#ap-single').checked;

  if (!buy || !sell) { r.innerHTML = ''; return; }

  const profit = sell - buy - expenses;

  let tax = 0;
  let exemptionNote = '';

  if (single) {
    tax = 0;
    exemptionNote = 'פטור מלא (דירה יחידה - פעם ב-18 חודש)';
  } else {
    // 25% on real gain (after CPI - simplified here)
    tax = profit > 0 ? profit * 0.25 : 0;
    exemptionNote = '25% מס שבח על רווח ריאלי';
  }

  const netProfit = profit - tax;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">רווח לפני מס</span>
      <strong>₪${fmt0(profit)}</strong>
    </div>
    <div class="r-row"><span class="r-label">מס שבח</span><span class="r-value">₪${fmt0(tax)}</span></div>
    <div class="r-row big sep"><span class="r-label">רווח נקי</span><strong style="color:var(--gold)">₪${fmt0(netProfit)}</strong></div>
    <div class="r-row"><span class="r-label">תשואה כוללת</span><span class="r-value">${fmt((netProfit / buy) * 100, 1)}%</span></div>
    ${years > 0 ? `<div class="r-row"><span class="r-label">תשואה שנתית מצטברת</span><span class="r-value">${fmt(Math.pow((sell / buy), 1 / years) * 100 - 100, 2)}%</span></div>` : ''}
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">${exemptionNote}</div>
      <div class="tip-body">
        <ul>
          <li>מס שבח חל על רווח ריאלי - הצמדה למדד מקטינה את המס</li>
          <li>פטור דירה יחידה: לפי תקופת החזקה ושימוש</li>
          <li>הוצאות מוכרות: שיפוצים, שמאי, עו"ד, תיווך, מס רכישה</li>
          <li>חובה: דווח תוך 30 יום ממכירה</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcVehicle() {
  const r = $('#v-result');
  if (!r) return;
  const buy = parseFloat($('#v-buy').value) || 0;
  const sell = parseFloat($('#v-sell').value) || 0;
  const years = parseInt($('#v-years').value) || 1;
  const insurance = parseFloat($('#v-insurance').value) || 0;
  const test = parseFloat($('#v-test').value) || 0;
  const fuel = parseFloat($('#v-fuel').value) || 0;
  const service = parseFloat($('#v-service').value) || 0;

  if (!buy) { r.innerHTML = ''; return; }

  const depreciation = buy - sell;
  const annualDep = depreciation / years;
  const annualInsurance = insurance;
  const annualTest = test;
  const annualFuel = fuel * 12;
  const annualService = service;
  const annualTotal = annualDep + annualInsurance + annualTest + annualFuel + annualService;
  const monthlyTotal = annualTotal / 12;
  const total = annualTotal * years;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">עלות חודשית אמיתית</span>
      <strong>₪${fmt0(monthlyTotal)}</strong>
    </div>
    <div class="r-row"><span class="r-label">עלות שנתית</span><span class="r-value">₪${fmt0(annualTotal)}</span></div>
    <div class="r-row sep"><span class="r-label">פיחות שנתי</span><span class="r-value">₪${fmt0(annualDep)}</span></div>
    <div class="r-row"><span class="r-label">דלק שנתי</span><span class="r-value">₪${fmt0(annualFuel)}</span></div>
    <div class="r-row"><span class="r-label">ביטוח שנתי</span><span class="r-value">₪${fmt0(annualInsurance)}</span></div>
    <div class="r-row"><span class="r-label">טיפולים + טסט שנתי</span><span class="r-value">₪${fmt0(annualService + annualTest)}</span></div>
    <div class="r-row big sep"><span class="r-label">סה"כ ל-${years} שנים</span><strong style="color:var(--gold)">₪${fmt0(total)}</strong></div>
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">⚙ תקציב רכב בישראל</div>
      <div class="tip-body">
        <ul>
          <li>פיחות בשנה ראשונה: 20-30% (גבוה ביותר!)</li>
          <li>שנים 2-5: 8-12% לשנה</li>
          <li>אחרי 7 שנים: 5% לשנה</li>
          <li>יבוא אישי: פיחות נמוך יותר אבל אחזקה יקרה</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcCurrency() {
  const r = $('#cu-result');
  if (!r) return;
  const amount = parseFloat($('#cu-amount').value) || 0;
  const from = $('#cu-from').value;
  const to = $('#cu-to').value;

  if (!amount || from === to) {
    r.innerHTML = `<div class="r-row big"><span class="r-label">תוצאה</span><strong>${amount} ${to}</strong></div>`;
    return;
  }

  // Convert through USD as base
  // ILS rate is direct from API
  // Approximate cross rates:
  const rates = {
    USD: 1,
    ILS: state.prices.usdIls || 3.6,
    EUR: 0.92,
    GBP: 0.79,
    CHF: 0.88,
    JPY: 150,
  };

  const inUSD = amount / rates[from];
  const result = inUSD * rates[to];

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">${amount} ${from}</span>
      <strong>${fmt(result, 2)} ${to}</strong>
    </div>
    <div class="r-row sep"><span class="r-label">שער</span><span class="r-value">1 ${from} = ${fmt(rates[to] / rates[from], 4)} ${to}</span></div>
    <div class="text-faint" style="margin-top:10px">שערים מקורבים. רק USD/ILS מעודכן בזמן אמת מ-API.</div>
  `;
}

function recalcCryptoConvert() {
  const r = $('#cr-convert');
  if (!r) return;
  const amount = parseFloat($('#cr-amount').value) || 0;
  const coin = $('#cr-coin').value;
  const usdPrice = state.prices[coin];
  const change = state.prices[coin + 'Change'];

  if (!amount || !usdPrice) {
    r.innerHTML = `<div class="text-faint">המתן לטעינת מחירי קריפטו...</div>`;
    return;
  }

  const usd = amount * usdPrice;
  const ils = usd * (state.prices.usdIls || 3.6);
  const coinSym = (CRYPTO_COINS.find(c => c.id === coin)?.symbol) || coin.toUpperCase().substring(0, 3);

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">${amount} ${coinSym}</span>
      <strong>$${fmt0(usd)}</strong>
    </div>
    <div class="r-row"><span class="r-label">בשקלים</span><span class="r-value gold">₪${fmt0(ils)}</span></div>
    <div class="r-row sep"><span class="r-label">מחיר נוכחי</span><span class="r-value">$${fmt0(usdPrice)}</span></div>
    ${change ? `<div class="r-row"><span class="r-label">שינוי 24 שעות</span><span class="r-value" style="color:${change >= 0 ? 'var(--green)' : 'var(--red)'}">${change >= 0 ? '+' : ''}${fmt(change, 2)}%</span></div>` : ''}
  `;
}

function renderCryptoFull() {
  const c = $('#crypto-full');
  if (!c) return;
  // Map from CRYPTO_COINS to state.prices fields
  const items = CRYPTO_COINS.map(coin => {
    const usd = state.prices[coin.id];
    const change = state.prices[coin.id + 'Change'] || 0;
    if (!usd) return null;
    return {
      sym: coin.symbol,
      name: coin.name,
      usd,
      ils: usd * (state.prices.usdIls || 3.6),
      change,
    };
  }).filter(Boolean);
  if (items.length === 0) {
    c.innerHTML = '<div class="text-faint" style="grid-column:1/-1;text-align:center;padding:20px">טוען מחירי קריפטו...</div>';
    return;
  }
  c.innerHTML = items.map(d => `
    <div class="card">
      <div class="c-sym">${d.sym}</div>
      <div class="c-name">${d.name}</div>
      <div class="c-price">$${fmt(d.usd, d.usd >= 100 ? 0 : 2)}</div>
      <div class="c-sub">₪${fmt0(d.ils)}</div>
      ${d.change ? `<div class="c-change ${d.change > 0 ? 'up' : 'down'}">${d.change > 0 ? '▲' : '▼'} ${fmt(Math.abs(d.change), 2)}%</div>` : '<div class="c-change">ערך ייחוס</div>'}
    </div>
  `).join('');
}
