// עדכון רשומה מהמסך בשירותים הישנים (אנשי קשר, משימות, לוחות, הקלטות, תוכניות עסקיות, תרחישי משכנתא, מודיעין שוק):
// רק שדות לעריכה. מזהה ומועד יצירה לא נדרסים — אחרת שתי רשומות עם אותו מזהה, ומחיקה של אחת מוחקת את שתיהן
// (בדיקת קוד 23.10.2026). בלי require — נארז גם לאנדרואיד
'use strict';

const PROTECTED = new Set(['id', 'createdAt', 'updatedAt', '__proto__', 'constructor', 'prototype']);

function editable(updates) {
  const out = {};
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return out;
  for (const [key, value] of Object.entries(updates)) {
    if (!PROTECTED.has(key)) out[key] = value;
  }
  return out;
}

module.exports = { editable, PROTECTED };
