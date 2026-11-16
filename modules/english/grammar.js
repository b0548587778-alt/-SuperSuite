// שיעורי דקדוק קצרים (הסבר בעברית + תרגילים שנבדקים אוטומטית) — נתונים בלבד, בלי DOM.
// תרגיל: q = משפט עם ___ במקום החסר, a = תשובות נכונות (הראשונה מוצגת), options = בחירה (אם אין — הקלדה).
(function (root) {
  'use strict';

  const LESSONS = [
    {
      id: 'to-be',
      title: 'הפועל to be — am / is / are',
      intro: 'באנגלית אין משפט בלי פועל. בעברית אומרים "אני תלמיד" בלי פועל, ובאנגלית חובה להוסיף את הפועל "להיות" בהווה (am / is / are) — I am a student. הפועל to be משתנה לפי הגוף:',
      rules: [
        { he: 'אני — am', en: 'I am happy.', tr: 'אני שמח.' },
        { he: 'הוא / היא / זה — is', en: 'She is my sister.', tr: 'היא אחותי.' },
        { he: 'אתה / אנחנו / הם — are', en: 'We are at home.', tr: 'אנחנו בבית.' },
        { he: 'שלילה: מוסיפים not אחרי הפועל', en: 'He is not tired.', tr: 'הוא לא עייף.' },
        { he: 'שאלה: הפועל עובר לתחילת המשפט', en: 'Are you ready?', tr: 'אתה מוכן?' }
      ],
      exercises: [
        { q: 'I ___ a student.', a: ['am'], options: ['am', 'is', 'are'], tr: 'אני תלמיד.' },
        { q: 'The cat ___ small.', a: ['is'], options: ['am', 'is', 'are'], tr: 'החתול קטן.' },
        { q: 'They ___ in the garden.', a: ['are'], options: ['am', 'is', 'are'], tr: 'הם בגינה.' },
        { q: 'My father ___ tall.', a: ['is'], tr: 'אבא שלי גבוה.' },
        { q: 'We ___ a big family.', a: ['are'], tr: 'אנחנו משפחה גדולה.' },
        { q: '___ you hungry?', a: ['are'], tr: 'אתה רעב?' }
      ]
    },
    {
      id: 'a-an',
      title: 'a / an — מילת היחיד',
      intro: 'לפני שם עצם ביחיד שאינו מסוים אומרים a או an (בערך "אחד"). הבחירה לפי הצליל שבתחילת המילה הבאה:',
      rules: [
        { he: 'לפני צליל של עיצור — a', en: 'a book, a cup, a tree', tr: 'ספר, כוס, עץ' },
        { he: 'לפני צליל של תנועה (a, e, i, o, u) — an', en: 'an apple, an egg, an orange', tr: 'תפוח, ביצה, תפוז' },
        { he: 'הצליל קובע, לא האות', en: 'an hour, a uniform', tr: 'שעה, תלבושת אחידה' },
        { he: 'דבר מסוים או ידוע — the', en: 'the sun, the door', tr: 'השמש, הדלת' }
      ],
      exercises: [
        { q: 'I eat ___ apple.', a: ['an'], options: ['a', 'an'], tr: 'אני אוכל תפוח.' },
        { q: 'She has ___ dog.', a: ['a'], options: ['a', 'an'], tr: 'יש לה כלב.' },
        { q: 'This is ___ egg.', a: ['an'], options: ['a', 'an'], tr: 'זו ביצה.' },
        { q: 'He is ___ teacher.', a: ['a'], options: ['a', 'an'], tr: 'הוא מורה.' },
        { q: 'Wait ___ hour.', a: ['an'], options: ['a', 'an'], tr: 'חכה שעה.' },
        { q: 'I see ___ elephant.', a: ['an'], options: ['a', 'an'], tr: 'אני רואה פיל.' }
      ]
    },
    {
      id: 'plurals',
      title: 'רבים — Plurals',
      intro: 'ברוב המילים מוסיפים s בסוף כדי לעשות רבים. יש כמה כללים מיוחדים:',
      rules: [
        { he: 'רוב המילים — מוסיפים s', en: 'book → books, apple → apples', tr: 'ספר ← ספרים' },
        { he: 'מילה שמסתיימת ב-s, sh, ch, x — מוסיפים es', en: 'bus → buses, box → boxes', tr: 'אוטובוס ← אוטובוסים' },
        { he: 'עיצור + y — ה-y הופך ל-ies', en: 'baby → babies, story → stories', tr: 'תינוק ← תינוקות' },
        { he: 'מילים חריגות — לזכור בעל פה', en: 'child → children, man → men, foot → feet, tooth → teeth, mouse → mice', tr: 'ילד ← ילדים' }
      ],
      exercises: [
        { q: 'one cat, two ___', a: ['cats'], tr: 'חתול אחד, שני חתולים' },
        { q: 'one box, three ___', a: ['boxes'], tr: 'קופסה אחת, שלוש קופסאות' },
        { q: 'one baby, two ___', a: ['babies'], tr: 'תינוק אחד, שני תינוקות' },
        { q: 'one child, five ___', a: ['children'], tr: 'ילד אחד, חמישה ילדים' },
        { q: 'one tooth, many ___', a: ['teeth'], tr: 'שן אחת, הרבה שיניים' },
        { q: 'one bus, two ___', a: ['buses'], tr: 'אוטובוס אחד, שני אוטובוסים' }
      ]
    },
    {
      id: 'pronouns',
      title: 'כינויי גוף — Pronouns',
      intro: 'כינויי הגוף באנגלית. שימו לב: you משמש גם ליחיד וגם לרבים, ו-it משמש לחפץ או לבעל חיים.',
      rules: [
        { he: 'אני, אתה/את, הוא, היא, זה', en: 'I, you, he, she, it', tr: '' },
        { he: 'אנחנו, אתם/אתן, הם/הן', en: 'we, you, they', tr: '' },
        { he: 'שייכות: שלי, שלך, שלו, שלה', en: 'my, your, his, her', tr: '' },
        { he: 'שייכות ברבים: שלנו, שלכם, שלהם', en: 'our, your, their', tr: '' },
        { he: 'דוגמה', en: 'This is my brother. His name is David.', tr: 'זה אחי. שמו דוד.' }
      ],
      exercises: [
        { q: 'Sarah is my sister. ___ is nine.', a: ['she'], options: ['he', 'she', 'it'], tr: 'שרה אחותי. היא בת תשע.' },
        { q: 'David is my friend. ___ is tall.', a: ['he'], options: ['he', 'she', 'they'], tr: 'דוד חברי. הוא גבוה.' },
        { q: 'The book is new. ___ is red.', a: ['it'], options: ['he', 'it', 'we'], tr: 'הספר חדש. הוא אדום.' },
        { q: 'My mother and I — ___ are at home.', a: ['we'], options: ['we', 'they', 'you'], tr: 'אמא ואני — אנחנו בבית.' },
        { q: 'This is ___ bag. (שלי)', a: ['my'], tr: 'זה התיק שלי.' },
        { q: 'They have a house. ___ house is big.', a: ['their'], options: ['our', 'their', 'his'], tr: 'יש להם בית. הבית שלהם גדול.' }
      ]
    },
    {
      id: 'present-simple',
      title: 'הווה פשוט — Present Simple',
      intro: 'הווה פשוט מתאר דבר שקורה תמיד או בקביעות (כל יום, בדרך כלל). הפועל נשאר כמו שהוא, חוץ מגוף שלישי יחיד:',
      rules: [
        { he: 'I / you / we / they — הפועל כמו שהוא', en: 'I read every day.', tr: 'אני קורא כל יום.' },
        { he: 'he / she / it — מוסיפים s', en: 'She reads every day.', tr: 'היא קוראת כל יום.' },
        { he: 'פועל שמסתיים ב-sh, ch, o, x — es', en: 'He washes. She goes. He watches.', tr: 'הוא רוחץ. היא הולכת.' },
        { he: 'שלילה: don\'t / doesn\'t + פועל בלי s', en: 'He doesn\'t eat meat.', tr: 'הוא לא אוכל בשר.' },
        { he: 'שאלה: Do / Does בתחילת המשפט', en: 'Does she like tea?', tr: 'היא אוהבת תה?' }
      ],
      exercises: [
        { q: 'He ___ to school by bus. (go)', a: ['goes'], tr: 'הוא נוסע לבית הספר באוטובוס.' },
        { q: 'We ___ English. (learn)', a: ['learn'], tr: 'אנחנו לומדים אנגלית.' },
        { q: 'My sister ___ a book every week. (read)', a: ['reads'], tr: 'אחותי קוראת ספר כל שבוע.' },
        { q: 'The baby ___ a lot. (sleep)', a: ['sleeps'], tr: 'התינוק ישן הרבה.' },
        { q: '___ you like apples?', a: ['do'], options: ['do', 'does'], tr: 'אתה אוהב תפוחים?' },
        { q: 'She ___ eat meat.', a: ["doesn't", 'does not'], options: ["don't", "doesn't"], tr: 'היא לא אוכלת בשר.' }
      ]
    },
    {
      id: 'questions',
      title: 'מילות שאלה — Question Words',
      intro: 'מילות השאלה באות בתחילת המשפט. אחריהן בדרך כלל בא הפועל (is / are / do / does).',
      rules: [
        { he: 'מה — What', en: 'What is your name?', tr: 'מה שמך?' },
        { he: 'מי — Who', en: 'Who is at the door?', tr: 'מי בדלת?' },
        { he: 'איפה — Where', en: 'Where is my pen?', tr: 'איפה העט שלי?' },
        { he: 'מתי — When', en: 'When do we eat?', tr: 'מתי אנחנו אוכלים?' },
        { he: 'למה — Why;  איך — How', en: 'Why are you sad? How are you?', tr: 'למה אתה עצוב? מה שלומך?' },
        { he: 'כמה (לספירה) — How many', en: 'How many books do you have?', tr: 'כמה ספרים יש לך?' }
      ],
      exercises: [
        { q: '___ is your name? (מה)', a: ['what'], tr: 'מה שמך?' },
        { q: '___ is my bag? (איפה)', a: ['where'], tr: 'איפה התיק שלי?' },
        { q: '___ is your teacher? (מי)', a: ['who'], tr: 'מי המורה שלך?' },
        { q: '___ do you go to bed? (מתי)', a: ['when'], tr: 'מתי אתה הולך לישון?' },
        { q: '___ are you? (איך / מה שלומך)', a: ['how'], tr: 'מה שלומך?' },
        { q: '___ many brothers do you have?', a: ['how'], options: ['what', 'how', 'who'], tr: 'כמה אחים יש לך?' }
      ]
    },
    {
      id: 'past-simple',
      title: 'עבר פשוט — פעלים רגילים',
      intro: 'בעבר פשוט מתארים דבר שקרה והסתיים. בפעלים רגילים מוסיפים ed לסוף הפועל — אותה צורה לכל הגופים.',
      rules: [
        { he: 'רוב הפעלים — מוסיפים ed', en: 'play → played, help → helped', tr: 'שיחק, עזר' },
        { he: 'פועל שמסתיים ב-e — מוסיפים רק d', en: 'smile → smiled, live → lived', tr: 'חייך, גר' },
        { he: 'עיצור + y — ה-y הופך ל-ied', en: 'study → studied, cry → cried', tr: 'למד, בכה' },
        { he: 'מילה קצרה: עיצור-תנועה-עיצור — מכפילים את האות האחרונה', en: 'stop → stopped, plan → planned', tr: 'עצר, תכנן' },
        { he: 'דוגמה', en: 'Yesterday we visited Grandmother.', tr: 'אתמול ביקרנו את סבתא.' }
      ],
      exercises: [
        { q: 'Yesterday I ___ my mother. (help)', a: ['helped'], tr: 'אתמול עזרתי לאמא.' },
        { q: 'We ___ in the park. (play)', a: ['played'], tr: 'שיחקנו בפארק.' },
        { q: 'The baby ___ at me. (smile)', a: ['smiled'], tr: 'התינוק חייך אליי.' },
        { q: 'She ___ for the test. (study)', a: ['studied'], tr: 'היא למדה למבחן.' },
        { q: 'The bus ___ at the station. (stop)', a: ['stopped'], tr: 'האוטובוס עצר בתחנה.' },
        { q: 'They ___ in Jerusalem. (live)', a: ['lived'], tr: 'הם גרו בירושלים.' }
      ]
    }
  ];

  const API = { LESSONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.EnglishGrammar = API;
})(this);
