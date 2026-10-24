// Business Service - Handles business plans and business intelligence
const crypto = require('crypto');
const { editable } = require('../core/editable');

class BusinessService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    // ה-Database המרכזי מנהל את כל האוספים בטבלת collections — אין צורך בטבלה נפרדת
    if (db) this.db = db;
  }

  async getBusinessPlans(senderId) {
    const data = await this.db.load();
    return this._asShape(data.businessPlans, senderId);
  }

  // מנרמל את האוסף למבנה { userId, plans: [] } — תומך גם במערך ישן וגם באובייקט
  _asShape(raw, senderId) {
    if (Array.isArray(raw)) return { userId: senderId, plans: raw };
    if (raw && typeof raw === 'object') return { userId: raw.userId || senderId, plans: raw.plans || [] };
    return { userId: senderId, plans: [] };
  }

  async saveBusinessPlan(senderId, planData) {
    if (!planData || !planData.name) {
      throw new Error('שם התוכנית העסקית חובה');
    }
    
    const plan = {
      id: crypto.randomUUID(),
      name: planData.name,
      description: planData.description || '',
      industry: planData.industry || '',
      // שדות הטופס שנזרקו קודם בשמירה: שוק יעד, עלות הקמה, הכנסה צפויה (מעוגל לאגורה)
      targetMarket: String(planData.targetMarket || '').trim(),
      startupCost: Math.round((Number(planData.startupCost) || 0) * 100) / 100,
      projectedRevenue: Math.round((Number(planData.projectedRevenue) || 0) * 100) / 100,
      goals: planData.goals || [],
      financialProjections: planData.financialProjections || [],
      createdAt: new Date().toISOString()
    };
    
    const data = await this.db.load();
    const shape = this._asShape(data.businessPlans, senderId);
    shape.userId = senderId;
    shape.plans.push(plan);
    data.businessPlans = shape.plans;
    await this.db.save(data);

    return plan;
  }

  async deleteBusinessPlan(senderId, planId) {
    const existing = await this.getBusinessPlans(senderId);
    const planIndex = existing.plans.findIndex(p => p.id === planId);
    
    if (planIndex === -1) {
      throw new Error('התוכנית העסקית לא נמצאה');
    }
    
    const updatedPlans = existing.plans.filter(p => p.id !== planId);

    const data = await this.db.load();
    const shape = this._asShape(data.businessPlans, senderId);
    shape.plans = updatedPlans;
    data.businessPlans = shape.plans;
    await this.db.save(data);

    return true;
  }

  async updateBusinessPlan(senderId, planId, updates) {
    const existing = await this.getBusinessPlans(senderId);
    const planIndex = existing.plans.findIndex(p => p.id === planId);
    
    if (planIndex === -1) {
      throw new Error('התוכנית העסקית לא נמצאה');
    }
    
    const plan = { 
      ...existing.plans[planIndex], 
      ...editable(updates), 
      updatedAt: new Date().toISOString() 
    };
    
    const updatedPlans = existing.plans.map((p, index) => {
      if (index === planIndex) return plan;
      return p;
    });

    const data = await this.db.load();
    const shape = this._asShape(data.businessPlans, senderId);
    shape.plans = updatedPlans;
    data.businessPlans = shape.plans;
    await this.db.save(data);

    return plan;
  }
}

module.exports = { BusinessService: new BusinessService() };