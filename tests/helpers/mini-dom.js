// DOM מינימלי לבדיקות הנגישות של המודול הכלכלי (r4-a11y-econ): פרסור HTML לעץ, בוררים פשוטים,
// אירועים, מיקוד (activeElement) ו-innerHTML דו-כיווני. מספיק כדי להריץ את ui/*.js האמיתיים
// ולבדוק את ה-DOM שנוצר — שמות לשדות ולכפתורים, טבלאות, אזורי הודעה ומלכודת מיקוד בחלונות.
'use strict';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
  if (ENT[e] !== undefined) return ENT[e];
  if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
  if (/^#/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
  return m;
});
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
  remove() { if (this.parentNode) { const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); this.parentNode = null; } }
}

class Text extends Node {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.data = String(data); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  get nodeValue() { return this.data; }
}

class ClassList {
  constructor(el) { this.el = el; }
  _get() { return String(this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  _set(l) { this.el.setAttribute('class', l.join(' ')); }
  add(...c) { const l = this._get(); for (const x of c) if (!l.includes(x)) l.push(x); this._set(l); }
  remove(...c) { this._set(this._get().filter(x => !c.includes(x))); }
  contains(c) { return this._get().includes(c); }
  toggle(c, force) { const has = this.contains(c); const want = force === undefined ? !has : !!force; if (want) this.add(c); else this.remove(c); return want; }
  get length() { return this._get().length; }
}

const camel = (s) => s.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
const kebab = (s) => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

class Element extends Node {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.attributes = new Map();
    this.listeners = {};
    this.style = {};
    this.classList = new ClassList(this);
    this._value = undefined;
    this._checked = undefined;
    const self = this;
    this.dataset = new Proxy({}, {
      get(_t, k) { return typeof k === 'string' ? (self.getAttribute('data-' + kebab(k)) ?? undefined) : undefined; },
      set(_t, k, v) { self.setAttribute('data-' + kebab(k), v); return true; },
      has(_t, k) { return self.hasAttribute('data-' + kebab(k)); },
      deleteProperty(_t, k) { self.removeAttribute('data-' + kebab(k)); return true; },
      ownKeys() { return [...self.attributes.keys()].filter(a => a.startsWith('data-')).map(a => camel(a.slice(5))); },
      getOwnPropertyDescriptor(_t, k) { return self.hasAttribute('data-' + kebab(k)) ? { enumerable: true, configurable: true, value: self.getAttribute('data-' + kebab(k)) } : undefined; },
    });
  }
  getAttribute(n) { n = String(n).toLowerCase(); return this.attributes.has(n) ? this.attributes.get(n) : null; }
  setAttribute(n, v) { this.attributes.set(String(n).toLowerCase(), String(v)); }
  removeAttribute(n) { this.attributes.delete(String(n).toLowerCase()); }
  hasAttribute(n) { return this.attributes.has(String(n).toLowerCase()); }
  toggleAttribute(n, f) { const want = f === undefined ? !this.hasAttribute(n) : !!f; if (want) this.setAttribute(n, ''); else this.removeAttribute(n); return want; }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', v); }
  get name() { return this.getAttribute('name') || ''; }
  set name(v) { this.setAttribute('name', v); }
  get type() { return this.getAttribute('type') || (this.localName === 'button' ? 'submit' : this.localName === 'input' ? 'text' : ''); }
  set type(v) { this.setAttribute('type', v); }
  get href() { return this.getAttribute('href') || ''; }
  set href(v) { this.setAttribute('href', v); }
  get placeholder() { return this.getAttribute('placeholder') || ''; }
  set placeholder(v) { this.setAttribute('placeholder', v); }
  get htmlFor() { return this.getAttribute('for') || ''; }
  set htmlFor(v) { this.setAttribute('for', v); }
  get tabIndex() { const t = this.getAttribute('tabindex'); return t === null ? (this.isFocusableByDefault() ? 0 : -1) : Number(t); }
  set tabIndex(v) { this.setAttribute('tabindex', v); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { this.toggleAttribute('disabled', !!v); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { this.toggleAttribute('hidden', !!v); }
  get required() { return this.hasAttribute('required'); }
  set required(v) { this.toggleAttribute('required', !!v); }
  get noValidate() { return this.hasAttribute('novalidate'); }
  set noValidate(v) { this.toggleAttribute('novalidate', !!v); }
  get autocomplete() { return this.getAttribute('autocomplete') || ''; }
  set autocomplete(v) { this.setAttribute('autocomplete', v); }
  get rows() { return Number(this.getAttribute('rows') || 2); }
  set rows(v) { this.setAttribute('rows', v); }
  get accept() { return this.getAttribute('accept') || ''; }
  set accept(v) { this.setAttribute('accept', v); }
  get download() { return this.getAttribute('download') || ''; }
  set download(v) { this.setAttribute('download', v); }
  get checked() { return this._checked !== undefined ? this._checked : this.hasAttribute('checked'); }
  set checked(v) { this._checked = !!v; }
  get open() { return this.hasAttribute('open'); }
  set open(v) { this.toggleAttribute('open', !!v); }
  get files() { return this._files || []; }
  set files(v) { this._files = v; }
  get options() { return this.querySelectorAll('option'); }
  get selectedIndex() {
    const o = this.options; if (!o.length) return -1;
    const v = this._value; if (v === undefined) { const s = o.findIndex(x => x.hasAttribute('selected')); return s >= 0 ? s : 0; }
    return o.findIndex(x => x.value === v);
  }
  set selectedIndex(i) { const o = this.options[i]; this._value = o ? o.value : ''; }
  get selectedOptions() { const i = this.selectedIndex; return i >= 0 ? [this.options[i]] : []; }
  get value() {
    if (this.localName === 'select') { const i = this.selectedIndex; return i >= 0 ? this.options[i].value : ''; }
    if (this.localName === 'option') return this.hasAttribute('value') ? this.getAttribute('value') : this.textContent;
    if (this.localName === 'textarea') return this._value !== undefined ? this._value : this.textContent;
    if (this._value !== undefined) return this._value;
    return this.getAttribute('value') || (this.type === 'checkbox' || this.type === 'radio' ? 'on' : '');
  }
  set value(v) { this._value = String(v ?? ''); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() { const p = this.parentNode; if (!p) return null; const l = p.children; return l[l.indexOf(this) + 1] || null; }
  get previousElementSibling() { const p = this.parentNode; if (!p) return null; const l = p.children; return l[l.indexOf(this) - 1] || null; }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; if (v !== '' && v != null) this.appendChild(new Text(this.ownerDocument, v)); }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(html) {
    this.childNodes.forEach(n => { n.parentNode = null; });
    this.childNodes = [];
    for (const n of parse(this.ownerDocument, String(html ?? ''))) this.appendChild(n);
  }
  get outerHTML() { return serialize(this); }
  appendChild(c) {
    if (c && c.isFragment) { for (const n of [...c.childNodes]) this.appendChild(n); return c; }
    if (c.parentNode) c.remove();
    c.parentNode = this; this.childNodes.push(c); return c;
  }
  append(...cs) { for (const c of cs) this.appendChild(typeof c === 'string' ? new Text(this.ownerDocument, c) : c); }
  prepend(...cs) { for (const c of cs.reverse()) this.insertBefore(typeof c === 'string' ? new Text(this.ownerDocument, c) : c, this.firstChild); }
  insertBefore(c, ref) {
    if (!ref) return this.appendChild(c);
    if (c.parentNode) c.remove();
    c.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); return c;
  }
  removeChild(c) { c.remove(); return c; }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p.insertBefore(n, this); this.remove(); }
  insertAdjacentHTML(pos, html) {
    const nodes = parse(this.ownerDocument, html);
    if (pos === 'beforeend') nodes.forEach(n => this.appendChild(n));
    else if (pos === 'afterbegin') nodes.reverse().forEach(n => this.insertBefore(n, this.firstChild));
    else if (pos === 'beforebegin' && this.parentNode) nodes.forEach(n => this.parentNode.insertBefore(n, this));
    else if (pos === 'afterend' && this.parentNode) { const nx = this.nextSibling; nodes.forEach(n => this.parentNode.insertBefore(n, nx)); }
  }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  descendants() { const out = []; const walk = (e) => { for (const c of e.children) { out.push(c); walk(c); } }; walk(this); return out; }
  querySelectorAll(sel) { const m = compile(sel); return this.descendants().filter(e => m(e, this)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  matches(sel) { return compile(sel)(this, null); }
  closest(sel) { const m = compile(sel); for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (m(x, null)) return x; return null; }
  addEventListener(t, fn, opts) { (this.listeners[t] ||= []).push({ fn, capture: opts === true || !!(opts && opts.capture) }); }
  removeEventListener(t, fn) { if (this.listeners[t]) this.listeners[t] = this.listeners[t].filter(l => l.fn !== fn); }
  dispatchEvent(ev) { return dispatch(this, ev); }
  isFocusableByDefault() {
    if (this.disabled) return false;
    if (['button', 'select', 'textarea'].includes(this.localName)) return true;
    if (this.localName === 'input') return this.type !== 'hidden';
    if (this.localName === 'a') return this.hasAttribute('href');
    if (this.localName === 'summary') return true;
    return false;
  }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  click() { dispatch(this, { type: 'click' }); }
  select() {}
  scrollIntoView() {}
  showModal() { this.setAttribute('open', ''); }
  close() { this.removeAttribute('open'); }
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
}

// אירוע עם בעבוע ושלב לכידה (capture) — מספיק ל-keydown על document ול-click
function dispatch(target, init) {
  const ev = Object.assign({ bubbles: true, defaultPrevented: false, target, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, init);
  ev.preventDefault = () => { ev.defaultPrevented = true; };
  ev.stopPropagation = () => { ev._stop = true; };
  ev.stopImmediatePropagation = () => { ev._stop = true; };
  const path = [];
  for (let x = target; x; x = x.parentNode) path.push(x);
  const doc = target.ownerDocument || target;
  if (!path.includes(doc)) path.push(doc);
  const run = (node, capture) => {
    for (const l of [...((node.listeners || {})[ev.type] || [])]) {
      if (l.capture !== capture && node !== target) continue;
      ev.currentTarget = node;
      l.fn.call(node, ev);
      if (ev._stop) return true;
    }
    return false;
  };
  for (const n of [...path].reverse()) { if (n === target) break; if (run(n, true)) return !ev.defaultPrevented; }
  // ביעד עצמו כל המאזינים רצים פעם אחת, בסדר הרישום (לכידה ובעבוע יחד)
  if (run(target, false)) return !ev.defaultPrevented;
  if (ev.bubbles !== false) for (const n of path.slice(1)) if (run(n, false)) break;
  // ברירת מחדל: לחיצה על כפתור submit בתוך טופס שולחת אותו
  if (ev.type === 'click' && !ev.defaultPrevented && target.localName === 'button' && target.type === 'submit') {
    const form = target.closest('form');
    if (form) dispatch(form, { type: 'submit' });
  }
  return !ev.defaultPrevented;
}

function serialize(n) {
  if (n.nodeType === 3) return escText(n.data);
  const attrs = [...n.attributes].map(([k, v]) => v === '' ? ' ' + k : ` ${k}="${escAttr(v)}"`).join('');
  if (VOID.has(n.localName)) return `<${n.localName}${attrs}>`;
  return `<${n.localName}${attrs}>${n.childNodes.map(serialize).join('')}</${n.localName}>`;
}

// פרסור HTML פשוט: תגים, מאפיינים, טקסט, הערות. סגירה אוטומטית של p/li/option/tr/td/th כמו בדפדפן — בקירוב
const AUTO_CLOSE = { li: ['li'], option: ['option'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'], p: ['p'] };
function parse(doc, html) {
  const root = new Element(doc, '#root');
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) { const e = html.indexOf('-->', i); i = e < 0 ? html.length : e + 3; continue; }
    if (html[i] === '<' && /[a-zA-Z/!]/.test(html[i + 1] || '')) {
      if (html[i + 1] === '!') { const e = html.indexOf('>', i); i = e < 0 ? html.length : e + 1; continue; }
      if (html[i + 1] === '/') {
        const e = html.indexOf('>', i);
        const tag = html.slice(i + 2, e).trim().toLowerCase();
        for (let k = stack.length - 1; k > 0; k--) if (stack[k].localName === tag) { stack.length = k; break; }
        i = e + 1; continue;
      }
      const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i));
      const tag = m[1].toLowerCase();
      let j = i + m[0].length;
      const el = new Element(doc, tag);
      // מאפיינים
      for (;;) {
        while (/\s/.test(html[j] || '')) j++;
        if (html[j] === '>' || j >= html.length) { j++; break; }
        if (html[j] === '/' && html[j + 1] === '>') { j += 2; break; }
        const am = /^([^\s=>/]+)/.exec(html.slice(j));
        if (!am) { j++; continue; }
        const an = am[1].toLowerCase(); j += am[1].length;
        while (/\s/.test(html[j] || '')) j++;
        let av = '';
        if (html[j] === '=') {
          j++; while (/\s/.test(html[j] || '')) j++;
          const q = html[j];
          if (q === '"' || q === "'") { const e = html.indexOf(q, j + 1); av = html.slice(j + 1, e); j = e + 1; }
          else { const vm = /^[^\s>]*/.exec(html.slice(j)); av = vm[0]; j += av.length; }
        }
        if (!el.attributes.has(an)) el.attributes.set(an, decode(av));
      }
      const closes = AUTO_CLOSE[tag];
      if (closes) {
        for (let k = stack.length - 1; k > 0; k--) {
          if (closes.includes(stack[k].localName)) { stack.length = k; break; }
          if (['table', 'tbody', 'thead', 'ul', 'ol', 'select', 'div', 'section', 'form'].includes(stack[k].localName)) break;
        }
      }
      top().appendChild(el);
      if (VOID.has(tag)) { i = j; continue; }
      if (RAW.has(tag)) {
        const e = html.toLowerCase().indexOf('</' + tag, j);
        const raw = html.slice(j, e < 0 ? html.length : e);
        if (raw) el.appendChild(new Text(doc, tag === 'textarea' || tag === 'title' ? decode(raw) : raw));
        const ce = e < 0 ? html.length : html.indexOf('>', e) + 1;
        i = ce; continue;
      }
      stack.push(el);
      i = j; continue;
    }
    const e = html.indexOf('<', i + 1);
    const t = html.slice(i, e < 0 ? html.length : e);
    top().appendChild(new Text(doc, decode(t)));
    i = e < 0 ? html.length : e;
  }
  const out = [...root.childNodes];
  out.forEach(n => { n.parentNode = null; });
  return out;
}

// מנוע בוררים: tag, #id, .class, [a], [a="v"], [a^="v"], :not(...), :checked, :disabled, :focus;
// צירופים: רווח (צאצא) ו-> (בן). רשימות עם פסיק.
function splitTop(s, ch) {
  const out = []; let depth = 0, q = null, cur = '';
  for (const c of s) {
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ch && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
function compound(sel) {
  const tests = [];
  let s = sel.trim();
  const tm = /^([a-zA-Z*][a-zA-Z0-9-]*)/.exec(s);
  if (tm) { const t = tm[1].toLowerCase(); if (t !== '*') tests.push(e => e.localName === t); s = s.slice(tm[0].length); }
  while (s.length) {
    let m;
    if ((m = /^#([\w-]+)/.exec(s))) { const v = m[1]; tests.push(e => e.id === v); }
    else if ((m = /^\.([\w-]+)/.exec(s))) { const v = m[1]; tests.push(e => e.classList.contains(v)); }
    else if ((m = /^\[([\w-]+)\s*(?:([\^$*~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/.exec(s))) {
      const [, a, op, v1, v2, v3] = m; const v = v1 ?? v2 ?? v3;
      tests.push(e => {
        const x = e.getAttribute(a);
        if (x === null) return false;
        if (!op) return true;
        if (op === '=') return x === v;
        if (op === '^=') return x.startsWith(v);
        if (op === '$=') return x.endsWith(v);
        if (op === '*=') return x.includes(v);
        if (op === '~=') return x.split(/\s+/).includes(v);
        return false;
      });
    } else if ((m = /^:not\(/.exec(s))) {
      let depth = 1, k = 5; while (k < s.length && depth) { if (s[k] === '(') depth++; if (s[k] === ')') depth--; k++; }
      const inner = compile(s.slice(5, k - 1)); tests.push(e => !inner(e, null)); s = s.slice(k); continue;
    } else if ((m = /^:checked/.exec(s))) tests.push(e => e.checked);
    else if ((m = /^:disabled/.exec(s))) tests.push(e => e.disabled);
    else if ((m = /^:focus/.exec(s))) tests.push(e => e.ownerDocument.activeElement === e);
    else if ((m = /^:scope/.exec(s))) tests.push(() => true);
    else throw new Error('mini-dom: בורר לא נתמך: ' + sel);
    s = s.slice(m[0].length);
  }
  return e => tests.every(t => t(e));
}
const cache = new Map();
function compile(sel) {
  if (cache.has(sel)) return cache.get(sel);
  const alts = splitTop(sel, ',').map(part => {
    const tokens = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+(?![^[]*\])/).filter(Boolean);
    const steps = [];
    for (let k = 0; k < tokens.length; k++) {
      if (tokens[k] === '>') continue;
      steps.push({ m: compound(tokens[k]), child: tokens[k - 1] === '>' });
    }
    return (el, scope) => {
      const match = (e, idx) => {
        if (!steps[idx].m(e)) return false;
        if (idx === 0) return true;
        if (steps[idx].child) { const p = e.parentElement; return !!p && p !== scope && match(p, idx - 1); }
        for (let p = e.parentElement; p && p !== scope; p = p.parentElement) if (match(p, idx - 1)) return true;
        return false;
      };
      return match(el, steps.length - 1);
    };
  });
  const fn = (el, scope) => alts.some(a => a(el, scope));
  cache.set(sel, fn);
  return fn;
}

class Document extends Element {
  constructor() {
    super(null, '#document');
    this.ownerDocument = this;
    this.nodeType = 9;
    this.readyState = 'loading';
    this.documentElement = new Element(this, 'html');
    this.head = new Element(this, 'head');
    this.body = new Element(this, 'body');
    this.documentElement.append(this.head, this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }
  createElement(tag) { return new Element(this, tag); }
  createTextNode(t) { return new Text(this, t); }
  createDocumentFragment() { const f = new Element(this, '#fragment'); f.isFragment = true; return f; }
  getElementById(id) { return this.descendants().find(e => e.id === id) || null; }
}

// מסמך מתוך קובץ HTML מלא: ה-body בלבד (בלי תגי script), המאפיינים של <html> נשמרים
function documentFromHtml(html) {
  const doc = new Document();
  const hm = /<html([^>]*)>/i.exec(html);
  if (hm) { const tmp = parse(doc, `<x${hm[1]}></x>`)[0]; for (const [k, v] of tmp.attributes) doc.documentElement.setAttribute(k, v); }
  const bm = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  doc.body.innerHTML = (bm ? bm[1] : html).replace(/<script[\s\S]*?<\/script>/gi, '');
  return doc;
}

// ---------- עזרי נגישות לבדיקות ----------
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';
function isHiddenTree(e) {
  for (let x = e; x && x.nodeType === 1; x = x.parentNode) {
    if (x.hidden || x.getAttribute('aria-hidden') === 'true' || x.classList.contains('hidden')) return true;
    if (x.style && x.style.display === 'none') return true;
  }
  return false;
}
// השם הנגיש (בקירוב של accname): aria-labelledby, aria-label, label (עוטף או for), title, placeholder, טקסט
function accessibleName(e) {
  const doc = e.ownerDocument;
  const lb = e.getAttribute('aria-labelledby');
  if (lb) { const t = lb.split(/\s+/).map(id => { const x = doc.getElementById(id); return x ? x.textContent : ''; }).join(' ').trim(); if (t) return t; }
  const al = (e.getAttribute('aria-label') || '').trim();
  if (al) return al;
  if (['input', 'select', 'textarea'].includes(e.localName)) {
    if (e.id) { const l = doc.descendants().find(x => x.localName === 'label' && x.getAttribute('for') === e.id); if (l && l.textContent.trim()) return l.textContent.trim(); }
    const wrap = e.closest('label'); if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
    if (e.title.trim()) return e.title.trim();
    if (e.placeholder.trim()) return e.placeholder.trim();
    return '';
  }
  const txt = e.textContent.replace(/\s+/g, ' ').trim();
  // כפתור שכל התוכן שלו אייקון — אין לו שם בלי תווית
  if (txt && /[֐-׿A-Za-z0-9]/.test(txt)) return txt;
  if (e.title.trim()) return e.title.trim();
  return '';
}

module.exports = { Document, Element, Text, documentFromHtml, parse, dispatch, accessibleName, isHiddenTree, FOCUSABLE };
