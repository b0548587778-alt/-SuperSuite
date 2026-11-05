// המהדורה של הבנייה הזו — נכתב בזמן הבנייה (tools/set-edition.js / build-local.js --product, SS_PRODUCT ב-CI).
// במאגר תמיד 'full' (המהדורה המלאה = ההתנהגות של היום). אין לערוך ידנית לפני commit — tests/edition.test.js בודק.
(function (root) {
  const id = 'full';
  if (typeof module !== 'undefined' && module.exports) module.exports = id;
  else root.SUITE_EDITION_ID = id;
})(typeof window !== 'undefined' ? window : this);
