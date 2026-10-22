// חזית עוזר ה-AI של התוכנה. מאחדת את המנועים: העדפות, מנוע הכללים, המודל המקומי, בחירת מנוע והסתרת מזהים.
// סדר העבודה: כללים קודם (דטרמיניסטי) ← המודל המקומי (GGUF בתהליך נפרד) רק למה שהכללים לא מבינים,
// לניסוח מכתבים ולסיכום דוחות. המודל עונה רק מתוך קריאות לכלים (tools.js), וכל מספר בתשובה נבדק
// מול תוצאות הכלים (grounding.js) — תשובה עם מספר מומצא נדחית ועונים ממנוע הכללים.
// אין כאן רשת, אין קריאה למסד ואין לוג של שאלות. הענן — לא מחובר (שלב עתידי, בהסכמה בלבד).
const fs = require('fs');
const path = require('path');

const { createPrefs, DEFAULTS } = require('./prefs');
const { choose, engineLabel, localLicensed, detectTask, routeQuestion } = require('./router');
const { runRules, detectIntent, detectDomain } = require('./rules');
const { redact } = require('./redact');
const { toolsFor, callTool } = require('./tools');
const { checkGrounded } = require('./grounding');
const { createModelStore } = require('./model-pack');
const { createLocalEngine } = require('./engines/local-llm');

const NO_CLOUD = Object.freeze({ ready: false, eligible: false });
const MODELS_DIR = 'ai-models';
const SEARCH_TOOLS = ['find_screen', 'search_records'];

// ההנחיה למודל. קצרה בכוונה — מודל קטן מציית טוב יותר להוראות מעטות וברורות
const SYSTEM_PROMPT = [
  'אתה העוזר של תוכנת SuperSuite לניהול חשבונות, עמותות ותרומות. ענה תמיד בעברית, בקצרה ובנימוס.',
  'כל נתון — רק מתוך קריאה לכלים. אל תחשב בעצמך ואל תמציא מספרים, שמות או תאריכים; העתק סכומים בדיוק כפי שהכלי החזיר.',
  'אם הכלי החזיר error או שאין כלי מתאים — אמור שהנתון אינו זמין, בלי לנחש.',
  'אל תיתן ייעוץ משפטי, מס או השקעות; אפשר להפנות לרואה החשבון.',
].join('\n');

const TASK_PROMPT = {
  answer: (q) => q,
  summary: (q) => `${q}\n\nסכם בשלוש עד חמש שורות, מתוך הכלים בלבד (period_summary, unpaid_invoices, donors_summary לפי הצורך).`,
  letter: (q) => `${q}\n\nנסח טקסט מכובד ונקי, בסגנון המקובל בציבור החרדי (למשל פתיחה ב„בס״ד”, סיום ב„בברכה ובתודה”). `
    + 'אם מוזכר תורם — קרא קודם ל-donor_record והשתמש רק בסכומים שהחזיר. בלי מספרי זהות ובלי פרטים שלא הופיעו בכלי. '
    + 'בנוסח קבלה לתרומה מותר לציין „סעיף 46”.',
};

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

