// People Service — מאגר אנשים מאוחד, לקריאה בלבד. נבנה מהנתונים הקיימים בכל קריאה (אין אוסף משלו).
const P = require('../core/people');

class PeopleService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  async search(query, canSeeConfidential) {
    const data = await this.db.load();
    return P.search(data, String(query ?? '').slice(0, 100), { canSeeConfidential: !!canSeeConfidential });
  }

  async getCard(key, canSeeConfidential) {
    const data = await this.db.load();
    return P.card(data, key, { canSeeConfidential: !!canSeeConfidential });
  }
}

module.exports = { PeopleService: new PeopleService() };
