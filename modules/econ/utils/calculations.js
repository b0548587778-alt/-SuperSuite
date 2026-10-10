// Core calculation utilities for financial and economic computations

/**
 * Calculate loan/mortgage payment details
 * @param {Object} params - Loan parameters
 * @param {number} params.principal - Loan principal amount
 * @param {number} params.annualRate - Annual interest rate (as decimal, e.g., 0.045 for 4.5%)
 * @param {number} params.years - Loan term in years
 * @returns {Object} Loan calculation results
 */
function calculateLoan({ principal, annualRate, years }) {
  // בדיקה לערכים חסרים (מאפשר ריבית 0 שהיא מקרה חוקי — הלוואה ללא ריבית)
  if (principal === undefined || principal === null ||
      annualRate === undefined || annualRate === null ||
      years === undefined || years === null) {
    throw new Error('Principal, annual rate, and years are required');
  }

  const p = Number(principal);
  const r = Number(annualRate);
  const y = Number(years);

  if (p <= 0 || r < 0 || y <= 0) {
    throw new Error('Invalid loan parameters');
  }

  // Monthly interest rate
  const monthlyRate = r / 12;
  // Total number of payments
  const totalPayments = y * 12;

  // Monthly payment formula: P * r * (1+r)^n / ((1+r)^n - 1)
  let monthlyPayment;
  if (monthlyRate === 0) {
    monthlyPayment = p / totalPayments;
  } else {
    const factor = Math.pow(1 + monthlyRate, totalPayments);
    monthlyPayment = p * monthlyRate * factor / (factor - 1);
  }

  const totalPaid = monthlyPayment * totalPayments;
  const totalInterest = totalPaid - p;

  // Generate yearly breakdown
  const yearlyBreakdown = [];
  let remainingBalance = p;
  
  for (let year = 1; year <= y; year++) {
    let yearlyInterest = 0;
    let yearlyPrincipal = 0;
    
    for (let month = 1; month <= 12; month++) {
      const interestPayment = remainingBalance * monthlyRate;
      const principalPayment = monthlyPayment - interestPayment;
      
      yearlyInterest += interestPayment;
      yearlyPrincipal += principalPayment;
      remainingBalance -= principalPayment;
    }
    
    yearlyBreakdown.push({
      year,
      principalPaid: Math.round(yearlyPrincipal * 100) / 100,
      interestPaid: Math.round(yearlyInterest * 100) / 100,
      remainingBalance: Math.max(0, Math.round(remainingBalance * 100) / 100)
    });
  }

  return {
    principal: p,
    annualRate: r * 100, // Return as percentage
    years: y,
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalInterest: Math.round(totalInterest * 100) / 100,
    yearlyBreakdown
  };
}

/**
 * Calculate compound interest with optional monthly contributions
 * @param {Object} params - Investment parameters
 * @param {number} params.principal - Initial principal
 * @param {number} params.annualRate - Annual interest rate (as decimal)
 * @param {number} params.years - Investment period in years
 * @param {number} params.monthlyContribution - Monthly contribution (default 0)
 * @returns {Object} Investment calculation results
 */
function calculateCompoundInterest({ principal, annualRate, years, monthlyContribution = 0 }) {
  const p = Number(principal);
  const r = Number(annualRate);
  const y = Number(years);
  const m = Number(monthlyContribution) || 0;

  if (p < 0 || r < 0 || y < 0 || m < 0) {
    throw new Error('Values cannot be negative');
  }

  // Future value with monthly compounding and contributions
  const monthlyRate = r / 12;
  const totalMonths = y * 12;
  
  let futureValue;
  if (monthlyRate === 0) {
    futureValue = p + (m * totalMonths);
  } else {
    const factor = Math.pow(1 + monthlyRate, totalMonths);
    futureValue = p * factor + (m * (factor - 1) / monthlyRate);
  }

  const totalContributed = p + (m * totalMonths);
  const totalInterest = futureValue - totalContributed;

  return {
    principal: p,
    annualRate: r * 100,
    years: y,
    monthlyContribution: m,
    totalContributed: Math.round(totalContributed * 100) / 100,
    futureValue: Math.round(futureValue * 100) / 100,
    totalInterest: Math.round(totalInterest * 100) / 100
  };
}

