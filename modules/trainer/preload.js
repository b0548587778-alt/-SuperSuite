// מודול האימונים בתוך הסרגל האחיד. המודול הוא חבילה מהודרת בלי API, ולכן ה-preload עובד מול ה-DOM:
// - trainer:goto (מ-main.js, עם הטקסט של הכפתור) — לחיצה על הכפתור המתאים בסרגל הפנימי;
// - דיווח המסך הפעיל (shell:trainer-view) — כדי שהסרגל האחיד יסמן אותו גם כשעוברים מסך מתוך המודול;
// - הסתרת הסרגל הפנימי — הניווט כולו בסרגל האחיד (כמו embedded=1 במודול הכלכלי).
// אין חשיפה לעמוד (contextBridge) — המודול לא מקבל שום יכולת חדשה.
const { ipcRenderer } = require('electron');

// הכפתור הפעיל מסומן במחלקה הזו בחבילה המהודרת
const ACTIVE_CLASS = 'bg-indigo-500/15';

// הטקסט של כפתור בלי האייקון שלפניו ("🥗תזונה" ← "תזונה")
function labelOf(btn) {
  return btn.textContent.replace(/^[^֐-׿]+/, '').trim();
}
function navButtons() {
  return [...document.querySelectorAll('aside button')].filter(b => labelOf(b));
}

let pending = null;
function tryGo() {
  if (!pending) return;
  const btn = navButtons().find(b => labelOf(b) === pending);
  if (btn) { pending = null; btn.click(); }
}

let reported = null;
function report() {
  const btn = navButtons().find(b => String(b.className).split(/\s+/).includes(ACTIVE_CLASS));
  const label = btn ? labelOf(btn) : null;
  if (label && label !== reported) {
    reported = label;
    ipcRenderer.invoke('shell:trainer-view', label).catch(() => {});
  }
}

// הבקשה נשמרת עד שהסרגל הפנימי קיים (למשל אחרי מסך ההגדרה הראשונית)
ipcRenderer.on('trainer:goto', (_e, label) => {
  pending = typeof label === 'string' ? label : null;
  tryGo();
});

// ── שאלון PAR-Q (כלי מאמן ← טופס PAR-Q) ──
// בחבילה הטופס הוא המסך עצמו עם window.print(): ההדפסה יצאה כצילום מסך (כותרות, לשוניות,
// שדות קלט) על שני עמודים, ולא היה איפה לחתום. כאן נוספים משטח חתימה בטופס, ובזמן ההדפסה
// נבנה מסמך נקי בעמוד A4 אחד מתוך הנתונים שבטופס — והוא לבדו מודפס.
const PARQ_TITLE = 'שאלון התאמה לפעילות גופנית';
const SIG_LABEL = 'חתימת המתאמן';
const SIG_W = 600, SIG_H = 160;

const PARQ_CSS = `
.ss-sig{position:relative;margin-bottom:4px}
.ss-sig canvas{display:block;width:100%;max-width:340px;height:90px;background:#f8fafc;border:1px dashed #94a3b8;border-radius:6px;touch-action:none;cursor:crosshair}
.ss-sig .ss-sig-hint{position:absolute;inset:0;max-width:340px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;pointer-events:none}
.ss-sig.signed .ss-sig-hint{display:none}
.ss-sig button{margin-top:4px;font-size:11px;color:#475569;background:none;border:1px solid #cbd5e1;border-radius:4px;padding:1px 8px;cursor:pointer}
.print-page input{color-scheme:light}
#ss-print{display:none}
@media print{
  @page{size:A4;margin:14mm 16mm}
  html.ss-print-parq,html.ss-print-parq body{background:#fff !important}
  html.ss-print-parq body>*:not(#ss-print){display:none !important}
  html.ss-print-parq #ss-print{display:block !important}
}
#ss-print{direction:rtl;color:#000;font-family:"David","Times New Roman",serif;font-size:12.5pt;line-height:1.45}
#ss-print h1{font-size:19pt;text-align:center;margin:0 0 2pt}
#ss-print .sub{text-align:center;font-size:10pt;color:#444;margin-bottom:12pt}
#ss-print .fields{display:flex;gap:24pt;margin-bottom:10pt}
#ss-print .fields div{flex:1;border-bottom:1px solid #000;padding-bottom:2pt}
#ss-print .fields b{font-weight:normal;color:#444;margin-left:6pt}
#ss-print table{width:100%;border-collapse:collapse;margin-bottom:10pt}
#ss-print th,#ss-print td{border:1px solid #555;padding:4pt 6pt;vertical-align:top}
#ss-print th{background:#eee !important;font-weight:bold;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#ss-print td.n{width:22pt;text-align:center}
#ss-print td.box{width:34pt;text-align:center;font-size:14pt;font-family:"Segoe UI Symbol","Arial",sans-serif}
#ss-print .result{border:1.5px solid #000;padding:6pt 8pt;margin-bottom:10pt;font-weight:bold}
#ss-print .decl{font-size:11pt;margin-bottom:18pt}
#ss-print .signs{display:flex;gap:30pt;align-items:flex-end}
#ss-print .signs>div{flex:1}
#ss-print .line{border-top:1px solid #000;padding-top:2pt;font-size:10pt;color:#333}
#ss-print .sigimg{height:60pt;display:flex;align-items:flex-end}
#ss-print .sigimg img{max-height:60pt;max-width:100%}
#ss-print .val{min-height:60pt;display:flex;align-items:flex-end;padding-bottom:2pt}
`;

