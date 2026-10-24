// Tasks Service - Handles task management
const crypto = require('crypto');
const { editable } = require('../core/editable');

// היום לפי השעון המקומי — לא UTC (new Date('2026-10-23') הוא חצות UTC, ולכן המשימה סומנה "דחוי!" כבר ביום היעד)
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// באיחור: תאריך היעד לפני היום (ביום עצמו — עוד לא), והמשימה לא הושלמה. מחושב בכל קריאה ולא נשמר — אחרת הדגל קפא
const isOverdue = (t, today = localDay()) => !!(t && t.dueDate && t.status !== 'done' && String(t.dueDate).slice(0, 10) < today);
// רשומה לשמירה — בלי הדגל המחושב (גם בנתונים ישנים שבהם נשמר)
const stored = (t) => { const { isOverdue: _, ...rest } = t || {}; return rest; };

class TasksService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    // ה-Database המרכזי מנהל את כל האוספים בטבלת collections — אין צורך בטבלה נפרדת
    if (db) this.db = db;
  }

  async getTasks(senderId) {
    const shape = await this._raw(senderId);
    const today = localDay();
    return { ...shape, tasks: shape.tasks.map(t => ({ ...t, isOverdue: isOverdue(t, today) })) };
  }

  async _raw(senderId) {
    const data = await this.db.load();
    return this._asShape(data.tasks, senderId);
  }

  // מנרמל את האוסף למבנה { userId, tasks: [] } — תומך גם במערך ישן וגם באובייקט
  _asShape(raw, senderId) {
    if (Array.isArray(raw)) return { userId: senderId, tasks: raw };
    if (raw && typeof raw === 'object') return { userId: raw.userId || senderId, tasks: raw.tasks || [] };
    return { userId: senderId, tasks: [] };
  }

  async createTask(senderId, taskData) {
    if (!taskData || !taskData.title) {
      throw new Error('כותרת המשימה חובה');
    }

    const task = {
      id: crypto.randomUUID(),
      title: taskData.title,
      description: taskData.description || '',
      category: taskData.category || 'other',
      priority: taskData.priority || 'medium',
      status: taskData.status || 'todo',
      dueDate: taskData.dueDate || null,
      createdAt: new Date().toISOString()
    };

    const data = await this.db.load();
    const shape = this._asShape(data.tasks, senderId);
    shape.userId = senderId;
    shape.tasks.push(task);
    data.tasks = shape.tasks;
    await this.db.save(data);

    return task;
  }

  async updateTask(senderId, taskId, updates) {
    const existing = await this._raw(senderId);
    const taskIndex = existing.tasks.findIndex(t => t.id === taskId);
    
    if (taskIndex === -1) {
      throw new Error('המשימה לא נמצאה');
    }
    
    const changes = editable(updates);
    const task = stored({
      ...existing.tasks[taskIndex],
      ...changes,
      updatedAt: new Date().toISOString()
    });

    const updatedTasks = existing.tasks.map((t, index) => (index === taskIndex ? task : stored(t)));
    
    const data = await this.db.load();
    const shape = this._asShape(data.tasks, senderId);
    shape.tasks = updatedTasks;
    data.tasks = shape.tasks;
    await this.db.save(data);

    return { ...task, isOverdue: isOverdue(task) };
  }

  async deleteTask(senderId, taskId) {
    const existing = await this._raw(senderId);
    const taskIndex = existing.tasks.findIndex(t => t.id === taskId);
    
    if (taskIndex === -1) {
      throw new Error('המשימה לא נמצאה');
    }
    
    const updatedTasks = existing.tasks.filter(t => t.id !== taskId);

    const data = await this.db.load();
    const shape = this._asShape(data.tasks, senderId);
    shape.tasks = updatedTasks;
    data.tasks = shape.tasks;
    await this.db.save(data);

    return true;
  }

  async getOverdueTasks(senderId) {
    const existing = await this.getTasks(senderId);
    return existing.tasks.filter(t => t.isOverdue);
  }

  async getTasksByCategory(senderId, category) {
    const existing = await this.getTasks(senderId);
    return existing.tasks.filter(t => t.category === category);
  }

  async getTasksByPriority(senderId, priority) {
    const existing = await this.getTasks(senderId);
    return existing.tasks.filter(t => t.priority === priority);
  }
}

module.exports = { TasksService: new TasksService(), isOverdue };