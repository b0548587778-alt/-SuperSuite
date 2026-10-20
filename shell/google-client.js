// מזהה התוכנה לכניסה עם Google (PLAN.md 4.7) — נארז בתוכנה, כדי שהלקוח לא יצטרך להגדיר כלום.
// הבעלים יוצר פעם אחת ב-Google Cloud מזהה לקוח מסוג "Desktop app" ומעתיק לכאן את שני הערכים
// (docs/GOOGLE-SIGNIN.md, "מזהה מובנה"). ריק = אין מזהה מובנה, והמנהל מגדיר מזהה משלו כמו קודם.
// ה"סוד" של אפליקציית שולחן עבודה אינו סוד אמיתי (כך מגדירה Google); ההגנה היא PKCE ב-shell/google-signin.js.
'use strict';

module.exports = {
  clientId: '241570708914-lkru04aoetrl8s77mfsv15bq5pav2h5o.apps.googleusercontent.com',
  clientSecret: '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',
};