// ctx: { today, summary, invoices, analytics, npo, shamai, trainer, opened, range } — נאסף על ידי הקורא (ipc.js) לפי הרשאות ורישיון
// licenseState() — מצב הרישיון (shell/licensing); בלעדיו המודל המקומי נעול. localEngine / rootKeys — להזרקה בבדיקות
function createAI({ userDataPath, getBackupKey, onError = () => {}, clock = () => Date.now(), licenseState = () => null,
  localEngine = null, rootKeys = null } = {}) {
  const prefs = createPrefs({
    fs,
    dir: userDataPath,
    getBackupKey,
    onError: (scope, e) => onError(scope, e),
    now: () => clock(),
  });

  const modelStore = userDataPath
    ? createModelStore({ fs, dir: path.join(userDataPath, MODELS_DIR), rootKeys: rootKeys || require('../licensing/root-keys') })
    : null;
  const local = localEngine || createLocalEngine({ modelStore, onError: (scope, e) => onError(scope, e), clock });
  // קריאת המודל המותקן (תעודה + גודל) — ברקע; ai:status הראשון עשוי לראות 'unavailable' עד שהיא מסתיימת
  Promise.resolve().then(() => local.refresh()).catch(e => onError('ai-local-refresh', e));

  const licensed = () => { try { return localLicensed(licenseState()); } catch { return false; } };

  // מצב המנועים בפועל. בלי רישיון 'ai.local' — „נעול”, והבורר לא יבחר במודל גם אם הוא מותקן
  function buildStatus(p) {
    const ls = local.status();
    const lic = licensed();
    return {
      local: { mode: lic ? ls.mode : 'locked', licensed: lic, present: ls.present, running: ls.running, model: ls.model, error: ls.error, downloading: false },
      // licensed/eligible — מהרישיון (shell/licensing). בלי רישיון 'ai.cloud' אין זכאות, גם לא בהסכמה
      cloud: { ready: NO_CLOUD.ready, eligible: NO_CLOUD.eligible, licensed: false, consented: p.consent.cloud === true, quotaLeft: null },
      engine: p.engine,
      conceal: p.conceal,
    };
  }

  function status() {
    const p = prefs.get();
    return { ...buildStatus(p), prefs: { ...p } };
  }

  function prefsGet() {
    return prefs.get();
  }

  function prefsSave(patch) {
    return prefs.save(patch);
  }

  const hide = (p, text) => (p.conceal ? redact(text).text : text);

  function rulesAnswer(p, q, ctx, requested, extra = {}) {
    const result = runRules(q, { ...ctx, today: ctx.today || '' });
    return {
      text: hide(p, result.text),
      engine: 'rules',
      engineLabel: engineLabel('rules'),
      requested,
      ...(result.data ? { data: p.conceal ? concealData(result.data) : result.data } : {}),
      ...extra,
    };
  }

  // שאלה אחת למודל המקומי, עם הכלים שפתוחים בהקשר. כל כשל — חזרה לכללים, עם סיבה
  async function askLocal(p, q, ctx, task, requested) {
    const t0 = clock();
    try {
      const prompt = (TASK_PROMPT[task] || TASK_PROMPT.answer)(q);
      const out = await local.chat({
        system: SYSTEM_PROMPT,
        prompt,
        tools: toolsFor(ctx).filter(t => !SEARCH_TOOLS.includes(t.name)),
        onTool: (name, args) => callTool(name, args, ctx),
        maxTokens: task === 'letter' ? 700 : 400,
        temperature: task === 'letter' ? 0.4 : 0.1,
      });
      const text = String(out.text || '').trim();
      const calls = Array.isArray(out.toolCalls) ? out.toolCalls : [];
      // מקורות מותרים למספרים: תוצאות הכלים, השאלה, התאריך, וההנחיה שלנו (למשל „סעיף 46”) — לא שום דבר אחר
      const grounded = checkGrounded(text, [prompt, ctx.today || '', ...calls.map(c => c.result)]);
      if (!text || !grounded.ok) {
        onError('ai-local-ungrounded', new Error(`numbers not from tools: ${grounded.invented.length}`));
        return rulesAnswer(p, q, ctx, requested, { fallback: 'ungrounded' });
      }
      return {
        text: hide(p, text),
        engine: 'local',
        engineLabel: engineLabel('local'),
        requested,
        task,
        tools: calls.map(c => c.name),
        latencyMs: clock() - t0,
      };
    } catch (e) {
      onError('ai-local', e);
      return rulesAnswer(p, q, ctx, requested, { fallback: 'local-error' });
    }
  }

  // תשובה: { text, engine, engineLabel, data?, tools?, fallback? }
  // כשהמודל המקומי לא נבחר — מוחזר אובייקט מיד (כמו קודם). כשהוא נבחר — Promise (ipc.js מחזיר אותו כפי שהוא)
  // conceal=true — ההסתרה חלה על השאלה ועל התשובה לפני שהן בכלל יוצאות מהתהליך הראשי
  function run(question, ctx = {}, opts = {}) {
    const p = prefs.get();
    const requested = choose({ task: 'answer', prefs: p, status: buildStatus(p) });
    const q = p.conceal ? redact(question).text : String(question || '').trim();
    const task = opts && opts.task ? opts.task : detectTask(q);
    const route = routeQuestion({ task, intent: detectIntent(q), domain: detectDomain(q), localReady: requested === 'local' });
    if (route === 'local') return askLocal(p, q, ctx, task, requested);
    return rulesAnswer(p, q, ctx, requested);
  }

  // תמיד Promise — לקוראים חדשים
  async function ask(question, ctx = {}, opts = {}) {
    return run(question, ctx, opts);
  }

  // Ctrl+K בשפה טבעית: התאמת מילים קודם; אם אין התאמה והמודל מוכן — המודל בוחר כלי חיפוש.
  // התוצאה היא תמיד מה שהכלים החזירו (מסכים מהרשימה הסגורה ורשומות קיימות), לעולם לא טקסט של המודל
  async function search(text, ctx = {}) {
    const p = prefs.get();
    const q = clip(p.conceal ? redact(text).text : text, 200);
    const screens = callTool('find_screen', { text: q }, ctx).screens || [];
    const records = callTool('search_records', { text: q }, ctx).records || [];
    if (!q || screens.length || records.length || choose({ task: 'answer', prefs: p, status: buildStatus(p) }) !== 'local') {
      return { screens, records, engine: 'rules' };
    }
    try {
      const out = await local.chat({
        system: SYSTEM_PROMPT + '\nהמשימה: למצוא מסך או רשומה בתוכנה. קרא ל-find_screen ו/או ל-search_records עם מילות מפתח קצרות מהבקשה.',
        prompt: q,
        tools: toolsFor(ctx, SEARCH_TOOLS),
        onTool: (name, args) => callTool(name, args, ctx),
        maxTokens: 120,
        temperature: 0,
      });
      const merged = { screens: [], records: [] };
      for (const c of out.toolCalls || []) {
        for (const s of (c.result && c.result.screens) || []) if (!merged.screens.some(x => x.view === s.view)) merged.screens.push(s);
        for (const r of (c.result && c.result.records) || []) if (!merged.records.some(x => x.name === r.name && x.kind === r.kind)) merged.records.push(r);
      }
      return { ...merged, engine: 'local' };
    } catch (e) {
      onError('ai-local-search', e);
      return { screens: [], records: [], engine: 'rules', fallback: 'local-error' };
    }
  }

  // הסבר לכל סכום בתשובה — וגם לשאלות „מאין הסכום?” — באותו עיקרון
  function explain(payload = {}) {
    const p = prefs.get();
    const text = String(payload.text || '').trim();
    const lines = [];
    lines.push('הסכום מחושב על ידי מנוע החישוב של התוכנה, בלי AI ובלי רשת. המודל המקומי רק מנסח — הוא מעתיק סכומים ולא מחשב אותם.');
    if (p.conceal) lines.push('מזהים (ת״ז, טלפון, דוא״ל) מוסתרים לפני שהטקסט נשמר או מוצג.');
    if (text) lines.push(`הקטע: ${p.conceal ? redact(text).text : text}`);
    return { text: lines.join('\n'), engine: 'rules', engineLabel: engineLabel('rules') };
  }

  // התוסף: התקנה מקובץ (USB) עם תעודה חתומה, אימות מלא, והסרה. התקנה — רק ברישיון 'ai.local'
  const model = {
    status: () => local.status(),
    async install(manifestText, filePath) {
      if (!licensed()) throw new Error('המודל המקומי אינו כלול ברישיון של המערכת');
      if (!modelStore) throw new Error('אין תיקיית נתונים להתקנת המודל');
      local.stop();
      // גם אחרי התקנה שנכשלה — המצב מתעדכן (המודל הקודם נעצר)
      try {
        return await modelStore.install(manifestText, filePath);
      } finally { await local.refresh(); }
    },
    async verify() {
      if (!modelStore) return { present: false };
      const r = await modelStore.current({ deep: true });
      await local.refresh();
      return { present: r.present, error: r.error || null };
    },
    async remove() {
      local.stop();
      try {
        return modelStore ? await modelStore.remove() : { present: false };
      } finally { await local.refresh(); }
    },
  };

  return { status, prefsGet, prefsSave, run, ask, search, explain, model, dispose: () => local.stop() };
}

// נתוני מנוע הכללים — סכומים באגורות; שמות לקוחות עוברים את אותה הסתרה כמו הטקסט
function concealData(data) {
  const d = { ...data };
  if (Array.isArray(d.rows)) d.rows = d.rows.map(r => ({ ...r, customer: redact(r.customer || '').text }));
  return d;
}

// המצב ההתחלתי של ההעדפות — לשימוש בממשק לפני שהעוזר נטען
const DEFAULT_PREFS = DEFAULTS;

module.exports = { createAI, DEFAULT_PREFS, SYSTEM_PROMPT };
