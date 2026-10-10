// Voice Notes Service - Handles voice note/audio memo management
const crypto = require('crypto');

class VoiceNotesService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    // ה-Database המרכזי מנהל את כל האוספים בטבלת collections — אין צורך בטבלה נפרדת
    if (db) this.db = db;
  }

  async getVoiceNotes(senderId) {
    const data = await this.db.load();
    return this._asShape(data.voiceNotes, senderId);
  }

  // מנרמל את האוסף למבנה { userId, notes: [] } — תומך גם במערך ישן וגם באובייקט
  _asShape(raw, senderId) {
    if (Array.isArray(raw)) return { userId: senderId, notes: raw };
    if (raw && typeof raw === 'object') return { userId: raw.userId || senderId, notes: raw.notes || [] };
    return { userId: senderId, notes: [] };
  }

  async createVoiceNote(senderId, noteData) {
    if (!noteData || !noteData.title) {
      throw new Error('Voice note title is required');
    }
    
    const note = {
      id: crypto.randomUUID(),
      title: noteData.title,
      description: noteData.description || '',
      duration: noteData.duration || 0, // in seconds
      audioPath: noteData.audioPath || '', // path to audio file
      recordedAt: noteData.recordedAt || new Date().toISOString(),
      notes: noteData.notes || '',
      tags: Array.isArray(noteData.tags) ? noteData.tags : [],
      createdAt: new Date().toISOString()
    };
    
    const data = await this.db.load();
    const shape = this._asShape(data.voiceNotes, senderId);
    shape.userId = senderId;
    shape.notes.push(note);
    data.voiceNotes = shape;
    await this.db.save(data);

    return note;
  }

  async updateVoiceNote(senderId, noteId, updates) {
    const existing = await this.getVoiceNotes(senderId);
    const noteIndex = existing.notes.findIndex(n => n.id === noteId);
    
    if (noteIndex === -1) {
      throw new Error('Voice note not found');
    }
    
    const note = { 
      ...existing.notes[noteIndex], 
      ...updates, 
      updatedAt: new Date().toISOString() 
    };
    
    const updatedNotes = existing.notes.map((n, index) => {
      if (index === noteIndex) return note;
      return n;
    });

    const data = await this.db.load();
    const shape = this._asShape(data.voiceNotes, senderId);
    shape.notes = updatedNotes;
    data.voiceNotes = shape;
    await this.db.save(data);

    return note;
  }

  async deleteVoiceNote(senderId, noteId) {
    const existing = await this.getVoiceNotes(senderId);
    const noteIndex = existing.notes.findIndex(n => n.id === noteId);
    
    if (noteIndex === -1) {
      throw new Error('Voice note not found');
    }
    
    const updatedNotes = existing.notes.filter(n => n.id !== noteId);

    const data = await this.db.load();
    const shape = this._asShape(data.voiceNotes, senderId);
    shape.notes = updatedNotes;
    data.voiceNotes = shape;
    await this.db.save(data);

    return true;
  }

  async searchVoiceNotes(senderId, query) {
    const existing = await this.getVoiceNotes(senderId);
    const lowerQuery = query.toLowerCase();
    
    return existing.notes.filter(n => 
      n.title.toLowerCase().includes(lowerQuery) ||
      n.description.toLowerCase().includes(lowerQuery) ||
      n.notes.toLowerCase().includes(lowerQuery) ||
      n.tags && n.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }
}

module.exports = { VoiceNotesService: new VoiceNotesService() };