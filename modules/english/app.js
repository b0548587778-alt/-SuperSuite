// ממשק מודול האנגלית: לומדים, כרטיסיות בחזרה מרווחת, בחנים, מילון, דקדוק, התקדמות והגדרות.
// הלוגיקה הטהורה ב-logic.js, המילים ב-words.js, שיעורי הדקדוק ב-grammar.js.
// כל טקסט נבנה ב-textContent (שם לומד ונתונים שמורים — קלט לא מהימן), אף פעם לא כ-HTML.
(function () {
  'use strict';

  const W = window.EnglishWords, L = window.EnglishLogic, G = window.EnglishGrammar;
  const WORDS = W.WORDS;
  const BY_ID = new Map(WORDS.map(w => [w.id, w]));
  const IDS = new Set(BY_ID.keys());
  const TOPIC_HE = Object.fromEntries(W.TOPICS.map(t => [t.id, t.he]));
  const LEVEL_HE = { 1: 'מתחילים', 2: 'ביניים', 3: 'מתקדמים' };
  const $ = id => document.getElementById(id);

  // ---------- עזרי DOM ----------
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k === 'vars') for (const [vk, vv] of Object.entries(v)) n.style.setProperty(vk, vv);
        else if (['hidden', 'disabled', 'checked', 'value', 'selected', 'type'].includes(k)) n[k] = v;
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return n;
  }
  const en = (text, cls) => el('span', { class: 'en-ltr ' + (cls || ''), dir: 'ltr', lang: 'en', text });
  const kpi = (label, value, note) => el('div', { class: 'ss-kpi' }, el('small', { text: label }), el('strong', { text: value }), note ? el('span', { class: 'en-kpi-note', text: note }) : null);
  function select(id, label, options, value, onChange) {
    const s = el('select', { class: 'ss-input', id, 'aria-label': label, onChange: e => onChange(e.target.value) },
      options.map(([v, t]) => el('option', { value: String(v), text: t, selected: String(v) === String(value) })));
    return s;
  }
  function field(label, control) {
    return el('div', { class: 'ss-field' }, el('label', { class: 'ss-label', for: control.id, text: label }), control);
  }
  function bar(pct, cls) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    return el('div', { class: 'en-bar ' + (cls || ''), role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': p },
      el('span', { vars: { '--pct': p + '%' } }));
  }
  function levelBadge(lv) {
    const cls = lv === 1 ? 'ss-badge-success' : lv === 2 ? 'ss-badge-info' : 'ss-badge-warning';
    return el('span', { class: 'ss-badge ' + cls, text: LEVEL_HE[lv] });
  }

  // הודעה קופצת: 6 שניות לפחות (ארוכה — יותר). עם undo — 10 שניות וכפתור "ביטול".
  // שגיאת שמירה נשארת גם בבאנר הקבוע (#roBanner) עד שהשמירה מצליחה
  let toastTimer = 0, undoFn = null;
  // הודעה שנעלמה מתרוקנת: כפתור "ביטול" / "סגירה" שקוף לא נשאר בסדר ה-Tab ולא נקרא בקורא מסך
  function hideToast() { clearTimeout(toastTimer); undoFn = null; const t = $('toast'); t.classList.remove('on'); t.classList.remove('en-toast-action'); t.textContent = ''; }
  function toast(msg, undo) {
    const t = $('toast');
    clearTimeout(toastTimer);
    undoFn = typeof undo === 'function' ? undo : null;
    t.textContent = msg;
    const fn = undoFn;
    // כפתור של הודעה קודמת לא מפעיל ביטול של פעולה אחרת
    if (fn) t.append(el('button', { type: 'button', class: 'ss-btn ss-btn-sm', onClick: () => { if (undoFn !== fn) return; hideToast(); fn(); } }, 'ביטול'));
    t.classList.add('on');
    t.classList.toggle('en-toast-action', !!undoFn);
    toastTimer = setTimeout(hideToast, undoFn ? 10000 : Math.max(6000, String(msg).length * 90));
  }
  // פעולה של הורים (מחיקת לומד, איפוס התקדמות): תרגיל כפל של מבוגרים לפני הביצוע — בלי סיסמה לזכור.
  // מניעת לחיצה בטעות של ילד שלומד לבד, לא אבטחה
  async function adultCheck(what) {
    // שני גורמים דו-ספרתיים 13–29 (בלי 20): מעבר לכפל שמודול החשבון מלמד בעל-פה בכיתות הנמוכות.
    // ילד גדול עם דף ועיפרון יכול לפתור — זה מעכב לחיצה בטעות, לא מנעול
    const pick = () => { const n = 13 + Math.floor(Math.random() * 16); return n >= 20 ? n + 1 : n; };
    const a = pick(), b = pick();
    const ans = await window.ssDialog.prompt(what + ' — זו פעולה להורים. כדי להמשיך, פתרו את התרגיל: \u2066' + a + ' × ' + b + '\u2069 = ?', '', { title: 'רק להורים', okText: 'המשך' });
    if (ans == null) return false;
    if (Number(String(ans).trim().replace(/[\u200e\u200f\s]/g, '')) === a * b) return true;
    await window.ssDialog.alert('התשובה לא נכונה, ולכן לא שינינו כלום.', { title: 'רק להורים' });
    return false;
  }

  // ---------- אחסון (localStorage המוצפן של התוכנה; קלט לא מהימן) ----------
  // כתיבה שנדחתה (קריאה בלבד לפי הרישיון, אין מקום): הסיבה בעברית מהמחסן (e.message) אם יש, ובאנר קבוע —
  // כדי שהלומד ידע שההתקדמות לא נשמרת. silent — בלי הודעה קופצת (הלשונית האחרונה, הלומד הפעיל)
  const SAVE_FAILED = 'לא נשמר. אם זה חוזר — קראו למנהל התוכנה.';
  // המפתחות שהכתיבה האחרונה שלהם נכשלה: הבאנר נעלם רק כשכולם נשמרו שוב (כתיבה קטנה שהצליחה —
  // למשל הלשונית — לא מעידה שההתקדמות, שנדחתה כגדולה מדי, נשמרת)
  const failedKeys = new Set();
  function saveFailed(k, e, silent) {
    failedKeys.add(k);
    const msg = e && typeof e.message === 'string' && /[א-ת]/.test(e.message) ? e.message : SAVE_FAILED;
    const b = $('roBanner');
    if (b) { b.textContent = 'ההתקדמות והשינויים לא נשמרים כרגע. ' + msg; b.hidden = false; }
    if (!silent) toast(msg);
  }
  function saved(k) {
    if (!failedKeys.delete(k) || failedKeys.size) return;
    const b = $('roBanner');
    if (b) { b.hidden = true; b.textContent = ''; }
  }
  const Store = {
    get(k) { try { return L.parseJSON(localStorage.getItem('english:' + k)); } catch (e) { return null; } },
    set(k, v, o) {
      try { localStorage.setItem('english:' + k, JSON.stringify(v)); }
      catch (e) { saveFailed(k, e, !!(o && o.silent)); return false; }
      saved(k);
      return true;
    },
    del(k) {
      try { localStorage.removeItem('english:' + k); }
      catch (e) { saveFailed(k, e); return false; }
      saved(k);
      return true;
    }
  };

  let learners = L.sanitizeLearners(Store.get('learners'));
  let settings = L.sanitizeSettings(Store.get('settings'));
  let progress = L.emptyProgress();
  let ui = (() => { const u = Store.get('ui'); return u && typeof u.tab === 'string' ? { tab: u.tab } : { tab: 'home' }; })();

  const today = () => L.dayIndex(new Date());
  function loadProgress() {
    progress = learners.active ? L.sanitizeProgress(Store.get('progress:' + learners.active), IDS) : L.emptyProgress();
  }
  const saveProgress = () => (learners.active ? Store.set('progress:' + learners.active, progress) : false);
  const saveLearners = () => Store.set('learners', learners);
  const saveSettings = () => Store.set('settings', settings);
  // שינוי בהתקדמות: אם השמירה נכשלה — חוזרים למצב הקודם (אחרת המסך מראה התקדמות שתיעלם בפתיחה הבאה)
  function commitProgress(mutate) {
    const snap = JSON.stringify(progress);
    mutate();
    if (saveProgress()) return true;
    progress = L.sanitizeProgress(L.parseJSON(snap), IDS);
    return false;
  }
  // שינוי בהגדרות: "נשמר" רק אחרי שמירה מוצלחת; בכישלון — ההגדרות והמסך חוזרים לערך הקודם
  function changeSettings(mutate, okMsg) {
    const snap = JSON.stringify(settings);
    mutate(settings);
    if (saveSettings()) { if (okMsg) toast(okMsg); return true; }
    settings = L.sanitizeSettings(L.parseJSON(snap));
    render();
    return false;
  }
  const activeLearner = () => learners.list.find(l => l.id === learners.active) || null;

  // ---------- הקראה (קולות מקומיים של Windows בלבד — בלי רשת) ----------
  const Speech = {
    voice: null,
    init() {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { this.apply(); return; }
      const pick = () => {
        let vs = [];
        try { vs = window.speechSynthesis.getVoices() || []; } catch (e) { vs = []; }
        const eng = vs.filter(v => /^en([-_]|$)/i.test(v.lang || '') && v.localService !== false);
        this.voice = eng.find(v => /en[-_]US/i.test(v.lang)) || eng.find(v => /en[-_]GB/i.test(v.lang)) || eng[0] || null;
        this.apply();
      };
      pick();
      try { window.speechSynthesis.addEventListener('voiceschanged', pick); } catch (e) { /* דפדפן ישן */ }
    },
    get ok() { return !!this.voice; },
    apply() { document.body.classList.toggle('en-no-voice', !this.voice); if (current === 'quiz' && !quiz) render(); },
    say(text) {
      if (!this.voice) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(String(text));
        u.voice = this.voice; u.lang = this.voice.lang; u.rate = 0.85;
        window.speechSynthesis.speak(u);
      } catch (e) { /* בלי קול — ממשיכים בשקט */ }
    }
  };
  // הקראת ההוראות בעברית — רק קול עברי מקומי (localService) של Windows / הטלפון, בלי רשת.
  // אין קול כזה ← כפתורי ההקראה מוסתרים (המחלקה en-no-he-voice על body, כבר בטעינה ב-index.html)
  const HeSpeech = {
    voice: null,
    init() {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { this.apply(); return; }
      const pick = () => {
        let vs = [];
        try { vs = window.speechSynthesis.getVoices() || []; } catch (e) { vs = []; }
        this.voice = vs.find(v => /^(he|iw)([-_]|$)/i.test(v.lang || '') && v.localService !== false) || null;
        this.apply();
      };
      pick();
      try { window.speechSynthesis.addEventListener('voiceschanged', pick); } catch (e) { /* דפדפן ישן */ }
    },
    apply() { document.body.classList.toggle('en-no-he-voice', !this.voice); },
    say(text) {
      if (!this.voice) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(String(text));
        u.voice = this.voice; u.lang = this.voice.lang; u.rate = 0.9;
        window.speechSynthesis.speak(u);
      } catch (e) { /* בלי קול — ממשיכים בשקט */ }
    }
  };
  // הוראה בעברית עם כפתור הקראה (מוסתר כשאין קול עברי)
  const instr = text => el('p', { class: 'en-instr' }, el('span', { text }),
    el('button', { type: 'button', class: 'ss-btn ss-btn-sm en-say', onClick: () => HeSpeech.say(text) }, el('span', { 'aria-hidden': 'true', text: '🔊 ' }), 'הקראת ההוראה'));
  const QUIZ_INSTR = {
    'en-he': 'קראו את המילה באנגלית ובחרו את התרגום הנכון.',
    'he-en': 'קראו את המילה בעברית ובחרו איך כותבים אותה באנגלית.',
    listen: 'הקשיבו למילה ובחרו איך כותבים אותה.',
    spell: 'הקלידו את המילה באנגלית ולחצו "בדיקה".',
    order: 'לחצו על המילים לפי הסדר, כדי לבנות משפט נכון.'
  };
  // הודעה כשאין קול באנגלית — לפי הפלטפורמה (בטלפון אין "הגדרות הדיבור של Windows")
  const IS_ANDROID = /android/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');
  const voiceNote = () => IS_ANDROID
    ? 'בטלפון הזה אין לתוכנה קול באנגלית, ולכן ההשמעה ומצב ההקשבה מוסתרים. אפשר לשמוע את ההגייה במחשב שיש בו קול אנגלי.'
    : 'לא נמצא במחשב קול באנגלית, ולכן ההשמעה ומצב ההקשבה מוסתרים. אפשר להוסיף קול אנגלי בהגדרות הדיבור של Windows.';
  const speakBtn = (text, small) => el('button', {
    type: 'button', class: 'ss-btn ss-btn-icon en-speak en-needs-voice' + (small ? ' ss-btn-sm' : ''),
    'aria-label': 'השמעת ההגייה', title: 'השמעה', onClick: e => { e.stopPropagation(); Speech.say(text); }
  }, el('span', { class: 'en-speaker', 'aria-hidden': 'true' }));

  // ---------- לומדים ----------
  function renderLearnerBox() {
    const has = learners.list.length > 0;
    $('learnerBox').hidden = !has;
    $('welcome').hidden = has;
    $('main').hidden = !has;
    const sel = $('learnerSel');
    sel.replaceChildren(...learners.list.map(l => el('option', { value: l.id, text: l.name, selected: l.id === learners.active })));
  }
  function addLearnerNamed(raw) {
    const name = L.cleanName(raw);
    if (!name) { toast('יש להקליד שם'); return false; }
    if (learners.list.length >= 50) { toast('אפשר עד 50 לומדים'); return false; }
    if (learners.list.some(l => l.name === name)) { toast('כבר יש לומד בשם הזה'); return false; }
    const l = { id: L.newId(), name, created: today() };
    const next = { list: learners.list.concat([l]), active: l.id };
    if (!Store.set('learners', next)) return false;
    learners = next;
    loadProgress();
    resetSessions();
    renderLearnerBox();
    render();
    toast('נוסף לומד: ' + name);
    return true;
  }
  async function addLearner() {
    const name = await window.ssDialog.prompt('שם הלומד החדש:', '');
    if (name != null) addLearnerNamed(name);
  }
  function switchLearner(id) {
    if (!learners.list.some(l => l.id === id)) return;
    learners.active = id;
    Store.set('learners', learners, { silent: true }); // הלומד הפעיל — גם בקריאה בלבד אפשר לעבור לומד ולצפות
    loadProgress();
    resetSessions();
    renderLearnerBox();
    render();
  }
  async function renameLearner(l) {
    const name = await window.ssDialog.prompt('שם חדש ל' + l.name + ':', l.name);
    if (name == null) return;
    const clean = L.cleanName(name);
    if (!clean) { toast('יש להקליד שם'); return; }
    const prev = l.name;
    l.name = clean;
    if (!saveLearners()) { l.name = prev; return; }
    renderLearnerBox();
    render();
  }
  // מחיקה — אחרי תרגיל ההורים, ואז 10 שניות לביטול (הלומד וההתקדמות שלו חוזרים)
  async function deleteLearner(l) {
    if (!(await adultCheck('מחיקת ' + l.name + ' וכל ההתקדמות שלו'))) return;
    if (!learners.list.some(x => x.id === l.id)) return;
    const before = { list: learners.list.slice(), active: learners.active };
    const savedProgress = Store.get('progress:' + l.id);
    const list = learners.list.filter(x => x.id !== l.id);
    const next = { list, active: learners.active === l.id ? (list[0] ? list[0].id : null) : learners.active };
    if (!Store.set('learners', next)) return;
    learners = next;
    Store.del('progress:' + l.id);
    loadProgress();
    resetSessions();
    renderLearnerBox();
    render();
    toast('נמחק: ' + l.name, () => restoreLearner(before, l, savedProgress));
  }
  function restoreLearner(before, l, savedProgress) {
    if (learners.list.some(x => x.id === l.id)) return;
    if (savedProgress != null && !Store.set('progress:' + l.id, savedProgress)) return;
    // הלומד חוזר למקומו; לומדים שנוספו בינתיים נשארים
    const added = learners.list.filter(x => !before.list.some(y => y.id === x.id));
    const next = { list: before.list.concat(added).slice(0, 50), active: before.active };
    if (!Store.set('learners', next)) { Store.del('progress:' + l.id); return; }
    learners = next;
    loadProgress();
    resetSessions();
    renderLearnerBox();
    render();
    toast('הוחזר: ' + l.name);
  }

  // ---------- לשוניות ----------
  const VIEWS = ['home', 'cards', 'quiz', 'words', 'grammar', 'progress', 'settings'];
  let current = VIEWS.includes(ui.tab) ? ui.tab : 'home';
  function show(tab) {
    if (!VIEWS.includes(tab)) tab = 'home';
    // סבב שהסתיים — לחיצה על הלשונית חוזרת למסך הבחירה
    if (tab === 'quiz' && quiz && quiz.i >= quiz.qs.length) quiz = null;
    if (tab === 'cards' && session && session.i >= session.items.length) session = null;
    current = tab;
    Store.set('ui', { tab }, { silent: true });
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    for (const b of document.querySelectorAll('#tabs .ss-tab')) {
      const on = b.dataset.tab === current;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
    for (const v of VIEWS) $('view-' + v).hidden = v !== current;
    if (!learners.active) return;
    const fn = { home: renderHome, cards: renderCards, quiz: renderQuiz, words: renderWords, grammar: renderGrammar, progress: renderProgress, settings: renderSettings }[current];
    fn($('view-' + current));
  }
  function resetSessions() { session = null; quiz = null; lessonId = null; }

  // מסנן לפי ההגדרות (נושא ורמות)
  const studyFilter = w => settings.levels.includes(w.level) && (settings.topic === 'all' || w.topic === settings.topic);
  function queueInfo() {
    const t = today();
    const left = Math.max(0, settings.newPerDay - L.newToday(progress.cards, t));
    return L.dailyQueue(WORDS, progress.cards, t, { newLimit: left, filter: studyFilter });
  }

  // ---------- בית ----------
  function renderHome(root) {
    const t = today();
    const st = L.stats(WORDS, progress, t);
    const q = queueInfo();
    const outside = Math.max(0, st.due - q.due.length); // לחזרה היום, אבל מחוץ לנושא / לרמות שנבחרו
    const name = activeLearner() ? activeLearner().name : '';
    const goalPct = Math.min(100, (st.todayCount / settings.dailyGoal) * 100);
    const wod = WORDS[(t * 7919) % WORDS.length];
    const nextLesson = G.LESSONS.find(ls => !progress.grammar[ls.id] || progress.grammar[ls.id].best < progress.grammar[ls.id].total) || G.LESSONS[0];

    root.replaceChildren(
      el('div', { class: 'en-hero ss-card' },
        el('div', { class: 'en-hero-text' },
          el('h2', { text: 'שלום, ' + name }),
          el('p', { class: 'ss-muted', text: st.todayCount >= settings.dailyGoal ? 'כל הכבוד! השלמת את המטרה היומית.' : 'המטרה היומית: ' + settings.dailyGoal + ' תשובות. עוד ' + Math.max(0, settings.dailyGoal - st.todayCount) + ' להיום.' }),
          el('div', { class: 'en-goal' }, bar(goalPct, 'en-bar-gold'), el('span', { class: 'en-goal-num', dir: 'ltr', text: st.todayCount + ' / ' + settings.dailyGoal }))
        ),
        el('div', { class: 'en-hero-actions' },
          el('button', { type: 'button', class: 'ss-btn-primary en-big-btn', onClick: () => { show('cards'); startSession(); } , disabled: !(q.due.length + q.fresh.length) },
            q.due.length + q.fresh.length ? 'לימוד יומי (' + (q.due.length + q.fresh.length) + ')' : 'אין כרטיסים להיום'),
          el('button', { type: 'button', class: 'ss-btn-secondary', onClick: () => { show('quiz'); startQuiz('en-he'); } }, 'בוחן מהיר')
        )
      ),
      el('div', { class: 'ss-kpis' },
        kpi('לחזרה היום', String(q.due.length), outside ? 'ועוד ' + outside + ' מחוץ לנושא או לרמות שנבחרו' : null),
        kpi('מילים חדשות להיום', String(q.fresh.length)),
        kpi('רצף ימים', String(st.streak), st.streak ? 'ימים ברצף' : 'מתחילים היום'),
        kpi('מילים שנלמדו', String(st.learned), 'מתוך ' + WORDS.length)
      ),
      el('div', { class: 'en-grid-2' },
        el('div', { class: 'ss-card en-wod' },
          el('h3', { class: 'ss-section-title', text: 'מילה של היום' }),
          el('div', { class: 'en-wod-word' }, en(wod.en, 'en-word-xl'), speakBtn(wod.en)),
          el('div', { class: 'en-wod-he', text: wod.he }),
          wod.ex ? el('p', { class: 'en-example' }, en(wod.ex)) : null,
          el('div', { class: 'en-row' }, el('span', { class: 'ss-badge', text: TOPIC_HE[wod.topic] }), levelBadge(wod.level))
        ),
        el('div', { class: 'ss-card en-next' },
          el('h3', { class: 'ss-section-title', text: 'המשך מכאן' }),
          el('button', { type: 'button', class: 'en-link-row', onClick: () => { show('grammar'); openLesson(nextLesson.id); } },
            el('span', { class: 'en-link-ico', 'aria-hidden': 'true', text: 'G' }),
            el('span', { class: 'en-link-txt' }, el('b', { text: 'שיעור דקדוק' }), el('small', { text: nextLesson.title }))),
          el('button', { type: 'button', class: 'en-link-row', onClick: () => show('words') },
            el('span', { class: 'en-link-ico', 'aria-hidden': 'true', text: 'Aa' }),
            el('span', { class: 'en-link-txt' }, el('b', { text: 'המילון' }), el('small', { text: WORDS.length + ' מילים ב-' + W.TOPICS.length + ' נושאים' }))),
          el('button', { type: 'button', class: 'en-link-row', onClick: () => show('progress') },
            el('span', { class: 'en-link-ico', 'aria-hidden': 'true', text: '%' }),
            el('span', { class: 'en-link-txt' }, el('b', { text: 'ההתקדמות שלי' }), el('small', { text: 'דיוק ' + st.accuracy + '% · ' + st.seen + ' מילים בתרגול' })))
        )
      )
    );
  }

  // ---------- כרטיסיות ----------
  let session = null; // { items:[{w, retry}], i, flipped, known, total, dir }
  function startSession(words) {
    let items;
    if (words) items = words.map(w => ({ w, retry: false }));
    else {
      const q = queueInfo();
      items = q.due.concat(q.fresh).map(w => ({ w, retry: false }));
    }
    if (!items.length) { toast('אין כרטיסים לחזרה כרגע'); session = null; render(); return; }
    // daily — התור היומי; סבב של מילים שנבחרו (טעויות מהבוחן) לא נספר במכסת המילים החדשות
    session = { items, i: 0, flipped: false, known: 0, total: items.length, dir: settings.cardDir, wrongs: [], daily: !words };
    render();
    maybeAutoSpeak();
  }
  function maybeAutoSpeak() {
    if (session && settings.autoSpeak && session.dir === 'en-he' && session.items[session.i]) Speech.say(session.items[session.i].w.en);
  }
  function flip() {
    if (!session || !session.items[session.i]) return;
    session.flipped = !session.flipped;
    const f = document.querySelector('.en-flash');
    if (f) {
      f.classList.toggle('flipped', session.flipped);
      f.setAttribute('aria-label', cardLabel(session.items[session.i].w, session.dir, session.flipped));
      faceHidden(f, session.flipped);
    }
    const live = $('cardLive');
    if (live) live.textContent = cardLabel(session.items[session.i].w, session.dir, session.flipped, true);
    renderCardActions();
    if (session.flipped && session.dir === 'he-en' && settings.autoSpeak) Speech.say(session.items[session.i].w.en);
  }
  function answerCard(known) {
    if (!session || !session.flipped) return;
    const it = session.items[session.i];
    if (!it.retry) {
      const t = today();
      commitProgress(() => {
        progress.cards[it.w.id] = L.review(progress.cards[it.w.id], known, t, { countNew: session.daily });
        L.bumpDay(progress, t, 1);
      });
      if (known) session.known += 1; else session.wrongs.push(it.w);
    }
    if (!known) session.items.push({ w: it.w, retry: true }); // חוזרים עליה בסוף הסבב
    session.i += 1;
    session.flipped = false;
    render();
    // המיקוד על הכרטיס החדש — קורא המסך מקריא את המילה, ורווח הופך אותו
    const f = document.querySelector('.en-flash');
    if (f) f.focus();
    maybeAutoSpeak();
  }

  // השם הנגיש של הכרטיס: המילה לפני ההפיכה, התשובה אחריה (aria-label קבוע הסתיר את שתיהן מקורא המסך)
  function cardLabel(w, dir, flipped, short) {
    const q = dir === 'en-he' ? w.en : w.he;
    const a = dir === 'en-he' ? w.he : w.en;
    if (!flipped) return 'מילה: ' + q + (short ? '' : ' — לחצו או הקישו רווח כדי לראות את התשובה');
    return 'תשובה: ' + a + (w.ex ? '. דוגמה: ' + w.ex : '') + (short ? '' : ' — לחצו כדי לחזור למילה');
  }
  function faceHidden(card, flipped) {
    const front = card.querySelector('.en-front'), back = card.querySelector('.en-back');
    if (front) { if (flipped) front.setAttribute('aria-hidden', 'true'); else front.removeAttribute('aria-hidden'); }
    if (back) { if (flipped) back.removeAttribute('aria-hidden'); else back.setAttribute('aria-hidden', 'true'); }
  }

  function renderCards(root) {
    if (session && session.i < session.items.length) return renderCardSession(root);
    if (session) return renderCardSummary(root);
    const q = queueInfo();
    const hard = L.hardWords(WORDS, progress.cards, 20);
    const lvls = [1, 2, 3];
    const outside = Math.max(0, L.stats(WORDS, progress, today()).due - q.due.length);
    root.replaceChildren(
      el('div', { class: 'ss-card en-setup' },
        el('h3', { class: 'ss-section-title', text: 'לימוד בכרטיסיות' }),
        el('p', { class: 'ss-hint', text: 'כל מילה חוזרת אחרי מרווח שהולך וגדל: יום, יומיים, 4, 8, 16 ו-32 ימים. מילה שלא ידעתם חוזרת מחר.' }),
        el('div', { class: 'en-form' },
          field('נושא', select('cardTopic', 'נושא', [['all', 'כל הנושאים']].concat(W.TOPICS.map(t => [t.id, t.he])), settings.topic, v => { if (changeSettings(s => { s.topic = v; })) render(); })),
          field('כיוון', select('cardDir', 'כיוון', [['en-he', 'אנגלית ← עברית'], ['he-en', 'עברית ← אנגלית']], settings.cardDir, v => { changeSettings(s => { s.cardDir = v; }); })),
          el('fieldset', { class: 'en-levels' }, el('legend', { class: 'ss-label', text: 'רמות' }),
            lvls.map(lv => el('label', { class: 'ss-check' },
              el('input', { type: 'checkbox', checked: settings.levels.includes(lv), onChange: e => {
                const set = new Set(settings.levels);
                if (e.target.checked) set.add(lv); else set.delete(lv);
                if (!set.size) { e.target.checked = true; toast('צריך לבחור לפחות רמה אחת'); return; }
                if (changeSettings(s => { s.levels = [...set].sort(); })) render();
              } }), LEVEL_HE[lv])))
        ),
        el('div', { class: 'en-queue' },
          el('div', { class: 'en-queue-item' }, el('strong', { text: String(q.due.length) }), el('span', { text: 'לחזרה' })),
          el('div', { class: 'en-queue-item' }, el('strong', { text: String(q.fresh.length) }), el('span', { text: 'חדשות' })),
          el('div', { class: 'en-queue-go' },
            el('button', { type: 'button', class: 'ss-btn-primary en-big-btn', id: 'startCards', disabled: !(q.due.length + q.fresh.length), onClick: () => startSession() }, 'התחלה'),
            hard.length ? el('button', { type: 'button', class: 'ss-btn-secondary', onClick: () => startSession(hard.map(h => h.word)) }, 'מילים קשות (' + hard.length + ')') : null)
        ),
        outside ? el('p', { class: 'ss-hint', text: 'יש עוד ' + outside + ' מילים לחזרה היום מחוץ לנושא או לרמות שנבחרו. כדי לחזור עליהן — בחרו "כל הנושאים" ואת כל הרמות.' }) : null,
        !(q.due.length + q.fresh.length) && !outside ? el('p', { class: 'ss-hint', text: 'סיימתם להיום. אפשר להגדיל את מכסת המילים החדשות בהגדרות, לבחור נושא אחר, או לתרגל בבחנים.' }) : null
      )
    );
  }

  function renderCardSession(root) {
    const it = session.items[session.i];
    const w = it.w;
    const front = session.dir === 'en-he' ? en(w.en, 'en-word-xl') : el('span', { class: 'en-word-he', text: w.he });
    const back = session.dir === 'en-he' ? el('span', { class: 'en-word-he', text: w.he }) : en(w.en, 'en-word-xl');
    const c = progress.cards[w.id];
    const done = Math.min(session.i, session.total);
    root.replaceChildren(
      el('div', { class: 'en-session' },
        el('div', { class: 'en-session-top' },
          el('span', { class: 'ss-muted', text: it.retry ? 'חזרה על מילה שלא ידעתם' : 'כרטיס ' + (done + 1) + ' מתוך ' + session.total }),
          el('button', { type: 'button', class: 'ss-btn-ghost ss-btn-sm', onClick: () => { session = { ...session, i: session.items.length }; render(); } }, 'סיום')
        ),
        bar((done / session.total) * 100),
        el('button', { type: 'button', class: 'en-flash' + (session.flipped ? ' flipped' : ''), 'aria-label': cardLabel(w, session.dir, session.flipped), onClick: flip },
          el('span', { class: 'en-flash-inner' },
            el('span', { class: 'en-face en-front', 'aria-hidden': session.flipped ? 'true' : null },
              el('span', { class: 'en-face-tags' }, el('span', { class: 'ss-badge', text: TOPIC_HE[w.topic] }), levelBadge(w.level), !c || !c.s ? el('span', { class: 'ss-badge ss-badge-info', text: 'חדשה' }) : null),
              front,
              el('span', { class: 'en-face-hint', text: 'לחצו או הקישו רווח כדי לראות את התשובה' })),
            el('span', { class: 'en-face en-back', 'aria-hidden': session.flipped ? null : 'true' },
              el('span', { class: 'en-face-q' }, session.dir === 'en-he' ? en(w.en) : el('span', { text: w.he })),
              back,
              w.ex ? el('span', { class: 'en-example' }, en(w.ex)) : null)
          )
        ),
        el('div', { class: 'en-card-actions', id: 'cardActions' }),
        el('div', { class: 'en-sr', id: 'cardLive', role: 'status', 'aria-live': 'polite' })
      )
    );
    renderCardActions();
  }
  function renderCardActions() {
    const box = $('cardActions');
    if (!box || !session) return;
    const w = session.items[session.i].w;
    box.replaceChildren(
      speakBtn(w.en),
      session.flipped
        ? el('div', { class: 'en-row' },
          el('button', { type: 'button', class: 'ss-btn en-btn-no', onClick: () => answerCard(false) }, el('kbd', { class: 'ss-kbd', text: '1' }), 'לא ידעתי'),
          el('button', { type: 'button', class: 'ss-btn-primary en-btn-yes', onClick: () => answerCard(true) }, el('kbd', { class: 'ss-kbd', text: '2' }), 'ידעתי'))
        : el('button', { type: 'button', class: 'ss-btn-primary', onClick: flip }, 'הצגת התשובה')
    );
  }
  function renderCardSummary(root) {
    const s = session;
    const answered = s.known + s.wrongs.length;
    const pct = answered ? Math.round((s.known / answered) * 100) : 0;
    root.replaceChildren(
      el('div', { class: 'ss-card en-summary' },
        el('div', { class: 'en-score-ring', vars: { '--pct': pct + '%' } }, el('span', { text: pct + '%' })),
        el('h2', { text: answered ? 'סיימתם את הסבב!' : 'הסבב הסתיים' }),
        el('p', { class: 'ss-muted', text: 'ידעתם ' + s.known + ' מתוך ' + answered + ' מילים.' }),
        s.wrongs.length ? el('div', { class: 'en-chips' }, s.wrongs.map(w => el('span', { class: 'en-chip-word' }, en(w.en), ' — ', w.he))) : null,
        el('div', { class: 'en-row en-center' },
          el('button', { type: 'button', class: 'ss-btn-primary', onClick: () => { session = null; render(); } }, 'חזרה למסך הכרטיסיות'),
          el('button', { type: 'button', class: 'ss-btn-secondary', onClick: () => show('home') }, 'למסך הבית'))
      )
    );
  }

  // ---------- בחנים ----------
  const MODES = [
    { id: 'en-he', title: 'אנגלית ← עברית', desc: 'רואים מילה באנגלית ובוחרים את התרגום.', ico: 'A→א' },
    { id: 'he-en', title: 'עברית ← אנגלית', desc: 'רואים מילה בעברית ובוחרים באנגלית.', ico: 'א→A' },
    { id: 'spell', title: 'איות', desc: 'מקלידים את המילה באנגלית.', ico: 'abc' },
    { id: 'listen', title: 'הקשבה', desc: 'שומעים מילה ובוחרים איך כותבים אותה.', ico: '))', voice: true },
    { id: 'order', title: 'סידור משפט', desc: 'מסדרים מילים למשפט נכון.', ico: '1-2-3' }
  ];
  let quiz = null;
  let quizSetup = { mode: 'en-he', topic: 'all', level: 'all', count: 10 };

  function quizPool(mode, setup) {
    return WORDS.filter(w => (setup.topic === 'all' || w.topic === setup.topic) && (setup.level === 'all' || String(w.level) === String(setup.level)) &&
      (mode !== 'order' || (w.ex && L.tokenize(w.ex).length >= 3 && L.tokenize(w.ex).length <= 9)));
  }
  function startQuiz(mode) {
    if (mode) quizSetup.mode = mode;
    const m = quizSetup.mode;
    if (m === 'listen' && !Speech.ok) { toast('אין במחשב קול באנגלית — מצב ההקשבה לא זמין'); return; }
    let pool = quizPool(m, quizSetup);
    if (pool.length < 4) { toast('אין מספיק מילים בבחירה הזו — בחרו נושא או רמה רחבים יותר'); return; }
    const rand = Math.random;
    const words = L.pickQuizWords(pool, progress.cards, Math.min(quizSetup.count, pool.length), rand);
    // מסיחים — מכל המילים באותה רמה ונושא (רחב יותר מהבוחן עצמו)
    const distractPool = WORDS;
    const qs = words.map(w => {
      if (m === 'en-he') return { w, kind: 'choice', ...L.buildChoice(w, distractPool, 'en-he', rand, 4) };
      if (m === 'he-en' || m === 'listen') return { w, kind: 'choice', ...L.buildChoice(w, distractPool, 'he-en', rand, 4) };
      if (m === 'spell') return { w, kind: 'spell' };
      return { w, kind: 'order', ...L.buildOrder(w.ex, rand), placed: [] };
    });
    quiz = { mode: m, qs, i: 0, score: 0, answered: false, wrongs: [] };
    render();
    if (m === 'listen') setTimeout(() => quiz && Speech.say(quiz.qs[0].w.en), 250);
  }
  function recordQuiz(w, ok) {
    const t = today();
    commitProgress(() => {
      progress.cards[w.id] = L.quizAnswer(progress.cards[w.id], ok, t);
      progress.quiz.t += 1;
      if (ok) progress.quiz.c += 1;
      L.bumpDay(progress, t, 1);
    });
    quiz.answered = true;
    if (ok) quiz.score += 1; else quiz.wrongs.push(w);
  }
  function nextQuestion() {
    if (!quiz || !quiz.answered) return;
    quiz.i += 1;
    quiz.answered = false;
    render();
    if (quiz.mode === 'listen' && quiz.qs[quiz.i]) setTimeout(() => Speech.say(quiz.qs[quiz.i].w.en), 200);
  }

  function renderQuiz(root) {
    if (quiz && quiz.i < quiz.qs.length) return renderQuestion(root);
    if (quiz) return renderQuizSummary(root);
    const modes = MODES.filter(m => !m.voice || Speech.ok);
    if (!modes.some(m => m.id === quizSetup.mode)) quizSetup.mode = 'en-he';
    const poolN = quizPool(quizSetup.mode, quizSetup).length;
    root.replaceChildren(
      el('div', { class: 'en-modes', role: 'radiogroup', 'aria-label': 'סוג הבוחן' },
        modes.map(m => el('button', {
          type: 'button', class: 'ss-card ss-card-hover en-mode' + (quizSetup.mode === m.id ? ' on' : ''), role: 'radio',
          'aria-checked': quizSetup.mode === m.id ? 'true' : 'false', dataset: { mode: m.id },
          onClick: () => { quizSetup.mode = m.id; render(); }
        }, el('span', { class: 'en-mode-ico', dir: 'ltr', 'aria-hidden': 'true', text: m.ico }), el('b', { text: m.title }), el('small', { text: m.desc })))
      ),
      el('div', { class: 'ss-card' },
        el('div', { class: 'en-form' },
          field('נושא', select('quizTopic', 'נושא', [['all', 'כל הנושאים']].concat(W.TOPICS.map(t => [t.id, t.he])), quizSetup.topic, v => { quizSetup.topic = v; render(); })),
          field('רמה', select('quizLevel', 'רמה', [['all', 'כל הרמות'], [1, LEVEL_HE[1]], [2, LEVEL_HE[2]], [3, LEVEL_HE[3]]], quizSetup.level, v => { quizSetup.level = v; render(); })),
          field('מספר שאלות', select('quizCount', 'מספר שאלות', [[5, '5'], [10, '10'], [20, '20']], quizSetup.count, v => { quizSetup.count = Number(v); }))
        ),
        el('div', { class: 'en-row en-between' },
          el('span', { class: 'ss-muted', text: poolN + ' מילים מתאימות' }),
          el('button', { type: 'button', class: 'ss-btn-primary en-big-btn', id: 'startQuiz', disabled: poolN < 4, onClick: () => startQuiz() }, 'התחלת הבוחן'))
      )
    );
  }

  function renderQuestion(root) {
    const q = quiz.qs[quiz.i];
    const head = el('div', { class: 'en-session-top' },
      el('span', { class: 'ss-muted', text: 'שאלה ' + (quiz.i + 1) + ' מתוך ' + quiz.qs.length }),
      el('span', { class: 'ss-badge ss-badge-success', text: 'נכונות: ' + quiz.score }),
      el('button', { type: 'button', class: 'ss-btn-ghost ss-btn-sm', onClick: () => { quiz = null; render(); } }, 'יציאה'));
    const body = el('div', { class: 'ss-card en-question' });
    const feedback = el('div', { class: 'en-feedback', id: 'quizFeedback', role: 'status', 'aria-live': 'polite' });
    const next = el('button', { type: 'button', class: 'ss-btn-primary', id: 'quizNext', hidden: true, onClick: nextQuestion }, quiz.i + 1 < quiz.qs.length ? 'לשאלה הבאה' : 'לתוצאות');
    const showNext = () => { next.hidden = false; next.focus(); };

    if (q.kind === 'choice') {
      const isListen = quiz.mode === 'listen';
      const prompt = isListen
        ? el('div', { class: 'en-prompt' }, el('button', { type: 'button', class: 'ss-btn-secondary en-big-btn', onClick: () => Speech.say(q.w.en) }, el('span', { class: 'en-speaker', 'aria-hidden': 'true' }), 'השמעה שוב'), el('p', { class: 'ss-hint', text: 'איזו מילה שמעתם?' }))
        : el('div', { class: 'en-prompt' }, q.dir === 'en-he' ? en(q.prompt, 'en-word-xl') : el('span', { class: 'en-word-he', text: q.prompt }), q.dir === 'en-he' ? speakBtn(q.w.en) : null);
      const opts = el('div', { class: 'en-options' });
      q.options.forEach((o, idx) => {
        opts.append(el('button', {
          type: 'button', class: 'en-option', dataset: { idx: String(idx) },
          onClick: e => {
            if (quiz.answered) return;
            const ok = idx === q.answerIndex;
            recordQuiz(q.w, ok);
            for (const b of opts.children) {
              b.disabled = true;
              if (Number(b.dataset.idx) === q.answerIndex) b.classList.add('ok');
            }
            if (!ok) e.currentTarget.classList.add('bad');
            feedback.replaceChildren(ok ? el('b', { class: 'en-good', text: 'נכון! ' }) : el('b', { class: 'en-bad', text: 'לא נכון. ' }),
              en(q.w.en, 'en-strong'), ' = ', q.w.he);
            if (!isListen && q.dir === 'he-en') Speech.say(q.w.en);
            showNext();
          }
        }, el('kbd', { class: 'ss-kbd', text: String(idx + 1) }), q.dir === 'he-en' ? en(o) : el('span', { text: o })));
      });
      body.append(prompt, opts);
    } else if (q.kind === 'spell') {
      const input = el('input', { class: 'ss-input en-spell-input', id: 'spellInput', dir: 'ltr', lang: 'en', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'המילה באנגלית', placeholder: 'type here…' });
      const check = () => {
        if (quiz.answered) return;
        const r = L.checkAnswer(input.value, L.spellAnswers(q.w, WORDS)); // גם מילה נרדפת ואיות בריטי
        if (r.empty) { toast('הקלידו את המילה'); return; }
        recordQuiz(q.w, r.correct);
        input.disabled = true; checkBtn.hidden = true;
        input.classList.add(r.correct ? 'ok' : 'bad');
        if (r.correct) feedback.replaceChildren(el('b', { class: 'en-good', text: 'נכון מאוד!' }), ' ', en(q.w.en));
        else {
          const diff = el('span', { class: 'en-diff', dir: 'ltr', lang: 'en', 'aria-label': 'השוואה בין מה שהוקלד לתשובה' },
            r.diff.map(d => el('span', { class: 'en-d-' + d.t, text: d.ch === ' ' ? ' ' : d.ch })));
          feedback.replaceChildren(
            el('div', {}, el('b', { class: 'en-bad', text: r.close ? 'כמעט! ' : 'לא נכון. ' }), 'התשובה הנכונה: ', en(q.w.en, 'en-strong')),
            el('div', { class: 'en-diff-row' }, el('span', { class: 'ss-muted', text: 'מה שהקלדתם: ' }), diff),
            el('div', { class: 'ss-hint', text: 'ירוק — נכון, אדום עם קו — אות מיותרת, צהוב — אות שחסרה.' }));
        }
        Speech.say(q.w.en);
        showNext();
      };
      const checkBtn = el('button', { type: 'button', class: 'ss-btn-primary', onClick: check }, 'בדיקה');
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!quiz.answered) check(); else nextQuestion(); } });
      body.append(
        el('div', { class: 'en-prompt' }, el('span', { class: 'en-word-he', text: q.w.he }), speakBtn(q.w.en)),
        el('p', { class: 'ss-hint en-center-text', text: 'כתבו את המילה באנגלית (' + q.w.en.length + ' תווים)' }),
        el('div', { class: 'en-row en-spell' }, input, checkBtn));
      setTimeout(() => input.focus(), 0);
    } else {
      const answer = el('div', { class: 'en-order-line', dir: 'ltr', 'aria-label': 'המשפט שבניתם' });
      const bank = el('div', { class: 'en-order-bank', dir: 'ltr', 'aria-label': 'מילים לבחירה' });
      const checkBtn = el('button', { type: 'button', class: 'ss-btn-primary', disabled: true }, 'בדיקה');
      const used = new Set();
      const draw = () => {
        answer.replaceChildren(...q.placed.map((ti, pos) => el('button', {
          type: 'button', class: 'en-token on', lang: 'en', disabled: quiz.answered, text: q.tokens[ti],
          onClick: () => { q.placed.splice(pos, 1); used.delete(ti); draw(); }
        })));
        if (!q.placed.length) answer.append(el('span', { class: 'en-order-ph', text: 'לחצו על המילים לפי הסדר' }));
        bank.replaceChildren(...q.tokens.map((tok, ti) => el('button', {
          type: 'button', class: 'en-token', lang: 'en', text: tok, disabled: used.has(ti) || quiz.answered,
          onClick: () => { q.placed.push(ti); used.add(ti); draw(); }
        })));
        checkBtn.disabled = quiz.answered || q.placed.length !== q.tokens.length;
      };
      checkBtn.addEventListener('click', () => {
        if (quiz.answered) return;
        const ok = L.checkOrder(q.placed.map(i => q.tokens[i]), q.sentence);
        recordQuiz(q.w, ok);
        answer.classList.add(ok ? 'ok' : 'bad');
        feedback.replaceChildren(ok ? el('b', { class: 'en-good', text: 'מצוין!' }) : el('b', { class: 'en-bad', text: 'לא בדיוק. ' }), ok ? null : 'המשפט הנכון: ', en(q.sentence, 'en-strong'));
        Speech.say(q.sentence);
        draw();
        showNext();
      });
      body.append(
        el('p', { class: 'ss-hint en-center-text' }, 'סדרו את המילים למשפט. מילת המפתח: ', en(q.w.en, 'en-strong'), ' (', q.w.he, ')'),
        answer, bank, el('div', { class: 'en-row en-center' }, checkBtn,
          el('button', { type: 'button', class: 'ss-btn-ghost', onClick: () => { if (quiz.answered) return; q.placed = []; used.clear(); draw(); } }, 'ניקוי')));
      draw();
    }
    if (QUIZ_INSTR[quiz.mode]) body.prepend(instr(QUIZ_INSTR[quiz.mode]));
    root.replaceChildren(el('div', { class: 'en-session' }, head, bar((quiz.i / quiz.qs.length) * 100), body, feedback, el('div', { class: 'en-row en-center' }, next)));
  }

  function renderQuizSummary(root) {
    const pct = Math.round((quiz.score / quiz.qs.length) * 100);
    const msg = pct === 100 ? 'מושלם!' : pct >= 80 ? 'יפה מאוד!' : pct >= 50 ? 'טוב — ממשיכים לתרגל' : 'כדאי לחזור על המילים';
    root.replaceChildren(
      el('div', { class: 'ss-card en-summary' },
        el('div', { class: 'en-score-ring', vars: { '--pct': pct + '%' } }, el('span', { text: pct + '%' })),
        el('h2', { text: msg }),
        el('p', { class: 'ss-muted', text: quiz.score + ' תשובות נכונות מתוך ' + quiz.qs.length }),
        quiz.wrongs.length ? el('div', {},
          el('h3', { class: 'ss-section-title', text: 'מילים לחזרה' }),
          el('div', { class: 'en-chips' }, quiz.wrongs.map(w => el('span', { class: 'en-chip-word' }, en(w.en), ' — ', w.he)))) : null,
        el('div', { class: 'en-row en-center' },
          el('button', { type: 'button', class: 'ss-btn-primary', onClick: () => startQuiz() }, 'בוחן נוסף'),
          quiz.wrongs.length ? el('button', { type: 'button', class: 'ss-btn-secondary', onClick: () => { const ws = quiz.wrongs.slice(); quiz = null; show('cards'); startSession(ws); } }, 'לתרגל את הטעויות בכרטיסיות') : null,
          el('button', { type: 'button', class: 'ss-btn-ghost', onClick: () => { quiz = null; render(); } }, 'בחירת בוחן'))
      )
    );
  }

  // ---------- מילון ----------
  let wordFilter = { q: '', topic: 'all', level: 'all', status: 'all' };
  function wordStatus(w) {
    const c = progress.cards[w.id];
    if (!c || !c.s) return 'new';
    return c.b >= L.LEARNED_BOX ? 'learned' : 'learning';
  }
  const STATUS = { new: ['חדשה', ''], learning: ['בלימוד', 'ss-badge-warning'], learned: ['נלמדה', 'ss-badge-success'] };
  function renderWords(root) {
    const tbody = el('tbody');
    const count = el('span', { class: 'ss-muted' });
    const fill = () => {
      const q = L.normalize(wordFilter.q);
      const list = WORDS.filter(w => (wordFilter.topic === 'all' || w.topic === wordFilter.topic) &&
        (wordFilter.level === 'all' || String(w.level) === wordFilter.level) &&
        (wordFilter.status === 'all' || wordStatus(w) === wordFilter.status) &&
        (!q || w.id.includes(q) || w.he.includes(wordFilter.q.trim())));
      count.textContent = list.length + ' מילים';
      tbody.replaceChildren(...list.map(w => {
        const st = STATUS[wordStatus(w)];
        return el('tr', {},
          el('td', {}, el('span', { class: 'en-cell-word' }, speakBtn(w.en, true), en(w.en, 'en-strong'))),
          el('td', { text: w.he }),
          el('td', { class: 'en-hide-sm', text: TOPIC_HE[w.topic] }),
          el('td', {}, levelBadge(w.level)),
          el('td', {}, el('span', { class: 'ss-badge ' + st[1], text: st[0] })),
          el('td', { class: 'en-hide-sm' }, w.ex ? en(w.ex, 'ss-muted') : ''));
      }));
      if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: 6 }, el('div', { class: 'ss-empty', text: 'לא נמצאו מילים' }))));
    };
    const search = el('input', { class: 'ss-input', type: 'search', id: 'wordSearch', 'aria-label': 'חיפוש מילה', placeholder: 'חיפוש באנגלית או בעברית', value: wordFilter.q,
      onInput: e => { wordFilter.q = e.target.value; fill(); } });
    root.replaceChildren(
      el('div', { class: 'ss-card' },
        el('div', { class: 'ss-toolbar' },
          search,
          select('wordTopic', 'נושא', [['all', 'כל הנושאים']].concat(W.TOPICS.map(t => [t.id, t.he])), wordFilter.topic, v => { wordFilter.topic = v; fill(); }),
          select('wordLevel', 'רמה', [['all', 'כל הרמות'], ['1', LEVEL_HE[1]], ['2', LEVEL_HE[2]], ['3', LEVEL_HE[3]]], wordFilter.level, v => { wordFilter.level = v; fill(); }),
          select('wordStatus', 'מצב', [['all', 'כל המצבים'], ['new', 'חדשות'], ['learning', 'בלימוד'], ['learned', 'נלמדו']], wordFilter.status, v => { wordFilter.status = v; fill(); }),
          el('span', { class: 'ss-push' }, count)
        ),
        el('div', { class: 'ss-scroll' },
          el('table', { class: 'ss-table en-words' },
            el('thead', {}, el('tr', {}, ['מילה', 'תרגום', 'נושא', 'רמה', 'מצב', 'דוגמה'].map((h, i) => el('th', { class: i === 2 || i === 5 ? 'en-hide-sm' : null, text: h })))),
            tbody))
      )
    );
    fill();
  }

  // ---------- דקדוק ----------
  let lessonId = null;
  let lessonState = null; // { answers: {idx: value}, checked: bool }
  function openLesson(id) { lessonId = id; lessonState = { answers: {}, checked: false }; render(); }
  function renderGrammar(root) {
    const lesson = G.LESSONS.find(l => l.id === lessonId);
    if (!lesson) {
      root.replaceChildren(
        el('p', { class: 'ss-hint', text: 'שיעורים קצרים עם הסבר בעברית ותרגול שנבדק מיד.' }),
        el('div', { class: 'en-lessons' }, G.LESSONS.map((l, i) => {
          const r = progress.grammar[l.id];
          return el('button', { type: 'button', class: 'ss-card ss-card-hover en-lesson', dataset: { lesson: l.id }, onClick: () => openLesson(l.id) },
            el('span', { class: 'en-lesson-num', text: String(i + 1) }),
            el('span', { class: 'en-lesson-body' }, el('b', { text: l.title }), el('small', { class: 'ss-muted', text: l.intro.slice(0, 80) + '…' })),
            r ? el('span', { class: 'ss-badge ' + (r.best === r.total ? 'ss-badge-success' : 'ss-badge-warning'), text: r.best + '/' + r.total }) : el('span', { class: 'ss-badge', text: 'חדש' }));
        }))
      );
      return;
    }
    const st = lessonState;
    const exRows = lesson.exercises.map((ex, idx) => {
      const val = st.answers[idx] || '';
      const res = st.checked ? L.checkAnswer(val, ex.a) : null;
      const parts = ex.q.split('___');
      let control;
      if (ex.options) {
        control = el('span', { class: 'en-opt-group', dir: 'ltr', role: 'group', 'aria-label': 'אפשרויות לתרגיל ' + (idx + 1) },
          ex.options.map(o => el('button', {
            type: 'button', class: 'ss-chip en-opt' + (L.normalize(val) === L.normalize(o) ? ' on' : ''), lang: 'en', 'aria-pressed': L.normalize(val) === L.normalize(o) ? 'true' : 'false', disabled: st.checked, text: o,
            onClick: () => { st.answers[idx] = o; render(); }
          })));
      } else {
        control = el('input', { class: 'ss-input en-blank', dir: 'ltr', lang: 'en', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'תשובה לתרגיל ' + (idx + 1), value: val, disabled: st.checked,
          onInput: e => { st.answers[idx] = e.target.value; } });
      }
      return el('li', { class: 'en-ex' + (res ? (res.correct ? ' ok' : ' bad') : '') },
        el('div', { class: 'en-ex-q', dir: 'ltr', lang: 'en' }, parts[0], ex.options ? el('span', { class: 'en-gap', text: val || '___' }) : control, parts[1] || ''),
        ex.options ? control : null,
        el('div', { class: 'en-ex-tr', text: ex.tr }),
        res ? el('div', { class: 'en-ex-res' }, res.correct ? el('b', { class: 'en-good', text: 'נכון' }) : el('span', {}, el('b', { class: 'en-bad', text: 'התשובה: ' }), en(ex.a[0], 'en-strong'))) : null);
    });
    const score = st.checked ? lesson.exercises.filter((ex, i) => L.checkAnswer(st.answers[i] || '', ex.a).correct).length : 0;
    root.replaceChildren(
      el('div', { class: 'en-row' }, el('button', { type: 'button', class: 'ss-btn-ghost ss-btn-sm', onClick: () => { lessonId = null; render(); } }, '→ כל השיעורים')),
      el('div', { class: 'ss-card ss-card-accent' },
        el('h2', { class: 'en-lesson-title', text: lesson.title }),
        el('p', { text: lesson.intro }),
        el('div', { class: 'ss-scroll' }, el('table', { class: 'ss-table en-rules' },
          el('tbody', {}, lesson.rules.map(r => el('tr', {}, el('td', { text: r.he }), el('td', {}, en(r.en, 'en-strong'), ' ', speakBtn(r.en, true)), el('td', { class: 'ss-muted', text: r.tr }))))))
      ),
      el('div', { class: 'ss-card' },
        el('h3', { class: 'ss-section-title', text: 'תרגול' }),
        el('ol', { class: 'en-exercises' }, exRows),
        st.checked ? el('div', { class: 'en-row en-between en-ex-score' },
          el('b', { text: 'הציון שלכם: ' + score + ' מתוך ' + lesson.exercises.length }),
          el('button', { type: 'button', class: 'ss-btn-secondary', onClick: () => openLesson(lesson.id) }, 'לנסות שוב'))
          : el('div', { class: 'en-row en-center' }, el('button', { type: 'button', class: 'ss-btn-primary', id: 'checkLesson', onClick: () => {
            st.checked = true;
            const sc = lesson.exercises.filter((ex, i) => L.checkAnswer(st.answers[i] || '', ex.a).correct).length;
            commitProgress(() => {
              const prev = progress.grammar[lesson.id];
              progress.grammar[lesson.id] = { best: Math.max(sc, prev ? prev.best : 0), total: lesson.exercises.length };
              L.bumpDay(progress, today(), 1);
            });
            render();
          } }, 'בדיקה'))
      )
    );
  }

  // ---------- התקדמות ----------
  function renderProgress(root) {
    const t = today();
    const st = L.stats(WORDS, progress, t);
    const dueSel = queueInfo().due.length; // לחזרה היום בנושא וברמות שנבחרו (כמו במסך הבית)
    const hard = L.hardWords(WORDS, progress.cards, 25);
    const days = [];
    for (let d = t - 13; d <= t; d++) days.push({ d, n: progress.days[d] || 0 });
    const maxN = Math.max(settings.dailyGoal, ...days.map(x => x.n));
    const dayName = d => new Date(d * L.DAY_MS).toLocaleDateString('he-IL', { weekday: 'narrow', timeZone: 'UTC' });
    root.replaceChildren(
      el('div', { class: 'ss-kpis' },
        kpi('מילים שנלמדו', String(st.learned), 'מתוך ' + WORDS.length),
        kpi('דיוק', st.answers ? st.accuracy + '%' : '—', st.answers + ' תשובות'),
        kpi('רצף ימים', String(st.streak)),
        kpi('בתרגול', String(st.seen), st.due + ' לחזרה היום' + (st.due !== dueSel ? ' (מהם ' + dueSel + ' בנושא וברמות שנבחרו)' : ''))
      ),
      el('div', { class: 'en-grid-2' },
        el('div', { class: 'ss-card' },
          el('h3', { class: 'ss-section-title', text: 'פעילות בשבועיים האחרונים' }),
          el('div', { class: 'en-chart', role: 'img', 'aria-label': 'תשובות בכל יום בשבועיים האחרונים' },
            days.map(x => el('div', { class: 'en-chart-col' + (x.n >= settings.dailyGoal ? ' goal' : '') + (x.d === t ? ' today' : ''), title: x.n + ' תשובות' },
              el('span', { class: 'en-chart-n', text: x.n ? String(x.n) : '' }),
              el('span', { class: 'en-chart-bar', vars: { '--h': Math.round((x.n / maxN) * 100) + '%' } }),
              el('span', { class: 'en-chart-d', text: dayName(x.d) })))),
          el('p', { class: 'ss-hint', text: 'עמודה בצבע זהב — יום שבו הושגה המטרה היומית (' + settings.dailyGoal + ').' })
        ),
        el('div', { class: 'ss-card' },
          el('h3', { class: 'ss-section-title', text: 'שליטה לפי נושא' }),
          el('div', { class: 'en-mastery' }, W.TOPICS.map(tp => {
            const m = st.mastery[tp.id];
            return el('div', { class: 'en-mastery-row' },
              el('span', { class: 'en-mastery-name', text: tp.he }),
              bar(m.pct),
              el('span', { class: 'en-mastery-num', text: m.learned + '/' + m.total }));
          }))
        )
      ),
      el('div', { class: 'en-grid-2' },
        el('div', { class: 'ss-card' },
          el('div', { class: 'en-row en-between' },
            el('h3', { class: 'ss-section-title', text: 'מילים קשות' }),
            hard.length ? el('button', { type: 'button', class: 'ss-btn-secondary ss-btn-sm', onClick: () => { show('cards'); startSession(hard.map(h => h.word)); } }, 'לתרגל אותן') : null),
          hard.length
            ? el('table', { class: 'ss-table' }, el('thead', {}, el('tr', {}, el('th', { text: 'מילה' }), el('th', { text: 'תרגום' }), el('th', { text: 'טעויות' }))),
              el('tbody', {}, hard.map(h => el('tr', {}, el('td', {}, en(h.word.en, 'en-strong')), el('td', { text: h.word.he }), el('td', {}, el('span', { class: 'ss-badge ss-badge-danger', text: String(h.wrong) }))))))
            : el('div', { class: 'ss-empty', text: 'אין עדיין מילים קשות — מצוין!' })
        ),
        el('div', { class: 'ss-card' },
          el('h3', { class: 'ss-section-title', text: 'שיעורי דקדוק' }),
          el('div', { class: 'ss-list' }, G.LESSONS.map(l => {
            const r = progress.grammar[l.id];
            return el('div', { class: 'ss-list-row' }, el('span', { class: 'ss-grow', text: l.title }),
              r ? el('span', { class: 'ss-badge ' + (r.best === r.total ? 'ss-badge-success' : 'ss-badge-warning'), text: r.best + '/' + r.total }) : el('span', { class: 'ss-badge', text: 'טרם' }));
          }))
        )
      )
    );
  }

  // ---------- הגדרות ----------
  // onSave מחזיר true רק אחרי שמירה מוצלחת; ערך לא חוקי חוזר לערך השמור האחרון
  function numberField(id, label, value, min, max, onSave) {
    let last = value;
    const input = el('input', { class: 'ss-input', type: 'number', id, min, max, value: String(value),
      onChange: e => {
        const n = Math.round(Number(e.target.value));
        if (!Number.isFinite(n) || n < min || n > max) { toast('ערך בין ' + min + ' ל-' + max); e.target.value = String(last); return; }
        if (onSave(n)) { last = n; toast('נשמר'); }
      } });
    return field(label, input);
  }
  function renderSettings(root) {
    const newName = el('input', { class: 'ss-input', id: 'newLearner', maxlength: 30, 'aria-label': 'שם לומד חדש', placeholder: 'שם לומד חדש' });
    const addBtn = el('button', { type: 'button', class: 'ss-btn-primary', onClick: () => { if (addLearnerNamed(newName.value)) newName.value = ''; } }, 'הוספה');
    newName.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
    root.replaceChildren(
      el('div', { class: 'en-grid-2' },
        el('div', { class: 'ss-card' },
          el('h3', { class: 'ss-section-title', text: 'לומדים' }),
          el('p', { class: 'ss-hint', text: 'לכל לומד התקדמות נפרדת. מחליפים לומד מהרשימה שבראש המסך.' }),
          el('div', { class: 'ss-list' }, learners.list.map(l => el('div', { class: 'ss-list-row' },
            el('span', { class: 'ss-grow' }, el('b', { text: l.name }), l.id === learners.active ? el('span', { class: 'ss-badge ss-badge-success en-ms', text: 'פעיל' }) : null),
            l.id !== learners.active ? el('button', { type: 'button', class: 'ss-btn ss-btn-sm', onClick: () => switchLearner(l.id) }, 'בחירה') : null,
            el('button', { type: 'button', class: 'ss-btn ss-btn-sm', onClick: () => renameLearner(l) }, 'שינוי שם'),
            el('button', { type: 'button', class: 'ss-btn-ghost ss-btn-sm en-danger-txt', onClick: () => deleteLearner(l) }, 'מחיקה')))),
          el('div', { class: 'en-row en-add' }, newName, addBtn)
        ),
        el('div', { class: 'ss-card' },
          el('h3', { class: 'ss-section-title', text: 'לימוד' }),
          el('div', { class: 'en-form' },
            numberField('setGoal', 'מטרה יומית (תשובות)', settings.dailyGoal, 5, 200, n => changeSettings(s => { s.dailyGoal = n; })),
            numberField('setNew', 'מילים חדשות ביום', settings.newPerDay, 0, 50, n => changeSettings(s => { s.newPerDay = n; })),
            field('כיוון הכרטיסיות', select('setDir', 'כיוון הכרטיסיות', [['en-he', 'אנגלית ← עברית'], ['he-en', 'עברית ← אנגלית']], settings.cardDir, v => { changeSettings(s => { s.cardDir = v; }, 'נשמר'); }))
          ),
          el('label', { class: 'ss-check en-needs-voice en-mt' },
            el('input', { type: 'checkbox', id: 'setSpeak', checked: settings.autoSpeak, onChange: e => { const v = e.target.checked; changeSettings(s => { s.autoSpeak = v; }); } }),
            'השמעה אוטומטית של המילה בכרטיסיות'),
          el('p', { class: 'ss-hint en-voice-note', text: voiceNote() })
        )
      ),
      el('div', { class: 'ss-card ss-card-warning' },
        el('h3', { class: 'ss-section-title', text: 'איפוס התקדמות' }),
        el('p', { class: 'ss-hint', text: 'מוחק את כל ההתקדמות של ' + (activeLearner() ? activeLearner().name : '') + ': כרטיסיות, בחנים, רצף ודקדוק. הלומד עצמו נשאר.' }),
        el('button', { type: 'button', class: 'ss-btn-danger', id: 'resetProgress', onClick: resetProgress }, 'איפוס ההתקדמות')
      )
    );
  }
  async function resetProgress() {
    const l = activeLearner();
    if (!l) return;
    if (!(await adultCheck('איפוס כל ההתקדמות של ' + l.name))) return;
    if (activeLearner() !== l) return;
    const prev = progress;
    const fresh = L.emptyProgress();
    if (!Store.set('progress:' + l.id, fresh)) return;
    progress = fresh;
    resetSessions();
    render();
    // 10 שניות לביטול — ההתקדמות הקודמת חוזרת (אם הלומד עדיין קיים)
    toast('ההתקדמות של ' + l.name + ' אופסה', () => {
      if (!learners.list.some(x => x.id === l.id) || !Store.set('progress:' + l.id, prev)) return;
      if (learners.active === l.id) { progress = prev; resetSessions(); render(); }
      toast('ההתקדמות חזרה');
    });
  }

  // ---------- מקלדת ----------
  document.addEventListener('keydown', e => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (document.querySelector('.ss-dlg')) return; // חלון ssDialog פתוח
    if (current === 'cards' && session && session.i < session.items.length) {
      // רווח / Enter הופכים רק כשהמיקוד על הכרטיס או על העמוד — כפתור אחר (סיום, השמעה, ידעתי) פועל כרגיל
      const ae = document.activeElement;
      const onCard = !ae || ae === document.body || ae === document.documentElement || !!(ae.closest && ae.closest('.en-flash'));
      if (onCard && (e.key === ' ' || (e.key === 'Enter' && !session.flipped))) { e.preventDefault(); flip(); }
      // Enter על כרטיס הפוך לא עושה כלום — בלי זה הלחיצה הרגילה של הכפתור הייתה הופכת אותו בחזרה
      else if (onCard && e.key === 'Enter') e.preventDefault();
      else if (session.flipped && e.key === '1') answerCard(false);
      else if (session.flipped && e.key === '2') answerCard(true);
    } else if (current === 'quiz' && quiz && quiz.i < quiz.qs.length) {
      const q = quiz.qs[quiz.i];
      if (q.kind === 'choice' && !quiz.answered && /^[1-4]$/.test(e.key)) {
        const b = document.querySelector('.en-option[data-idx="' + (Number(e.key) - 1) + '"]');
        if (b) b.click();
      } else if (quiz.answered && e.key === 'Enter' && tag !== 'BUTTON') { e.preventDefault(); nextQuestion(); }
    }
  });

  // ---------- אתחול ----------
  $('tabs').addEventListener('click', e => { const b = e.target.closest('.ss-tab'); if (b) show(b.dataset.tab); });
  $('tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = VIEWS.indexOf(current);
    const n = e.key === 'Home' ? VIEWS[0] : e.key === 'End' ? VIEWS[VIEWS.length - 1]
      : VIEWS[(i + (e.key === 'ArrowLeft' ? 1 : -1) + VIEWS.length) % VIEWS.length]; // RTL: שמאלה = הבא
    show(n);
    const b = document.querySelector('#tabs .ss-tab[data-tab="' + n + '"]');
    if (b) b.focus();
  });
  $('learnerSel').addEventListener('change', e => switchLearner(e.target.value));
  $('learnerAdd').addEventListener('click', addLearner);
  $('welcomeGo').addEventListener('click', () => addLearnerNamed($('welcomeName').value));
  $('welcomeName').addEventListener('keydown', e => { if (e.key === 'Enter') addLearnerNamed(e.target.value); });

  // ---------- קישור ישיר לפעולה (מהמעטפת) ----------
  // #ss-action=<id> — רק מהרשימה הסגורה, אחרת מתעלמים; ה-hash נמחק. הפעולה רק פותחת מסך (לא שומרת נתונים)
  const ACTIONS = {
    // לימוד יומי: הכרטיסיות של היום; אין כרטיסים להיום — מסך הבית; אין לומד — מסך הפתיחה
    'practice-today': () => {
      if (!learners.active) { const w = $('welcomeName'); if (w) w.focus(); return; }
      const q = queueInfo();
      if (q.due.length + q.fresh.length) { show('cards'); startSession(); } else show('home');
    }
  };
  // רשימה סגורה: Map (לא גישה דינמית לאובייקט לפי שם שמגיע מהכתובת)
  const ACTION_MAP = new Map(Object.entries(ACTIONS));
  function takeAction() {
    const loc = window.location;
    const m = loc && /^#ss-action=([a-z0-9-]{1,40})(?:&|$)/.exec(String(loc.hash || ''));
    if (!m) return;
    try { window.history.replaceState(null, '', loc.pathname + loc.search); } catch (e) { /* בלי היסטוריה */ }
    const fn = ACTION_MAP.get(m[1]);
    if (typeof fn === 'function') fn();
  }
  if (typeof window.addEventListener === 'function') window.addEventListener('hashchange', takeAction);

  loadProgress();
  renderLearnerBox();
  Speech.init();
  HeSpeech.init();
  render();
  if (!learners.list.length) setTimeout(() => $('welcomeName').focus(), 0);
  takeAction();
})();
