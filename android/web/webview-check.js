/* בדיקת גרסת ה-WebView לפני כל סקריפט אחר (סקירת קוד 2.11.2026).
   minSdk 28 מאפשר מכשירים עם WebView 66–95, והממשק דורש Chrome 98 — בלי הבדיקה המסך נשבר בלי הסבר.
   הקובץ כתוב בתחביר ישן (ES5) בכוונה: הוא חייב לרוץ גם ב-WebView שלא מבין את שאר הקוד. */
(function (root) {
  'use strict';
  // יכולות שהקוד משתמש בהן; הגבוהה מהן — structuredClone (Chrome 98, host.js)
  var FEATURES = [
    ['structuredClone', function (w) { return typeof w.structuredClone === 'function'; }],
    ['Object.hasOwn', function (w) { return typeof w.Object.hasOwn === 'function'; }],
    ['Array.prototype.at', function (w) { return typeof w.Array.prototype.at === 'function'; }],
    ['String.prototype.replaceAll', function (w) { return typeof w.String.prototype.replaceAll === 'function'; }],
    ['Promise.any', function (w) { return typeof w.Promise.any === 'function'; }],
    ['Intl.DateTimeFormat', function (w) { return !!(w.Intl && typeof w.Intl.DateTimeFormat === 'function'); }]
  ];
  var MESSAGE_TITLE = 'רכיב התצוגה במכשיר ישן מדי';
  var MESSAGE_BODY = 'כדי ש-SuperSuite יעבוד, יש לעדכן את "Android System WebView" (וגם את "Chrome") בחנות Google Play, ' +
    'ואז לסגור את SuperSuite ולפתוח אותו מחדש.';

  function missingFeatures(w) {
    var out = [];
    for (var i = 0; i < FEATURES.length; i++) {
      var ok = false;
      try { ok = FEATURES[i][1](w); } catch (e) { ok = false; }
      if (!ok) out.push(FEATURES[i][0]);
    }
    return out;
  }

  // הודעה על כל המסך, רק דרך DOM ו-style (ה-CSP לא מתיר סקריפט מוטבע)
  function showMessage(doc, missing) {
    var box = doc.createElement('div');
    box.id = 'ssWebViewTooOld';
    box.setAttribute('role', 'alert');
    box.setAttribute('dir', 'rtl');
    var s = box.style;
    s.position = 'fixed'; s.top = '0'; s.right = '0'; s.bottom = '0'; s.left = '0'; s.zIndex = '2147483647';
    s.background = '#0f1a30'; s.color = '#ffffff'; s.padding = '32px 24px'; s.fontFamily = 'sans-serif';
    s.fontSize = '18px'; s.lineHeight = '1.6'; s.overflow = 'auto';
    var h = doc.createElement('h1');
    h.style.fontSize = '22px';
    h.appendChild(doc.createTextNode(MESSAGE_TITLE));
    var p = doc.createElement('p');
    p.appendChild(doc.createTextNode(MESSAGE_BODY));
    var small = doc.createElement('p');
    small.style.fontSize = '13px'; small.style.opacity = '.75';
    small.appendChild(doc.createTextNode('חסר: ' + missing.join(', ')));
    box.appendChild(h); box.appendChild(p); box.appendChild(small);
    (doc.body || doc.documentElement).appendChild(box);
  }

  function check(w) {
    var missing = missingFeatures(w);
    if (!missing.length) return missing;
    w.__ssWebViewTooOld = missing;
    var doc = w.document;
    if (doc) {
      if (doc.body) showMessage(doc, missing);
      else doc.addEventListener('DOMContentLoaded', function () { showMessage(doc, missing); });
    }
    return missing;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { missingFeatures: missingFeatures, check: check, MESSAGE_TITLE: MESSAGE_TITLE, MESSAGE_BODY: MESSAGE_BODY };
  } else {
    check(root);
  }
})(this);
