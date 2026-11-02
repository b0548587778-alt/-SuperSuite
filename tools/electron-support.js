#!/usr/bin/env node
// בדיקה שגרסת Electron שנארזת עדיין נתמכת (סקירת קוד 2.11.2026: 38.8.6 נארזה אחרי סוף התמיכה).
// Electron מתקן אבטחה רק בשלוש הגרסאות הראשיות האחרונות (latest, latest-1, latest-2).
//   node tools/electron-support.js <הגרסה האחרונה>   — ב-security.yml: "$(npm view electron dist-tags.latest)"
// הגרסה המותקנת — מקובץ הנעילה של השורש (מה שנארז בפועל), לא מהטווח ב-package.json.
// יציאה 1 = גרסה שאינה נתמכת. אין כאן פנייה לרשת — הגרסה האחרונה מגיעה בפרמטר.
'use strict';
const fs = require('fs');
const path = require('path');

const SUPPORTED_MAJORS = 3;

const major = v => {
  const m = /^v?(\d+)\.\d+\.\d+/.exec(String(v || '').trim());
  return m ? Number(m[1]) : null;
};

function lockedElectron(projectDir) {
  const lock = JSON.parse(fs.readFileSync(path.join(projectDir, 'package-lock.json'), 'utf8'));
  const info = lock.packages && lock.packages['node_modules/electron'];
  return info && info.version || null;
}

// null = נתמכת; אחרת — הסבר בעברית
function supportProblem(installed, latest) {
  const have = major(installed);
  const top = major(latest);
  if (have == null) return 'גרסת Electron המותקנת לא נקראה: ' + installed;
  if (top == null) return 'הגרסה האחרונה של Electron לא נקראה: ' + latest;
  const oldest = top - SUPPORTED_MAJORS + 1;
  if (have < oldest) return `Electron ${installed} כבר לא נתמכת (נתמכות ${oldest}–${top}) — לעדכן את package.json ואת קובץ הנעילה`;
  return null;
}

if (require.main === module) {
  const latest = process.argv[2];
  const installed = lockedElectron(path.join(__dirname, '..'));
  const problem = supportProblem(installed, latest);
  console.log(problem || `Electron ${installed} נתמכת (האחרונה: ${latest})`);
  process.exitCode = problem ? 1 : 0;
}

module.exports = { supportProblem, lockedElectron, SUPPORTED_MAJORS };
