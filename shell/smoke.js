// בדיקת עלייה של הגרסה הארוזה (PLAN.md 3.5): SuperSuite.exe --smoke --user-data-dir=<תיקייה זמנית>
// טוען כל מודול, אוסף שגיאות (JS בעמוד, preload, טעינה, קריסה, שגיאה בתהליך הראשי), כותב smoke.json ויוצא.
// קוד יציאה 0 = הכול נטען בלי שגיאות. נועד ל-GitHub Actions — תופס כיווץ ששבר קוד או בדיקת שלמות שנכשלה.
// בזמן הבדיקה חלונות ההודעה לא נפתחים (נרשמים בלבד): חלון מודאלי היה תוקע את ההרצה בשרת.

const SETTLE_MS = 2500;
const TIMEOUT_MS = 120 * 1000;

const isSmoke = (argv) => (argv || []).includes('--smoke');
// --shots=<תיקייה>: צילום מסך של כל מודול (PLAN.md 7.1 — השוואת מראה לפני/אחרי). רק יחד עם --smoke
const shotsDir = (argv) => { const a = (argv || []).find(x => String(x).startsWith('--shots=')); return a ? String(a).slice(8) : null; };

function createSmoke({ fs, path, dir, dialog, exit, now = Date.now, setTimer = setTimeout, shots = null, measure = null }) {
  const errors = [];
  const loaded = [];
  // זמני טעינה לכל מסך (מדידת מהירות): [{ id, ms }] — מאז תחילת הבדיקה
  const timings = [];
  const started = now();
  let finished = false;
  const add = (where, message) => errors.push({ where, message: String(message).slice(0, 500) });

  // חלונות הודעה: נרשמים כשגיאה ולא נפתחים. showMessageBox מחזיר ביטול
  dialog.showErrorBox = (title, content) => add('dialog', `${title}: ${content}`);
  dialog.showMessageBox = async (a, b) => { const o = b || a || {}; add('dialog', o.message || ''); return { response: o.cancelId != null ? o.cancelId : 0 }; };
  dialog.showMessageBoxSync = (a, b) => { const o = b || a || {}; add('dialog', o.message || ''); return o.cancelId != null ? o.cancelId : 0; };

  function finish(reason) {
    if (finished) return;
    finished = true;
    if (reason) add('smoke', reason);
    const result = { ok: errors.length === 0, ms: now() - started, loaded, errors, timings };
    // measure (אופציונלי): נתוני זיכרון וזמן עלייה מהתהליך הראשי. כשל במדידה לא מכשיל את הבדיקה
    if (measure) { try { result.measure = measure(); } catch { /* מדידה בלבד */ } }
    try { fs.writeFileSync(path.join(dir, 'smoke.json'), JSON.stringify(result, null, 2)); } catch { /* exit בכל מקרה */ }
    exit(result.ok ? 0 : 1);
  }
  const timer = setTimer(() => finish('timeout'), TIMEOUT_MS);
  if (timer && timer.unref) timer.unref();

  function watch(name, wc) {
    wc.on('console-message', (e, level, message) => {
      const ev = e && typeof e.level === 'string' ? e : null;
      if (ev ? ev.level === 'error' : level >= 3) add('console:' + name, ev ? ev.message : message);
    });
    wc.on('preload-error', (_e, file, err) => add('preload:' + name, `${file}: ${err && err.message}`));
    wc.on('did-fail-load', (_e, code, desc, url) => add('load:' + name, `${code} ${desc} ${url}`));
    wc.on('render-process-gone', (_e, d) => add('gone:' + name, d && d.reason));
  }

  // modules: [[שם, webContents מוכן לטעינה]]. waitLoaded מחזיר Promise כשהטעינה הסתיימה.
  // capture(id) (אופציונלי, עם --shots) מחזיר Promise לתמונה (NativeImage עם toPNG, או Buffer)
  async function run(open, ids, waitLoaded, capture) {
    try {
      for (const id of ids) {
        const wc = open(id);
        await waitLoaded(wc);
        loaded.push(id);
        timings.push({ id, ms: now() - started });
      }
      await new Promise(r => setTimer(r, SETTLE_MS));
      if (shots && capture) {
        fs.mkdirSync(shots, { recursive: true });
        for (const id of ids) {
          const img = await capture(id);
          const png = img && typeof img.toPNG === 'function' ? img.toPNG() : img;
          if (!png || !png.length) add('shots', 'צילום ריק: ' + id);
          else fs.writeFileSync(path.join(shots, id + '.png'), png);
        }
      }
    } catch (e) { add('smoke', e && e.message); }
    finish();
  }

  return { watch, run, finish, add, errors, loaded };
}

module.exports = { createSmoke, isSmoke, shotsDir, SETTLE_MS, TIMEOUT_MS };
