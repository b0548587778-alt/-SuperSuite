// Contacts Service - Handles contact management
const crypto = require('crypto');

class ContactsService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    // ה-Database המרכזי מנהל את כל האוספים בטבלת collections — אין צורך בטבלה נפרדת
    if (db) this.db = db;
  }

  async getContacts(senderId) {
    const data = await this.db.load();
    return this._asShape(data.contacts, senderId);
  }

  // מנרמל את האוסף למבנה { userId, contacts: [] } — תומך גם במערך ישן וגם באובייקט
  _asShape(raw, senderId) {
    if (Array.isArray(raw)) return { userId: senderId, contacts: raw };
    if (raw && typeof raw === 'object') return { userId: raw.userId || senderId, contacts: raw.contacts || [] };
    return { userId: senderId, contacts: [] };
  }

  async createContact(senderId, contactData) {
    if (!contactData || !contactData.name) {
      throw new Error('שם איש הקשר חובה');
    }
    
    const contact = {
      id: crypto.randomUUID(),
      name: contactData.name,
      email: contactData.email || '',
      phone: contactData.phone || '',
      company: contactData.company || '',
      role: contactData.role || '',
      address: contactData.address || '',
      notes: contactData.notes || '',
      tags: Array.isArray(contactData.tags) ? contactData.tags : [],
      createdAt: new Date().toISOString()
    };
    
    const data = await this.db.load();
    const shape = this._asShape(data.contacts, senderId);
    shape.userId = senderId;
    shape.contacts.push(contact);
    data.contacts = shape.contacts;
    await this.db.save(data);

    return contact;
  }

  async updateContact(senderId, contactId, updates) {
    const existing = await this.getContacts(senderId);
    const contactIndex = existing.contacts.findIndex(c => c.id === contactId);
    
    if (contactIndex === -1) {
      throw new Error('איש הקשר לא נמצא');
    }
    
    const contact = { 
      ...existing.contacts[contactIndex], 
      ...updates, 
      updatedAt: new Date().toISOString() 
    };
    
    const updatedContacts = existing.contacts.map((c, index) => {
      if (index === contactIndex) return contact;
      return c;
    });
    
    const data = await this.db.load();
    const shape = this._asShape(data.contacts, senderId);
    shape.contacts = updatedContacts;
    data.contacts = shape.contacts;
    await this.db.save(data);

    return contact;
  }

  async deleteContact(senderId, contactId) {
    const existing = await this.getContacts(senderId);
    const contactIndex = existing.contacts.findIndex(c => c.id === contactId);
    
    if (contactIndex === -1) {
      throw new Error('איש הקשר לא נמצא');
    }
    
    const updatedContacts = existing.contacts.filter(c => c.id !== contactId);

    const data = await this.db.load();
    const shape = this._asShape(data.contacts, senderId);
    shape.contacts = updatedContacts;
    data.contacts = shape.contacts;
    await this.db.save(data);

    return true;
  }

  async searchContacts(senderId, query) {
    const existing = await this.getContacts(senderId);
    const lowerQuery = query.toLowerCase();
    
    return existing.contacts.filter(c => 
      c.name.toLowerCase().includes(lowerQuery) ||
      c.email.toLowerCase().includes(lowerQuery) ||
      c.company.toLowerCase().includes(lowerQuery) ||
      c.role.toLowerCase().includes(lowerQuery) ||
      (c.tags && c.tags.some(tag => tag.toLowerCase().includes(lowerQuery)))
    );
  }
}

module.exports = { ContactsService: new ContactsService() };