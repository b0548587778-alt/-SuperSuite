// חלון קוד השחזור — הקוד נבדק בתהליך הראשי; כאן רק קלט והצגת השגיאה
(async () => {
  const info = await window.recoveryAPI.info();
  if (info && info.message) document.getElementById('err').textContent = info.message;
  const send = () => window.recoveryAPI.submit(document.getElementById('code').value);
  document.getElementById('ok').addEventListener('click', send);
  document.getElementById('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  document.getElementById('cancel').addEventListener('click', () => window.recoveryAPI.submit(null));
})();
