// נתוני דוגמה (PLAN.md 1.5): הכנסה ומחיקה בשמירה אחת. הלוגיקה ב-core/sampleData.js
'use strict';
const crypto = require('crypto');
const SD = require('../core/sampleData');

class SampleService {
  constructor(db) { this.db = db; }
  async initialize(db) { if (db) this.db = db; }

  async getStatus(license) {
    const data = await this.db.load();
    const allowed = SD.availableKinds(license);
    return {
      counts: SD.counts(data),
      kinds: allowed.map(k => ({ id: k, label: SD.KINDS[k].label })),
    };
  }

  async add(kinds, license, today) {
    const data = await this.db.load();
    const added = SD.apply(data, kinds, { today, uuid: () => crypto.randomUUID(), allowed: SD.availableKinds(license) });
    await this.db.save(data);
    return { added, counts: SD.counts(data) };
  }

  async removeAll() {
    const data = await this.db.load();
    const info = {};
    const removed = SD.remove(data, info);
    if (removed) await this.db.save(data);
    return { removed, kept: info.kept || 0, counts: SD.counts(data) };
  }
}

module.exports = { SampleService: new SampleService() };
