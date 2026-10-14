// Tasks Service - Handles task management
const crypto = require('crypto');

class TasksService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    // ה-Database המרכזי מנהל את כל האוספים בטבלת collections — אין צורך בטבלה נפרדת
    if (db) this.db = db;
  }

  async getTasks(senderId) {
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
    const existing = await this.getTasks(senderId);
    const taskIndex = existing.tasks.findIndex(t => t.id === taskId);
    
    if (taskIndex === -1) {
      throw new Error('המשימה לא נמצאה');
    }
    
    const task = { 
      ...existing.tasks[taskIndex], 
      ...updates, 
      updatedAt: new Date().toISOString() 
    };
    
    // Recalculate isOverdue if dueDate or status changed
    if (updates.dueDate !== undefined || updates.status !== undefined) {
      const dueDate = updates.dueDate !== undefined ? updates.dueDate : existing.tasks[taskIndex].dueDate;
      const status = updates.status !== undefined ? updates.status : existing.tasks[taskIndex].status;
      task.isOverdue = !!(dueDate && status !== 'done' && new Date(dueDate).getTime() < Date.now());
    }
    
    const updatedTasks = existing.tasks.map((t, index) => {
      if (index === taskIndex) return task;
      return t;
    });
    
    const data = await this.db.load();
    const shape = this._asShape(data.tasks, senderId);
    shape.tasks = updatedTasks;
    data.tasks = shape.tasks;
    await this.db.save(data);

    return task;
  }

  async deleteTask(senderId, taskId) {
    const existing = await this.getTasks(senderId);
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

module.exports = { TasksService: new TasksService() };