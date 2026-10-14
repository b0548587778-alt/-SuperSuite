// היסטוריית ניווט לכל התוכנה (אחורה / קדימה), כמו בדפדפן.
// מיקום = { mod, view }: mod=null הוא מסך הבית; view — תצוגה פנימית במודול הכלכלי.
// טהור: main.js רושם מעברים ומבצע את המעבר בפועל.

function same(a, b) {
  return !!a && !!b && a.mod === b.mod && (a.view || null) === (b.view || null);
}

function create(max = 50) {
  let list = [];
  let idx = -1;
  return {
    // רישום מעבר חדש. מחזיר true אם ההיסטוריה השתנתה.
    push(loc) {
      const next = { mod: loc && loc.mod ? loc.mod : null, view: loc && loc.view ? loc.view : null };
      const cur = list[idx];
      if (same(cur, next)) return false;
      // כניסה למודול לפני שדיווח על התצוגה שלו — הדיווח משלים את אותו רישום ולא יוצר צעד נוסף
      if (cur && cur.mod === next.mod && !cur.view && next.view) { list[idx] = next; return true; }
      list = list.slice(0, idx + 1);
      list.push(next);
      if (list.length > max) list = list.slice(list.length - max);
      idx = list.length - 1;
      return true;
    },
    // מעבר בהיסטוריה (-1 אחורה, 1 קדימה). מחזיר את המיקום, או null אם אין לאן
    go(delta) {
      const to = idx + delta;
      if (to < 0 || to >= list.length) return null;
      idx = to;
      return { ...list[idx] };
    },
    current() { return list[idx] ? { ...list[idx] } : null; },
    state() { return { canBack: idx > 0, canForward: idx >= 0 && idx < list.length - 1 }; }
  };
}

module.exports = { create, same };
