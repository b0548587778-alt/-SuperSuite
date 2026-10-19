// פירוק App.jsx של מודול האימונים לקבצים לפי תחום (PLAN.md 6.2) — חד-פעמי, בלי לשנות שום שורת קוד.
// כל פונקציה ברמה העליונה עוברת כמו שהיא (מהשורה שלה עד לפני הפונקציה הבאה, כולל ההערות שלפניה)
// לקובץ שנקבע ב-GROUPS. שורות ה-import נבנות לפי השמות שבאמת מופיעים בכל קובץ.
//   node tools/split-trainer-app.js          — כותב את הקבצים
//   node tools/split-trainer-app.js --check  — רק מדפיס את החלוקה
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'modules-src', 'trainer', 'src');
const APP = path.join(SRC, 'App.jsx');

// קובץ ← רשימת הפונקציות. כל פונקציה ב-App.jsx חייבת להופיע בדיוק פעם אחת (או להישאר ב-App.jsx)
const GROUPS = {
  'components/legacy-ui.jsx': ['Btn', 'Card', 'Field', 'Input', 'Textarea', 'Badge', 'Modal', 'Toggle'],
  'features/home.jsx': ['TrainerSetup', 'Dashboard', 'StatCard', 'formatRelative', 'TrainerSettings'],
  'features/clients.jsx': ['ClientsList', 'ClientForm', 'ClientDetail', 'OverviewTab', 'Row', 'ProgressTab', 'SessionsTab'],
  'features/program.jsx': ['ProgramTab', 'AddExerciseButton', 'PrintableProgram', 'PrintContent'],
  'features/library.jsx': ['LibraryView'],
  'features/nutrition.jsx': ['NutritionView', 'NutritionCalculator', 'FoodDatabase', 'MealPlansList', 'NutritionTipsList',
    'ClientNutritionTab', 'PrintableNutrition', 'NutritionPrintContent'],
  'features/knowledge.jsx': ['KnowledgeView', 'WarmupList', 'InjuriesList', 'PrinciplesList', 'TechniquesList'],
  'features/tools.jsx': ['ToolsView', 'OneRMCalculator', 'FMSAssessment', 'PARQForm', 'ClientAssessmentTab'],
  'features/mobility.jsx': ['MobilityView', 'MobilityRoutinesList', 'YogaList', 'RecoveryList'],
  'features/cardio.jsx': ['CardioView', 'HRZonesCalc', 'HIITList', 'LISSList', 'RunningProgramsList', 'IntervalTimer'],
  'features/templates.jsx': ['TemplatesView', 'PrintableTemplate', 'TemplatePrintContent'],
};
const STAYS = ['App', 'Sidebar'];

// מפרק את שורות ה-import בראש הקובץ: שם ← { from, def }
function parseImports(head) {
  const names = new Map();
  const re = /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*'([^']+)';/g;
  for (const m of head.matchAll(re)) {
    const [, def, list, from] = m;
    if (def) names.set(def, { from, def: true });
    for (const n of (list || '').split(',').map(s => s.trim()).filter(Boolean)) names.set(n, { from, def: false });
  }
  return names;
}

function split(text) {
  const lines = text.split('\n');
  const starts = [];
  lines.forEach((l, i) => {
    const m = /^(export default )?function (\w+)\s*\(/.exec(l);
    if (m) starts.push({ name: m[2], line: i });
  });
  // הקבועים FONT_* — שורות בודדות לפני הפונקציה הראשונה
  const consts = lines.filter(l => /^const FONT_(HEADING|BODY) = /.test(l));
  const firstFn = starts[0].line;
  // ההערות שלפני פונקציה שייכות לה: הגבול הוא סוף הפונקציה הקודמת ("}" בתחילת שורה)
  const blocks = starts.map((s, k) => {
    let from = s.line;
    while (from > 0 && k > 0 && !/^}\s*$/.test(lines[from - 1]) && from - 1 > starts[k - 1].line) from--;
    const end = k + 1 < starts.length ? starts[k + 1].line : lines.length;
    return { name: s.name, from, end };
  });
  // תיקון: כל בלוק נגמר איפה שהבא מתחיל (כולל ההערות שלו)
  for (let k = 0; k + 1 < blocks.length; k++) blocks[k].end = blocks[k + 1].from;
  return { lines, blocks, consts, head: lines.slice(0, firstFn).join('\n') };
}

function usedNames(code, candidates) {
  return candidates.filter(n => new RegExp(`(?<![\\w.])${n}(?![\\w])`).test(code));
}

function relImport(fromFile, target) {
  let r = path.posix.relative(path.posix.dirname(fromFile), target);
  if (!r.startsWith('.')) r = './' + r;
  return r;
}

