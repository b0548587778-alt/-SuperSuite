// כללי הרשאה למעבר בין מודולים. קובץ נפרד (בלי Electron) כדי שאפשר לבדוק אותו בטסטים.

// מעטפת בלבד רשאית לנווט ישירות (ערוץ shell:switch)
function canShellNavigate(senderId, shellId) {
  return Number.isInteger(shellId) && senderId === shellId;
}

// מודול שמבקש לפתוח מודול אחר (ערוץ shell:open-module): השולח חייב להיות תצוגת מודול קיימת,
// והיעד חייב להיות מזהה מוכר. מודול שאינו מוצג כתצוגה לא יכול לנווט.
function canModuleOpen(senderId, moduleViewIds, target, mods) {
  return Array.isArray(moduleViewIds) && moduleViewIds.includes(senderId)
    && Array.isArray(mods) && mods.includes(target);
}

// בדיקה שהפוקוס נמצא בשדה עריכה. נשלחת לתוך ה-renderer דרך executeJavaScript.
const EDITING_CHECK_JS = `(function () {
  const a = document.activeElement;
  return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
})()`;

module.exports = { canShellNavigate, canModuleOpen, EDITING_CHECK_JS };