// השאלון המוצג כעת (אם יש) — לפי הכותרת שבתוך .print-page
function parqRoot() {
  return [...document.querySelectorAll('.print-page')]
    .find(el => (el.querySelector('h2') || {}).textContent === PARQ_TITLE) || null;
}

let sigCanvas = null; // משטח החתימה של הטופס המוצג; מתאפס כשהטופס נבנה מחדש (כמו שאר שדותיו)
let sigEmpty = true;

function addSignaturePad(root) {
  if (root.querySelector('.ss-sig')) return;
  const label = [...root.querySelectorAll('div')].find(d => d.textContent === SIG_LABEL && !d.children.length);
  if (!label) return;
  const wrap = document.createElement('div');
  wrap.className = 'ss-sig no-print';
  const canvas = document.createElement('canvas');
  canvas.width = SIG_W; canvas.height = SIG_H;
  const hint = document.createElement('div');
  hint.className = 'ss-sig-hint';
  hint.textContent = 'חתמו כאן בעכבר או במגע';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'ניקוי חתימה';
  wrap.append(canvas, hint, clear);
  label.parentNode.insertBefore(wrap, label);

  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f172a';
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * SIG_W / r.width, (e.clientY - r.top) * SIG_H / r.height];
  };
  let drawing = false;
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y); ctx.stroke();
    sigEmpty = false; wrap.classList.add('signed');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = at(e);
    ctx.lineTo(x, y); ctx.stroke();
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  clear.addEventListener('click', () => {
    ctx.clearRect(0, 0, SIG_W, SIG_H);
    sigEmpty = true; wrap.classList.remove('signed');
  });
  sigCanvas = canvas;
  sigEmpty = true;
}

// הנתונים מתוך הטופס כפי שהוא מוצג (הקלטים מנוהלים ע"י React — הערך ב-DOM הוא הערך הנוכחי)
function readParq(root) {
  const inputs = [...root.querySelectorAll('input')];
  const name = (inputs.find(i => i.type === 'text' || !i.type) || {}).value || '';
  const date = (inputs.find(i => i.type === 'date') || {}).value || '';
  const questions = [...root.querySelectorAll('.space-y-3 > div')].map(box => {
    const text = (box.firstElementChild ? box.firstElementChild.textContent : '').replace(/^\s*\d+\.\s*/, '').trim();
    const [yes, no] = box.querySelectorAll('input[type=radio]');
    return { text, answer: yes && yes.checked ? 'yes' : no && no.checked ? 'no' : null };
  }).filter(q => q.text);
  const declP = [...root.querySelectorAll('p')].find(p => p.textContent.startsWith('הצהרה'));
  return {
    name: name.trim(), date, questions,
    declaration: declP ? declP.textContent.replace(/^הצהרה:\s*/, '').trim() : '',
    signature: sigCanvas && !sigEmpty ? sigCanvas.toDataURL('image/png') : null,
  };
}