function plan(text) {
  const { lines, blocks, consts, head } = split(text);
  const imports = parseImports(head);
  const owner = new Map();
  for (const [file, names] of Object.entries(GROUPS)) for (const n of names) {
    if (owner.has(n)) throw new Error('פונקציה בשני קבצים: ' + n);
    owner.set(n, file);
  }
  for (const n of STAYS) owner.set(n, 'App.jsx');
  const all = blocks.map(b => b.name);
  const missing = all.filter(n => !owner.has(n));
  const extra = [...owner.keys()].filter(n => !all.includes(n));
  if (missing.length || extra.length) throw new Error(`חלוקה לא שלמה — חסרים: ${missing} | לא קיימים: ${extra}`);

  const files = {};
  for (const b of blocks) {
    const f = owner.get(b.name);
    (files[f] = files[f] || []).push(b);
  }
  const body = (f) => files[f].map(b => lines.slice(b.from, b.end).join('\n')).join('\n').replace(/\n+$/, '\n');

  // אילו פונקציות משמשות מחוץ לקובץ שלהן — אלה מקבלות export
  const bodies = Object.fromEntries(Object.keys(files).map(f => [f, body(f)]));
  const exported = new Set();
  const deps = {};
  for (const f of Object.keys(files)) {
    const local = new Set(files[f].map(b => b.name));
    const fnUses = usedNames(bodies[f], all.filter(n => !local.has(n)));
    fnUses.forEach(n => exported.add(n));
    const fontUses = usedNames(bodies[f], ['FONT_HEADING', 'FONT_BODY']);
    const extUses = usedNames(bodies[f], [...imports.keys()].filter(n => n !== 'React'));
    deps[f] = { fnUses, fontUses, extUses, jsx: /<[A-Za-z]/.test(bodies[f]) };
  }

  const out = {};
  for (const f of Object.keys(files)) {
    const d = deps[f];
    const imp = [];
    // React: תמיד כשיש JSX (כמו המקור), והוקים לפי השימוש
    const hooks = d.extUses.filter(n => imports.get(n).from === 'react');
    if (d.jsx || hooks.length) imp.push(`import React${hooks.length ? `, { ${hooks.join(', ')} }` : ''} from 'react';`);
    // ספריות ונתונים: לפי סדר המקור
    const byFrom = new Map();
    for (const n of d.extUses) {
      const { from } = imports.get(n);
      if (from === 'react') continue;
      if (!byFrom.has(from)) byFrom.set(from, []);
      byFrom.get(from).push(n);
    }
    for (const [from, ns] of byFrom) {
      const target = from.startsWith('.') ? relImport(f, path.posix.join('.', from)) : from;
      imp.push(`import { ${ns.join(', ')} } from '${target}';`);
    }
    // פונקציות מקבצים אחרים — לפי הקובץ שלהן
    const fromFiles = new Map();
    const fonts = f === 'components/legacy-ui.jsx' ? [] : d.fontUses;
    if (fonts.length) fromFiles.set('components/legacy-ui.jsx', [...fonts]);
    for (const n of d.fnUses) {
      const of = owner.get(n);
      if (!fromFiles.has(of)) fromFiles.set(of, []);
      fromFiles.get(of).push(n);
    }
    for (const [of, ns] of fromFiles) {
      if (of === 'App.jsx') throw new Error(`${f} משתמש ב-${ns} שנשאר ב-App.jsx`);
      imp.push(`import { ${ns.join(', ')} } from '${relImport(f, of)}';`);
    }
    let code = bodies[f];
    // export לפונקציה שמשמשת מחוץ לקובץ שלה (App נשאר export default)
    for (const b of files[f]) if (exported.has(b.name)) code = code.replace(new RegExp(`^function ${b.name}\\s*\\(`, 'm'), m => 'export ' + m);
    const header = f === 'App.jsx' ? null :
      `// מודול האימונים — ${path.posix.basename(f)}: הועבר מ-App.jsx כמו שהוא (PLAN.md 6.2)\n`;
    if (f === 'components/legacy-ui.jsx') {
      code = consts.map(c => 'export ' + c).join('\n') + '\n\n' + code;
    }
    out[f] = { imp, code, header };
  }

  // App.jsx: רק ה-import של React מהראש המקורי; כל השאר נבנה לפי השימוש, כמו בשאר הקבצים
  const app = out['App.jsx'];
  app.full = app.imp.join('\n') + '\n\n' + app.code;
  return { out, owner, deps };
}

function main() {
  const raw = fs.readFileSync(APP, 'utf8');
  // כבר פורק (App.jsx מייבא מ-features/) — הרצה שנייה הייתה מוחקת את הקבצים, לכן נעצרים
  if (/from '\.\/features\//.test(raw)) { console.log('App.jsx כבר פורק — אין מה לעשות'); return; }
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const { out, deps } = plan(raw.replace(/\r\n/g, '\n'));
  for (const [f, o] of Object.entries(out)) {
    console.log(`${f.padEnd(28)} ${o.code.split('\n').length} שורות | ${o.imp.length} import`);
    if (process.argv.includes('-v')) console.log('   ', JSON.stringify(deps[f]));
  }
  if (process.argv.includes('--check')) return;
  for (const [f, o] of Object.entries(out)) {
    const text = f === 'App.jsx' ? o.full : o.header + o.imp.join('\n') + '\n\n' + o.code;
    fs.mkdirSync(path.dirname(path.join(SRC, f)), { recursive: true });
    fs.writeFileSync(path.join(SRC, f), text.replace(/\n/g, nl));
  }
}

if (require.main === module) main();
module.exports = { GROUPS, STAYS, plan, split, parseImports, usedNames };
