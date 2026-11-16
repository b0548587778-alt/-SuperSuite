// ניהול מוסד חינוכי (ת"ת / בית ספר / סמינר / כולל / ישיבה) — לוגיקה טהורה, בלי DOM.
// נבדקת ב-tests/school-logic.test.js. כסף — תמיד שלמי אגורות.
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 2;
  // אחסון (סקירה 11.2026, f4/f30): המחסן מגביל כל פריט ל-5M תווים, ולכן הנתונים מפוצלים למפתחות —
  // school:core (הגדרות, שנים, כיתות, תלמידים, תוכניות ומונה הקבלות paySeq), school:pay:<שנה> (תשלומים),
  // school:grades:<שנה> (מבחנים וציונים) ו-school:att:<YYYY-MM> (נוכחות). 'school:data' — המבנה הישן (מפתח אחד),
  // נקרא ומומר אוטומטית. שינוי במבנה המונה — לעדכן גם את shell/module-counters.js
  const STORAGE_KEY = 'school:core';
  const LEGACY_KEY = 'school:data';
  const PAY_PREFIX = 'school:pay:';
  const GRADES_PREFIX = 'school:grades:';
  const ATT_PREFIX = 'school:att:';
  const ITEM_MAX = 5 * 1024 * 1024; // התקרה לפריט במחסן (shell/secure-store.js — MAX_VALUE)
  const SIZE_WARN = 0.7;
  const FIRST_YEAR_ID = 'y1';

  // ---------- סוגי מוסד ותוויות ----------
  const INSTITUTION_TYPES = {
    tt: 'תלמוד תורה',
    school: 'בית ספר',
    seminary: 'סמינר',
    kollel: 'כולל',
    yeshiva: 'ישיבה'
  };
  const DEFAULT_SUBJECTS = ['גמרא', 'משנה', 'חומש', 'נביא', 'דקדוק', 'חשבון', 'כתיבה', 'אנגלית'];
  const DEFAULT_SESSIONS = ['סדר א׳', 'סדר ב׳', 'סדר ג׳'];
  const DEFAULT_TERMS = ['מחצית א׳', 'מחצית ב׳'];

  const ATT_CODES = { P: 'נוכח', A: 'נעדר', L: 'איחור', E: 'מוצדק' };

  // קטגוריות בתוכנית שכר הלימוד. optional = רשות: לא נכנס לפיגור.
  const CATEGORIES = {
    tuition: { label: 'שכר לימוד', mandatory: true, exemptSpecialEd: true },
    registration: { label: 'דמי רישום', mandatory: true, exemptSpecialEd: true, oneTime: true },
    talan: { label: 'תל"ן', mandatory: true, exemptSpecialEd: false },
    optional: { label: 'רשות', mandatory: false, exemptSpecialEd: false }
  };
  const PAY_METHODS = { cash: 'מזומן', check: 'המחאה', transfer: 'העברה בנקאית', standing: 'הוראת קבע' };

  const MAX_AG = 100000000000; // תקרה: מיליארד ש"ח
  // days — בלי תקרה מעשית: הנוכחות מפוצלת לפי חודשים (תקרה נמוכה הייתה מוחקת בשקט חודשים ישנים)
  const LIMITS = { students: 5000, teachers: 500, classes: 300, assessments: 5000, payments: 50000, subjects: 60, days: 20000, years: 60 };
  const LIMIT_TEXT = {
    students: 'אפשר לרשום עד 5,000 תלמידים', teachers: 'אפשר לרשום עד 500 מלמדים', classes: 'אפשר להגדיר עד 300 כיתות',
    assessments: 'אפשר לשמור עד 5,000 מבחנים בשנת לימודים', payments: 'אפשר לרשום עד 50,000 תשלומים בשנת לימודים', years: 'אפשר לשמור עד 60 שנות לימודים'
  };
  // בדיקת מגבלה לפני הוספה (f109): חריגה הייתה נשמרת ונעלמת בשקט בטעינה הבאה (normalizeData קוטע).
  // מבחנים ותשלומים — לכל שנת לימודים בנפרד (PER_YEAR): שנים קודמות לקריאה בלבד, ותקרה כוללת הייתה חוסמת לתמיד
  const PER_YEAR = { assessments: true, payments: true };
  function assertRoom(data, kind, add = 1) {
    const n = kind === 'years' ? data.years.length + 1
      : PER_YEAR[kind] ? data[kind].filter(x => (x.yearId || data.yearId) === data.yearId).length : data[kind].length;
    if (n + add > LIMITS[kind]) throw new Error(LIMIT_TEXT[kind] + ' — הגעתם למגבלה, ולכן הרשומה לא נשמרה.');
  }

  // ---------- עזרי טיפוס ----------
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const arr = v => (Array.isArray(v) ? v : []);
  function str(v, max = 200) {
    if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
    if (typeof v !== 'string') return '';
    return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
  }
  function intIn(v, min, max, dflt) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return dflt;
    const r = Math.round(n);
    return r < min ? min : r > max ? max : r;
  }
  const agOf = v => (Number.isInteger(v) && v >= 0 && v <= MAX_AG ? v : 0);

  // ---------- תאריכים (מקומיים, לא UTC) ----------
  const pad2 = n => String(n).padStart(2, '0');
  function localDay(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  // בדיקה קפדנית: 2026-02-31 נדחה
  function isDay(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  const isMonth = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  function addMonths(month, k) {
    const [y, m] = month.split('-').map(Number);
    const t = y * 12 + (m - 1) + k;
    return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
  }
  function daysInMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function dayOfWeek(day) { // 0 = ראשון
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  function monthDays(month) {
    const out = [];
    for (let d = 1; d <= daysInMonth(month); d++) out.push(`${month}-${pad2(d)}`);
    return out;
  }

  // ---------- תאריך עברי (Intl, בלי טבלה) ----------
  // מספר באותיות: 21 ← כ״א, 5787 ← תשפ״ז (האלפים מושמטים). 15/16 ← ט״ו / ט״ז
  function hebrewNumber(n) {
    n = Math.floor(Number(n)) % 1000;
    if (!(n > 0)) return '';
    const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
    const hundreds = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
    let out = hundreds[Math.floor(n / 100)];
    const r = n % 100;
    if (r === 15) out += 'טו';
    else if (r === 16) out += 'טז';
    else out += tens[Math.floor(r / 10)] + ones[r % 10];
    return out.length === 1 ? out + '׳' : out.slice(0, -1) + '״' + out.slice(-1);
  }
  function hebrewDate(day) {
    if (!isDay(day)) return '';
    try {
      const [y, m, d] = day.split('-').map(Number);
      const parts = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
        .formatToParts(new Date(Date.UTC(y, m - 1, d, 12)));
      const get = t => (parts.find(p => p.type === t) || {}).value || '';
      const dd = Number(get('day')), yy = Number(get('year')), mm = get('month');
      if (!dd || !yy || !mm) return '';
      return `${hebrewNumber(dd)} ${mm} ${hebrewNumber(yy)}`;
    } catch (e) { return ''; }
  }

  // ---------- תעודת זהות (אלגוריתם ספרת הביקורת, עותק מקומי) ----------
  function normalizeId(v) {
    const s = String(v ?? '').trim();
    if (!/^\d{5,9}$/.test(s)) return null;
    return s.padStart(9, '0');
  }
  function isValidIsraeliId(v) {
    const id = normalizeId(v);
    if (!id || /^0+$/.test(id)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let d = Number(id[i]) * (i % 2 === 0 ? 1 : 2);
      if (d > 9) d -= 9;
      sum += d;
    }
    return sum % 10 === 0;
  }
  // ריק — מותר. מחזיר הודעת שגיאה בעברית או null
  function idError(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (!/^\d{5,9}$/.test(s)) return 'מספר הזהות חייב להכיל 5–9 ספרות';
    if (!isValidIsraeliId(s)) return 'מספר הזהות אינו תקין (ספרת ביקורת)';
    return null;
  }

  // ---------- כסף ----------
  // "1,234.50" ← 123450. פסיק — רק מפריד אלפים. קלט לא תקין ← null
  function parseShekels(v) {
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || v < 0) return null;
      v = v.toFixed(2);
    }
    let s = String(v ?? '').replace(/[\s₪]/g, '');
    if (!s) return null;
    if (s.includes(',')) {
      if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return null;
      s = s.replace(/,/g, '');
    }
    const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s);
    if (!m) return null;
    const ag = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
    return Number.isSafeInteger(ag) && ag <= MAX_AG ? ag : null;
  }
  function fmtMoney(ag) {
    const n = Number.isInteger(ag) ? ag : 0;
    const neg = n < 0;
    const a = Math.abs(n);
    const whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${neg ? '-' : ''}₪${whole}.${pad2(a % 100)}`;
  }
  // אחוז בנקודות בסיס (10000 = 100%) מסכום באגורות, בעיגול אחד
  const pctOf = (ag, bp) => Math.round((ag * bp) / 10000);

  // ---------- מזהים ----------
  let idCounter = 0;
  function newId(prefix = 'r') {
    idCounter = (idCounter + 1) % 1e6;
    return prefix + Date.now().toString(36) + idCounter.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  // ---------- מצב ריק ----------
  function emptyData() {
    return {
      v: SCHEMA_VERSION,
      settings: {
        name: '', type: 'tt', year: '', subjects: DEFAULT_SUBJECTS.slice(), terms: DEFAULT_TERMS.slice(),
        sessions: DEFAULT_SESSIONS.slice(0, 2), showRanking: false, lowAttendancePct: 85,
        kollelMinPct: 90, kollelMinPresent: 15, defaultInstallments: 10, yearStartMonth: ''
      },
      // yearId — שנת הלימודים הנוכחית (שמה ב-settings.year, חודש הפתיחה ב-settings.yearStartMonth);
      // years — שנים קודמות שנסגרו ב"פתיחת שנת לימודים" (שם, חודש פתיחה, תוכניות ויתרות שעברו אליהן)
      yearId: FIRST_YEAR_ID, years: [],
      teachers: [], classes: [], students: [], attendance: {}, assessments: [], plans: {}, carry: {}, payments: [], paySeq: 0
    };
  }

  // ---------- נרמול קלט לא מהימן (localStorage / גיבוי) ----------
  const safeKey = k => typeof k === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
  const uniqStrings = (a, max, len) => [...new Set(arr(a).map(x => str(x, len)).filter(Boolean))].slice(0, max);

  function normSettings(s) {
    const d = emptyData().settings;
    if (!isObj(s)) return d;
    const subjects = uniqStrings(s.subjects, LIMITS.subjects, 40);
    const terms = uniqStrings(s.terms, 6, 30);
    const sessions = uniqStrings(s.sessions, 5, 30);
    return {
      name: str(s.name, 120),
      type: Object.prototype.hasOwnProperty.call(INSTITUTION_TYPES, s.type) ? s.type : d.type,
      year: str(s.year, 30),
      subjects: Array.isArray(s.subjects) ? subjects : d.subjects,
      terms: terms.length ? terms : d.terms,
      sessions: sessions.length ? sessions : d.sessions,
      showRanking: s.showRanking === true,
      lowAttendancePct: intIn(s.lowAttendancePct, 1, 100, d.lowAttendancePct),
      kollelMinPct: intIn(s.kollelMinPct, 1, 100, d.kollelMinPct),
      kollelMinPresent: intIn(s.kollelMinPresent, 0, 500, d.kollelMinPresent),
      defaultInstallments: intIn(s.defaultInstallments, 1, 24, d.defaultInstallments),
      yearStartMonth: isMonth(s.yearStartMonth) ? s.yearStartMonth : ''
    };
  }
  function normTeacher(t) {
    if (!isObj(t) || !safeKey(t.id)) return null;
    const name = str(t.name, 80);
    if (!name) return null;
    return { id: t.id, name, role: str(t.role, 40), phone: str(t.phone, 30), notes: str(t.notes, 500), demo: t.demo === true };
  }
  function normClass(c) {
    if (!isObj(c) || !safeKey(c.id)) return null;
    const name = str(c.name, 60);
    if (!name) return null;
    return { id: c.id, name, grade: str(c.grade, 30), teacherId: safeKey(c.teacherId) ? c.teacherId : '', demo: c.demo === true };
  }
  function normStudent(s) {
    if (!isObj(s) || !safeKey(s.id)) return null;
    const first = str(s.first, 50), last = str(s.last, 50);
    if (!first && !last) return null;
    return {
      id: s.id, first, last,
      idNum: /^\d{5,9}$/.test(str(s.idNum, 9)) ? str(s.idNum, 9) : '',
      birth: isDay(s.birth) ? s.birth : '',
      classId: safeKey(s.classId) ? s.classId : '',
      father: str(s.father, 80), mother: str(s.mother, 80),
      phone1: str(s.phone1, 30), phone2: str(s.phone2, 30),
      address: str(s.address, 160), notes: str(s.notes, 1000),
      specialEd: s.specialEd === true,
      status: s.status === 'left' ? 'left' : 'active',
      joined: isDay(s.joined) ? s.joined : '',
      leftOn: s.status === 'left' && isDay(s.leftOn) ? s.leftOn : '',
      demo: s.demo === true
    };
  }
  function normAttendance(a) {
    const out = {};
    if (!isObj(a)) return out;
    const days = Object.keys(a).filter(isDay).sort().slice(-LIMITS.days);
    for (const day of days) {
      const slots = a[day];
      if (!isObj(slots)) continue;
      const o = {};
      for (const slot of Object.keys(slots)) {
        if (!/^(day|s[0-4])$/.test(slot) || !isObj(slots[slot])) continue;
        const m = {};
        for (const sid of Object.keys(slots[slot])) {
          const code = slots[slot][sid];
          if (safeKey(sid) && Object.prototype.hasOwnProperty.call(ATT_CODES, code)) m[sid] = code;
        }
        if (Object.keys(m).length) o[slot] = m;
      }
      if (Object.keys(o).length) out[day] = o;
    }
    return out;
  }
  function normAssessment(x) {
    if (!isObj(x) || !safeKey(x.id)) return null;
    const title = str(x.title, 80);
    const subject = str(x.subject, 40);
    if (!title || !subject) return null;
    const max = intIn(x.max, 1, 1000, 100);
    const scores = {};
    if (isObj(x.scores)) {
      for (const sid of Object.keys(x.scores)) {
        const v = x.scores[sid];
        if (safeKey(sid) && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max) scores[sid] = Math.round(v * 10) / 10;
      }
    }
    return {
      id: x.id, title, subject, classId: safeKey(x.classId) ? x.classId : '',
      term: str(x.term, 30), date: isDay(x.date) ? x.date : '',
      weight: intIn(x.weight, 1, 100, 1), max, scores, demo: x.demo === true, yearId: safeKey(x.yearId) ? x.yearId : ''
    };
  }
  function normPlan(p) {
    if (!isObj(p)) return null;
    const items = arr(p.items).slice(0, 20).map(it => isObj(it) && CATEGORIES[it.category] && Number.isInteger(it.amountAg) && it.amountAg >= 0
      ? { category: it.category, label: str(it.label, 60), amountAg: agOf(it.amountAg) } : null).filter(Boolean);
    const discounts = arr(p.discounts).slice(0, 10).map(d => {
      if (!isObj(d)) return null;
      const label = str(d.label, 60) || 'הנחה';
      if (Number.isInteger(d.pctBp) && d.pctBp > 0 && d.pctBp <= 10000) return { label, pctBp: d.pctBp };
      if (Number.isInteger(d.amountAg) && d.amountAg > 0 && d.amountAg <= MAX_AG) return { label, amountAg: d.amountAg };
      return null;
    }).filter(Boolean);
    return {
      items, discounts,
      installments: intIn(p.installments, 1, 24, 10),
      startMonth: isMonth(p.startMonth) ? p.startMonth : '',
      exemptOverride: p.exemptOverride === false ? false : null,
      note: str(p.note, 300)
    };
  }
  function normPayment(p) {
    if (!isObj(p) || !safeKey(p.id) || !safeKey(p.sid)) return null;
    const amountAg = agOf(p.amountAg);
    const no = intIn(p.no, 1, 1e9, 0);
    if (!amountAg || !no || !isDay(p.date)) return null;
    return {
      id: p.id, no, sid: p.sid, date: p.date, amountAg,
      method: PAY_METHODS[p.method] ? p.method : 'cash',
      ref: str(p.ref, 60), payer: str(p.payer, 80), note: str(p.note, 200),
      cancelled: p.cancelled === true, cancelReason: str(p.cancelReason, 200),
      cancelledAt: p.cancelled === true ? str(p.cancelledAt, 20) : '', cancelledBy: p.cancelled === true ? str(p.cancelledBy, 80) : '',
      demo: p.demo === true, yearId: safeKey(p.yearId) ? p.yearId : ''
    };
  }
  const isAg = v => Number.isInteger(v) && Math.abs(v) <= MAX_AG;
  function normPlans(o) {
    const plans = {};
    if (isObj(o)) for (const sid of Object.keys(o)) {
      if (!safeKey(sid)) continue;
      const p = normPlan(o[sid]);
      if (p) plans[sid] = p;
    }
    return plans;
  }
  // יתרה שעברה משנה קודמת: חיובי = חוב, שלילי = זכות
  function normCarry(o) {
    const out = {};
    if (isObj(o)) for (const sid of Object.keys(o)) if (safeKey(sid) && isAg(o[sid]) && o[sid] !== 0) out[sid] = o[sid];
    return out;
  }
  function normYear(y) {
    if (!isObj(y) || !safeKey(y.id)) return null;
    return { id: y.id, name: str(y.name, 30) || 'שנה קודמת', startMonth: isMonth(y.startMonth) ? y.startMonth : '', plans: normPlans(y.plans), carry: normCarry(y.carry) };
  }
  const listOf = (a, fn, max) => {
    const seen = new Set();
    const out = [];
    for (const x of arr(a).slice(0, max)) {
      const n = fn(x);
      if (n && !seen.has(n.id)) { seen.add(n.id); out.push(n); }
    }
    return out;
  };

  function capPerYear(list, max) {
    const n = {};
    return list.filter(x => (n[x.yearId] = (n[x.yearId] || 0) + 1) <= max);
  }

  // לעולם לא זורק: קלט פגום ← מצב ריק / רשומות פגומות מדולגות
  function normalizeData(raw) {
    let d = raw;
    if (typeof raw === 'string') {
      try { d = JSON.parse(raw); } catch (e) { d = null; }
    }
    const base = emptyData();
    if (!isObj(d)) return base;
    try {
      base.settings = normSettings(d.settings);
      base.teachers = listOf(d.teachers, normTeacher, LIMITS.teachers);
      base.classes = listOf(d.classes, normClass, LIMITS.classes);
      base.students = listOf(d.students, normStudent, LIMITS.students);
      base.attendance = normAttendance(d.attendance);
      // מבחנים ותשלומים — התקרה לכל שנה (capPerYear למטה); כאן רק תקרה כוללת לכל השנים
      base.assessments = listOf(d.assessments, normAssessment, LIMITS.assessments * (LIMITS.years + 1));
      base.payments = listOf(d.payments, normPayment, LIMITS.payments * (LIMITS.years + 1));
      base.plans = normPlans(d.plans);
      base.carry = normCarry(d.carry);
      // שנות לימודים: נתונים מהמבנה הישן (בלי שנים) שייכים כולם לשנה הנוכחית
      base.yearId = safeKey(d.yearId) ? d.yearId : FIRST_YEAR_ID;
      base.years = listOf(d.years, normYear, LIMITS.years).filter(y => y.id !== base.yearId);
      const known = new Set([base.yearId, ...base.years.map(y => y.id)]);
      for (const x of base.payments) if (!known.has(x.yearId)) x.yearId = base.yearId;
      for (const x of base.assessments) if (!known.has(x.yearId)) x.yearId = base.yearId;
      base.assessments = capPerYear(base.assessments, LIMITS.assessments);
      base.payments = capPerYear(base.payments, LIMITS.payments);
      // המספור לא חוזר אחורה: לפחות המספר הגבוה ביותר שנרשם
      const maxNo = base.payments.reduce((m, p) => Math.max(m, p.no), 0);
      base.paySeq = Math.max(intIn(d.paySeq, 0, 1e9, 0), maxNo);
      base.demoLoaded = d.demoLoaded === true;
    } catch (e) {
      return emptyData();
    }
    return base;
  }

  // ---------- אחסון מפוצל ----------
  const isDataKey = k => typeof k === 'string' && (k === STORAGE_KEY || k === LEGACY_KEY ||
    ((k.startsWith(PAY_PREFIX) || k.startsWith(GRADES_PREFIX)) && safeKey(k.slice(k.indexOf(':', 7) + 1))) ||
    (k.startsWith(ATT_PREFIX) && isMonth(k.slice(ATT_PREFIX.length))));
  const parseJson = v => { if (typeof v !== 'string') return undefined; try { return JSON.parse(v); } catch (e) { return undefined; } };
  // נתונים (מנורמלים) ← { מפתח: JSON }. מפתח ריק לא נכתב (למשל חודש בלי נוכחות)
  function splitData(data) {
    const out = {};
    const core = {
      v: SCHEMA_VERSION, settings: data.settings, yearId: data.yearId, years: data.years, teachers: data.teachers, classes: data.classes,
      students: data.students, plans: data.plans, carry: data.carry, paySeq: data.paySeq
    };
    if (data.demoLoaded) core.demoLoaded = true;
    out[STORAGE_KEY] = JSON.stringify(core);
    const group = (list, prefix) => {
      const by = {};
      for (const x of list) (by[x.yearId || data.yearId] = by[x.yearId || data.yearId] || []).push(x);
      for (const y of Object.keys(by)) out[prefix + y] = JSON.stringify(by[y]);
    };
    group(data.payments, PAY_PREFIX);
    group(data.assessments, GRADES_PREFIX);
    const months = {};
    for (const day of Object.keys(data.attendance).sort()) (months[day.slice(0, 7)] = months[day.slice(0, 7)] || {})[day] = data.attendance[day];
    for (const m of Object.keys(months)) out[ATT_PREFIX + m] = JSON.stringify(months[m]);
    return out;
  }
  // { מפתח: JSON } ← נתונים מנורמלים. יש 'school:data' (המבנה הישן) — הוא המקור; מונה הקבלות — הגבוה מבין שניהם
  // (שחזור גיבוי ישן מוסיף לידו את school:core עם המונה הנוכחי בלבד — shell/module-counters.js)
  function joinData(items) {
    const it = isObj(items) ? items : {};
    const core = parseJson(it[STORAGE_KEY]);
    const legacy = parseJson(it[LEGACY_KEY]);
    if (isObj(legacy)) {
      const d = normalizeData(legacy);
      if (isObj(core)) d.paySeq = Math.max(d.paySeq, intIn(core.paySeq, 0, 1e9, 0));
      return d;
    }
    const raw = Object.assign({}, isObj(core) ? core : {}, { payments: [], assessments: [], attendance: {} });
    for (const k of Object.keys(it).sort()) {
      if (!isDataKey(k)) continue;
      const v = parseJson(it[k]);
      if (k.startsWith(PAY_PREFIX) || k.startsWith(GRADES_PREFIX)) {
        const y = k.slice(k.indexOf(':', 7) + 1);
        const list = arr(v).map(x => (isObj(x) ? Object.assign({}, x, { yearId: y }) : x));
        (k.startsWith(PAY_PREFIX) ? raw.payments : raw.assessments).push(...list);
      } else if (k.startsWith(ATT_PREFIX) && isObj(v)) {
        const m = k.slice(ATT_PREFIX.length);
        for (const day of Object.keys(v)) if (day.slice(0, 7) === m) raw.attendance[day] = v[day];
      }
    }
    return normalizeData(raw);
  }
  // מפתחות שמתקרבים לתקרה (70%): [{ key, pct, label }]
  function sizeWarnings(items) {
    const out = [];
    for (const k of Object.keys(items || {})) {
      const v = items[k];
      if (typeof v !== 'string' || v.length < ITEM_MAX * SIZE_WARN) continue;
      const label = k === STORAGE_KEY || k === LEGACY_KEY ? 'נתוני התלמידים והכיתות' : k.startsWith(PAY_PREFIX) ? 'התשלומים של שנת הלימודים'
        : k.startsWith(GRADES_PREFIX) ? 'המבחנים והציונים של שנת הלימודים' : 'הנוכחות של החודש';
      out.push({ key: k, pct: Math.min(100, Math.round((v.length / ITEM_MAX) * 100)), label });
    }
    return out.sort((a, b) => b.pct - a.pct);
  }

  // ---------- מינוח לפי סוג המוסד ----------
  function termsFor(type) {
    if (type === 'kollel') return { one: 'אברך', many: 'אברכים', cls: 'חבורה', classes: 'חבורות', teacher: 'ראש חבורה', teachers: 'ראשי חבורות', father: 'שם האשה', mother: 'איש קשר נוסף' };
    if (type === 'seminary') return { one: 'תלמידה', many: 'תלמידות', cls: 'כיתה', classes: 'כיתות', teacher: 'מורה', teachers: 'מורות', father: 'שם האב', mother: 'שם האם' };
    if (type === 'yeshiva') return { one: 'בחור', many: 'בחורים', cls: 'שיעור', classes: 'שיעורים', teacher: 'ר"מ', teachers: 'רמי"ם', father: 'שם האב', mother: 'שם האם' };
    if (type === 'school') return { one: 'תלמיד', many: 'תלמידים', cls: 'כיתה', classes: 'כיתות', teacher: 'מורה', teachers: 'מורים', father: 'שם האב', mother: 'שם האם' };
    return { one: 'תלמיד', many: 'תלמידים', cls: 'כיתה', classes: 'כיתות', teacher: 'מלמד', teachers: 'מלמדים', father: 'שם האב', mother: 'שם האם' };
  }

  // ---------- עזרי רשומות ----------
  const fullName = s => (s ? `${s.first || ''} ${s.last || ''}`.trim() : '');
  const activeStudents = (data, classId) => data.students
    .filter(s => s.status === 'active' && (!classId || s.classId === classId))
    .sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first, 'he'));
  function searchStudents(data, { q = '', classId = '', status = 'active', specialEd = false } = {}) {
    const needle = String(q).trim().toLowerCase();
    return data.students.filter(s =>
      (!status || status === 'all' || s.status === status) &&
      (!classId || s.classId === classId) &&
      (!specialEd || s.specialEd) &&
      (!needle || [s.first, s.last, s.idNum, s.father, s.mother, s.phone1, s.phone2].some(v => String(v || '').toLowerCase().includes(needle)))
    ).sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first, 'he'));
  }

  // ---------- נוכחות ----------
  function slotsFor(settings) {
    return settings.type === 'kollel' ? settings.sessions.map((_, i) => 's' + i) : ['day'];
  }
  function setMark(data, day, slot, sid, code) {
    if (!isDay(day) || !/^(day|s[0-4])$/.test(slot) || !safeKey(sid)) return false;
    const a = data.attendance;
    if (!code) {
      if (a[day] && a[day][slot]) {
        delete a[day][slot][sid];
        if (!Object.keys(a[day][slot]).length) delete a[day][slot];
        if (!Object.keys(a[day]).length) delete a[day];
      }
      return true;
    }
    if (!ATT_CODES[code]) return false;
    if (!a[day]) a[day] = {};
    if (!a[day][slot]) a[day][slot] = {};
    a[day][slot][sid] = code;
    return true;
  }
  function markAll(data, day, slot, sids, code = 'P', { overwrite = false } = {}) {
    let n = 0;
    for (const sid of sids) {
      const cur = data.attendance[day] && data.attendance[day][slot] && data.attendance[day][slot][sid];
      if (cur && !overwrite) continue;
      if (setMark(data, day, slot, sid, code)) n++;
    }
    return n;
  }
  const emptyStats = () => ({ P: 0, A: 0, L: 0, E: 0, total: 0, pct: null });
  // אחוז נוכחות = (נוכח + איחור) / (נוכח + איחור + נעדר). היעדרות מוצדקת לא נספרת.
  function finishStats(s) {
    s.total = s.P + s.A + s.L + s.E;
    const base = s.P + s.L + s.A;
    s.pct = base ? Math.round(((s.P + s.L) * 1000) / base) / 10 : null;
    return s;
  }
  // from / to — ימים כוללניים (YYYY-MM-DD). sids — Set או מערך; בלי = כולם
  function attendanceStats(data, { from = '', to = '', sids = null, slot = '' } = {}) {
    const set = sids ? new Set(sids) : null;
    const st = emptyStats();
    for (const day of Object.keys(data.attendance || {})) {
      if ((from && day < from) || (to && day > to)) continue;
      const slots = data.attendance[day];
      for (const sl of Object.keys(slots)) {
        if (slot && sl !== slot) continue;
        for (const sid of Object.keys(slots[sl])) {
          if (set && !set.has(sid)) continue;
          const c = slots[sl][sid];
          if (st[c] !== undefined) st[c]++;
        }
      }
    }
    return finishStats(st);
  }
  function monthRange(month) { return { from: month + '-01', to: `${month}-${pad2(daysInMonth(month))}` }; }
  function monthSummary(data, month, classId = '') {
    const r = monthRange(month);
    const students = activeStudents(data, classId);
    const rows = students.map(s => ({ student: s, stats: attendanceStats(data, { ...r, sids: [s.id] }) }));
    const cls = attendanceStats(data, { ...r, sids: students.map(s => s.id) });
    return { month, rows, class: cls };
  }
  function lowAttendance(data, month, threshold) {
    const t = threshold ?? (data.settings.type === 'kollel' ? data.settings.kollelMinPct : data.settings.lowAttendancePct);
    return monthSummary(data, month).rows.filter(r => r.stats.pct !== null && r.stats.pct < t)
      .sort((a, b) => a.stats.pct - b.stats.pct);
  }
  // כולל: מספר הנוכחים בכל סדר ביום נתון מול המינימום
  function kollelDayCheck(data, day) {
    const min = data.settings.kollelMinPresent;
    const recs = (data.attendance[day]) || {};
    return data.settings.sessions.map((name, i) => {
      const m = recs['s' + i] || {};
      const present = Object.values(m).filter(c => c === 'P' || c === 'L').length;
      const marked = Object.keys(m).length;
      return { slot: 's' + i, name, present, marked, min, ok: !marked || present >= min };
    });
  }

  // ---------- ציונים ----------
  // ממוצע משוקלל באחוזים (0–100), עשרונית אחת. null כשאין ציון
  function weightedAverage(list) {
    let w = 0, sum = 0;
    for (const x of list) {
      if (!x || typeof x.score !== 'number' || !Number.isFinite(x.score)) continue;
      const max = x.max > 0 ? x.max : 100;
      const weight = x.weight > 0 ? x.weight : 1;
      sum += (x.score / max) * 100 * weight;
      w += weight;
    }
    return w ? Math.round((sum / w) * 10) / 10 : null;
  }
  // כל ציון שרשום לתלמיד נספר, גם ממבחן של כיתה קודמת (f32: תלמיד שעבר כיתה באמצע השנה). yearId — שנת הלימודים
  function studentSubjectAverages(data, sid, term = '', yearId = data.yearId) {
    const out = {};
    for (const a of data.assessments) {
      if (term && a.term !== term) continue;
      if (yearId && (a.yearId || data.yearId) !== yearId) continue;
      if (typeof a.scores[sid] !== 'number') continue;
      (out[a.subject] = out[a.subject] || []).push({ score: a.scores[sid], max: a.max, weight: a.weight, title: a.title });
    }
    const res = {};
    for (const k of Object.keys(out)) res[k] = { average: weightedAverage(out[k]), count: out[k].length, items: out[k] };
    return res;
  }
  function overallAverage(subjAvgs) {
    const vals = Object.values(subjAvgs).map(x => x.average).filter(v => v !== null);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  }
  // דירוג כיתתי — רק כשההגדרה פעילה; שווים מקבלים אותו מקום
  function classRanking(data, classId, term = '', yearId = data.yearId) {
    const rows = activeStudents(data, classId).map(s => ({ student: s, average: overallAverage(studentSubjectAverages(data, s.id, term, yearId)) }))
      .filter(r => r.average !== null).sort((a, b) => b.average - a.average);
    let rank = 0, prev = null;
    rows.forEach((r, i) => { if (r.average !== prev) { rank = i + 1; prev = r.average; } r.rank = rank; });
    return rows;
  }
  function verbalGrade(avg) {
    if (avg === null || avg === undefined) return '';
    if (avg >= 95) return 'מצוין מאוד';
    if (avg >= 85) return 'מצוין';
    if (avg >= 75) return 'טוב מאוד';
    if (avg >= 65) return 'טוב';
    if (avg >= 55) return 'מספיק';
    return 'טעון שיפור';
  }

  // ---------- שכר לימוד ----------
  // חלוקה שווה; השארית בתשלום האחרון. סכום השורות = הסכום הכולל עד האגורה
  function splitEven(totalAg, n) {
    const t = agOf(totalAg);
    const k = Math.max(1, intIn(n, 1, 24, 1));
    const base = Math.floor(t / k);
    const out = new Array(k).fill(base);
    out[k - 1] = t - base * (k - 1);
    return out;
  }
  function isExempt(student, plan) {
    return !!(student && student.specialEd) && !(plan && plan.exemptOverride === false);
  }
  // סיכום התוכנית לתלמיד: ברוטו, פטור, הנחות, נטו (חובה / רשות)
  function planTotals(plan, student) {
    const p = plan || { items: [], discounts: [] };
    const exempt = isExempt(student, p);
    const byCat = { tuition: 0, registration: 0, talan: 0, optional: 0 };
    let gross = 0, exemptAg = 0;
    for (const it of p.items) {
      gross += it.amountAg;
      if (exempt && CATEGORIES[it.category].exemptSpecialEd) exemptAg += it.amountAg;
      else byCat[it.category] += it.amountAg;
    }
    // הנחות ומלגות חלות על שכר הלימוד בלבד: אחוזים מהברוטו ואז סכומים; לא יורדות מתחת לאפס
    let discountAg = 0;
    const tuitionBase = byCat.tuition;
    for (const d of p.discounts) {
      const v = d.pctBp ? pctOf(tuitionBase, d.pctBp) : d.amountAg;
      discountAg += v;
    }
    discountAg = Math.min(discountAg, byCat.tuition);
    byCat.tuition -= discountAg;
    const mandatoryAg = byCat.tuition + byCat.registration + byCat.talan;
    return { gross, exempt, exemptAg, discountAg, byCat, mandatoryAg, optionalAg: byCat.optional, netAg: mandatoryAg + byCat.optional };
  }
  // לוח תשלומים: דמי הרישום בתשלום הראשון, השאר בחלוקה שווה (שארית באחרון), רשות — חלוקה נפרדת
  function installmentSchedule(plan, student, fallbackStart) {
    const p = plan || { items: [], discounts: [], installments: 10 };
    const t = planTotals(p, student);
    const n = Math.max(1, intIn(p.installments, 1, 24, 10));
    const start = isMonth(p.startMonth) ? p.startMonth : (isMonth(fallbackStart) ? fallbackStart : localDay().slice(0, 7));
    const spread = splitEven(t.byCat.tuition + t.byCat.talan, n);
    const opt = splitEven(t.optionalAg, n);
    const rows = spread.map((m, i) => {
      const mandatoryAg = m + (i === 0 ? t.byCat.registration : 0);
      return { no: i + 1, month: addMonths(start, i), mandatoryAg, optionalAg: opt[i], amountAg: mandatoryAg + opt[i] };
    });
    return { rows, totals: t };
  }
  // שנת לימודים (f5): הנוכחית — מההגדרות ומ-data.plans / data.carry; קודמת — מ-data.years
  function yearInfo(data, yearId) {
    if (!yearId || yearId === data.yearId) {
      return { id: data.yearId, name: data.settings.year, startMonth: data.settings.yearStartMonth, plans: data.plans, carry: data.carry, current: true };
    }
    const y = data.years.find(x => x.id === yearId);
    return y ? Object.assign({ current: false }, y) : null;
  }
  // הנוכחית ראשונה, ואחריה הקודמות מהחדשה לישנה
  function yearsList(data) {
    return [yearInfo(data, data.yearId), ...data.years.slice().reverse().map(y => yearInfo(data, y.id))];
  }
  const paidFor = (data, sid, yearId = data.yearId) => data.payments
    .filter(p => p.sid === sid && !p.cancelled && (p.yearId || data.yearId) === yearId).reduce((a, p) => a + p.amountAg, 0);
  // תלמיד שעזב (f33): החיוב נעצר בחודש העזיבה. בלי תאריך עזיבה (נתונים מלפני השדה) אין לנו מתי הוא עזב —
  // החיוב לפי כל הלוח, כמו קודם (ניחוש היה מוחק חוב אמיתי), והמסך מבקש להזין את תאריך העזיבה
  function stopMonth(data, st) {
    if (!st || st.status !== 'left' || !st.leftOn) return '';
    return st.leftOn.slice(0, 7);
  }
  // מצב חשבון לשנה: יתרה = חיוב + יתרה משנה קודמת − שולם (שלילי = זכות). פיגור — רק על חלק החובה שמועדו עבר
  function studentBalance(data, sid, today = localDay(), yearId = data.yearId) {
    const y = yearInfo(data, yearId) || yearInfo(data, data.yearId);
    const st = data.students.find(s => s.id === sid);
    const plan = y.plans[sid];
    const carryAg = y.carry[sid] || 0;
    const sch = installmentSchedule(plan, st, y.startMonth);
    const stop = stopMonth(data, st);
    const schedule = stop ? sch.rows.filter(r => r.month <= stop) : sch.rows;
    const chargeAg = plan ? schedule.reduce((a, r) => a + r.amountAg, 0) : 0;
    const paidAg = paidFor(data, sid, y.id);
    const month = today.slice(0, 7);
    const dueMandatory = plan ? schedule.filter(r => r.month <= month).reduce((a, r) => a + r.mandatoryAg, 0) : 0;
    const arrearsAg = Math.max(0, dueMandatory + carryAg - paidAg);
    return {
      hasPlan: !!plan || carryAg !== 0, plan: !!plan, schedule, totals: sch.totals, chargeAg, carryAg, paidAg, yearId: y.id,
      left: !!stop, leftNoDate: !!st && st.status === 'left' && !stop, stopMonth: stop, mandatoryChargeAg: plan ? schedule.reduce((a, r) => a + r.mandatoryAg, 0) : 0, balanceAg: chargeAg + carryAg - paidAg, dueMandatoryAg: dueMandatory, arrearsAg
    };
  }
  function debtors(data, today = localDay(), yearId = data.yearId) {
    const y = yearInfo(data, yearId) || yearInfo(data, data.yearId);
    return data.students.filter(s => y.plans[s.id] || y.carry[s.id])
      .map(s => ({ student: s, ...studentBalance(data, s.id, today, y.id) }))
      .filter(r => r.arrearsAg > 0)
      .sort((a, b) => b.arrearsAg - a.arrearsAg);
  }
  function tuitionSummary(data, today = localDay(), yearId = data.yearId) {
    const y = yearInfo(data, yearId) || yearInfo(data, data.yearId);
    let planned = 0, paid = 0, arrears = 0, open = 0, carry = 0;
    for (const s of data.students) {
      if (!y.plans[s.id] && !y.carry[s.id]) continue;
      const b = studentBalance(data, s.id, today, y.id);
      planned += b.chargeAg; carry += b.carryAg; paid += b.paidAg; arrears += b.arrearsAg; open += Math.max(0, b.balanceAg);
    }
    return { plannedAg: planned, carryAg: carry, paidAg: paid, arrearsAg: arrears, openAg: open };
  }
  // פתיחת שנת לימודים: התוכניות והיתרות של השנה הנוכחית נשמרות בשנים הקודמות (לצפייה), ולכל תלמיד
  // שנשארה לו יתרה (חוב או זכות) נרשמת בשנה החדשה שורה מפורשת "יתרה משנה קודמת". התשלומים והמבחנים
  // נשארים בשנה שבה נרשמו; מספרי האישורים ממשיכים ברצף
  function openNewYear(data, { name, startMonth } = {}) {
    const nm = str(name, 30);
    if (!nm) throw new Error('יש להזין את שם שנת הלימודים החדשה');
    if (!isMonth(startMonth)) throw new Error('חודש הפתיחה של השנה החדשה אינו תקין');
    if (nm === data.settings.year) throw new Error('שם השנה החדשה זהה לשם השנה הנוכחית');
    if (data.settings.yearStartMonth && startMonth <= data.settings.yearStartMonth) throw new Error('חודש הפתיחה של השנה החדשה חייב להיות אחרי חודש הפתיחה של השנה הנוכחית');
    assertRoom(data, 'years');
    // עוברת יתרה של חובה בלבד (f5): בשנה החדשה היתרה נספרת בפיגור, ופריט רשות שלא שולם (הסעה וכו') אינו
    // חוב חובה. התשלומים מכסים קודם את החובה (כמו arrearsAg). זכות (שולם יותר מהחיוב כולו) עוברת כמו שהיא.
    // החוב על פריטי רשות נשאר בשנה הקודמת, שאפשר לצפות בה
    const carry = {};
    for (const s of data.students) {
      const b = studentBalance(data, s.id, '9999-12-31');
      const v = b.balanceAg < 0 ? b.balanceAg : Math.min(b.balanceAg, Math.max(0, b.mandatoryChargeAg + b.carryAg - b.paidAg));
      if (v) carry[s.id] = v;
    }
    data.years.push({ id: data.yearId, name: data.settings.year || 'שנה קודמת', startMonth: data.settings.yearStartMonth, plans: data.plans, carry: data.carry });
    data.yearId = newId('y');
    data.settings.year = nm;
    data.settings.yearStartMonth = startMonth;
    data.plans = {};
    data.carry = carry;
    return { carried: Object.keys(carry).length };
  }
  // בדיקת דמי רישום (לבדיקה מול הנחיות משרד החינוך — אינה פסיקה): עד הנמוך מבין 5% משכר הלימוד ו-150 ₪
  function registrationWarning(plan) {
    if (!plan) return null;
    const reg = plan.items.filter(i => i.category === 'registration').reduce((a, i) => a + i.amountAg, 0);
    if (!reg) return null;
    const tuition = plan.items.filter(i => i.category === 'tuition').reduce((a, i) => a + i.amountAg, 0);
    const cap = Math.min(15000, pctOf(tuition, 500));
    return reg > cap ? `דמי הרישום (${fmtMoney(reg)}) גבוהים מהנמוך מבין 5% משכר הלימוד ו-150 ₪ (${fmtMoney(cap)}) — לבדיקה` : null;
  }
  function nextPaymentNo(data) {
    const maxNo = data.payments.reduce((m, p) => Math.max(m, p.no), 0);
    return Math.max(data.paySeq || 0, maxNo) + 1;
  }
  // רישום תשלום: מספר רץ שלא חוזר (גם אחרי ביטול). מחזיר את הרשומה או זורק שגיאה בעברית
  function addPayment(data, { sid, amountAg, date, method = 'cash', ref = '', payer = '', note = '' }) {
    if (!data.students.some(s => s.id === sid)) throw new Error('תלמיד לא נמצא');
    if (!Number.isInteger(amountAg) || amountAg <= 0 || amountAg > MAX_AG) throw new Error('סכום לא תקין');
    if (!isDay(date)) throw new Error('תאריך לא תקין');
    if (!PAY_METHODS[method]) throw new Error('אמצעי תשלום לא מוכר');
    assertRoom(data, 'payments');
    const no = nextPaymentNo(data);
    const rec = { id: newId('p'), no, sid, date, amountAg, method, ref: str(ref, 60), payer: str(payer, 80), note: str(note, 200), cancelled: false, cancelReason: '', cancelledAt: '', cancelledBy: '', demo: false, yearId: data.yearId };
    data.payments.push(rec);
    data.paySeq = no;
    return rec;
  }
  // f108: נרשם גם מתי ומי ביטל
  function cancelPayment(data, id, reason = '', { at = '', by = '' } = {}) {
    const p = data.payments.find(x => x.id === id);
    if (!p || p.cancelled) return false;
    p.cancelled = true;
    p.cancelReason = str(reason, 200);
    p.cancelledAt = str(at, 20);
    p.cancelledBy = str(by, 80);
    return true;
  }
  // מחיקת כיתה (f32): התלמידים נשארים בלי כיתה, והמבחנים שלה (עם הציונים) נמחקים — לא נשארים יתומים ונסתרים
  function deleteClass(data, classId) {
    const n = { students: data.students.filter(s => s.classId === classId).length, assessments: data.assessments.filter(a => a.classId === classId).length };
    data.classes = data.classes.filter(c => c.id !== classId);
    data.students.forEach(s => { if (s.classId === classId) s.classId = ''; });
    data.assessments = data.assessments.filter(a => a.classId !== classId);
    return n;
  }

  // ---------- ימי הולדת קרובים (לוח לועזי) ----------
  function upcomingBirthdays(data, today = localDay(), days = 14) {
    const [ty, tm, td] = today.split('-').map(Number);
    const t0 = Date.UTC(ty, tm - 1, td);
    const out = [];
    for (const s of data.students) {
      if (s.status !== 'active' || !s.birth) continue;
      const [by, bm, bd] = s.birth.split('-').map(Number);
      for (const y of [ty, ty + 1]) {
        // 29.2 בשנה פשוטה ← 28.2
        const dd = bm === 2 && bd === 29 && new Date(Date.UTC(y, 1, 29)).getUTCMonth() !== 1 ? 28 : bd;
        const t = Date.UTC(y, bm - 1, dd);
        const diff = Math.round((t - t0) / 86400000);
        if (diff >= 0 && diff <= days) { out.push({ student: s, inDays: diff, date: `${y}-${pad2(bm)}-${pad2(dd)}`, age: y - by }); break; }
      }
    }
    return out.sort((a, b) => a.inDays - b.inDays);
  }

  // ---------- CSV ----------
  // הגנת נוסחאות: תא שמתחיל ב- = + - @ (או טאב/CR) מקבל גרש; מספר שלילי פשוט נשאר
  function csvCell(v) {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  // עם BOM — כדי שאקסל יזהה UTF-8 בעברית
  function toCsv(header, rows) {
    return '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  const agToPlain = ag => `${ag < 0 ? '-' : ''}${Math.floor(Math.abs(ag) / 100)}.${pad2(Math.abs(ag) % 100)}`;
  function className(data, id) { const c = data.classes.find(x => x.id === id); return c ? c.name : ''; }
  // הכותרות לפי סוג המוסד, כמו בטופס (f110: בכולל father הוא שם האשה)
  function studentsCsv(data) {
    const T = termsFor(data.settings.type);
    return toCsv(['שם משפחה', 'שם פרטי', 'ת"ז', 'תאריך לידה', T.cls, T.father, T.mother, 'טלפון 1', 'טלפון 2', 'כתובת', 'חינוך מיוחד', 'מצב', 'הערות'],
      data.students.map(s => [s.last, s.first, s.idNum, s.birth, className(data, s.classId), s.father, s.mother, s.phone1, s.phone2, s.address, s.specialEd ? 'כן' : '', s.status === 'left' ? 'עזב' : 'פעיל', s.notes]));
  }
  function attendanceCsv(data, month) {
    const sum = monthSummary(data, month);
    return toCsv(['חודש', 'שם', termsFor(data.settings.type).cls, 'נוכח', 'איחור', 'נעדר', 'מוצדק', 'אחוז נוכחות'],
      sum.rows.map(r => [month, fullName(r.student), className(data, r.student.classId), r.stats.P, r.stats.L, r.stats.A, r.stats.E, r.stats.pct === null ? '' : r.stats.pct]));
  }
  function debtsCsv(data, today = localDay(), yearId = data.yearId) {
    return toCsv(['שם', termsFor(data.settings.type).cls, 'הורים', 'טלפון', 'סה"כ לשנה', 'שולם', 'יתרה', 'פיגור'],
      debtors(data, today, yearId).map(r => [fullName(r.student), className(data, r.student.classId), [r.student.father, r.student.mother].filter(Boolean).join(' / '), r.student.phone1,
        agToPlain(r.chargeAg + r.carryAg), agToPlain(r.paidAg), agToPlain(r.balanceAg), agToPlain(r.arrearsAg)]));
  }

  // ---------- נתוני דוגמה (רק בלחיצה; כל רשומה מסומנת demo) ----------
  function loadDemo(data, today = localDay()) {
    if (data.students.some(s => s.demo)) return false;
    // נתוני הדוגמה תופסים מספרי אישור תשלום — במוסד שכבר רשם תשלומים זה היה יוצר חור ברצף (f34)
    if (data.payments.some(p => !p.demo)) throw new Error('אי אפשר לטעון נתוני דוגמה אחרי שנרשמו תשלומים — הדוגמה הייתה תופסת מספרי אישור ברצף.');
    assertRoom(data, 'students', 12);
    assertRoom(data, 'classes', 3);
    assertRoom(data, 'teachers', 3);
    const kollel = data.settings.type === 'kollel';
    const role = kollel ? 'ראש חבורה' : data.settings.type === 'school' ? 'מורה' : 'מלמד';
    const T = [['הרב משה כהן', role], ['הרב יעקב לוי', role], ['הרב אהרן פרידמן', role]].map(([name, r]) => ({ id: newId('t'), name, role: r, phone: '', notes: '', demo: true }));
    const C = (kollel ? [['חבורה א׳', '', 0], ['חבורה ב׳', '', 1], ['חבורה ג׳', '', 2]] : [['כיתה א׳', 'א׳', 0], ['כיתה ב׳', 'ב׳', 1], ['כיתה ג׳', 'ג׳', 2]])
      .map(([name, grade, i]) => ({ id: newId('c'), name, grade, teacherId: T[i].id, demo: true }));
    const firsts = ['משה', 'יעקב', 'אהרן', 'שמואל', 'דוד', 'יוסף', 'אברהם', 'יצחק', 'מנחם', 'חיים', 'שלמה', 'נחום'];
    const lasts = ['כהן', 'לוי', 'פרידמן', 'גולדברג', 'רוזנטל', 'שפירא', 'וייס', 'קליין', 'הורוביץ', 'ברגר', 'שטרן', 'פישר'];
    const fathers = ['ישראל', 'אליהו', 'מרדכי', 'בנימין', 'ראובן', 'שמעון', 'נפתלי', 'זאב', 'צבי', 'מאיר', 'פנחס', 'עזריאל'];
    const mothers = ['שרה', 'רבקה', 'רחל', 'לאה', 'מרים', 'חנה', 'אסתר', 'דבורה', 'יהודית', 'בתיה', 'פייגא', 'חיה'];
    const y = Number(today.slice(0, 4));
    const S = firsts.map((f, i) => {
      const age = kollel ? 24 + (i % 9) : 6 + (i % 3);
      const birthMonth = Number(today.slice(5, 7));
      const bday = i === 1 ? today.slice(5) : `${pad2(((birthMonth + i) % 12) + 1)}-${pad2(3 + i)}`;
      return {
        id: newId('s'), first: f, last: lasts[i], idNum: '', birth: `${y - age}-${bday}`.replace(/-02-(29|3\d)$/, '-02-28'),
        classId: C[i % 3].id, father: kollel ? mothers[i] : fathers[i], mother: kollel ? '' : mothers[i], phone1: `050-000-00${pad2(i)}`, phone2: '',
        address: 'רחוב הדוגמה ' + (i + 1), notes: '', specialEd: i === 5, status: 'active', joined: '', demo: true
      };
    }).map(normStudent);
    data.teachers.push(...T); data.classes.push(...C); data.students.push(...S);
    // נוכחות בימים האחרונים (בלי שבת)
    const t = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
    let marked = 0;
    for (let back = 0; marked < 8 && back < 20; back++) {
      const d = new Date(t); d.setDate(d.getDate() - back);
      if (d.getDay() === 6) continue;
      const day = localDay(d);
      for (const slot of slotsFor(data.settings)) {
        S.forEach((s, i) => setMark(data, day, slot, s.id, (i * 7 + back) % 11 === 0 ? 'A' : (i + back) % 9 === 0 ? 'L' : (i === 3 && back % 3 === 1) ? 'A' : 'P'));
      }
      marked++;
    }
    // מבחנים
    const term = data.settings.terms[0];
    for (const c of C) {
      const studs = S.filter(s => s.classId === c.id);
      [['גמרא', 'מבחן חודשי', 2], ['חומש', 'מבחן פרשה', 1], ['חשבון', 'בוחן', 1]].forEach(([subject, title, weight], k) => {
        const scores = {};
        studs.forEach((s, i) => { scores[s.id] = 70 + ((i * 13 + k * 7) % 31); });
        data.assessments.push({ id: newId('a'), title, subject, classId: c.id, term, date: today, weight, max: 100, scores, demo: true, yearId: data.yearId });
      });
    }
    // שכר לימוד
    const start = addMonths(today.slice(0, 7), -2);
    S.forEach((s, i) => {
      data.plans[s.id] = normPlan({
        items: [{ category: 'tuition', label: 'שכר לימוד שנתי', amountAg: 600000 }, { category: 'registration', label: 'דמי רישום', amountAg: 15000 }, { category: 'optional', label: 'הסעות (רשות)', amountAg: 100000 }],
        discounts: i === 2 ? [{ label: 'הנחת אחים', pctBp: 1000 }] : i === 7 ? [{ label: 'מלגה', amountAg: 50000 }] : [],
        installments: 10, startMonth: start
      });
      const pays = i % 4 === 0 ? 0 : i % 4 === 1 ? 1 : 3;
      for (let k = 0; k < pays; k++) {
        const rec = addPayment(data, { sid: s.id, amountAg: 75000, date: today, method: k % 2 ? 'check' : 'transfer', ref: k % 2 ? String(1000 + i * 10 + k) : '', payer: s.father + ' ' + s.last });
        rec.demo = true;
      }
    });
    data.demoLoaded = true;
    return true;
  }
  // הסרת נתוני הדוגמה בלבד. המספור לא חוזר אחורה (paySeq נשמר). מה שהמשתמש קשר לרשומות הדוגמה נשמר (f34):
  // תלמיד דוגמה שנרשם לו תשלום אמיתי, כיתה עם תלמידים או מבחנים אמיתיים ומבחן עם ציונים אמיתיים — הופכים לרגילים
  function removeDemo(data) {
    const realPaid = new Set(data.payments.filter(p => !p.demo).map(p => p.sid));
    for (const s of data.students) if (s.demo && realPaid.has(s.id)) s.demo = false;
    const demoSids = new Set(data.students.filter(s => s.demo).map(s => s.id));
    const realSids = new Set(data.students.filter(s => !s.demo).map(s => s.id));
    for (const a of data.assessments) {
      for (const sid of Object.keys(a.scores)) if (demoSids.has(sid)) delete a.scores[sid];
      if (a.demo && Object.keys(a.scores).some(sid => realSids.has(sid))) a.demo = false;
    }
    data.assessments = data.assessments.filter(a => !a.demo);
    for (const c of data.classes) {
      if (c.demo && (data.students.some(s => !s.demo && s.classId === c.id) || data.assessments.some(a => a.classId === c.id))) c.demo = false;
    }
    data.students = data.students.filter(s => !s.demo);
    data.payments = data.payments.filter(p => !p.demo);
    data.teachers = data.teachers.filter(t => !t.demo);
    data.classes = data.classes.filter(c => !c.demo);
    const classIds = new Set(data.classes.map(c => c.id));
    const teacherIds = new Set(data.teachers.map(t => t.id));
    for (const s of data.students) if (s.classId && !classIds.has(s.classId)) s.classId = '';
    for (const c of data.classes) if (c.teacherId && !teacherIds.has(c.teacherId)) c.teacherId = '';
    for (const sid of demoSids) { delete data.plans[sid]; delete data.carry[sid]; }
    for (const day of Object.keys(data.attendance)) {
      for (const slot of Object.keys(data.attendance[day])) {
        for (const sid of Object.keys(data.attendance[day][slot])) if (demoSids.has(sid)) delete data.attendance[day][slot][sid];
        if (!Object.keys(data.attendance[day][slot]).length) delete data.attendance[day][slot];
      }
      if (!Object.keys(data.attendance[day]).length) delete data.attendance[day];
    }
    data.demoLoaded = false;
    return demoSids.size;
  }
  // מחיקת תלמיד: נוכחות, ציונים ותוכנית. תלמיד עם תשלומים — רק "עזב" (התיעוד נשמר)
  function deleteStudent(data, sid) {
    if (data.payments.some(p => p.sid === sid)) return false;
    data.students = data.students.filter(s => s.id !== sid);
    delete data.plans[sid];
    delete data.carry[sid];
    for (const day of Object.keys(data.attendance)) for (const slot of Object.keys(data.attendance[day])) delete data.attendance[day][slot][sid];
    for (const a of data.assessments) delete a.scores[sid];
    return true;
  }

  const API = {
    SCHEMA_VERSION, STORAGE_KEY, LEGACY_KEY, PAY_PREFIX, GRADES_PREFIX, ATT_PREFIX, ITEM_MAX, INSTITUTION_TYPES, DEFAULT_SUBJECTS, ATT_CODES, CATEGORIES, PAY_METHODS, LIMITS,
    localDay, isDay, isMonth, hebrewNumber, hebrewDate, addMonths, daysInMonth, dayOfWeek, monthDays, monthRange,
    normalizeId, isValidIsraeliId, idError, parseShekels, fmtMoney, pctOf, newId,
    emptyData, normalizeData, isDataKey, splitData, joinData, sizeWarnings, termsFor, assertRoom, normStudent, normPlan, fullName, activeStudents, searchStudents, className,
    slotsFor, setMark, markAll, attendanceStats, monthSummary, lowAttendance, kollelDayCheck,
    weightedAverage, studentSubjectAverages, overallAverage, classRanking, verbalGrade,
    splitEven, isExempt, planTotals, installmentSchedule, yearInfo, yearsList, studentBalance, debtors, tuitionSummary, openNewYear, registrationWarning,
    nextPaymentNo, addPayment, cancelPayment, deleteClass, upcomingBirthdays,
    csvCell, toCsv, studentsCsv, attendanceCsv, debtsCsv, loadDemo, removeDemo, deleteStudent
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SchoolLogic = API;
})(this);
