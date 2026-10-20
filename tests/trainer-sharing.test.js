// מודול האימונים — שליחת תוכנית ותזכורות (modules-src/trainer/src/lib/sharing.js), בדיקת קוד 20.10.2026 ממצאים 1–2:
// טקסט התוכנית בלי "undefined"/"null" ועם שמות בעברית, ומספר וואטסאפ ישראלי מקומי ← פורמט בינלאומי (כמו בשמאות)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..', 'modules-src', 'trainer', 'src');
const load = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);
let Sh, P, Co, E, T;
test.before(async () => {
  [Sh, P, Co, E, T] = await Promise.all(['lib/sharing.js', 'lib/program.js', 'data/constants.js', 'data/exercises.js', 'data/program-templates.js'].map(load));
});

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const trainer = { name: 'המאמן דוד', businessName: 'סטודיו אור', phone: '050-7654321' };
const NOW = { now: new Date(2026, 9, 20, 12) };
const noJunk = (text) => {
  assert.doesNotMatch(text, /undefined/, 'אין "undefined" בטקסט');
  assert.doesNotMatch(text, /\bnull\b/, 'אין "null" בטקסט');
  assert.doesNotMatch(text, /NaN/, 'אין "NaN" בטקסט');
};

test('תוכנית מהמחולל: שמות התרגילים מהספרייה, מטרה ורמה בעברית, תרגיל לפי זמן — משך ולא "null חזרות"', () => {
  const client = { name: 'יוסף כהן', goal: 'weight-loss', level: 'beginner', daysPerWeek: 3, medical: [], equipment: Co.EQUIPMENT.map(e => e.id) };
  const program = P.generateProgram(client, { random: seeded(3) });
  assert.equal(program.level, undefined, 'התרחיש מהבדיקה: למחולל אין level');
  const text = Sh.programToPlainText(client, program, trainer, NOW);
  noJunk(text);
  assert.match(text, /🎯 מטרה: ירידה במשקל/);
  assert.match(text, /📊 רמה: מתחיל/, 'הרמה מכרטיס המתאמן כשאין בתוכנית');
  assert.doesNotMatch(text, /weight-loss|beginner/, 'לא מזהה באנגלית');
  for (const ex of program.days.flatMap(d => d.exercises)) {
    const name = E.EXERCISES.find(e => e.id === ex.exerciseId).name;
    assert.ok(text.includes(name), 'שם התרגיל בטקסט: ' + name);
  }
  const timed = program.days.flatMap(d => d.exercises).find(x => x.reps === null && x.duration);
  assert.ok(timed, 'יש בתוכנית תרגיל לפי זמן');
  assert.ok(text.includes(Sh.formatDuration(timed.duration)), 'משך התרגיל מוצג');
  assert.match(text, /— נשלח מ-TrainerPro$/);
});

test('תוכנית מתבנית: מטרה ורמה כתוויות, ושמות כל התרגילים', () => {
  const tpl = T.PROGRAM_TEMPLATES.find(t => t.category === 'strength');
  // כמו templates.jsx → assignToClient
  const program = { goal: tpl.category, level: tpl.level, days: tpl.days.map(d => ({ name: d.name, exercises: d.exercises.map(e => ({ ...e, weight: '' })) })) };
  const text = Sh.programToPlainText({ name: 'שמעון לוי' }, program, trainer, NOW);
  noJunk(text);
  assert.match(text, /🎯 מטרה: כוח/);
  assert.match(text, new RegExp('📊 רמה: ' + Co.LEVELS.find(l => l.id === tpl.level).label));
  const first = E.EXERCISES.find(e => e.id === tpl.days[0].exercises[0].exerciseId).name;
  assert.match(text, new RegExp('1\\. ' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /5 סטים × 5 חזרות · מנוחה 180״/);
});

test('שדות חסרים מושמטים: מטרה לא מוכרת, בלי רמה, תרגיל שאינו בספרייה, בלי מנוחה ובלי שם מתאמן', () => {
  const known = E.EXERCISES[0];
  const program = { goal: 'xyz', days: [{ exercises: [
    { exerciseId: 'no-such-exercise', sets: 3, reps: 10 },
    { exerciseId: known.id, sets: 2, reps: null, duration: null, rest: 0, notes: '' },
    { exerciseId: known.id, name: 'ישן', sets: '', reps: '' },
  ] }] };
  const text = Sh.programToPlainText({}, program, null, NOW);
  noJunk(text);
  assert.doesNotMatch(text, /מטרה:|רמה:/, 'בלי תווית — בלי השורה');
  assert.doesNotMatch(text, /מנוחה/, 'מנוחה 0 — לא מוצגת');
  assert.match(text, /^🏋️ תוכנית אימון אישית\n/, 'בלי שם — בלי " — "');
  assert.match(text, /📌 יום 1\n/);
  assert.match(text, new RegExp('1\\. ' + known.name + '\\n   2 סטים\\n'));
  assert.doesNotMatch(text, /3\. /, 'תרגיל שאינו בספרייה מדולג (כמו במסך התוכנית)');
  assert.equal(Sh.programToPlainText({}, null, null), '');
  assert.equal(Sh.exerciseName({ exerciseId: 'gone', name: 'תרגיל ישן' }), 'תרגיל ישן', 'תוכנית ישנה עם name — נשמר');
  assert.equal(Sh.formatDuration(1200), '20 דק׳');
  assert.equal(Sh.formatDuration(40), '40״');
  assert.equal(Sh.formatDuration(null), '');
});

test('וואטסאפ: מספר ישראלי מקומי ← 972 בלי 0, כמו modules/shamai/src/contacts.js', () => {
  assert.equal(Sh.whatsappPhone('050-1234567'), '972501234567');
  assert.equal(Sh.whatsappPhone('0501234567'), '972501234567');
  assert.equal(Sh.whatsappPhone('+972 50-123-4567'), '972501234567');
  assert.equal(Sh.whatsappPhone('972501234567'), '972501234567', 'כבר בינלאומי — בלי קידומת כפולה');
  assert.equal(Sh.whatsappPhone('00972501234567'), '972501234567');
  assert.equal(Sh.whatsappPhone('501234567'), '972501234567', 'בלי 0 — כמו בשמאות');
  assert.equal(Sh.whatsappPhone('+1 212 555 0100'), '12125550100', 'מספר זר עם + נשאר');
  assert.equal(Sh.whatsappPhone(''), '');
  assert.equal(Sh.whatsappPhone(null), '');
  assert.equal(Sh.whatsappShareUrl('שלום', '050-1234567'), 'https://wa.me/972501234567?text=' + encodeURIComponent('שלום'));
  assert.equal(Sh.whatsappShareUrl('שלום', ''), 'https://wa.me/?text=' + encodeURIComponent('שלום'), 'בלי נמען — בחירה בוואטסאפ');
  assert.doesNotMatch(Sh.whatsappShareUrl('x', '050-1234567'), /phone=/, 'הצורה המתועדת wa.me/<מספר>');
});

test('אותו כלל כמו במודול השמאות (העתק קטן, בלי ייבוא בין מודולים)', () => {
  const shamai = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shamai', 'src', 'contacts.js'), 'utf8');
  assert.match(shamai, /startsWith\('0'\) \? '\+972' \+ cleaned\.substring\(1\)/, 'הכלל בשמאות לא השתנה — לבדוק התאמה');
  const src = fs.readFileSync(path.join(SRC, 'lib', 'sharing.js'), 'utf8');
  assert.doesNotMatch(src, /from ['"][./]*\.\.\/\.\.\/\.\.\/modules/, 'אין ייבוא מחוץ למקור האימונים');
});
