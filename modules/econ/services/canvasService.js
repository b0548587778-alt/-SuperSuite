// Canvas Service - Handles whiteboard/kanban boards
const crypto = require('crypto');
const { editable } = require('../core/editable');

class CanvasService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    // ה-Database המרכזי מנהל את כל האוספים בטבלת collections — אין צורך בטבלה נפרדת
    if (db) this.db = db;
  }

  async getBoards(senderId) {
    const data = await this.db.load();
    return this._asShape(data.canvasBoards, senderId);
  }

  // מנרמל את האוסף למבנה { userId, boards: [] } — תומך גם במערך ישן וגם באובייקט
  _asShape(raw, senderId) {
    if (Array.isArray(raw)) return { userId: senderId, boards: raw };
    if (raw && typeof raw === 'object') return { userId: raw.userId || senderId, boards: raw.boards || [] };
    return { userId: senderId, boards: [] };
  }

  async saveBoard(senderId, boardData) {
    if (!boardData || !boardData.boardName) {
      throw new Error('שם הלוח חובה');
    }
    
    const board = {
      id: crypto.randomUUID(),
      boardName: boardData.boardName,
      cards: Array.isArray(boardData.cards) ? boardData.cards : [],
      connections: Array.isArray(boardData.connections) ? boardData.connections : [],
      createdAt: new Date().toISOString()
    };
    
    const data = await this.db.load();
    const shape = this._asShape(data.canvasBoards, senderId);
    shape.userId = senderId;
    shape.boards.push(board);
    data.canvasBoards = shape;
    await this.db.save(data);

    return board;
  }

  async deleteBoard(senderId, boardId) {
    const existing = await this.getBoards(senderId);
    const boardIndex = existing.boards.findIndex(b => b.id === boardId);
    
    if (boardIndex === -1) {
      throw new Error('הלוח לא נמצא');
    }
    
    const updatedBoards = existing.boards.filter(b => b.id !== boardId);

    const data = await this.db.load();
    const shape = this._asShape(data.canvasBoards, senderId);
    shape.boards = updatedBoards;
    data.canvasBoards = shape;
    await this.db.save(data);

    return true;
  }

  async updateBoard(senderId, boardId, updates) {
    const existing = await this.getBoards(senderId);
    const boardIndex = existing.boards.findIndex(b => b.id === boardId);
    
    if (boardIndex === -1) {
      throw new Error('הלוח לא נמצא');
    }
    
    const board = { 
      ...existing.boards[boardIndex], 
      ...editable(updates), 
      updatedAt: new Date().toISOString() 
    };
    
    const updatedBoards = existing.boards.map((b, index) => {
      if (index === boardIndex) return board;
      return b;
    });

    const data = await this.db.load();
    const shape = this._asShape(data.canvasBoards, senderId);
    shape.boards = updatedBoards;
    data.canvasBoards = shape;
    await this.db.save(data);

    return board;
  }
}

module.exports = { CanvasService: new CanvasService() };