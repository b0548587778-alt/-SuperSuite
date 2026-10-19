// חלון הודעה ואישור — אותו חלון כמו בשאר התוכנה (shell/ss-dialog.js, נטען ב-index.html).
// מחוץ לתוכנה (vite dev) אין ssDialog — נופלים לחלון של הדפדפן.
const ss = () => (typeof window !== 'undefined' && window.ssDialog) || null;

export function askConfirm(message, opts = {}) {
  const d = ss();
  return d ? d.confirm(message, opts) : Promise.resolve(window.confirm(message));
}

export function showMessage(message, opts = {}) {
  const d = ss();
  return d ? d.alert(message, opts) : Promise.resolve(window.alert(message));
}
