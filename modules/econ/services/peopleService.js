// People Service — מאגר אנשים מאוחד, לקריאה בלבד. נבנה מהנתונים הקיימים בכל קריאה (אין אוסף משלו).
const P = require('../core/people');

class PeopleService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  // sources: התחומים הפתוחים ברישיון (gate.peopleSources). בלי ערך — כל התחומים (התקנה בלי רישוי)
  // trainerClients: המתאמנים ממודול האימונים (TP.readClients), או [] כשהמודול לא זמין
  async search(query, canSeeConfidential, sources, trainerClients = []) {
    const data = { ...(await this.db.load()), trainerClients };
    return P.search(data, String(query ?? '').slice(0, 100), { canSeeConfidential: !!canSeeConfidential, sources: sources || P.SOURCES });
  }

  async getCard(key, canSeeConfidential, sources, trainerClients = []) {
    const data = { ...(await this.db.load()), trainerClients };
    return P.card(data, key, { canSeeConfidential: !!canSeeConfidential, sources: sources || P.SOURCES });
  }
}

module.exports = { PeopleService: new PeopleService() };
