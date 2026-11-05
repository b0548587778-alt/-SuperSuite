// מהדורות SuperSuite — מקור אמת אחד (docs/SPLIT-3-PRODUCTS-PLAN.md, החלטת הבעלים 5.11.2026).
// למשתמש: שלוש תוכנות נפרדות (עמותות / נדל"ן ועסקים / חשבונאות) ומהדורה מלאה (הכול — ממנה הבעלים מנהל).
// המהדורה נקבעת בזמן הבנייה (shell/edition-id.js) ואינה הגדרה של המשתמש.
// ההרשאה בפועל = מהדורה ∩ רישיון ∩ תפקיד: gate.js בודק את המהדורה לפני הרישיון, גם בהתקנה בלי רישוי.
// קובץ טהור, בלי require חוץ מ-edition-id — נטען ב-main.js, ב-ipc.js, במעטפת ובאנדרואיד.
(function (root) {
  'use strict';

  // תחיליות ערוצים שקיימות בכל מהדורה: כניסה, רישוי, הודעות, הגדרות ומשתמשים, גיבוי, מסך הבית, עוזר ה-AI,
  // אנשי קשר ומשימות, ייבוא/ייצוא (כל סוג נבדק שוב לפי התחום שלו), פרטיות (כל מאגר לפי התחום), גבייה (לפי התחום)
  const COMMON_PREFIXES = ['auth', 'license', 'owner', 'chat', 'update', 'settings', 'users', 'audit', 'data', 'dashboard',
    'tasks', 'contacts', 'voiceNotes', 'canvas', 'ai', 'sample', 'ports', 'privacy', 'collect', 'econ'];
  // מסכים במודול הכלכלי שקיימים בכל מהדורה
  const COMMON_VIEWS = ['dashboard', 'collect', 'tasks', 'contacts', 'voice-notes', 'canvas', 'ai', 'settings', 'licensing', 'messages'];
  const AI_FEATURES = ['ai', 'ai.local', 'ai.cloud'];

  // מנוע החשבוניות "מאחורי הקלעים" (החלטת הבעלים): בעמותות ובנדל"ן מפיקים חשבוניות (עמלה, פעילות עסקית),
  // רואים אותן, מדפיסים, גובים ומבטלים בזיכוי — בלי הנהלת החשבונות המלאה (יומן, מע"מ, PCN874, קובץ אחיד, בנק, דוחות).
  // 'x' — ערוץ מדומה שהקוד בודק בו "מנוע החשבוניות פתוח" (madv / rlty / גבייה / מאגר אנשים).
  // הרישיון לערוצים האלה דורש רק 'econ' (בלי econ.accounting) — gate.featuresForChannel
  // 'startTask' — ערוץ מדומה של בדיקת משימה (main.js / main-android.js: חשבונית / קבלה מתיבת הפקודה)
  const ACCT_BACKSTAGE = ['x', 'startTask', 'getInvoices', 'createInvoice', 'recordPayment', 'unrecordPayment', 'cancelInvoice',
    'exportInvoicePdf', 'getSettings', 'saveSettings', 'setLogo', 'setAllocation', 'waiveAllocation',
    'getSalesDocs', 'createSalesDoc', 'convertSalesDoc', 'cancelSalesDoc', 'createCreditNote', 'exportSalesDocPdf',
    'getCustomerDirectory', 'searchDocuments', 'getDuplicateInput', 'getInvoiceAnalytics', 'getProducts', 'getRecurring'];

  const EDITIONS = Object.freeze({
    full: {
      id: 'full', name: 'SuperSuite כלכלה', short: 'כלכלה', tagline: 'כספים, עסק וקהילה — במקום אחד', product: 'SuperSuite', dist: '', appId: 'com.bunimseller.supersuite',
      artifact: 'SuperSuite', color: null, mods: null, views: null, prefixes: null, features: null, profiles: null, backstage: false,
    },
    npo: {
      id: 'npo', name: 'SuperSuite עמותות', short: 'עמותות', tagline: 'תרומות, גמ"ח וחסד — במקום אחד', product: 'SuperSuite Amutot', dist: 'npo', appId: 'com.bunimseller.supersuite.npo',
      artifact: 'SuperSuite-Amutot', color: '#1f7a4d',
      mods: ['econ', 'tools'],
      views: ['npo', 'gemach', 'chesed', 'people', 'acct-invoices', 'acct-settings'],
      prefixes: ['npo', 'gemach', 'chesed', 'people'],
      features: ['econ', 'econ.npo', 'econ.gemach', 'econ.chesed', 'tools'],
      profiles: ['npo', 'gemach', 'chesed'],
      backstage: true,
    },
    realty: {
      id: 'realty', name: 'SuperSuite נדל"ן ועסקים', short: 'נדל"ן ועסקים', tagline: 'נדל"ן, שמאות ומשכנתאות — במקום אחד', product: 'SuperSuite Nadlan', dist: 'realty', appId: 'com.bunimseller.supersuite.realty',
      artifact: 'SuperSuite-Nadlan', color: '#1f5fa8',
      mods: ['econ', 'shamai', 'tools'],
      views: ['realty', 'realestate', 'mortgage', 'mortgage-advisor', 'mortgage-lab', 'business', 'market-intel', 'acct-invoices', 'acct-settings'],
      prefixes: ['rlty', 'realestate', 'madv', 'mlab', 'mortgage', 'business', 'marketIntel'],
      features: ['econ', 'econ.realestate', 'econ.mortgage', 'econ.mortgage-advisor', 'econ.mortgage-lab', 'shamai', 'tools'],
      profiles: ['mortgage', 'appraiser'],
      backstage: true,
    },
    acct: {
      id: 'acct', name: 'SuperSuite חשבונאות', short: 'חשבונאות', tagline: 'חשבוניות, מע"מ ודוחות — במקום אחד', product: 'SuperSuite Heshbonaut', dist: 'acct', appId: 'com.bunimseller.supersuite.acct',
      artifact: 'SuperSuite-Heshbonaut', color: '#6b3fa0',
      mods: ['econ', 'tools'],
      views: ['acct-invoices', 'acct-reports', 'biz-reports', 'acct-bank', 'acct-journal', 'acct-chart', 'acct-pricing', 'acct-settings',
        'business', 'market-intel', 'personal-finance', 'finance', 'acct-personal'],
      prefixes: ['acct', 'personalFinance', 'personal', 'financial', 'business', 'marketIntel'],
      features: ['econ', 'econ.accounting', 'tools'],
      profiles: ['business', 'household'],
      backstage: false,
    },
  });
  const IDS = Object.keys(EDITIONS);
  const PARTIAL_IDS = IDS.filter(id => id !== 'full');

  const builtId = (typeof module !== 'undefined' && module.exports) ? require('./edition-id') : root.SUITE_EDITION_ID;
  let currentId = EDITIONS[builtId] ? builtId : 'full';

  const get = (id) => EDITIONS[id] || null;
  const current = () => EDITIONS[currentId];
  // תיקיית הנתונים של המהדורה: המלאה — זו של היום (לא נוגעים; לקוחות קיימים); כל מהדורה אחרת — תיקייה משלה
  // לפי שם המוצר (גם נעילת המופע היחיד נפרדת, וכך אפשר להתקין כמה מהדורות באותו מחשב). --user-data-dir גובר
  function userDataDir(appDataDir, argv = [], join = (a, b) => a + '/' + b, ed = current()) {
    if (isFull(ed) || (argv || []).some(a => String(a).startsWith('--user-data-dir='))) return null;
    return join(appDataDir, ed.product);
  }
  // לבדיקות בלבד (כל קובץ בדיקה רץ בתהליך נפרד). בתוכנה המהדורה קבועה מהבנייה
  function _setForTests(id) {
    if (!EDITIONS[id]) throw new Error('unknown edition: ' + id);
    currentId = id;
  }

  const isFull = (ed = current()) => ed.id === 'full';

  // מודול (econ / shamai / tools / ...) קיים במהדורה
  function modAllowed(mod, ed = current()) {
    return isFull(ed) || ed.mods.includes(mod);
  }
  // מסך במודול הכלכלי קיים במהדורה
  function viewAllowed(view, ed = current()) {
    return isFull(ed) || COMMON_VIEWS.includes(view) || ed.views.includes(view);
  }
  // מפתח בקטלוג ('econ:npo' / 'shamai' / 'tools')
  function keyAllowed(key, ed = current()) {
    const [mod, view] = String(key || '').split(':');
    if (!modAllowed(mod, ed)) return false;
    return mod !== 'econ' || !view || viewAllowed(view, ed);
  }
  // ערוץ IPC של המודול הכלכלי: null = קיים במהדורה, אחרת הודעה בעברית
  function channelDenied(channel, ed = current()) {
    if (isFull(ed)) return null;
    const [prefix, action] = String(channel || '').split(':');
    if (COMMON_PREFIXES.includes(prefix) || ed.prefixes.includes(prefix)) return null;
    if (prefix === 'acct' && ed.backstage && ACCT_BACKSTAGE.includes(action)) return null;
    return `התחום הזה אינו חלק מ-${ed.name}`;
  }
  // ערוץ של מנוע החשבוניות שפתוח מאחורי הקלעים במהדורה (בלי רישיון econ.accounting)
  function isBackstageChannel(channel, ed = current()) {
    if (isFull(ed) || !ed.backstage) return false;
    const [prefix, action] = String(channel || '').split(':');
    return prefix === 'acct' && ACCT_BACKSTAGE.includes(action);
  }
  // תכונת רישיון (offer.FEATURES) שקיימת במהדורה. עוזר ה-AI — בכל המהדורות
  function featureAllowed(feature, ed = current()) {
    return isFull(ed) || AI_FEATURES.includes(feature) || ed.features.includes(feature);
  }
  function features(all, ed = current()) {
    return (all || []).filter(f => featureAllowed(f, ed));
  }
  // פרופיל באשף ההתחלה (shell/onboarding.js)
  function profileAllowed(id, ed = current()) {
    return isFull(ed) || ed.profiles.includes(id);
  }
  // משימה (shell/tasks.js / shell/simple-mode.js): לפי פריט הקטלוג שלה; פעולת מעטפת (גיבוי, חיפוש) — בכל מהדורה
  function taskAllowed(task, ed = current()) {
    return !task || !task.key || keyAllowed(task.key, ed);
  }

  const api = {
    EDITIONS, IDS, PARTIAL_IDS, COMMON_PREFIXES, COMMON_VIEWS, ACCT_BACKSTAGE,
    get, current, isFull, userDataDir, modAllowed, viewAllowed, keyAllowed, channelDenied, isBackstageChannel,
    featureAllowed, features, taskAllowed, profileAllowed, _setForTests,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUITE_EDITION = api;
})(typeof window !== 'undefined' ? window : this);
