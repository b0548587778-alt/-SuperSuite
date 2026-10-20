// כללים רגולטוריים למנוע התמהיל (הועבר מ-tamhil/packages/rules).
// כל ערך כאן הוא ערך התחלתי שטרם אומת מול נוסח ההוראה העדכני. המנוע מתייחס אליהם
// כספי אזהרה בלבד — לעולם לא כחסימה. אימות נרשם לגרסת כללים מסוימת; העלאת
// RULES_VERSION מחזירה את כל באנרי "יש לאמת".

const RULES_VERSION = '2026.10.1';
const UNVERIFIED = 'ערך התחלתי — טרם אומת מול נוסח ההוראה העדכני';
// שנת התוקף שאליה מתייחס הערך שהוזן (לא תאריך התחולה של ההוראה). מוצג ליד "לא מאומת"
const VALUE_YEAR = 2026;

// תווית מצב לכלל: "לא מאומת · 2026" או "אומת"
function statusLabel(rule) {
  if (!rule) return '';
  return rule.needsVerification ? `לא מאומת · ${rule.valueYear || VALUE_YEAR}` : 'אומת';
}

const TRACK_TYPES = {
  PRIME: 'פריים',
  FIXED_UNLINKED: 'קבועה לא צמודה (קל"צ)',
  FIXED_LINKED: 'קבועה צמודה (ק"צ)',
  VARIABLE_UNLINKED: 'משתנה לא צמודה',
  VARIABLE_LINKED: 'משתנה צמודה',
  ELIGIBILITY: 'משכנתא זכאות',
  BRIDGE: 'הלוואת גישור'
};

const BUYER_TYPES = {
  SINGLE_HOME: 'דירה יחידה',
  HOME_UPGRADER: 'משפר דיור',
  ADDITIONAL_HOME: 'דירה נוספת'
};

const RULE_CATALOG = [
  { id: 'boi.prime.spread', value: 0.015, effectiveFrom: '2000-01-01', source: `מרווח הפריים מעל ריבית בנק ישראל. ${UNVERIFIED}`, description: 'מרווח פריים מעל ריבית בנק ישראל' },
  { id: 'boi.329.maxVariableShare', value: 2 / 3, effectiveFrom: '2020-01-01', source: `הוראת ניהול בנקאי תקין 329. ${UNVERIFIED}`, description: 'נתח מקסימלי לריבית משתנה (כולל פריים)' },
  { id: 'boi.329.maxShortResetVariableShare', value: 2 / 3, effectiveFrom: '2020-01-01', source: `הוראת ניהול בנקאי תקין 329. ${UNVERIFIED}`, description: 'נתח מקסימלי לריבית שמשתנה בתדירות של פחות מ-5 שנים' },
  { id: 'boi.329.shortResetThresholdMonths', value: 60, effectiveFrom: '2020-01-01', source: `הוראת ניהול בנקאי תקין 329. ${UNVERIFIED}`, description: 'סף תדירות שינוי (בחודשים) שמתחתיו מסלול נחשב משתנה בתדירות גבוהה' },
  { id: 'boi.329.ptiWarning', value: 0.40, effectiveFrom: '2013-01-01', source: `הוראת ניהול בנקאי תקין 329. ${UNVERIFIED}`, description: 'יחס החזר להכנסה שמעליו מוצגת אזהרה' },
  { id: 'boi.329.ptiMax', value: 0.50, effectiveFrom: '2013-01-01', source: `הוראת ניהול בנקאי תקין 329. ${UNVERIFIED}`, description: 'יחס החזר להכנסה מקסימלי' },
  { id: 'boi.329.maxTermMonths', value: 360, effectiveFrom: '2013-01-01', source: `הוראת ניהול בנקאי תקין 329. ${UNVERIFIED}`, description: 'תקופת הלוואה מקסימלית (בחודשים)' },
  { id: 'boi.329.maxLtv', value: { SINGLE_HOME: 0.75, HOME_UPGRADER: 0.70, ADDITIONAL_HOME: 0.50 }, effectiveFrom: '2010-11-01', source: `הוראת ניהול בנקאי תקין 329. ${UNVERIFIED}`, description: 'שיעור מימון מקסימלי לפי סוג רוכש' },
  {
    id: 'boi.451.uniformBaskets',
    value: [
      { kind: 'UNIFORM_BASKET_1', label: 'סל אחיד 1 — קבועה לא צמודה', shares: [{ trackType: 'FIXED_UNLINKED', units: 6 }] },
      { kind: 'UNIFORM_BASKET_2', label: 'סל אחיד 2 — שליש קל"צ, שליש פריים, שליש משתנה צמודה כל 5', shares: [{ trackType: 'FIXED_UNLINKED', units: 2 }, { trackType: 'PRIME', units: 2 }, { trackType: 'VARIABLE_LINKED', units: 2, resetEveryMonths: 60 }] },
      { kind: 'UNIFORM_BASKET_3', label: 'סל אחיד 3 — חצי קל"צ, חצי פריים', shares: [{ trackType: 'FIXED_UNLINKED', units: 3 }, { trackType: 'PRIME', units: 3 }] }
    ],
    effectiveFrom: '2020-01-01', source: `הוראת ניהול בנקאי תקין 451. ${UNVERIFIED}`, description: 'הגדרת שלושת הסלים האחידים'
  },
  { id: 'prepayment.operationalFee', value: 60, effectiveFrom: '2002-01-01', source: `צו הבנקאות (עמלת פירעון מוקדם). ${UNVERIFIED}`, description: 'עמלה תפעולית בפירעון מוקדם (₪)' },
  { id: 'prepayment.noticeFeeRate', value: 0.001, effectiveFrom: '2002-01-01', source: `צו הבנקאות (עמלת פירעון מוקדם). ${UNVERIFIED}`, description: 'עמלת אי-מתן הודעה מוקדמת (שיעור מהסכום, בהלוואה צמודה)' },
  { id: 'prepayment.noticeDays', value: 10, effectiveFrom: '2002-01-01', source: `צו הבנקאות (עמלת פירעון מוקדם). ${UNVERIFIED}`, description: 'מספר ימי הודעה מוקדמת שפוטרים מעמלת אי-הודעה' },
  // ריק בכוונה: המדרגות לא אומתו מול הצו, ולכן לא ניתנת הנחה וההערכה נוטה למעלה.
  { id: 'prepayment.capitalizationDiscounts', value: [], effectiveFrom: '2002-01-01', source: 'צו הבנקאות (עמלת פירעון מוקדם). לא הוזנו מדרגות הנחה — יש להזין ולאמת לפי נוסח הצו.', description: 'הנחה בעמלת ההיוון לפי משך הזמן שחלף מנטילת ההלוואה' }
].map(r => Object.freeze({ valueYear: VALUE_YEAR, ...r, needsVerification: true }));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

