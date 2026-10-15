// מאגד CommonJS מינימלי: אוסף את קבצי המקור (require עם נתיב יחסי) לסקריפט דפדפן אחד.
// מודולים חיצוניים (electron, fs, crypto וכו') לא נכללים — הם מסופקים בזמן ריצה דרך externals.
// בלי npm: אין אפשרות להתקין esbuild/rollup בסביבה המסוננת.
'use strict';
const fs = require('fs');
const path = require('path');

const REQ = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;

function resolveFile(fromDir, spec) {
  const base = path.resolve(fromDir, spec);
  for (const f of [base, base + '.js', path.join(base, 'index.js')]) {
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  throw new Error(`bundle: לא נמצא ${spec} (מתוך ${fromDir})`);
}

// entries: { name: absolutePath } — שמות שאפשר לדרוש מבחוץ דרך __ssRequire(name)
function bundle(entries, { root, globalName = '__ssModules' } = {}) {
  const ids = new Map(); // נתיב מלא ← מזהה
  const order = [];
  const sources = new Map();

  function visit(file) {
    if (ids.has(file)) return ids.get(file);
    const id = path.relative(root, file).split(path.sep).join('/');
    ids.set(file, id);
    const src = fs.readFileSync(file, 'utf8').replace(/^#!.*\n/, '');
    const deps = {};
    for (const m of src.matchAll(REQ)) {
      const spec = m[2];
      if (spec.startsWith('.')) deps[spec] = visit(resolveFile(path.dirname(file), spec));
    }
    sources.set(id, { src, deps });
    order.push(id);
    return id;
  }

  const named = {};
  for (const [name, file] of Object.entries(entries)) named[name] = visit(path.resolve(file));

  let out = `/* נוצר אוטומטית על ידי android/lib/bundle.js — אין לערוך ידנית */\n`;
  // בלי 'use strict' ברמת העטיפה: מודול CommonJS רץ ב-Node במצב רגיל אלא אם הצהיר אחרת
  out += `(function (G) {\nconst defs = Object.create(null);\n`;
  for (const id of order) {
    const { src, deps } = sources.get(id);
    out += `defs[${JSON.stringify(id)}] = { deps: ${JSON.stringify(deps)}, fn: function (module, exports, require, __filename, __dirname) {\n${src}\n} };\n`;
  }
  out += `const cache = Object.create(null);
function load(id, externals) {
  if (cache[id]) return cache[id].exports;
  const d = defs[id];
  if (!d) throw new Error('bundle: מודול חסר ' + id);
  const module = { exports: {} };
  cache[id] = module;
  const req = spec => {
    if (Object.prototype.hasOwnProperty.call(d.deps, spec)) return load(d.deps[spec], externals);
    if (Object.prototype.hasOwnProperty.call(externals, spec)) return externals[spec];
    throw new Error('bundle: require לא נתמך: ' + spec);
  };
  const dir = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '.';
  d.fn.call(module.exports, module, module.exports, req, '/' + id, '/' + dir);
  return module.exports;
}
const named = ${JSON.stringify(named)};
G[${JSON.stringify(globalName)}] = Object.assign(G[${JSON.stringify(globalName)}] || {}, {
  require(name, externals) {
    if (!named[name]) throw new Error('bundle: אין כניסה בשם ' + name);
    return load(named[name], externals || {});
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
`;
  return { code: out, files: order };
}

module.exports = { bundle };
