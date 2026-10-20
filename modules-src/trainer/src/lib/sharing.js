// ═══════════════════════════════════════════════════════════════════
//             CLIENT-FACING MATERIALS HELPERS
// ═══════════════════════════════════════════════════════════════════

// Generate plain text version of program for sharing via WhatsApp / SMS
export function programToPlainText(client, program, trainer) {
  if (!program) return '';
  let text = `🏋️ תוכנית אימון אישית — ${client.name}\n`;
  text += `📋 מאת: ${trainer?.name || 'המאמן'}\n`;
  if (trainer?.businessName) text += `${trainer.businessName}\n`;
  text += `📅 תאריך: ${new Date().toLocaleDateString('he-IL')}\n\n`;

  text += `🎯 מטרה: ${program.goal}\n`;
  text += `📊 רמה: ${program.level}\n\n`;
  text += '─'.repeat(30) + '\n\n';

  program.days?.forEach((day, di) => {
    text += `📌 יום ${di + 1}: ${day.name || day.focus}\n`;
    text += '─'.repeat(20) + '\n';
    day.exercises?.forEach((ex, ei) => {
      text += `${ei + 1}. ${ex.name}\n`;
      text += `   ${ex.sets} סטים × ${ex.reps} חזרות`;
      if (ex.rest) text += ` · מנוחה ${ex.rest}״`;
      text += '\n';
      if (ex.notes) text += `   💡 ${ex.notes}\n`;
      text += '\n';
    });
    text += '\n';
  });

  if (trainer?.phone) text += `📞 ליצירת קשר: ${trainer.phone}\n`;
  text += '\n— נשלח מ-TrainerPro';
  return text;
}

// Generate WhatsApp share URL
export function whatsappShareUrl(text, phone) {
  const cleaned = phone ? phone.replace(/\D/g, '') : '';
  const phoneStr = cleaned ? `phone=${cleaned}&` : '';
  return `https://wa.me/?${phoneStr}text=${encodeURIComponent(text)}`;
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