class RuleSet {
  constructor(rules = RULE_CATALOG, version = RULES_VERSION) {
    for (const r of rules) if (!ISO_DATE.test(r.effectiveFrom)) throw new Error(`תאריך תחולה לא תקין בכלל ${r.id}`);
    this.rules = rules;
    this.version = version;
  }

  // אימות חל רק על גרסת הכללים שבה נרשם
  withVerifications(records) {
    const verified = new Set((Array.isArray(records) ? records : []).filter(r => r && r.rulesVersion === this.version).map(r => r.ruleId));
    return new RuleSet(this.rules.map(r => (verified.has(r.id) ? { ...r, needsVerification: false } : r)), this.version);
  }

  get(id, asOf) {
    if (!ISO_DATE.test(asOf)) throw new Error('תאריך חישוב לא תקין');
    let best = null;
    for (const r of this.rules) {
      if (r.id !== id || r.effectiveFrom > asOf) continue;
      if (!best || r.effectiveFrom > best.effectiveFrom) best = r;
    }
    if (!best) throw new Error(`לא נמצא כלל "${id}" בתוקף ל-${asOf}`);
    return best;
  }

  value(id, asOf) { return this.get(id, asOf).value; }

  // כללים בתוקף שעדיין דורשים אימות — מניע את באנרי "יש לאמת"
  inForce(asOf) {
    return [...new Set(this.rules.map(r => r.id))].flatMap(id => { try { return [this.get(id, asOf)]; } catch { return []; } });
  }

  unverified(asOf) { return this.inForce(asOf).filter(r => r.needsVerification); }
}

const defaultRuleSet = new RuleSet();
const ALL_RULE_IDS = [...new Set(RULE_CATALOG.map(r => r.id))];

module.exports = { RULES_VERSION, VALUE_YEAR, statusLabel, RULE_CATALOG, ALL_RULE_IDS, TRACK_TYPES, BUYER_TYPES, RuleSet, defaultRuleSet };
