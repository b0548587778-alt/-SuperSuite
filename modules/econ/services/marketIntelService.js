// Market Intelligence Service - Handles market data and intelligence tracking
const crypto = require('crypto');
const { editable } = require('../core/editable');

class MarketIntelService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    // ה-Database המרכזי מנהל את כל האוספים בטבלת collections — אין צורך בטבלה נפרדת
    if (db) this.db = db;
  }

  async getIntel(senderId) {
    const data = await this.db.load();
    return this._asShape(data.marketIntel, senderId);
  }

  // מנרמל את האוסף למבנה { userId, entries: [] } — תומך גם במערך ישן וגם באובייקט
  _asShape(raw, senderId) {
    if (Array.isArray(raw)) return { userId: senderId, entries: raw };
    if (raw && typeof raw === 'object') return { userId: raw.userId || senderId, entries: raw.entries || [] };
    return { userId: senderId, entries: [] };
  }

  async updateIntel(senderId, intelData) {
    if (!intelData) {
      throw new Error('נתוני מודיעין השוק אינם תקינים');
    }
    // המערכת שולחת ערך בודד (title + sourceType) — לא רשימת entries
    if (!intelData.title || !intelData.sourceType) {
      throw new Error('יש להזין כותרת וסוג מקור');
    }

    const now = new Date().toISOString();
    const entry = {
      id: crypto.randomUUID(),
      title: intelData.title || 'New Entry',
      description: intelData.description || '',
      sourceType: intelData.sourceType || 'rumor',
      credibility: intelData.credibility || 'unverified',
      impactDirection: intelData.impactDirection || 'neutral',
      potentialImpact: intelData.potentialImpact || '',
      date: intelData.date || new Date().toISOString(),
      tags: intelData.tags || [],
      createdAt: now,
      updatedAt: now
    };
    
    // Get existing data
    const existing = await this.getIntel(senderId);
    
    // Add new entry
    const updatedEntries = [...existing.entries, entry];
    
    // Save updated data
    await this._saveEntries(senderId, updatedEntries);
    return entry;
  }

  async deleteEntry(senderId, entryId) {
    const existing = await this.getIntel(senderId);
    const entryIndex = existing.entries.findIndex(e => e.id === entryId);
    
    if (entryIndex === -1) {
      throw new Error('הרשומה לא נמצאה');
    }
    
    const updatedEntries = existing.entries.filter(e => e.id !== entryId);

    await this._saveEntries(senderId, updatedEntries);
    return true;
  }

  async updateEntry(senderId, entryId, updates) {
    const existing = await this.getIntel(senderId);
    const entryIndex = existing.entries.findIndex(e => e.id === entryId);
    
    if (entryIndex === -1) {
      throw new Error('הרשומה לא נמצאה');
    }
    
    const entry = { ...existing.entries[entryIndex], ...editable(updates), updatedAt: new Date().toISOString() };
    
    // Ensure required fields
    entry.updatedAt = new Date().toISOString();
    if (!entry.title) entry.title = 'Updated Entry';
    if (!entry.date) entry.date = new Date().toISOString();
    
    const updatedEntries = existing.entries.map((e, index) => {
      if (index === entryIndex) return entry;
      return e;
    });
    
    await this._saveEntries(senderId, updatedEntries);
    return entry;
  }

  // שומר את רשימת הערכים לאוסף marketIntel
  async _saveEntries(senderId, entries) {
    const data = await this.db.load();
    const shape = this._asShape(data.marketIntel, senderId);
    shape.userId = senderId;
    shape.entries = entries;
    data.marketIntel = shape;
    await this.db.save(data);
  }
}

module.exports = { MarketIntelService: new MarketIntelService() };