function parqResult(questions) {
  if (questions.some(q => q.answer === 'yes')) return 'נמצאה תשובה חיובית — נדרש אישור רופא לפני תחילת תוכנית אימונים.';
  if (questions.some(q => !q.answer)) return 'השאלון לא הושלם — יש שאלות ללא תשובה.';
  return 'כל התשובות שליליות — לפי השאלון אין מניעה לתחילת תוכנית אימונים.';
}

function missingParts(data) {
  const missing = [];
  if (!data.name) missing.push('שם המתאמן');
  const open = data.questions.filter(q => !q.answer).length;
  if (open) missing.push(`${open} שאלות ללא תשובה`);
  if (!data.signature) missing.push('חתימה');
  return missing;
}

// "2026-10-15" ← "15/10/2026" (בלי Date — לא מושפע מאזור הזמן)
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

// המסמך המודפס — נבנה ב-textContent בלבד (שם המתאמן הוא קלט חופשי)
function buildPrintDoc(data) {
  const doc = el('div');
  doc.id = 'ss-print';
  doc.append(el('h1', '', PARQ_TITLE), el('div', 'sub', 'PAR-Q — שאלון מוכנות לפעילות גופנית'));

  const fields = el('div', 'fields');
  const field = (label, value) => { const d = el('div'); d.append(el('b', '', label + ':'), document.createTextNode(value)); return d; };
  fields.append(field('שם מלא', data.name), field('תאריך', formatDate(data.date)));
  doc.append(fields);

  const table = el('table');
  const head = el('tr');
  head.append(el('th', '', '#'), el('th', '', 'שאלה'), el('th', '', 'כן'), el('th', '', 'לא'));
  table.append(head);
  data.questions.forEach((q, i) => {
    const tr = el('tr');
    tr.append(el('td', 'n', String(i + 1)), el('td', '', q.text),
      el('td', 'box', q.answer === 'yes' ? '☒' : '☐'), el('td', 'box', q.answer === 'no' ? '☒' : '☐'));
    table.append(tr);
  });
  doc.append(table, el('div', 'result', parqResult(data.questions)));
  if (data.declaration) {
    const decl = el('div', 'decl');
    decl.append(el('b', '', 'הצהרה: '), document.createTextNode(data.declaration));
    doc.append(decl);
  }

  const signs = el('div', 'signs');
  const sig = el('div');
  const sigBox = el('div', 'sigimg');
  if (data.signature) { const img = el('img'); img.src = data.signature; img.alt = SIG_LABEL; sigBox.append(img); }
  sig.append(sigBox, el('div', 'line', SIG_LABEL));
  const date = el('div');
  date.append(el('div', 'val', formatDate(data.date)), el('div', 'line', 'תאריך'));
  signs.append(sig, date);
  doc.append(signs);
  return doc;
}

function preparePrint() {
  cleanupPrint();
  const root = parqRoot();
  if (!root) return; // הדפסה אחרת במודול — ללא שינוי
  document.body.appendChild(buildPrintDoc(readParq(root)));
  document.documentElement.classList.add('ss-print-parq');
}
function cleanupPrint() {
  const old = document.getElementById('ss-print');
  if (old) old.remove();
  document.documentElement.classList.remove('ss-print-parq');
}

// לפני ההדפסה: אם הטופס חסר — שאלה אם להדפיס בכל זאת (טופס ריק להחתמה ידנית הוא שימוש לגיטימי)
function onPrintClick(e) {
  const btn = e.target && e.target.closest && e.target.closest('button');
  if (!btn || !btn.textContent.includes('הדפסה')) return;
  const root = parqRoot();
  if (!root || !btn.closest('.no-print') || btn.closest('.print-page')) return;
  const missing = missingParts(readParq(root));
  if (missing.length && !window.confirm(`בטופס חסרים: ${missing.join(', ')}.\nלהדפיס בכל זאת?`)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = 'aside{display:none !important}';
  document.head.appendChild(style);
  const parqStyle = document.createElement('style');
  parqStyle.textContent = PARQ_CSS;
  document.head.appendChild(parqStyle);
  const enhance = () => { const root = parqRoot(); if (root) addSignaturePad(root); };
  new MutationObserver(() => { tryGo(); report(); enhance(); })
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  tryGo();
  report();
  enhance();
});
window.addEventListener('click', onPrintClick, true);
window.addEventListener('beforeprint', preparePrint);
window.addEventListener('afterprint', cleanupPrint);
