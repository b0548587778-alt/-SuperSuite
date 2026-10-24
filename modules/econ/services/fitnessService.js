// Fitness Service - Handles health and fitness tracking
const crypto = require('crypto');
const { localDay } = require('../core/dates');

class FitnessService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    // ה-Database המרכזי מנהל את כל האוספים בטבלת collections — אין צורך בטבלה נפרדת
    if (db) this.db = db;
  }

  async getFitnessData(senderId) {
    const data = await this.db.load();
    return this._asShape(data.fitnessData, senderId);
  }

  // מנרמל את האוסף למבנה { userId, workouts, nutrition, metrics } — תומך גם במערך ישן וגם באובייקט
  _asShape(raw, senderId) {
    const empty = { userId: senderId, workouts: [], nutrition: [], metrics: [] };
    if (Array.isArray(raw)) {
      // מבנה ישן: רק אימונים? נשיב עבור workouts בלבד
      return { userId: senderId, workouts: raw, nutrition: [], metrics: [] };
    }
    if (raw && typeof raw === 'object') {
      return {
        userId: raw.userId || senderId,
        workouts: raw.workouts || [],
        nutrition: raw.nutrition || [],
        metrics: raw.metrics || []
      };
    }
    return empty;
  }

  async createWorkout(senderId, workoutData) {
    if (!workoutData || !workoutData.type || !workoutData.durationMinutes) {
      throw new Error('יש להזין סוג אימון ומשך');
    }
    
    const workout = {
      id: crypto.randomUUID(),
      date: workoutData.date || localDay(), // היום המקומי, לא UTC
      type: workoutData.type, // cardio, strength, yoga (גמישות ומתיחות), walking, sports, other
      durationMinutes: Number(workoutData.durationMinutes),
      caloriesBurned: workoutData.caloriesBurned || 0,
      notes: workoutData.notes || '',
      createdAt: new Date().toISOString()
    };
    
    const shape = await this._loadShape(senderId);
    shape.workouts.push(workout);
    await this._saveShape(senderId, shape);

    return workout;
  }

  async createNutrition(senderId, nutritionData) {
    if (!nutritionData || !nutritionData.mealType || !nutritionData.calories) {
      throw new Error('יש להזין סוג ארוחה וקלוריות');
    }
    
    const nutrition = {
      id: crypto.randomUUID(),
      date: nutritionData.date || localDay(), // היום המקומי, לא UTC
      mealType: nutritionData.mealType, // breakfast, lunch, dinner, snack
      description: nutritionData.description || '',
      calories: Number(nutritionData.calories),
      notes: nutritionData.notes || '',
      createdAt: new Date().toISOString()
    };
    
    const shape = await this._loadShape(senderId);
    shape.nutrition.push(nutrition);
    await this._saveShape(senderId, shape);

    return nutrition;
  }

  async createMetric(senderId, metricData) {
    if (!metricData || !metricData.date) {
      throw new Error('תאריך המדד חובה');
    }
    
    const metric = {
      id: crypto.randomUUID(),
      date: metricData.date,
      weightKg: metricData.weightKg !== undefined ? Number(metricData.weightKg) : null,
      bodyFatPercent: metricData.bodyFatPercent !== undefined ? Number(metricData.bodyFatPercent) : null,
      notes: metricData.notes || '',
      createdAt: new Date().toISOString()
    };
    
    const shape = await this._loadShape(senderId);
    shape.metrics.push(metric);
    await this._saveShape(senderId, shape);

    return metric;
  }

  // טוען את מבנה ה-fitnessData מהדאטה
  async _loadShape(senderId) {
    const data = await this.db.load();
    return this._asShape(data.fitnessData, senderId);
  }

  // שומר את מבנה ה-fitnessData חזרה לדאטה
  async _saveShape(senderId, shape) {
    const data = await this.db.load();
    shape.userId = senderId;
    data.fitnessData = shape;
    await this.db.save(data);
  }

  async getWorkoutsByType(senderId, type) {
    const existing = await this.getFitnessData(senderId);
    return existing.workouts.filter(w => w.type === type);
  }

  async getMetricsByDateRange(senderId, startDate, endDate) {
    const existing = await this.getFitnessData(senderId);
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    return existing.metrics.filter(m => {
      if (!m.date) return false;
      const metricDate = new Date(m.date);
      return metricDate >= start && metricDate <= end;
    });
  }
}

module.exports = { FitnessService: new FitnessService() };