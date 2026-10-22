// סט הזהב בעברית לעוזר ה-AI (tests/fixtures/ai-golden-he.json), מול מודל מדומה.
// בודק לכל שאלה: איזה מנוע ענה (כללים קודם), אילו כלים נקראו, שהסכומים הנכונים מופיעים —
// ושתשובה עם מספר שלא הגיע מכלי נדחית. מול מודל אמיתי: node tools/ai-golden-eval.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { createAI } = require(path.join(ROOT, 'shell/ai'));
const { createLocalEngine } = require(path.join(ROOT, 'shell/ai/engines/local-llm'));
const { createMockFork, fakeStore } = require('./helpers/mock-llm');

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ai-golden-he.json'), 'utf8'));
const LICENSED = { mode: 'licensed', status: 'active', features: ['ai', 'ai.local'] };

function makeAI() {
  const byQ = new Map(GOLDEN.cases.filter(c => c.mock).map(c => [c.q, c.mock]));
  // השאלה מגיעה למודל בתחילת ה-prompt (אחריה הוראות המשימה)
  const fork = createMockFork((msg) => {
    for (const [q, mock] of byQ) if (String(msg.prompt).startsWith(q)) return mock;
    return { calls: [], answer: 'לא הבנתי את השאלה.' };
  });
  const local = createLocalEngine({ modelStore: fakeStore(), fork, hasRuntime: () => true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-golden-'));
  const ai = createAI({ userDataPath: dir, getBackupKey: () => null, licenseState: () => LICENSED, localEngine: local });
  return { ai, local, fork };
}

test('סט הזהב: מבנה תקין ולפחות 15 שאלות', () => {
  assert.ok(GOLDEN.cases.length >= 15);
  const ids = new Set();
  for (const c of GOLDEN.cases) {
    assert.ok(!ids.has(c.id), 'מזהה כפול: ' + c.id);
    ids.add(c.id);
    assert.ok(GOLDEN.contexts[c.ctx], c.id + ': הקשר לא מוכר');
    assert.ok(['ask', 'search'].includes(c.kind), c.id);
    if (c.expect.engine === 'local' || c.expect.fallback) assert.ok(c.mock, c.id + ': שאלה למודל צריכה mock');
  }
});

test('סט הזהב: כל השאלות עוברות מול המודל המדומה', async () => {
  const { ai, local } = makeAI();
  await local.refresh();
  const failures = [];
  for (const c of GOLDEN.cases) {
    const ctx = structuredClone(GOLDEN.contexts[c.ctx]);
    const e = c.expect;
    const fail = (why) => failures.push(`${c.id}: ${why}`);
    if (c.kind === 'search') {
      const r = await ai.search(c.q, ctx);
      if (r.engine !== e.engine) fail(`מנוע ${r.engine} במקום ${e.engine}`);
      if (e.screens) assert.deepEqual(r.screens.map(s => s.view), e.screens, c.id);
      if (e.records) assert.deepEqual(r.records.map(x => x.name), e.records, c.id);
      continue;
    }
    const r = await ai.run(c.q, ctx);
    if (r.engine !== e.engine) fail(`מנוע ${r.engine} במקום ${e.engine} (${r.fallback || ''})`);
    if (e.fallback && r.fallback !== e.fallback) fail(`fallback ${r.fallback} במקום ${e.fallback}`);
    if (e.task && r.task !== e.task) fail(`משימה ${r.task} במקום ${e.task}`);
    if (e.tools) assert.deepEqual(r.tools || [], e.tools, c.id + ': כלים');
    for (const s of e.contains || []) if (!r.text.includes(s)) fail(`חסר „${s}” בתשובה: ${r.text}`);
    for (const s of e.notContains || []) if (r.text.includes(s)) fail(`„${s}” לא אמור להופיע`);
  }
  ai.dispose();
  assert.deepEqual(failures, []);
});

test('סט הזהב: בלי רישיון ai.local — כל שאלה נענית בכללים, והמודל לא נטען', async () => {
  const fork = createMockFork(() => ({ calls: [], answer: 'x' }));
  const local = createLocalEngine({ modelStore: fakeStore(), fork, hasRuntime: () => true });
  await local.refresh();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-golden-'));
  for (const state of [null, { mode: 'unlicensed' }, { mode: 'licensed', status: 'active', features: ['ai', 'ai.cloud'] }, { ...LICENSED, status: 'suspended' }]) {
    const ai = createAI({ userDataPath: dir, getBackupKey: () => null, licenseState: () => state, localEngine: local });
    assert.equal(ai.status().local.mode, 'locked');
    for (const c of GOLDEN.cases.filter(x => x.kind === 'ask')) {
      const r = await ai.run(c.q, structuredClone(GOLDEN.contexts[c.ctx]));
      assert.equal(r.engine, 'rules', c.id);
    }
  }
  assert.equal(fork.forks.length, 0, 'לא נוצר תהליך מודל');
});
