// ═══════════════════════════════════════════════════════════════════
//             CLIENT-FACING MATERIALS HELPERS
// ═══════════════════════════════════════════════════════════════════
// טהור (בלי DOM) עד copyToClipboard — נבדק ב-tests/trainer-sharing.test.js
import { EXERCISES } from '../data/exercises.js';
import { GOALS, LEVELS } from '../data/constants.js';

const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const labelOf = (list, id) => (hasValue(id) ? list.find((x) => x.id === id)?.label || '' : '');

// תרגיל בתוכנית שומר רק exerciseId — השם מהספרייה (תרגיל ישן עם name — כגיבוי)
export function exerciseName(ex) {
  const data = EXERCISES.find((e) => e.id === ex?.exerciseId);
  if (data?.name) return data.name;
  return hasValue(ex?.name) ? String(ex.name) : '';
}

// משך בשניות — כמו בהדפסה (40״); דקות שלמות — "20 דק׳"
export function formatDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n >= 60 && n % 60 === 0 ? `${n / 60} דק׳` : `${n}״`;
}

// שורת המינון: סטים × חזרות / משך, ומנוחה — רק שדות שקיימים
export function exerciseDose(ex) {
  const parts = [];
  if (hasValue(ex.sets)) parts.push(`${ex.sets} סטים`);
  if (hasValue(ex.reps)) parts.push(`${ex.reps} חזרות`);
  else if (formatDuration(ex.duration)) parts.push(formatDuration(ex.duration));
  let line = parts.join(' × ');
  if (Number(ex.rest) > 0) line += `${line ? ' · ' : ''}מנוחה ${ex.rest}״`;
  return line;
}

// Generate plain text version of program for sharing via WhatsApp / SMS
// מטרה ורמה — תוויות בעברית (מזהה לא מוכר ← השורה מושמטת); רמה מהתוכנית או מהמתאמן
export function programToPlainText(client, program, trainer, { now = new Date() } = {}) {
  if (!program) return '';
  const name = hasValue(client?.name) ? ` — ${client.name}` : '';
  let text = `🏋️ תוכנית אימון אישית${name}\n`;
  text += `📋 מאת: ${trainer?.name || 'המאמן'}\n`;
  if (trainer?.businessName) text += `${trainer.businessName}\n`;
  text += `📅 תאריך: ${now.toLocaleDateString('he-IL')}\n\n`;

  const goal = labelOf(GOALS, program.goal || client?.goal);
  const level = labelOf(LEVELS, program.level || client?.level);
  if (goal) text += `🎯 מטרה: ${goal}\n`;
  if (level) text += `📊 רמה: ${level}\n`;
  if (goal || level) text += '\n';
  text += '─'.repeat(30) + '\n\n';

  (program.days || []).forEach((day, di) => {
    const title = day?.name || day?.focus;
    text += `📌 יום ${di + 1}${hasValue(title) ? `: ${title}` : ''}\n`;
    text += '─'.repeat(20) + '\n';
    // תרגיל שאינו בספרייה לא מוצג גם במסך התוכנית — מדולג גם כאן
    const exercises = (day?.exercises || []).filter((ex) => exerciseName(ex));
    exercises.forEach((ex, ei) => {
      text += `${ei + 1}. ${exerciseName(ex)}\n`;
      const dose = exerciseDose(ex);
      if (dose) text += `   ${dose}\n`;
      if (hasValue(ex.notes)) text += `   💡 ${ex.notes}\n`;
      text += '\n';
    });
    text += '\n';
  });

  if (trainer?.phone) text += `📞 ליצירת קשר: ${trainer.phone}\n`;
  text += '\n— נשלח מ-TrainerPro';
  return text;
}

// מספר לוואטסאפ בפורמט בינלאומי בלי + — כמו במודול השמאות (modules/shamai/src/contacts.js):
// "+..." נשאר, "0..." ← "972...", אחרת ← "972" לפני המספר. בנוסף: "00..." (חיוג בינלאומי) ו-"972..." בלי + לא מקבלים קידומת כפולה
export function whatsappPhone(phone) {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return '972' + digits;
}

// Generate WhatsApp share URL — הצורה המתועדת: wa.me/<מספר>?text=… (בלי נמען: wa.me/?text=…)
export function whatsappShareUrl(text, phone) {
  return `https://wa.me/${whatsappPhone(phone)}?text=${encodeURIComponent(text)}`;
}

// Web Share API (mobile native share)
export async function shareNative({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch (e) {
      console.log('Share cancelled or failed', e);
      return false;
    }
  }
  return false;
}

// Copy to clipboard
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.error('Clipboard failed', e);
    return false;
  }
}


// Format date in Hebrew
export function formatDateHe(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Download text as file
export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