/**
 * Calculate ROI (Return on Investment)
 * @param {number} investment - Initial investment
 * @param {number} returns - Total returns
 * @returns {Object} ROI calculation results
 */
function calculateROI(investment, returns) {
  const inv = Number(investment);
  const ret = Number(returns);

  if (inv <= 0) {
    throw new Error('Investment must be greater than zero');
  }

  const roi = ((ret - inv) / inv) * 100;
  return {
    investment: inv,
    returns: ret,
    roi: Math.round(roi * 100) / 100 + '%',
    profit: Math.round((ret - inv) * 100) / 100
  };
}

/**
 * Calculate NPV (Net Present Value)
 * @param {number} initialInvestment - Initial investment
 * @param {number[]} cashFlows - Array of future cash flows
 * @param {number} discountRate - Discount rate (as decimal)
 * @returns {Object} NPV calculation results
 */
function calculateNPV(initialInvestment, cashFlows, discountRate) {
  const inv = Number(initialInvestment);
  const rate = Number(discountRate);
  const flows = Array.isArray(cashFlows) ? cashFlows : [];

  if (inv < 0 || rate < 0) {
    throw new Error('Invalid parameters');
  }

  let npv = -inv;
  flows.forEach((flow, index) => {
    npv += Number(flow) / Math.pow(1 + rate, index + 1);
  });

  return {
    initialInvestment: inv,
    discountRate: rate * 100,
    npv: Math.round(npv * 100) / 100,
    isProfitable: npv > 0
  };
}

/**
 * Calculate IRR (Internal Rate of Return) - approximation
 * @param {number} initialInvestment - Initial investment
 * @param {number[]} cashFlows - Array of future cash flows
 * @returns {Object} IRR calculation results
 */
function calculateIRR(initialInvestment, cashFlows) {
  const inv = Number(initialInvestment);
  const flows = Array.isArray(cashFlows) ? cashFlows : [];

  if (inv <= 0 || flows.length === 0) {
    throw new Error('Invalid parameters');
  }

  // Simple IRR approximation using binary search
  let low = -0.99;
  let high = 10; // 1000%
  let irr = 0;
  
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    let npv = -inv;
    
    flows.forEach((flow, index) => {
      npv += Number(flow) / Math.pow(1 + mid, index + 1);
    });
    
    if (npv > 0) {
      low = mid;
    } else {
      high = mid;
    }
    
    irr = mid;
  }

  return {
    initialInvestment: inv,
    irr: Math.round(irr * 10000) / 100 + '%',
    isProfitable: irr > 0
  };
}

/**
 * Calculate price elasticity of demand
 * @param {number} price1 - Initial price
 * @param {number} quantity1 - Initial quantity
 * @param {number} price2 - New price
 * @param {number} quantity2 - New quantity
 * @returns {Object} Elasticity calculation results
 */
function calculatePriceElasticity(price1, quantity1, price2, quantity2) {
  const p1 = Number(price1);
  const q1 = Number(quantity1);
  const p2 = Number(price2);
  const q2 = Number(quantity2);

  if (p1 <= 0 || q1 <= 0 || p2 <= 0 || q2 <= 0) {
    throw new Error('All values must be positive');
  }

  const percentChangeQuantity = ((q2 - q1) / q1) * 100;
  const percentChangePrice = ((p2 - p1) / p1) * 100;
  
  const elasticity = percentChangeQuantity / percentChangePrice;

  let interpretation;
  if (Math.abs(elasticity) > 1) {
    interpretation = 'Elastic (demand is sensitive to price changes)';
  } else if (Math.abs(elasticity) === 1) {
    interpretation = 'Unit elastic';
  } else {
    interpretation = 'Inelastic (demand is not sensitive to price changes)';
  }

  return {
    price1: p1,
    quantity1: q1,
    price2: p2,
    quantity2: q2,
    percentChangeQuantity: Math.round(percentChangeQuantity * 100) / 100,
    percentChangePrice: Math.round(percentChangePrice * 100) / 100,
    elasticity: Math.round(elasticity * 100) / 100,
    interpretation
  };
}

/**
 * Calculate break-even point
 * @param {number} fixedCosts - Total fixed costs
 * @param {number} variableCostPerUnit - Variable cost per unit
 * @param {number} pricePerUnit - Selling price per unit
 * @returns {Object} Break-even calculation results
 */
