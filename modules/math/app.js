// מודול החשבון — הממשק. כל הלוגיקה החשבונית ב-logic.js (MathLogic); כאן רק DOM, אחסון ומעברים.
// אחסון: localStorage בלבד, מפתחות math:*, נקרא כקלט לא מהימן (sanitize*). אין רשת.
(function () {
  'use strict';
  const M = window.MathLogic;
  const $ = id => document.getElementById(id);
  const view = $('view');

  // ---------------------------------------------------------------- עזרים
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  // הודעה קופצת: הצלחה — 6 שניות לפחות (ארוכה — יותר); שגיאה — נשארת עד "סגירה"; עם ביטול — 10 שניות וכפתור "ביטול"
  let toastTimer = 0, undoFn = null;
  function toast(msg, opts) {
    opts = opts || {};
    const t = $('toast');
    clearTimeout(toastTimer);
    undoFn = typeof opts.undo === 'function' ? opts.undo : null;
    t.setAttribute('role', opts.error ? 'alert' : 'status');
    t.setAttribute('aria-live', opts.error ? 'assertive' : 'polite');
    t.innerHTML = '<span>' + esc(msg) + '</span>' +
      (undoFn ? '<button type="button" class="ss-btn ss-btn-sm" data-act="undo">ביטול</button>' : '') +
      (opts.error || undoFn ? '<button type="button" class="ss-btn-ghost ss-btn-sm" data-act="toast-close">✕ סגירה</button>' : '');
    t.classList.add('on');
    t.classList.toggle('m-toast-action', !!(opts.error || undoFn));
    if (!opts.error) toastTimer = setTimeout(hideToast, undoFn ? 10000 : Math.max(6000, String(msg).length * 90));
  }
  // הודעה שנעלמה מתרוקנת: כפתור "ביטול" / "סגירה" שקוף לא נשאר בסדר ה-Tab ולא נקרא בקורא מסך
  function hideToast() { clearTimeout(toastTimer); undoFn = null; const t = $('toast'); t.classList.remove('on'); t.classList.remove('m-toast-action'); t.textContent = ''; }
  function runUndo() { const fn = undoFn; hideToast(); if (fn) fn(); }
  // פעולה של הורים (מחיקת ילד, שינוי כיתה): תרגיל כפל של מבוגרים לפני הביצוע — בלי סיסמה לזכור.
  // זו מניעת לחיצה בטעות של ילד שמתרגל לבד, לא אבטחה (הנתונים במחשב, והמבוגר מחליט)
  async function adultCheck(what) {
    // שני גורמים דו-ספרתיים 13–29 (בלי 20): מעבר לכפל שמודול החשבון מלמד בעל-פה בכיתות הנמוכות.
    // ילד גדול עם דף ועיפרון יכול לפתור — זה מעכב לחיצה בטעות, לא מנעול
    const pick = () => { const n = 13 + Math.floor(Math.random() * 16); return n >= 20 ? n + 1 : n; };
    const a = pick(), b = pick();
    const ans = await ssDialog.prompt(what + ' — זו פעולה להורים. כדי להמשיך, פתרו את התרגיל: \u2066' + a + ' × ' + b + '\u2069 = ?', '', { title: 'רק להורים', okText: 'המשך' });
    if (ans == null) return false;
    if (Number(String(ans).trim().replace(/[\u200e\u200f\s]/g, '')) === a * b) return true;
    await ssDialog.alert('התשובה לא נכונה, ולכן לא שינינו כלום.', { title: 'רק להורים' });
    return false;
  }
  // הודעה לקורא מסך — אזור חי קטן ייעודי (לא כל המסך)
  function announce(msg) { const l = $('live'); if (l) l.textContent = msg; }
  // ביטוי חשבוני: משמאל לימין, שברים מוערמים (עם טקסט לקורא מסך), סימן שאלה מודגש — או קו תשובה בדף עבודה
  function exprHtml(s, opts) {
    let h = esc(s);
    h = h.replace(/(\d+)\/(\d+)/g, '<span class="fr"><span class="fr-n" aria-hidden="true">$1</span><span class="fr-d" aria-hidden="true">$2</span><span class="m-sr">$1 חלקי $2</span></span>');
    h = h.replace(/\?/g, opts && opts.blank ? '<span class="m-blank"></span>' : '<span class="q-mark">?</span>').replace(/☐/g, '<span class="q-box" role="img" aria-label="מה הסימן?"></span>');
    return '<span class="expr" dir="ltr">' + h + '</span>';
  }
  // טקסט הסבר: ⟦...⟧ = ביטוי
  function richHtml(s) {
    return String(s).split(/⟦|⟧/).map((part, i) => i % 2 ? exprHtml(part) : esc(part)).join('');
  }
  function plain(s) { return String(s).replace(/⟦|⟧/g, ''); }

  // ---------------------------------------------------------------- הקראה בעברית
  // רק קול עברי מקומי של המחשב / הטלפון (localService) — בלי רשת. אין קול כזה ← כפתורי ההקראה מוסתרים
  // (המחלקה m-no-he-voice על body, כבר בטעינה ב-index.html)
  const HeVoice = {
    voice: null,
    init() {
      const synth = typeof window.speechSynthesis !== 'undefined' ? window.speechSynthesis : null;
      if (!synth || typeof window.SpeechSynthesisUtterance === 'undefined') { this.apply(); return; }
      const pick = () => {
        let vs = [];
        try { vs = synth.getVoices() || []; } catch (_) { vs = []; }
        this.voice = vs.find(v => /^(he|iw)([-_]|$)/i.test(v.lang || '') && v.localService !== false) || null;
        this.apply();
      };
      pick();
      try { synth.addEventListener('voiceschanged', pick); } catch (_) { /* ישן */ }
    },
    apply() { if (document.body && document.body.classList) document.body.classList.toggle('m-no-he-voice', !this.voice); },
    say(text) {
      if (!this.voice || !text) return;
      try {
        window.speechSynthesis.cancel();
        const u = new window.SpeechSynthesisUtterance(String(text));
        u.voice = this.voice; u.lang = this.voice.lang; u.rate = 0.9;
        window.speechSynthesis.speak(u);
      } catch (_) { /* בלי קול — ממשיכים בשקט */ }
    }
  };
  const sayBtn = '<button type="button" class="ss-btn ss-btn-sm m-say" data-act="say"><span aria-hidden="true">🔊</span> הקראת התרגיל</button>';

  // ---------------------------------------------------------------- אחסון
  const LS = {
    read(key) { try { return M.safeParse(localStorage.getItem(key)); } catch (_) { return null; } },
    // what — מה לא נשמר (בהודעה); false — בלי הודעה (העדפות תצוגה)
    write(key, val, what) {
      try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { if (what !== false) toast(M.saveErrorText(e, what || 'ההתקדמות לא נשמרה'), { error: true }); return false; }
    },
    remove(key) { try { localStorage.removeItem(key); return true; } catch (_) { return false; } }
  };
  const KEY_LEARNERS = 'math:learners', KEY_PREFS = 'math:prefs';
  // אתגר: דקה (נספר לשיא), 2 דקות, או בלי שעון (אימון) — 0
  const TIMED_LENS = [60, 120, 0];
  const keyProgress = id => 'math:progress:' + id;

  let learners = M.sanitizeLearners(LS.read(KEY_LEARNERS));
  let progress = M.emptyProgress();
  let prefs = (function () { const p = LS.read(KEY_PREFS); return { tab: p && typeof p.tab === 'string' ? p.tab : 'practice', timedTopic: p && M.TOPIC_IDS.includes(p.timedTopic) ? p.timedTopic : 'multable', timedLen: p && TIMED_LENS.includes(p.timedLen) ? p.timedLen : 60 }; })();

  function active() { return learners.list.find(l => l.id === learners.active) || null; }
  function loadProgress() { const a = active(); progress = a ? M.sanitizeProgress(LS.read(keyProgress(a.id))) : M.emptyProgress(); }
  function saveProgress() { const a = active(); return a ? LS.write(keyProgress(a.id), progress) : false; }
  function saveLearners(what) { return LS.write(KEY_LEARNERS, learners, what || 'השינוי לא נשמר'); }
  function savePrefs() { LS.write(KEY_PREFS, prefs, false); }
  function grade() { const a = active(); return a ? a.grade : 3; }
  // עותק עם רמה מוגבלת לכיתה — המצב השמור לא משתנה (שינוי כיתה בטעות לא מוחק רמות)
  function topicState(id) {
    const s = progress.topics[id] || M.newTopicState(id, grade());
    return Object.assign({}, s, { level: M.clampLevel(id, grade(), s.level) || 1 });
  }
  function today() { return M.localDay(new Date()); }

  // ---------------------------------------------------------------- כותרת ולשוניות
  let tab = prefs.tab;
  let timer = null; // אתגר דקה פעיל
  let session = null; // תרגול פעיל

  function renderWho() {
    const who = $('who');
    if (!learners.list.length) { who.innerHTML = ''; return; }
    const opts = learners.list.map(l => '<option value="' + esc(l.id) + '"' + (l.id === learners.active ? ' selected' : '') + '>' + esc(l.name) + ' · כיתה ' + esc(M.gradeName(l.grade)) + '</option>').join('');
    who.innerHTML = '<button type="button" class="ss-btn m-home" data-act="home"><span aria-hidden="true">🏠</span> לבחירת תרגול</button>' +
      '<span class="ss-badge ss-badge-warning" title="כוכבים"><span class="m-star" aria-hidden="true">★</span> ' + (progress.stars | 0) + ' כוכבים</span>' +
      '<select class="ss-input" id="learnerSel" aria-label="הילד שמתרגל עכשיו">' + opts + '</select>';
  }
  function setTab(t) {
    if (!['practice', 'timed', 'table', 'sheet', 'progress', 'learners'].includes(t)) t = 'practice';
    stopTimer();
    session = null;
    tab = t; prefs.tab = t; savePrefs();
    document.querySelectorAll('#tabs .ss-tab').forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    render();
  }
  function render() {
    renderWho();
    if (!active() && tab !== 'learners') { view.innerHTML = welcomeHtml(); return; }
    ({ practice: renderPractice, timed: renderTimedSetup, table: renderTable, sheet: renderSheetForm, progress: renderProgress, learners: renderLearners })[tab]();
  }

  // ---------------------------------------------------------------- ילדים
  function gradeOptions(sel) { return M.GRADES.map((g, i) => '<option value="' + (i + 1) + '"' + (i + 1 === sel ? ' selected' : '') + '>' + g + "'</option>").join(''); }
  function addFormHtml() {
    return '<div class="m-add">' +
      '<div class="ss-field"><label class="ss-label" for="newName">שם הילד</label><input class="ss-input" id="newName" maxlength="30" placeholder="למשל: יוסי" autocomplete="off"></div>' +
      '<div class="ss-field m-grade"><label class="ss-label" for="newGrade">כיתה</label><select class="ss-input" id="newGrade">' + gradeOptions(2) + '</select></div>' +
      '<button class="ss-btn-primary" data-act="add-learner">הוספה</button></div>';
  }
  function welcomeHtml() {
    return '<section class="ss-card m-welcome ss-rise"><div class="m-logo" aria-hidden="true"><span dir="ltr">1+2</span></div>' +
      '<h2 class="ss-section-title">ברוכים הבאים לחשבון!</h2><p class="ss-hint">הוסיפו את הילד הראשון — התרגילים יותאמו לכיתה שלו, וההתקדמות תישמר לכל ילד בנפרד.</p>' +
      addFormHtml() + '</section>';
  }
  function renderLearners() {
    const rows = learners.list.map(l => {
      const p = M.sanitizeProgress(LS.read(keyProgress(l.id))), t = M.totals(p);
      const on = l.id === learners.active;
      return '<div class="ss-list-row' + (on ? ' is-active' : '') + '"><span class="m-avatar" aria-hidden="true">' + esc(l.name.slice(0, 1)) + '</span>' +
        '<div class="ss-grow"><b>' + esc(l.name) + '</b> <span class="ss-badge ss-badge-info">כיתה ' + esc(M.gradeName(l.grade)) + '</span>' + (on ? ' <span class="ss-badge ss-badge-success"><i class="ss-dot"></i>מתרגל עכשיו</span>' : '') +
        '<div class="ss-hint" style="margin:2px 0 0">' + t.total + ' תרגילים · ' + t.pct + '% הצלחה · ★ ' + (p.stars | 0) + '</div></div>' +
        '<div class="ss-actions">' + (on ? '' : '<button class="ss-btn-secondary ss-btn-sm" data-act="pick-learner" data-id="' + esc(l.id) + '">בחירה</button>') +
        '<button class="ss-btn ss-btn-sm" data-act="edit-learner" data-id="' + esc(l.id) + '">עריכה</button>' +
        '<button class="ss-btn-ghost ss-btn-sm" data-act="del-learner" data-id="' + esc(l.id) + '">מחיקה</button></div></div>';
    }).join('');
    view.innerHTML = '<div class="ss-stack ss-rise">' +
      (learners.list.length ? '<section class="ss-card"><h2 class="ss-section-title">הילדים</h2><div class="ss-list">' + rows + '</div></section>' : '') +
      '<section class="ss-card"><h2 class="ss-section-title">הוספת ילד</h2><p class="ss-hint">לכל ילד התקדמות, רמה וכוכבים משלו.</p>' + addFormHtml() + '</section></div>';
  }
  function newId() { return (Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)).slice(0, 20); }
  async function addLearner() {
    const name = ($('newName').value || '').trim().slice(0, 30), g = M.clampGrade($('newGrade').value);
    if (!name) { $('newName').focus(); $('newName').classList.add('shake'); setTimeout(() => $('newName').classList.remove('shake'), 400); return; }
    if (learners.list.length >= 50) { await ssDialog.alert('אפשר לשמור עד 50 ילדים.'); return; }
    const l = { id: newId(), name, grade: g }, prevActive = learners.active;
    learners.list.push(l); learners.active = l.id;
    if (!saveLearners('הילד לא נוסף')) { learners.list.pop(); learners.active = prevActive; learners = M.sanitizeLearners(learners); return; }
    loadProgress();
    toast('נוסף: ' + name);
    setTab(tab === 'learners' ? 'practice' : tab);
  }
  async function editLearner(id) {
    const l = learners.list.find(x => x.id === id); if (!l) return;
    const name = await ssDialog.prompt('השם של הילד', l.name);
    if (name == null) return;
    // הכפתור הראשון (שמקבל את המיקוד) — הכיתה הנוכחית, כדי ש-Enter לא ישנה כיתה
    const choices = [{ label: 'כיתה ' + M.gradeName(l.grade) + ' (בלי שינוי)', value: l.grade }].concat(M.GRADES.map((x, i) => ({ label: 'כיתה ' + x + "'", value: i + 1 })).filter(c => c.value !== l.grade));
    let g = await ssDialog.choose('באיזו כיתה ' + (name.trim() || l.name) + '?', choices);
    // שינוי כיתה — פעולה של הורים (משנה את רמת התרגילים); בלי התרגיל — רק השם נשמר
    if (g && M.clampGrade(g) !== l.grade && !(await adultCheck('שינוי הכיתה של ' + (name.trim() || l.name)))) g = null;
    const old = Object.assign({}, l);
    if (name.trim()) l.name = name.trim().slice(0, 30);
    if (g) l.grade = M.clampGrade(g);
    if (!saveLearners('השינוי לא נשמר')) Object.assign(l, old);
    render();
  }
  // מחיקה — אחרי תרגיל ההורים, ואז 10 שניות לביטול (הילד וההתקדמות שלו חוזרים כמו שהיו)
  async function deleteLearner(id) {
    const l = learners.list.find(x => x.id === id); if (!l) return;
    if (!(await adultCheck('מחיקת ' + l.name + ' וכל ההתקדמות שלו'))) return;
    if (!learners.list.some(x => x.id === id)) return;
    const before = JSON.parse(JSON.stringify(learners));
    let savedProgress = null;
    try { savedProgress = localStorage.getItem(keyProgress(id)); } catch (_) { savedProgress = null; }
    learners.list = learners.list.filter(x => x.id !== id);
    if (learners.active === id) learners.active = learners.list[0] ? learners.list[0].id : null;
    if (!saveLearners('הילד לא נמחק')) { learners = before; return; }
    LS.remove(keyProgress(id));
    loadProgress(); render();
    toast('נמחק: ' + l.name, { undo: () => restoreLearner(before, id, savedProgress) });
  }
  function restoreLearner(before, id, savedProgress) {
    if (learners.list.some(x => x.id === id)) return;
    const prev = learners;
    // הילד חוזר למקומו ברשימה; ילדים שנוספו בינתיים נשארים
    const added = learners.list.filter(x => !before.list.some(y => y.id === x.id));
    learners = M.sanitizeLearners({ v: 1, active: before.active, list: before.list.concat(added) });
    if (savedProgress != null) { try { localStorage.setItem(keyProgress(id), savedProgress); } catch (e) { learners = prev; toast(M.saveErrorText(e, 'הביטול לא נשמר'), { error: true }); return; } }
    if (!saveLearners('הביטול לא נשמר')) { learners = prev; LS.remove(keyProgress(id)); return; }
    loadProgress(); render();
    toast('הוחזר: ' + (learners.list.find(x => x.id === id) || {}).name);
  }
  function pickLearner(id) {
    if (!learners.list.some(l => l.id === id)) return;
    learners.active = id; saveLearners('הבחירה לא נשמרה'); loadProgress();
    setTab(tab);
  }

  // ---------------------------------------------------------------- תרגול: בחירת נושא
  function topicCard(t, extra) {
    const max = M.maxLevelFor(t.id, grade()), st = topicState(t.id);
    const acc = st.total ? Math.round(st.correct * 100 / st.total) : null;
    return '<button class="ss-card ss-card-hover m-topic" data-act="' + extra.act + '" data-topic="' + t.id + '"' + (max ? '' : ' disabled') + '>' +
      '<span class="m-glyph" aria-hidden="true">' + esc(t.glyph) + '</span><span><b>' + esc(t.name) + '</b><small>' + esc(t.desc) + '</small>' +
      '<span class="m-meta">' + (max ? '<span class="ss-badge ss-badge-info">רמה ' + st.level + ' מתוך ' + max + '</span>' + (acc != null ? '<span class="ss-badge ' + (acc >= 80 ? 'ss-badge-success' : acc >= 50 ? 'ss-badge-warning' : 'ss-badge-danger') + '">' + acc + '%</span>' : '<span class="ss-badge">חדש</span>') : '<span class="ss-badge">מכיתה ' + esc(firstGrade(t.id)) + '</span>') + '</span></span></button>';
  }
  function firstGrade(id) { const t = M.topicById(id); const i = t.maxLevel.findIndex(x => x > 0); return M.GRADES[i] + "'"; }
  function renderPractice() {
    const a = active();
    const open = M.TOPICS.filter(t => M.maxLevelFor(t.id, a.grade)), later = M.TOPICS.filter(t => !M.maxLevelFor(t.id, a.grade));
    // המלצה: הנושא עם הכי מעט תרגול
    const rec = open.slice().sort((x, y) => topicState(x.id).total - topicState(y.id).total)[0];
    view.innerHTML = '<div class="ss-rise">' +
      '<div class="ss-kpis">' + kpi('שלום ' + esc(a.name) + '!', 'כיתה ' + esc(M.gradeName(a.grade))) + kpi('ימים ברצף', String(M.dayStreak(progress.days, today()))) + kpi('כוכבים', '★ ' + (progress.stars | 0)) + kpi('המלצה להיום', esc(rec ? rec.name : '—'), rec ? 'rec' : '') + '</div>' +
      '<h2 class="m-section">בחרו נושא לתרגול <span class="ss-muted" style="font-size:var(--ss-fs-sm);font-weight:400">— 10 תרגילים, הרמה עולה אחרי ' + M.UP_AFTER + ' נכונות ברצף</span></h2>' +
      '<div class="m-topics">' + open.map(t => topicCard(t, { act: 'start' })).join('') + '</div>' +
      (later.length ? '<h2 class="m-section">בהמשך הדרך</h2><div class="m-topics">' + later.map(t => topicCard(t, { act: 'start' })).join('') + '</div>' : '') + '</div>';
  }
  function kpi(label, value, act) {
    return '<div class="ss-kpi"><small>' + label + '</small><strong>' + value + '</strong>' + (act === 'rec' ? '<button class="ss-btn-ghost ss-btn-sm" data-act="start-rec" style="margin-top:4px;padding:0">להתחיל ←</button>' : '') + '</div>';
  }

  // ---------------------------------------------------------------- תרגול: סשן
  const PRAISE = ['כל הכבוד!', 'מצוין!', 'יפה מאוד!', 'נכון!', 'אלוף!', 'בדיוק!'];
  function startSession(topic, opts) {
    opts = opts || {};
    if (!M.maxLevelFor(topic, grade()) && !opts.facts) { toast('הנושא הזה מתחיל בכיתה ' + firstGrade(topic)); return; }
    stopTimer();
    session = { mode: opts.facts ? 'facts' : 'practice', topic, total: 10, idx: 0, correct: 0, facts: opts.facts || null, q: null, done: false, levelStart: topicState(topic).level, startedAt: Date.now() };
    nextQuestion();
  }
  function makeQuestion(topic) {
    if (session && session.facts) return M.generate('multable', 3, { fact: session.facts[session.idx % session.facts.length] });
    const st = topicState(topic);
    // לא לחזור על אותו תרגיל פעמיים ברצף
    let q, guard = 0;
    do { q = M.generate(topic, st.level, { grade: grade() }); } while (session && session.q && guard++ < 5 && q.expr === session.q.expr && q.prompt === session.q.prompt);
    return q;
  }
  function nextQuestion() {
    if (session.idx >= session.total) return finishSession();
    session.q = makeQuestion(session.topic);
    session.answered = false;
    renderQuestion();
  }
  function answerHtml(q, idp) {
    idp = idp || 'ans';
    if (q.kind === 'choice') {
      return '<div class="m-choices" role="group" aria-label="בחירת סימן">' +
        [['<', 'קטן מ'], ['=', 'שווה ל'], ['>', 'גדול מ']].map(c => '<button class="m-choice" data-act="choose" data-v="' + esc(c[0]) + '" aria-label="' + c[1] + '">' + esc(c[0]) + '</button>').join('') + '</div>';
    }
    if (q.kind === 'divrem') {
      return '<div class="m-answer"><label for="' + idp + 'Q">מנה</label><input class="ss-input m-small" id="' + idp + 'Q" inputmode="numeric" autocomplete="off">' +
        '<label for="' + idp + 'R">שארית</label><input class="ss-input m-small" id="' + idp + 'R" inputmode="numeric" autocomplete="off" placeholder="0">' +
        '<button class="ss-btn-primary" data-act="check">בדיקה</button></div>';
    }
    return '<div class="m-answer"><input class="ss-input" id="' + idp + '" autocomplete="off" aria-label="התשובה" aria-describedby="qbody" inputmode="' + (['frac', 'neg', 'pow', 'eq'].includes(q.topic) ? 'text' : 'decimal') + '">' +
      (q.blank && q.topic === 'eq' ? '<span class="m-unit" dir="ltr">' + esc(q.blank) + '</span>' : '') +
      (q.unit ? '<span class="m-unit">' + esc(q.unit) + '</span>' : '') + '<button class="ss-btn-primary" data-act="check">בדיקה</button></div>';
  }
  function questionBody(q) {
    const story = !q.expr;
    return '<div id="qbody">' + (q.prompt ? '<p class="m-prompt' + (story ? ' m-story' : '') + '">' + esc(q.prompt) + '</p>' : '') +
      (q.expr ? '<div class="m-expr">' + exprHtml(q.expr) + '</div>' : '') + '</div>';
  }
  function renderQuestion() {
    const s = session, q = s.q, t = M.topicById(s.topic), st = topicState(s.topic);
    const title = s.mode === 'facts' ? 'אלוף לוח הכפל' : t.name;
    view.innerHTML = '<div class="m-play">' +
      '<div class="m-bar"><button class="ss-btn-ghost ss-btn-sm" data-act="quit">→ חזרה</button><div class="m-progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + s.total + '" aria-valuenow="' + s.idx + '" aria-label="התקדמות בתרגול"><i style="width:' + (s.idx * 100 / s.total) + '%"></i></div>' +
      '<span class="ss-badge"><span dir="ltr">' + (s.idx + 1) + ' / ' + s.total + '</span></span>' + (s.mode === 'facts' ? '' : '<span class="ss-badge ss-badge-info">רמה ' + st.level + '</span>') + '</div>' +
      '<section class="ss-card m-qcard ss-rise" id="qcard"><div class="ss-muted" style="font-size:var(--ss-fs-sm);margin-bottom:var(--ss-sp-2)">' + esc(title) + ' · ✓ ' + s.correct + '</div>' +
      questionBody(q) + '<div class="m-say-row">' + sayBtn + '</div><div id="answerArea">' + answerHtml(q) + '</div><div class="m-hint" id="hint"></div><div id="feedback"></div></section></div>';
    focusAnswer();
  }
  function focusAnswer() { const el = $('ans') || $('ansQ') || view.querySelector('.m-choice'); if (el) el.focus(); }
  function readAnswer(q, idp) {
    idp = idp || 'ans';
    if (q.kind === 'divrem') {
      const qv = ($(idp + 'Q').value || '').trim(), rv = ($(idp + 'R').value || '').trim();
      if (!qv) return '';
      return rv ? qv + ' ש ' + rv : qv;
    }
    return $(idp) ? $(idp).value : '';
  }
  function hintFor(res, q, short) {
    if (res.hint === 'hebrew-slash') return 'נראה שהמקלדת בעברית — לשבר מקלידים / (במקלדת העברית זה המקש Q), או עוברים לאנגלית';
    if (res.hint === 'whole') return 'כתבו את התוצאה כמספר';
    if (short) return 'כתבו מספר';
    if (q.topic === 'eq') return 'כתבו את המספר ש-x שווה לו, למשל 5 או -3';
    return q.kind === 'divrem' ? 'כתבו את המנה (ואם יש — את השארית)' : q.topic === 'frac' ? 'כתבו מספר או שבר, למשל 3/4 או 1 1/2' : 'כתבו מספר, למשל 12 או 2.5';
  }
  function nudge(msg) {
    const h = $('hint'); if (h) h.textContent = msg;
    announce(msg);
    const c = $('answerArea'); if (c) { c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
    focusAnswer();
  }
  function applyResult(q, correct) {
    const r = M.updateAdaptive(topicState(q.topic), correct, q.topic, grade());
    progress.topics[q.topic] = r.state;
    if (q.topic === 'multable' && q.data && q.data.a && q.data.b) progress.facts = M.recordFact(progress.facts, q.data.a, q.data.b, correct);
    saveProgress();
    return r.change;
  }
  function submit(input) {
    const s = session; if (!s || s.answered) return;
    const q = s.q, res = M.checkAnswer(q, input == null ? readAnswer(q) : input);
    if (res.status === 'unparsed') return nudge(hintFor(res, q));
    if (res.status === 'not-reduced') return nudge('התשובה שווה, אבל אפשר לצמצם עוד — נסו שוב');
    s.answered = true;
    const ok = res.status === 'correct';
    if (ok) s.correct++;
    const change = s.mode === 'facts' ? (applyResult(q, ok), 0) : applyResult(q, ok);
    view.querySelectorAll('#answerArea input, #answerArea button').forEach(el => { el.disabled = true; });
    $('hint').textContent = '';
    $('feedback').innerHTML = feedbackHtml(q, ok, change, input == null ? readAnswer(q) : input);
    announce(ok ? 'נכון!' : 'לא נכון. התשובה הנכונה: ' + plain(M.answerMarkup(q)));
    const nb = $('nextBtn'); if (nb) nb.focus();
  }
  function columnHtml(q) {
    const c = q.column; if (!c) return '';
    const w = Math.max(String(c.a).length, String(c.b).length + 2, String(c.result).length);
    const pad = s => String(s).padStart(w, ' ');
    return '<div class="m-col" aria-hidden="true"><span>' + pad(c.a) + '</span><span>' + esc(c.op) + pad(c.b).slice(1) + '</span><span class="m-line m-res">' + pad(c.result) + '</span></div>';
  }
  function feedbackHtml(q, ok, change, given) {
    const lv = change > 0 ? '<span class="ss-badge ss-badge-success m-levelup">עלית רמה! ↑</span>' : change < 0 ? '<span class="ss-badge ss-badge-info m-levelup">נתרגל רמה קלה יותר</span>' : '';
    const steps = '<div class="m-explain">' + columnHtml(q) + '<div style="flex:1 1 300px"><h4>' + (ok ? 'איך פותרים' : 'בואו נראה איך פותרים') + '</h4><ol class="m-steps">' + q.steps.map(s => '<li>' + richHtml(s) + '</li>').join('') + '</ol></div></div>';
    const last = session.idx + 1 >= session.total;
    const next = '<div class="m-next">' + (ok ? '<button class="ss-btn ss-btn-sm" data-act="toggle-explain">הסבר</button>' : '') + '<button class="ss-btn-primary" id="nextBtn" data-act="next">' + (last ? 'לסיכום' : 'לתרגיל הבא') + ' ←</button></div>';
    if (ok) return '<div class="m-feedback ok"><h3>' + PRAISE[Math.floor(Math.random() * PRAISE.length)] + lv + '</h3><div id="explainBox" hidden>' + steps + '</div>' + next + '</div>';
    return '<div class="m-feedback bad"><h3>לא נורא, ננסה להבין' + lv + '</h3>' +
      '<p class="m-right">' + (String(given).trim() ? 'כתבת: <span class="expr" dir="ltr">' + esc(String(given).trim()) + '</span> · ' : '') + 'התשובה הנכונה: <b>' + richHtml(M.answerMarkup(q)) + '</b></p>' + steps + next + '</div>';
  }
  function finishSession() {
    const s = session;
    const before = new Set(M.earnedBadges(progress, today()));
    const r = M.recordSession(progress, { mode: s.mode, topic: s.mode === 'facts' ? 'multable' : s.topic, total: s.total, correct: s.correct, level: topicState(s.topic).level, at: Date.now() }, today());
    progress = r.progress; saveProgress();
    const fresh = M.earnedBadges(progress, today()).filter(b => !before.has(b)).map(id => M.BADGES.find(b => b.id === id));
    session = null;
    const lvNow = topicState(s.topic).level;
    view.innerHTML = '<section class="ss-card m-summary ss-rise" style="max-width:620px;margin:0 auto">' +
      '<h2 class="ss-section-title" style="margin-top:0">' + (r.stars === 3 ? 'מושלם!' : r.stars === 2 ? 'עבודה יפה!' : r.stars === 1 ? 'יפה, ממשיכים להתאמן!' : 'כל תרגול מקדם — ננסה שוב?') + '</h2>' +
      starsHtml(r.stars) + '<div class="m-score"><span dir="ltr">' + s.correct + ' / ' + s.total + '</span></div>' +
      (s.mode === 'practice' && lvNow !== s.levelStart ? '<p class="ss-hint">הרמה ב' + esc(M.topicById(s.topic).name) + ': ' + s.levelStart + ' ← ' + lvNow + '</p>' : '') +
      (fresh.length ? '<div style="margin-top:var(--ss-sp-3)"><p class="ss-hint">תג חדש!</p><div class="m-fresh">' + fresh.map(b => badgeHtml(b, true)).join('') + '</div></div>' : '') +
      '<div class="m-actions"><button class="ss-btn-primary" data-act="again" data-topic="' + s.topic + '" data-mode="' + s.mode + '">עוד סבב</button><button class="ss-btn" data-act="tab" data-tab="' + (s.mode === 'facts' ? 'table' : 'practice') + '">בחירת נושא אחר</button><button class="ss-btn-ghost" data-act="tab" data-tab="progress">להתקדמות</button></div></section>';
    renderWho();
  }
  function starsHtml(n) { let h = '<div class="m-stars" aria-label="' + n + ' כוכבים מתוך 3">'; for (let i = 0; i < 3; i++) h += '<span class="' + (i < n ? 'on' : 'off') + '">★</span>'; return h + '</div>'; }

  // ---------------------------------------------------------------- אתגר דקה
  function stopTimer() { if (timer) { if (timer.handle) clearInterval(timer.handle); if (timer.next) clearTimeout(timer.next); } timer = null; }
  const LEN_NAME = { 60: 'דקה', 120: '2 דקות', 0: 'בלי שעון (אימון)' };
  function renderTimedSetup() {
    const open = M.topicsForGrade(grade());
    if (!open.some(t => t.id === prefs.timedTopic)) prefs.timedTopic = open[0].id;
    const best = progress.bestTimed[prefs.timedTopic] | 0, len = prefs.timedLen;
    view.innerHTML = '<section class="ss-card ss-rise" style="max-width:760px;margin:0 auto">' +
      '<h2 class="ss-section-title">אתגר דקה</h2><p class="ss-hint">כמה תרגילים נכונים תספיקו לפתור? אפשר לבחור דקה, 2 דקות, או לתרגל בלי שעון. השיא נספר רק באתגר של דקה: 6 נכונות — כוכב, 12 — שניים, 20 — שלושה. ב-2 דקות ובלי שעון — כוכבים לפי ההצלחה, אחרי 10 תרגילים לפחות.</p>' +
      '<div class="m-chips" role="group" aria-label="כמה זמן">' + TIMED_LENS.map(n => '<button class="ss-chip" data-act="timed-len" data-len="' + n + '" aria-pressed="' + (n === len) + '">' + LEN_NAME[n] + '</button>').join('') + '</div>' +
      '<div class="m-chips" role="group" aria-label="נושא האתגר">' + open.map(t => '<button class="ss-chip" data-act="timed-topic" data-topic="' + t.id + '" aria-pressed="' + (t.id === prefs.timedTopic) + '">' + esc(t.name) + '</button>').join('') + '</div>' +
      '<div class="m-actions" style="justify-content:flex-start;align-items:center"><button class="ss-btn-primary" data-act="timed-start" style="min-height:48px;padding:0 28px;font-size:var(--ss-fs-lg)">התחלה' + (len ? ' ⏱' : '') + '</button>' +
      (len === 60 ? '<span class="ss-badge ss-badge-warning">השיא ב' + esc(M.topicById(prefs.timedTopic).name) + ': ' + best + '</span>' : '<span class="ss-badge">' + (len ? '2 דקות — בלי שיא' : 'בלי שעון ובלי שיא — מסיימים מתי שרוצים') + '</span>') + '</div></section>';
  }
  function startTimed() {
    stopTimer();
    const topic = prefs.timedTopic, len = prefs.timedLen;
    timer = { topic, len, end: len ? Date.now() + len * 1000 : 0, correct: 0, total: 0, q: null, handle: 0, lock: false, said: 0 };
    if (len) timer.handle = setInterval(tickTimed, 200);
    nextTimed();
  }
  function nextTimed() {
    if (!timer) return;
    timer.q = M.generate(timer.topic, topicState(timer.topic).level, { grade: grade() });
    timer.lock = false;
    const left = timer.len ? Math.max(0, Math.ceil((timer.end - Date.now()) / 1000)) : 0;
    view.innerHTML = '<div class="m-play"><div class="m-timed-top"><button class="ss-btn-ghost ss-btn-sm" data-act="timed-stop">' + (timer.len ? 'עצירה' : 'סיום') + '</button>' +
      '<div><div class="ss-muted" style="font-size:var(--ss-fs-sm)">נכונות</div><div class="m-count" id="tCount">' + timer.correct + '</div></div>' +
      (timer.len ? '<div class="m-timer" id="tClock" role="timer" aria-label="שניות שנשארו"><span id="tLeft">' + left + '</span></div>' : '<span class="ss-badge">בלי שעון</span>') + '</div>' +
      '<section class="ss-card m-qcard" id="qcard">' + questionBody(timer.q) + '<div class="m-say-row">' + sayBtn + '</div><div id="answerArea">' + answerHtml(timer.q) + '</div><div class="m-hint" id="hint"></div><div id="tNext"></div></section></div>';
    tickTimed();
    focusAnswer();
  }
  function tickTimed() {
    if (!timer || !timer.len) return;
    const ms = timer.end - Date.now(), c = $('tClock'), sec = Math.max(0, Math.ceil(ms / 1000));
    if (c) { c.style.setProperty('--p', Math.max(0, ms / (timer.len * 1000))); c.classList.toggle('low', ms < 10000); $('tLeft').textContent = sec; }
    // קורא מסך: הזמן שנשאר — רק כל 10 שניות (לא כל עדכון של השעון)
    if (sec > 0 && sec % 10 === 0 && sec !== timer.said && sec < timer.len) { timer.said = sec; announce('נשארו ' + sec + ' שניות'); }
    if (ms <= 0) finishTimed();
  }
  function submitTimed(input) {
    if (!timer || timer.lock) return;
    const q = timer.q, res = M.checkAnswer(q, input == null ? readAnswer(q) : input);
    if (res.status === 'unparsed') return nudge(hintFor(res, q, true));
    if (res.status === 'not-reduced') return nudge('אפשר לצמצם עוד');
    const ok = res.status === 'correct';
    timer.total++; if (ok) timer.correct++;
    applyResult(q, ok);
    timer.lock = true;
    const card = $('qcard');
    card.classList.add(ok ? 'm-flash-ok' : 'm-flash-bad');
    // ההמשך שייך לאתגר הזה בלבד: אתגר שנעצר מבטל אותו, ואתגר חדש לא מקבל אותו
    const t = timer, next = () => { if (timer === t) { t.next = 0; nextTimed(); } };
    if (ok) { $('tCount').textContent = timer.correct; announce('נכון!'); t.next = setTimeout(next, 250); return; }
    // טעות: התשובה הנכונה נשארת עד "הבנתי" — ילד שקורא לאט לא מפסיד אותה
    view.querySelectorAll('#answerArea input, #answerArea button').forEach(el => { el.disabled = true; });
    $('hint').innerHTML = 'התשובה: ' + richHtml(M.answerMarkup(q));
    $('tNext').innerHTML = '<div class="m-next"><button class="ss-btn-primary" id="timedNextBtn" data-act="timed-next">הבנתי ←</button></div>';
    announce('לא נכון. התשובה: ' + plain(M.answerMarkup(q)));
    const nb = $('timedNextBtn'); if (nb) nb.focus();
  }
  function finishTimed() {
    const t = timer; stopTimer(); if (!t) return;
    const prevBest = progress.bestTimed[t.topic] | 0;
    // אתגר בלי אף תשובה — לא נרשם (לא מאריך רצף ימים ולא מעניק תגים)
    if (!t.total) {
      view.innerHTML = '<section class="ss-card m-summary ss-rise" style="max-width:620px;margin:0 auto"><h2 class="ss-section-title" style="margin-top:0">' + (t.len ? 'האתגר הסתיים' : 'האימון הסתיים') + '</h2>' +
        '<p class="ss-hint">לא נענו תרגילים, ולכן ' + (t.len ? 'האתגר' : 'האימון') + ' לא נרשם.</p><div class="m-actions"><button class="ss-btn-primary" data-act="timed-start">שוב!</button><button class="ss-btn" data-act="tab" data-tab="timed">נושא אחר</button></div></section>';
      return;
    }
    // רק אתגר של דקה נספר לשיא; 2 דקות ובלי שעון — נרשמים כתרגול (רצף ימים, וכוכבים לפי אחוז ההצלחה רק מ-10 תרגילים)
    const rec = t.len === 60;
    const r = M.recordSession(progress, { mode: rec ? 'timed' : 'practice', topic: t.topic, total: t.total, correct: t.correct, level: topicState(t.topic).level, at: Date.now() }, today());
    progress = r.progress; saveProgress();
    view.innerHTML = '<section class="ss-card m-summary ss-rise" style="max-width:620px;margin:0 auto"><h2 class="ss-section-title" style="margin-top:0">' + (t.len ? 'הזמן נגמר!' : 'כל הכבוד!') + '</h2>' + starsHtml(r.stars) +
      '<div class="m-score">' + t.correct + ' נכונות</div><p class="ss-hint">מתוך ' + t.total + ' ניסיונות · ' + esc(M.topicById(t.topic).name) + ' · ' + LEN_NAME[t.len] + '</p>' +
      (!rec && t.total < M.MIN_STAR_TOTAL ? '<p class="ss-hint">כוכבים מקבלים אחרי ' + M.MIN_STAR_TOTAL + ' תרגילים לפחות.</p>' : '') +
      (rec ? (t.correct > prevBest ? '<span class="ss-badge ss-badge-success">שיא חדש! (הקודם: ' + prevBest + ')</span>' : '<span class="ss-badge">השיא: ' + prevBest + '</span>') : '') +
      '<div class="m-actions"><button class="ss-btn-primary" data-act="timed-start">שוב!</button><button class="ss-btn" data-act="tab" data-tab="timed">נושא אחר</button></div></section>';
    renderWho();
  }

  // ---------------------------------------------------------------- אלוף לוח הכפל
  const ST_NAME = { mastered: 'נשלט', learning: 'בלמידה', weak: 'צריך חיזוק', new: 'עוד לא תורגל' };
  function renderTable() {
    const f = progress.facts, sum = M.factSummary(f);
    let grid = '<div class="h"></div>';
    for (let b = 1; b <= 10; b++) grid += '<div class="h">' + b + '</div>';
    for (let a = 1; a <= 10; a++) {
      grid += '<div class="h">' + a + '</div>';
      for (let b = 1; b <= 10; b++) {
        const st = M.factStatus(f[M.factKey(a, b)]);
        grid += '<button class="m-cell st-' + st + '" data-act="fact" data-a="' + a + '" data-b="' + b + '" aria-label="' + a + ' כפול ' + b + ' — ' + ST_NAME[st] + '" title="\u2066' + a + ' × ' + b + ' = ' + (a * b) + '\u2069">' + (st === 'mastered' ? a * b : '') + '</button>';
      }
    }
    const pct = Math.round(sum.mastered * 100 / sum.total);
    view.innerHTML = '<div class="m-table-wrap ss-rise"><section class="ss-card"><h2 class="ss-section-title">לוח הכפל שלי</h2>' +
      '<p class="ss-hint">כל משבצת היא עובדת כפל. עובדה "נשלטת" אחרי 3 תשובות נכונות ותשובה אחרונה נכונה. לחיצה על משבצת — תרגול שמתחיל ממנה.</p>' +
      '<div class="m-grid" role="group" aria-label="לוח הכפל">' + grid + '</div>' +
      '<div class="m-legend">' + ['mastered', 'learning', 'weak', 'new'].map(k => '<span><i class="st-' + k + '"></i>' + ST_NAME[k] + '</span>').join('') + '</div></section>' +
      '<aside class="ss-stack"><div class="ss-kpi"><small>עובדות שנשלטו</small><strong><span dir="ltr">' + sum.mastered + ' / ' + sum.total + '</span></strong>' +
      '<div class="m-progress" style="margin-top:8px"><i style="width:' + pct + '%;background:var(--ss-success)"></i></div></div>' +
      '<div class="ss-kpi"><small>צריכות חיזוק</small><strong>' + sum.weak + '</strong></div><div class="ss-kpi"><small>בלמידה</small><strong>' + sum.learning + '</strong></div>' +
      '<button class="ss-btn-primary" data-act="facts-start" style="min-height:48px">תרגול העובדות שלי (10)</button>' +
      '<p class="ss-hint">התרגול בוחר קודם עובדות שצריכות חיזוק, אחר כך כאלה שבלמידה ואחר כך חדשות.</p></aside></div>';
  }
  function startFacts(first) {
    let list = M.pickFacts(progress.facts, 10);
    if (first) list = [first].concat(list.filter(x => M.factKey(x[0], x[1]) !== M.factKey(first[0], first[1]))).slice(0, 10);
    startSession('multable', { facts: list });
  }

  // ---------------------------------------------------------------- דף עבודה
  let sheet = null;
  function renderSheetForm() {
    const open = M.topicsForGrade(grade());
    const sel = sheet && open.some(t => t.id === sheet.topic) ? sheet.topic : open[0].id;
    const maxL = M.MAX_LEVEL[sel], lv = sheet ? Math.min(sheet.level, maxL) : topicState(sel).level;
    view.innerHTML = '<div class="ss-rise"><section class="ss-card no-print"><h2 class="ss-section-title">דף עבודה להדפסה</h2>' +
      '<div class="ss-form-grid">' +
      '<div class="ss-field"><label class="ss-label" for="wsTopic">נושא</label><select class="ss-input" id="wsTopic">' + open.map(t => '<option value="' + t.id + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select></div>' +
      '<div class="ss-field"><label class="ss-label" for="wsLevel">רמה</label><select class="ss-input" id="wsLevel">' + Array.from({ length: maxL }, (_, i) => '<option value="' + (i + 1) + '"' + (i + 1 === lv ? ' selected' : '') + '>רמה ' + (i + 1) + '</option>').join('') + '</select></div>' +
      '<div class="ss-field"><label class="ss-label" for="wsCount">מספר תרגילים</label><select class="ss-input" id="wsCount">' + [10, 20, 30].map(n => '<option' + ((sheet ? sheet.count : 20) === n ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></div>' +
      '<div class="ss-field"><button class="ss-btn-primary" data-act="ws-make">יצירת דף חדש</button></div></div>' +
      '<div class="ss-toolbar"><label class="ss-check"><input type="checkbox" id="wsKey"' + (sheet && sheet.key ? ' checked' : '') + '> הצגת פתרונות</label>' +
      '<button class="ss-btn ss-push" data-act="ws-print"' + (sheet ? '' : ' disabled') + '>הדפסה</button></div></section><div id="sheetBox">' + (sheet ? sheetHtml() : '') + '</div></div>';
  }
  function makeSheet() {
    const topic = $('wsTopic').value, level = Number($('wsLevel').value) || 1, count = Number($('wsCount').value) || 20;
    if (!M.topicById(topic)) return;
    sheet = { topic, level, count, key: $('wsKey').checked, qs: M.generateSet(topic, level, count, {}) };
    renderSheetForm();
  }
  function sheetHtml() {
    const t = M.topicById(sheet.topic), a = active();
    const items = sheet.qs.map(q => {
      let body;
      if (!q.expr) body = '<span class="m-story">' + esc(q.prompt) + '</span> תשובה:<span class="m-blank"></span>' + (q.unit ? ' ' + esc(q.unit) : '');
      else if (q.kind === 'divrem') body = exprHtml(q.expr.replace(' = ?', ' =')) + ' <span class="m-blank"></span> שארית <span class="m-blank" style="min-width:40px"></span>';
      else if (q.kind === 'choice') body = exprHtml(q.expr);
      // מקום התשובה בדיוק במקום ה-? ("12 / 40 = ____%", "____ × 7 = 56")
      else if (q.expr.includes('?')) body = exprHtml(q.expr, { blank: true });
      else body = exprHtml(q.expr) + (q.blank ? ' ' + exprHtml(q.blank) + '<span class="m-blank"></span>' : '');
      if (q.topic === 'frac' && q.requireReduced) body = '<span class="ss-muted" style="font-size:var(--ss-fs-sm)">צמצמו: </span>' + body;
      if (q.topic === 'round') body = '<span class="ss-muted" style="font-size:var(--ss-fs-sm)">' + esc(q.prompt) + ': </span>' + body;
      return '<li' + (q.expr ? '' : ' class="wide"') + '>' + body + '<span class="m-ans">' + richHtml(M.answerMarkup(q)) + '</span></li>';
    }).join('');
    return '<article class="m-sheet' + (sheet.key ? ' show-key' : '') + '" id="sheet"><div class="m-sheet-head"><div><h2>דף עבודה — ' + esc(t.name) + '</h2><div class="ss-muted" style="font-size:var(--ss-fs-sm)">רמה ' + sheet.level + ' · ' + sheet.qs.length + ' תרגילים</div></div>' +
      '<div class="m-sheet-fields"><div>שם: <span>' + esc(a ? a.name : '') + '</span></div><div>תאריך: <span></span></div></div></div><ol>' + items + '</ol>' +
      '<div class="m-sheet-foot">בהצלחה! ✎</div></article>';
  }
  function printSheet() {
    if (!sheet) return;
    try { if (typeof window.print === 'function') window.print(); else toast('ההדפסה אינה זמינה כאן'); } catch (_) { toast('ההדפסה אינה זמינה כאן'); }
  }

  // ---------------------------------------------------------------- התקדמות
  const MODE_NAME = { practice: 'תרגול', timed: 'אתגר דקה', facts: 'לוח הכפל' };
  function badgeHtml(b, on) { return '<div class="m-badge' + (on ? '' : ' locked') + '"><div class="m-medal" aria-hidden="true">' + esc(b.glyph) + '</div><b>' + esc(b.name) + '</b><small>' + esc(b.desc) + '</small></div>'; }
  function renderProgress() {
    const t = M.totals(progress), streak = M.dayStreak(progress.days, today()), fs = M.factSummary(progress.facts);
    const earned = new Set(M.earnedBadges(progress, today()));
    const rows = M.TOPICS.filter(x => M.maxLevelFor(x.id, grade()) || (progress.topics[x.id] && progress.topics[x.id].total)).map(x => {
      const s = progress.topics[x.id], max = M.maxLevelFor(x.id, grade()) || M.MAX_LEVEL[x.id];
      const pct = s && s.total ? Math.round(s.correct * 100 / s.total) : null;
      return '<tr><td><b>' + esc(x.name) + '</b></td><td>' +  (s ? 'רמה <span dir="ltr">' + Math.min(s.level, max) + ' / ' + max + '</span>' : '<span class="ss-muted">—</span>') + '</td>' +
        '<td>' + (pct == null ? '<span class="ss-muted">עוד לא תורגל</span>' : '<div class="m-acc"><div class="m-progress"><i class="' + (pct >= 80 ? 'hi' : pct >= 50 ? 'mid' : 'low') + '" style="width:' + pct + '%"></i></div><span dir="ltr">' + pct + '%</span></div>') + '</td>' +
        '<td class="ss-num">' + (s ? '<span dir="ltr">' + s.correct + ' / ' + s.total + '</span>' : '') + '</td><td class="ss-num">' + (s ? s.best : '') + '</td></tr>';
    }).join('');
    const recent = progress.sessions.slice(-12).reverse().map(s => {
      const [y, m, d] = s.day.split('-');
      return '<tr><td dir="ltr" style="text-align:right">' + Number(d) + '.' + Number(m) + '.' + y + '</td><td>' + MODE_NAME[s.mode] + '</td><td>' + esc(M.topicById(s.topic).name) + '</td><td class="ss-num"><span dir="ltr">' + s.correct + ' / ' + s.total + '</span></td><td><span class="m-star">' + '★'.repeat(s.stars) + '</span><span class="ss-muted">' + '☆'.repeat(3 - s.stars) + '</span></td></tr>';
    }).join('');
    view.innerHTML = '<div class="ss-stack ss-rise"><div class="ss-kpis" style="margin:0">' +
      kpi('כוכבים', '★ ' + (progress.stars | 0)) + kpi('הצלחה כוללת', t.total ? t.pct + '%' : '—') + kpi('תרגילים', String(t.total)) + kpi('ימים ברצף', String(streak)) + kpi('עובדות כפל', '<span dir="ltr">' + fs.mastered + ' / 55</span>') + '</div>' +
      '<section class="ss-card"><h2 class="ss-section-title">לפי נושא</h2><div class="ss-scroll"><table class="ss-table"><thead><tr><th>נושא</th><th>רמה</th><th>הצלחה</th><th class="ss-num">נכונות</th><th class="ss-num">רצף שיא</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
      '<section class="ss-card"><h2 class="ss-section-title">תגים <span class="ss-badge ss-badge-warning"><span dir="ltr">' + earned.size + ' / ' + M.BADGES.length + '</span></span></h2><div class="m-badges">' + M.BADGES.map(b => badgeHtml(b, earned.has(b.id))).join('') + '</div></section>' +
      '<section class="ss-card"><h2 class="ss-section-title">תרגולים אחרונים</h2>' + (recent ? '<div class="ss-scroll"><table class="ss-table"><thead><tr><th>תאריך</th><th>סוג</th><th>נושא</th><th class="ss-num">ציון</th><th>כוכבים</th></tr></thead><tbody>' + recent + '</tbody></table></div>' : '<div class="ss-empty">עוד אין תרגולים — זה הזמן להתחיל!</div>') + '</section></div>';
  }

  // ---------------------------------------------------------------- אירועים
  document.addEventListener('click', e => {
    const tabBtn = e.target.closest('#tabs .ss-tab');
    if (tabBtn) return setTab(tabBtn.dataset.tab);
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    switch (act) {
      case 'add-learner': addLearner(); break;
      case 'pick-learner': pickLearner(el.dataset.id); break;
      case 'edit-learner': editLearner(el.dataset.id); break;
      case 'del-learner': deleteLearner(el.dataset.id); break;
      case 'start': startSession(el.dataset.topic); break;
      case 'start-rec': { const open = M.topicsForGrade(grade()); const rec = open.slice().sort((x, y) => topicState(x.id).total - topicState(y.id).total)[0]; if (rec) startSession(rec.id); break; }
      case 'check': timer ? submitTimed() : submit(); break;
      case 'choose': timer ? submitTimed(el.dataset.v) : submit(el.dataset.v); break;
      case 'next': session.idx++; nextQuestion(); break;
      case 'toggle-explain': { const b = $('explainBox'); if (b) b.hidden = !b.hidden; break; }
      case 'quit': quitSession(); break;
      case 'again': el.dataset.mode === 'facts' ? startFacts() : startSession(el.dataset.topic); break;
      case 'tab': setTab(el.dataset.tab); break;
      case 'timed-topic': prefs.timedTopic = el.dataset.topic; savePrefs(); renderTimedSetup(); break;
      case 'timed-start': startTimed(); break;
      case 'timed-stop': finishTimed(); break;
      case 'fact': startFacts([Number(el.dataset.a), Number(el.dataset.b)]); break;
      case 'facts-start': startFacts(); break;
      case 'ws-make': makeSheet(); break;
      case 'ws-print': printSheet(); break;
      case 'timed-len': { const n = Number(el.dataset.len); if (TIMED_LENS.includes(n)) { prefs.timedLen = n; savePrefs(); renderTimedSetup(); } break; }
      case 'timed-next': if (timer && timer.lock) { const t = timer; if (t.next) clearTimeout(t.next); t.next = 0; nextTimed(); } break;
      case 'say': { const q = timer ? timer.q : session ? session.q : null; if (q) HeVoice.say(M.spokenText(q)); break; }
      case 'home': goHome(); break;
      case 'undo': runUndo(); break;
      case 'toast-close': hideToast(); break;
    }
  });
  // "לבחירת תרגול" — תמיד גלוי בכותרת: יוצאים מכל מסך (תרגול באמצע — עם אישור) למסך בחירת הנושא
  async function goHome() {
    if (timer) { stopTimer(); }
    if (session && session.idx > 0 && !(await ssDialog.confirm('לצאת מהתרגול? התשובות שכבר נענו נשמרו בהתקדמות.'))) return;
    session = null;
    setTab(active() ? 'practice' : 'learners');
  }
  async function quitSession() {
    if (session && session.idx > 0 && !(await ssDialog.confirm('לצאת מהתרגול? התשובות שכבר נענו נשמרו בהתקדמות.'))) return;
    session = null; render();
  }
  document.addEventListener('change', e => {
    if (e.target.id === 'learnerSel') pickLearner(e.target.value);
    else if (e.target.id === 'wsTopic') {
      const t = e.target.value, maxL = M.MAX_LEVEL[t] || 1, lv = Math.min(topicState(t).level, maxL);
      $('wsLevel').innerHTML = Array.from({ length: maxL }, (_, k) => '<option value="' + (k + 1) + '"' + (k + 1 === lv ? ' selected' : '') + '>רמה ' + (k + 1) + '</option>').join('');
      if (sheet && sheet.qs) makeSheet();
    }
    else if (e.target.id === 'wsLevel' || e.target.id === 'wsCount') { if (sheet && sheet.qs) makeSheet(); }
    else if (e.target.id === 'wsKey') { if (sheet) { sheet.key = e.target.checked; const s = $('sheet'); if (s) s.classList.toggle('show-key', sheet.key); } }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const id = e.target && e.target.id;
    if (id === 'newName') { e.preventDefault(); addLearner(); return; }
    if (timer && (id === 'ans' || id === 'ansQ' || id === 'ansR')) { e.preventDefault(); if (id === 'ansQ' && timer.q.kind === 'divrem' && !$('ansR').value) { $('ansR').focus(); return; } submitTimed(); return; }
    if (session && !session.answered && (id === 'ans' || id === 'ansQ' || id === 'ansR')) { e.preventDefault(); if (id === 'ansQ' && !$('ansR').value) { $('ansR').focus(); return; } submit(); return; }
  });

  // לשוניות מהמקלדת: חצים (RTL — שמאלה = הבאה), Home / End
  const TABS = ['practice', 'timed', 'table', 'sheet', 'progress', 'learners'];
  const tabsEl = $('tabs');
  if (tabsEl && tabsEl.addEventListener) tabsEl.addEventListener('keydown', e => {
    const i = TABS.indexOf(tab);
    let n = null;
    if (e.key === 'ArrowLeft') n = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowRight') n = TABS[(i - 1 + TABS.length) % TABS.length];
    else if (e.key === 'Home') n = TABS[0];
    else if (e.key === 'End') n = TABS[TABS.length - 1];
    if (!n) return;
    e.preventDefault();
    setTab(n);
    const b = document.querySelector && document.querySelector('#tabs .ss-tab[data-tab="' + n + '"]');
    if (b) b.focus();
  });

  // ---------------------------------------------------------------- קישור ישיר לפעולה (מהמעטפת)
  // המעטפת פותחת את המודול עם #ss-action=<id>. רק פעולות מהרשימה הסגורה; אחרת — מתעלמים בשקט.
  // הפעולה רק פותחת מסך — לא יוצרת ולא שומרת נתונים. אחרי הקריאה ה-hash נמחק (history.replaceState)
  const ACTIONS = {
    // תרגול להיום: הנושא המומלץ (הכי מעט תרגול); בלי ילד — מסך ההוספה
    'practice-today': () => {
      if (!active()) { setTab('learners'); return; }
      const open = M.topicsForGrade(grade());
      const rec = open.slice().sort((x, y) => topicState(x.id).total - topicState(y.id).total)[0];
      // קודם הלשונית "תרגול" (נבחרת ונשמרת), ואז התרגול — אחרת "חזרה" וכל רינדור מחזירים ללשונית הקודמת
      setTab('practice');
      if (rec) startSession(rec.id);
    }
  };
  // רשימה סגורה: Map (לא גישה דינמית לאובייקט לפי שם שמגיע מהכתובת)
  const ACTION_MAP = new Map(Object.entries(ACTIONS));
  function takeAction() {
    const loc = window.location;
    const m = loc && /^#ss-action=([a-z0-9-]{1,40})(?:&|$)/.exec(String(loc.hash || ''));
    if (!m) return;
    try { window.history.replaceState(null, '', loc.pathname + loc.search); } catch (_) { /* בלי היסטוריה */ }
    const fn = ACTION_MAP.get(m[1]);
    if (typeof fn === 'function') fn();
  }
  if (typeof window.addEventListener === 'function') window.addEventListener('hashchange', takeAction);

  // ---------------------------------------------------------------- עלייה
  loadProgress();
  HeVoice.init();
  setTab(active() ? tab : 'learners');
  takeAction();
})();
