const MODS = [
  { id: 'econ',   icon: '₪',  name: 'מערכת כלכלית', desc: 'הנהלת חשבונות, חשבוניות ודוחות' },
  { id: 'shamai', icon: '💎', name: 'שמאי',          desc: 'הערכת שווי נכסים' },
  { id: 'trainer',icon: '🏋️', name: 'TrainerPro',    desc: 'ניהול אימונים ומתאמנים' },
  { id: 'tools',  icon: '🧰', name: 'ארגז כלים',     desc: 'מחשבונים וכלי עזר' }
];
const nav = document.getElementById('nav');
nav.innerHTML = MODS.map((m, i) =>
  `<button data-id="${m.id}" title="${m.desc}"><span class="i">${m.icon}</span><span class="t">${m.name}<small>${m.desc}</small></span><span class="k">Ctrl+${i + 1}</span></button>`).join('');
function mark(id) { nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.id === id)); }
nav.onclick = e => { const b = e.target.closest('button'); if (b) { mark(b.dataset.id); window.shellAPI.switchTo(b.dataset.id); } };
window.shellAPI.onActive(mark);

// חלון סיסמת גיבוי: מחזיר {pass, scope} או null בביטול. scopes=true מציג בחירת מודול (לגיבוי)
function askPassphrase({ title, text, optional, scopes }) {
  const dlg = document.getElementById('pp');
  const input = document.getElementById('ppInput');
  const err = document.getElementById('ppErr');
  const scopeSel = document.getElementById('ppScope');
  document.getElementById('ppTitle').textContent = title;
  document.getElementById('ppText').textContent = text;
  input.value = ''; err.textContent = '';
  input.required = !optional;
  scopeSel.hidden = !scopes;
  scopeSel.value = 'all';
  return new Promise(resolve => {
    const form = document.getElementById('ppForm');
    const cancel = document.getElementById('ppCancel');
    const done = (value) => { form.onsubmit = null; cancel.onclick = null; dlg.close(); resolve(value); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = input.value;
      if (!optional && v.length < 8) { err.textContent = 'הסיסמה חייבת להכיל לפחות 8 תווים'; return; }
      done({ pass: v, scope: scopeSel.value });
    };
    cancel.onclick = () => done(null);
    dlg.showModal();
    input.focus();
  });
}

async function runBackup() {
  const r = await askPassphrase({ title: 'גיבוי מוצפן', text: 'בחר מה לגבות והזן סיסמה. בלי הסיסמה לא ניתן לשחזר את הקובץ.', scopes: true });
  if (r === null) return;
  try { await window.shellAPI.backupAll(r.pass, r.scope); }
  catch (e) { alert(e.message || 'שגיאה בגיבוי'); }
}
async function runRestore() {
  const r = await askPassphrase({ title: 'שחזור מגיבוי', text: 'אם הגיבוי מוצפן, הזן את סיסמת הגיבוי. בגיבוי אוטומטי השאר ריק.', optional: true });
  if (r === null) return;
  try { await window.shellAPI.restoreAll(r.pass); }
  catch (e) { alert(e.message || 'שגיאה בשחזור'); }
}

document.getElementById('bk').onclick = runBackup;
document.getElementById('rs').onclick = runRestore;
document.getElementById('hp').onclick = () => document.getElementById('guide').showModal();
document.getElementById('guideOk').onclick = () => document.getElementById('guide').close();
document.getElementById('hm').onclick = () => window.shellAPI.goHome();
document.getElementById('qt').onclick = () => {
  if (confirm('לצאת מהמערכת ולסגור את החלון?')) window.shellAPI.quit();
};

document.getElementById('tg').onclick = async () => {
  try {
    const t = await window.shellAPI.pickBackupTarget();
    if (t) document.getElementById('tgInfo').textContent = 'גיבוי אוטומטי ליעד: ' + t;
  } catch (e) { alert(e.message || 'נדרשת כניסה למערכת הכלכלית כדי להגדיר יעד גיבוי'); }
};
// יעד הגיבוי תלוי בהרשאת גיבוי, ולכן לפני הכניסה למערכת הכלכלית אין מה לבקש אותו.
// שואלים קודם (בשקט) אם יש כניסה, ורק אז מבקשים את היעד — כדי לא לייצר חריגה בכל הפעלה.
// בכל מעבר למודול הכלכלי מנסים שוב, עד שהמשתמש מתחבר והטקסט מתעדכן.
let targetShown = false;
async function refreshTargetIfLoggedIn() {
  if (targetShown) return;
  try {
    if (!(await window.shellAPI.isLoggedIn())) return;
    const t = await window.shellAPI.getBackupTarget();
    targetShown = true;
    document.getElementById('tgInfo').textContent = t ? 'גיבוי אוטומטי ליעד: ' + t : 'גיבוי אוטומטי: תיקיית המסמכים';
    // סטטוס הגיבוי האחרון: כשל שקט (אין הצפנת מערכת / כונן מנותק) חייב להיות גלוי למשתמש
    const st = window.shellAPI.getBackupStatus ? await window.shellAPI.getBackupStatus() : '';
    if (st) document.getElementById('tgInfo').textContent += ' · ' + st;
  } catch { /* נעדכן במעבר הבא */ }
}
window.shellAPI.onActive(id => { if (id === 'econ') refreshTargetIfLoggedIn(); });

// פקודות מקלדת שמטופלות במעטפת (F1, Ctrl+Shift+B/R)
window.shellAPI.onCmd(cmd => {
  if (cmd === 'help') document.getElementById('guide').showModal();
  if (cmd === 'backup') runBackup();
  if (cmd === 'restore') runRestore();
});
