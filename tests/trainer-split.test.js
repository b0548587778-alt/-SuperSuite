// מבנה קוד המקור של מודול האימונים אחרי הפירוק (PLAN.md 6.2): קובץ לכל תחום ב-src/features,
// כל רכיב מוגדר בקובץ אחד בלבד, וכל ייבוא יחסי מצביע על קובץ קיים שמייצא את השם.
// (מקומית אין vite — זו הבדיקה שתופסת ייבוא שבור לפני הבנייה ב-CI)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SRC, jsxFiles } = require('./helpers/trainer-src');

const rel = (f) => path.relative(SRC, f).split(path.sep).join('/');
const read = (f) => fs.readFileSync(f, 'utf8');
const IMPORT_RE = /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*'([^']+)'/g;
const names = (list) => (list || '').split(',').map(s => s.trim()).filter(Boolean);

test('App.jsx: רק המעטפת של המודול (ניווט וסרגל), והמסכים בקבצים נפרדים', () => {
  const app = read(path.join(SRC, 'App.jsx'));
  const fns = [...app.matchAll(/^(?:export (?:default )?)?function (\w+)/gm)].map(m => m[1]);
  assert.deepEqual(fns, ['App', 'Sidebar']);
  assert.ok(app.split('\n').length < 300, 'App.jsx גדל שוב: ' + app.split('\n').length + ' שורות');
  for (const f of ['home', 'clients', 'program', 'library', 'nutrition', 'knowledge', 'tools', 'mobility', 'cardio', 'templates']) {
    assert.ok(fs.existsSync(path.join(SRC, 'features', f + '.jsx')), f);
  }
});

test('כל רכיב מוגדר בקובץ אחד בלבד', () => {
  const where = {};
  for (const f of jsxFiles()) {
    for (const m of read(f).matchAll(/^(?:export (?:default )?)?(?:function|const) (\w+)/gm)) (where[m[1]] = where[m[1]] || []).push(rel(f));
  }
  // components/ui.jsx (של studio.jsx) ו-components/legacy-ui.jsx (של שאר המסכים) — שני מימושים בכוונה, עד 6.4
  const ALLOWED_TWICE = new Set(['Btn', 'Card', 'Field', 'Input', 'Textarea', 'Badge', 'Modal', 'Toggle', 'FONT_HEADING', 'FONT_BODY']);
  const dup = Object.entries(where).filter(([n, fs]) => fs.length > 1 && !(ALLOWED_TWICE.has(n) && fs.every(f => f.startsWith('components/'))));
  assert.deepEqual(dup, []);
});

test('כל ייבוא יחסי: הקובץ קיים ומייצא את השם; ואין ייבוא שלא בשימוש', () => {
  const problems = [];
  for (const f of jsxFiles()) {
    const text = read(f);
    const body = text.split('\n').filter(l => !/^import /.test(l)).join('\n').replace(/^\s*\/\/.*$/gm, '');
    for (const m of text.matchAll(IMPORT_RE)) {
      const [, def, list, from] = m;
      for (const n of names(list)) {
        if (!new RegExp(`(?<![\\w.])${n}(?![\\w])`).test(body)) problems.push(`${rel(f)}: ${n} מיובא ולא בשימוש`);
      }
      if (!from.startsWith('.')) continue;
      const target = path.join(path.dirname(f), from);
      if (!fs.existsSync(target)) { problems.push(`${rel(f)}: ${from} לא קיים`); continue; }
      const t = read(target);
      for (const n of names(list)) {
        if (!new RegExp(`export (?:const|function|async function) ${n}\\b`).test(t)) problems.push(`${rel(f)}: ${n} לא מיוצא מ-${from}`);
      }
      if (def && def !== 'React' && !/export default /.test(t)) problems.push(`${rel(f)}: אין export default ב-${from}`);
    }
    if (/<[A-Za-z]/.test(body) && !/^import React\b/m.test(text)) problems.push(`${rel(f)}: JSX בלי import React`);
  }
  assert.deepEqual(problems, []);
});

test('כל רכיב שמשמש בקובץ — מוגדר בו או מיובא אליו', () => {
  const exported = new Set();
  for (const f of jsxFiles()) for (const m of read(f).matchAll(/^export (?:default )?(?:function|const) (\w+)/gm)) exported.add(m[1]);
  const problems = [];
  for (const f of jsxFiles()) {
    const text = read(f);
    // מוגדר בקובץ — גם משתנה מקומי בתוך פונקציה (למשל const Tag = onClick ? 'button' : 'div')
    const local = new Set([...text.matchAll(/(?:function|const|let) (\w+)/g)].map(m => m[1]));
    const imported = new Set();
    for (const m of text.matchAll(IMPORT_RE)) { if (m[1]) imported.add(m[1]); names(m[2]).forEach(n => imported.add(n)); }
    const body = text.split('\n').filter(l => !/^import /.test(l)).join('\n').replace(/^\s*\/\/.*$/gm, '');
    // רכיב JSX (<Name) או קריאה לפונקציה של קובץ אחר
    const used = new Set([...body.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]));
    for (const n of exported) if (new RegExp(`(?<![\\w.])${n}\\(`).test(body)) used.add(n);
    for (const n of used) if (!local.has(n) && !imported.has(n)) problems.push(`${rel(f)}: ${n}`);
  }
  assert.deepEqual(problems, []);
});
