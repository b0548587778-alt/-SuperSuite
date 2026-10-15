#!/usr/bin/env node
// אריזת שרת הממסר להעלאה לשרת: רק הקבצים שהשרת טוען בפועל + קבצי ההתקנה.
//   node tools/pack-relay.js   →   dist/supersuite-relay.tar.gz
// רשימת הקבצים נגזרת מה-require בפועל, כך שקובץ חדש שהשרת צריך לא יישכח.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// בתהליך נפרד: בתהליך שכבר טען את המודולים (למשל בבדיקות) ה-require הפנימיים לא רצים שוב
function serverFiles() {
  const out = execFileSync(process.execPath, [__filename, '--list'], { encoding: 'utf8' });
  return JSON.parse(out);
}

function loadedFiles() {
  const seen = new Set();
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    const file = Module._resolveFilename(request, parent, isMain);
    if (path.isAbsolute(file) && file.startsWith(ROOT) && !file.includes('node_modules')) seen.add(path.relative(ROOT, file));
    return orig.apply(this, arguments);
  };
  try { require(path.join(ROOT, 'server', 'license-relay.js')); } finally { Module._load = orig; }
  const deploy = fs.readdirSync(path.join(ROOT, 'server', 'deploy')).map(f => path.join('server', 'deploy', f));
  return [...seen, ...deploy].map(f => f.split(path.sep).join('/')).sort();
}

function pack() {
  const files = serverFiles();
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-relay-pack-'));
  const dir = path.join(stage, 'supersuite-relay');
  for (const f of files) {
    const to = path.join(dir, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), to);
  }
  const out = path.join(ROOT, 'dist', 'supersuite-relay.tar.gz');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // נתיבים יחסיים בלבד: tar של Git Bash מפרש "C:" כשם מחשב מרוחק
  execFileSync('tar', ['-czf', 'supersuite-relay.tar.gz', 'supersuite-relay'], { cwd: stage });
  fs.copyFileSync(path.join(stage, 'supersuite-relay.tar.gz'), out);
  fs.rmSync(stage, { recursive: true, force: true });
  return { out, files };
}

if (require.main === module && process.argv[2] === '--list') {
  process.stdout.write(JSON.stringify(loadedFiles()));
} else if (require.main === module) {
  const { out, files } = pack();
  console.log(files.map(f => '  ' + f).join('\n'));
  console.log(`✔ ${files.length} קבצים → ${out}`);
}

module.exports = { serverFiles, pack };