function calculateBreakEven(fixedCosts, variableCostPerUnit, pricePerUnit) {
  const fc = Number(fixedCosts);
  const vc = Number(variableCostPerUnit);
  const p = Number(pricePerUnit);

  if (fc < 0 || vc < 0 || p <= 0) {
    throw new Error('Invalid parameters');
  }

  if (p <= vc) {
    throw new Error('Price must be greater than variable cost per unit');
  }

  const contributionMargin = p - vc;
  const breakEvenUnits = fc / contributionMargin;
  const breakEvenRevenue = breakEvenUnits * p;

  return {
    fixedCosts: fc,
    variableCostPerUnit: vc,
    pricePerUnit: p,
    contributionMargin: Math.round(contributionMargin * 100) / 100,
    breakEvenUnits: Math.ceil(breakEvenUnits),
    breakEvenRevenue: Math.round(breakEvenRevenue * 100) / 100
  };
}

/**
 * Calculate consumer surplus
 * @param {number} maxPrice - Maximum price consumer is willing to pay
 * @param {number} marketPrice - Actual market price
 * @param {number} quantity - Quantity purchased
 * @returns {Object} Consumer surplus calculation
 */
function calculateConsumerSurplus(maxPrice, marketPrice, quantity) {
  const maxP = Number(maxPrice);
  const marketP = Number(marketPrice);
  const q = Number(quantity);

  if (maxP < 0 || marketP < 0 || q < 0) {
    throw new Error('Values cannot be negative');
  }

  if (maxP < marketP) {
    return {
      maxPrice: maxP,
      marketPrice: marketP,
      quantity: q,
      consumerSurplus: 0,
      interpretation: 'No consumer surplus (market price exceeds willingness to pay)'
    };
  }

  const surplus = (maxP - marketP) * q;

  return {
    maxPrice: maxP,
    marketPrice: marketP,
    quantity: q,
    consumerSurplus: Math.round(surplus * 100) / 100,
    interpretation: 'Consumer surplus represents the benefit consumers receive'
  };
}

/**
 * Calculate producer surplus
 * @param {number} minPrice - Minimum price producer is willing to accept
 * @param {number} marketPrice - Actual market price
 * @param {number} quantity - Quantity sold
 * @returns {Object} Producer surplus calculation
 */
function calculateProducerSurplus(minPrice, marketPrice, quantity) {
  const minP = Number(minPrice);
  const marketP = Number(marketPrice);
  const q = Number(quantity);

  if (minP < 0 || marketP < 0 || q < 0) {
    throw new Error('Values cannot be negative');
  }

  if (marketP < minP) {
    return {
      minPrice: minP,
      marketPrice: marketP,
      quantity: q,
      producerSurplus: 0,
      interpretation: 'No producer surplus (market price below minimum acceptable)'
    };
  }

  const surplus = (marketP - minP) * q;

  return {
    minPrice: minP,
    marketPrice: marketP,
    quantity: q,
    producerSurplus: Math.round(surplus * 100) / 100,
    interpretation: 'Producer surplus represents the benefit producers receive'
  };
}

/**
 * Calculate budget allocation percentages
 * @param {Object} budget - Budget object with categories and amounts
 * @returns {Object} Budget allocation with percentages
 */
function calculateBudgetAllocation(budget) {
  if (!budget || typeof budget !== 'object') {
    throw new Error('Budget object is required');
  }

  const total = Object.values(budget).reduce((sum, val) => sum + Number(val), 0);
  
  if (total === 0) {
    return { total: 0, allocations: {} };
  }

  const allocations = {};
  for (const [category, amount] of Object.entries(budget)) {
    allocations[category] = {
      amount: Number(amount),
      percentage: Math.round((Number(amount) / total) * 10000) / 100
    };
  }

  return {
    total: Math.round(total * 100) / 100,
    allocations
  };
}

module.exports = {
  calculateLoan,
  calculateCompoundInterest,
  calculateROI,
  calculateNPV,
  calculateIRR,
  calculatePriceElasticity,
  calculateBreakEven,
  calculateConsumerSurplus,
  calculateProducerSurplus,
  calculateBudgetAllocation
};