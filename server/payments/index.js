// שכבת תשלום מופשטת לשרת הרישוי. כל ספק סליקה מממש את אותו ממשק — ומחליפים ספק בהגדרה בלבד, בלי לגעת בשאר הקוד:
//
//   createCheckout({ paymentId, amountAgorot, description, customer, returnUrl }) → { checkoutId, url }
//       יצירת דף תשלום מאובטח אצל הספק. פרטי האשראי מוקלדים רק בדף של הספק — לא בתוכנה ולא בשרת שלנו.
//   parseWebhook({ rawBody, headers }) → { checkoutId, status: 'paid' | 'failed', amountAgorot, providerRef }
//       אימות הודעת "שולם" מהספק (חתימה / סוד משותף) ופענוחה. הודעה שאינה מאומתת — זורקת שגיאה.
//   lookup({ checkoutId }) (אופציונלי) → כמו parseWebhook: שאילתה מאומתת אצל הספק על עסקה אחת — להתאמה כשה-webhook
//       אבד (f15; השרת בודק תשלומים פתוחים בעצמו). ספק בלי lookup — רק webhook
//   routes (אופציונלי) — דפים שהספק מגיש בשרת עצמו (רק בספק הבדיקות).
//
// להוספת ספק אמיתי (חברת סליקה ישראלית): קובץ חדש בתיקייה הזו לפי הממשק, ורישום ב-PROVIDERS.
// הסכום תמיד באגורות שלמות (כלל 1).
'use strict';
const { createTestProvider } = require('./test-provider');
const { createCardcomProvider } = require('./cardcom-provider');

const PROVIDERS = { test: createTestProvider, cardcom: createCardcomProvider };

function createProvider(name, opts = {}) {
  const make = PROVIDERS[name];
  if (!make) throw new Error('ספק תשלום לא מוכר: ' + name);
  const p = make(opts);
  for (const fn of ['createCheckout', 'parseWebhook']) if (typeof p[fn] !== 'function') throw new Error(`ספק התשלום ${name} אינו מממש ${fn}`);
  return p;
}

module.exports = { createProvider, PROVIDERS };
