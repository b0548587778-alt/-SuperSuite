// שמאי — כלים, ייצוא וייבוא. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS
// ─────────────────────────────────────────────────────────────────────────────

// מס רכישה — purchaseTaxBreakdown / calcPurchaseTax / purchaseTaxWarning ב-calc.js (חישוב בלי DOM, משותף למסך הנדל"ן)

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

  if (!(value > 0)) { r.innerHTML = ''; return; }

  const warn = `<div class="tip-box" style="margin-top:14px"><div class="tip-body">${escapeHtml(purchaseTaxWarning())}</div></div>`;
  const b = purchaseTaxBreakdown(value, status);
  if (!b) {
    r.innerHTML = `<div class="tip-box"><div class="tip-title">עולה חדש</div><div class="tip-body">לעולה חדש יש מדרגות מס רכישה מיוחדות, ואין להן טבלה בתוכנה. יש לחשב במחשבון מס רכישה של רשות המסים.</div></div>`;
    return;
  }
  const totalTax = b.taxAg / 100;
  const bracketDetails = b.rows.filter(x => x.rate > 0 && x.portionAg > 0)
    .map(x => `${fmt(x.rate * 100, 1)}% על ₪${fmt0(x.portionAg / 100)} = ₪${fmt(x.taxAg / 100)}`);

  const effectiveRate = (b.taxAg / b.valueAg) * 100;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">סה"כ מס רכישה (הערכה)</span>
      <strong>₪${fmt0(totalTax)}</strong>
    </div>
    <div class="r-row"><span class="r-label">שיעור אפקטיבי</span><span class="r-value">${fmt(effectiveRate, 2)}%</span></div>
    <div class="r-row sep"><span class="r-label">שווי הנכס</span><span class="r-value">₪${fmt0(value)}</span></div>
    <div class="r-row"><span class="r-label">סה"כ עלות (כולל מס)</span><span class="r-value gold">₪${fmt0((b.valueAg + b.taxAg) / 100)}</span></div>
    ${bracketDetails.length ? `
      <div class="tip-box" style="margin-top:14px">
        <div class="tip-title">פירוט מדרגות</div>
        <div class="tip-body">
          ${bracketDetails.map(d => `<div>• ${d}</div>`).join('')}
        </div>
      </div>` : ''}
    ${warn}
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

// שערים ביחס לדולר. דולר, אירו וליש"ט — מהשערים שהשמאי הקליד בלוח (eurIls / gbpIls); פעם האירו והליש"ט היו קבועים
// והטקסט טען לשער שמתעדכן מ-API — אין API (סקירת קוד 2.11.2026). CHF / JPY — מקורבים קבועים
function currencyRates(prices) {
  const p = prices || {};
  const usdIls = p.usdIls > 0 ? p.usdIls : DEFAULT_PRICES.usdIls;
  const eurIls = p.eurIls > 0 ? p.eurIls : DEFAULT_PRICES.eurIls;
  const gbpIls = p.gbpIls > 0 ? p.gbpIls : DEFAULT_PRICES.gbpIls;
  return { USD: 1, ILS: usdIls, EUR: usdIls / eurIls, GBP: usdIls / gbpIls, CHF: 0.88, JPY: 150 };
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

  const rates = currencyRates(state.prices);

  const inUSD = amount / rates[from];
  const result = inUSD * rates[to];

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">${amount} ${from}</span>
      <strong>${fmt(result, 2)} ${to}</strong>
    </div>
    <div class="r-row sep"><span class="r-label">שער</span><span class="r-value">1 ${from} = ${fmt(rates[to] / rates[from], 4)} ${to}</span></div>
    <div class="text-faint" style="margin-top:10px">דולר, אירו וליש״ט — לפי השערים בלוח המחירים (הקלדה או קובץ, בלי אינטרנט). פרנק שוויצרי ויין — שערים מקורבים קבועים.</div>
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
