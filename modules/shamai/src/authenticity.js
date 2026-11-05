// שמאי — בדיקת אותנטיות וכניסה. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  AUTHENTICITY CHECK - identify fakes/counterfeits
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_CHECKLISTS = {
  watch: {
    name: 'שעוני יוקרה',
    icon: '⌚',
    intro: 'כל סימן אדום = ⚠. שלושה סימנים אדומים = סבירות גבוהה לזיוף',
    items: [
      { id: 'weight', q: 'משקל ומשקל ספציפי', tip: 'רולקס אמיתי כבד מהותית מזיוף. דאטג׳סט 36mm ≈ 125g', critical: true },
      { id: 'serial', q: 'מספר סריאלי - חרוט עמוק וברור?', tip: 'חרוט בלייזר/יד עם שוליים חדים. זיוף = רך, מזולזל', critical: true },
      { id: 'second-sweep', q: 'מחוג שניות - תנועה רציפה (מכני)?', tip: 'אוטומטי = תנועה חלקה (8 פעימות לשניה). זיוף קווארץ = קפיצות שניה אחת', critical: true },
      { id: 'cyclops', q: 'זכוכית הציקלופ מגדילה x2.5?', tip: 'זכוכית מקור מגדילה משמעותית את התאריך. זיופים מגדילים פחות' },
      { id: 'crown', q: 'כתר - לוגו רולקס מדויק 5 נקודות?', tip: 'הכתר הקדימה צריך 5 נקודות סימטריות מושלמות' },
      { id: 'rehaut', q: 'רהאוט (טבעת פנימית) - חרוט ROLEX סביב?', tip: 'משנת 2005+ כל רולקס עם חריטה רהאוט. בדוק אחידות' },
      { id: 'movement', q: 'מנגנון - חתימת רולקס + מספרי גלגל?', tip: 'דורש פתיחת הגב. אם המוכר מסרב - חשד גבוה', critical: true },
      { id: 'box-papers', q: 'קופסה + ניירות מקוריים?', tip: 'תעודת אחריות, תג עם סריאל תואם, קופסה ירוקה אופיינית' },
      { id: 'price', q: 'המחיר הגיוני (לא נמוך מ-70% מערך שוק)?', tip: 'הצעה זולה משמעותית = דגל אדום ענק', critical: true },
      { id: 'seller', q: 'מוכר עם היסטוריה ומוניטין?', tip: 'בדוק ביקורות, פרופיל, האם דורש פגישה אישית' },
    ],
  },
  bag: {
    name: 'תיקי יוקרה',
    icon: '👜',
    intro: 'תיק אמיתי - תפר אחיד, חומרה כבדה, ריח עור עשיר',
    items: [
      { id: 'stitching', q: 'תפרים - אחידים, ישרים, צפופים?', tip: 'הרמס: 7-9 תפרים לס"מ, צבע צהוב-חום מובהק. זיוף = לא אחיד', critical: true },
      { id: 'leather', q: 'עור - ריח עשיר, מרקם אורגני?', tip: 'הרמס/לואי ויטון עור Togo/Epi - מבריק, קר. זיוף = פלסטיק זול', critical: true },
      { id: 'hardware', q: 'חומרה - כבדה, מצופה זהב 24K?', tip: 'מנעולים, תפסים - חייבים להיות כבדים. זיוף = קל ומשוף', critical: true },
      { id: 'logo', q: 'לוגו - חרוט עמוק וחד?', tip: 'הרמס: HERMES PARIS עם נקודות מתחת לאותיות. LV: מונוגרם סימטרי', critical: true },
      { id: 'lining', q: 'בטנה - בד ייעודי עם לוגו פנימי?', tip: 'לואי ויטון בטנת Alcantara חומה. הרמס: עז Chèvre בצבע תואם' },
      { id: 'serial', q: 'מספר סריאלי / Date Code?', tip: 'LV: 4 ספרות באות + עור פנימי. הרמס: חרוט בעור בצורת ◯' },
      { id: 'symmetry', q: 'סימטריה מושלמת בין שני הצדדים?', tip: 'תיק אותנטי = מראה מושלמת. זיוף תמיד אסימטרי במשהו' },
      { id: 'dustbag', q: 'שקית אבק עם לוגו תואם?', tip: 'הרמס: כתום עם פס שחור. שאנל: לבן-שחור, LV: חום' },
      { id: 'price', q: 'מחיר ב-70-90% משוק חוקי?', tip: 'תיק חדש בחצי מחיר = זיוף. מסומש 65-85% מהמחיר הקטלוגי', critical: true },
      { id: 'receipt', q: 'קבלת קנייה מבוטיק רשמי?', tip: 'דורש מספר עסקה, חותמת חנות, תאריך, פרטי המוצר' },
    ],
  },
  gold: {
    name: 'זהב וכסף',
    icon: '✦',
    intro: 'בדיקות פיזיקליות פשוטות - אסור לוותר עליהן',
    items: [
      { id: 'hallmark', q: 'תג מעצב/קראט (750/925/916) חרוט?', tip: '750=18K, 585=14K, 999=24K, 925=Sterling Silver. ללא תג = חשד', critical: true },
      { id: 'magnet', q: 'בוחן מגנט - לא נמשך?', tip: 'זהב וכסף לא מגנטיים. אם נמשך = מתכת עטופה זהב', critical: true },
      { id: 'weight', q: 'משקל סביר ביחס לגודל?', tip: 'זהב צפיפות 19.3 - כבד מאוד. כסף 10.5. השוו לטבלה' },
      { id: 'acid-test', q: 'בדיקת חומצה (ערכת זהבן)?', tip: 'מטפטפים על המתכת - תגובה מאמתת קראט. דורש ערכה (~₪80)' },
      { id: 'sound', q: 'צליל - בקשה/מטבע מצלצל ממושכות?', tip: 'כסף אמיתי "מצלצל" יפה כמו פעמון. זיוף = צליל עמום' },
      { id: 'patina', q: 'פטינה / כסף משחיר עם הזמן?', tip: 'כסף אמיתי משחיר אם לא מנקים. זיוף נשאר בוהק תמיד' },
      { id: 'density', q: 'בדיקת צפיפות במים (ארכימדס)?', tip: 'משקילים יבש + טבול במים. נוסחה נותנת צפיפות. השוו לטבלה' },
      { id: 'maker', q: 'תג יצרן/מותג מוכר?', tip: 'תכשיטי יוקרה: Cartier, Tiffany. ישראלי: H. Stern, Yvel' },
      { id: 'price', q: 'מחיר ב-90%+ ממחיר השוק?', tip: 'זהב גרם בערך לפי ספוט. הצעה ב-50% = זיוף', critical: true },
    ],
  },
  diamond: {
    name: 'יהלומים',
    icon: '◆',
    intro: 'בעיקר: טבעי vs מעבדה (CVD/HPHT). מעבדה זול ב-70-80% מטבעי',
    items: [
      { id: 'gia-cert', q: 'תעודת GIA / IGI מקורית?', tip: 'כל יהלום מעל 0.5ct - דרשו תעודה. ללא תעודה = ערך חצי', critical: true },
      { id: 'gia-engraved', q: 'מספר תעודה חרוט בלייזר על המכלולים?', tip: 'GIA חורט מספר על girdle. דרוש מיקרוסקופ x10 לראיה' },
      { id: 'fog-test', q: 'מבחן ערפל - מתפוגג מיידית?', tip: 'נושפים על האבן - יהלום אמיתי מתבהר תוך שניה. זיוף = נשאר ערפל' },
      { id: 'fluorescence', q: 'פלואורסנציה תחת UV?', tip: 'כ-30% מהיהלומים זוהרים כחול תחת UV. סימן טוב לאמיתי' },
      { id: 'lab-grown', q: 'מעבדה - תווית "LG" בתעודה?', tip: 'IGI/GIA מסמנים LAB GROWN במפורש. אם חסר - בדוק שוב', critical: true },
      { id: 'inclusions', q: 'כתמים פנימיים נראים תחת לופה x10?', tip: 'יהלום טבעי כמעט תמיד עם כתם קטן. מושלם לחלוטין = חשוד' },
      { id: 'color-bg', q: 'צבע ל-G+ ללא BGM?', tip: 'BGM = Brown/Green/Milky tints. פוגעים בערך ב-20-40%' },
      { id: 'symmetry', q: 'סימטריה - חיתוך Excellent?', tip: 'GIA מעריך Cut: Excellent / VG / Good. EX משלם פרמיה 10-15%' },
      { id: 'price-rap', q: 'מחיר תואם מחיר רפפורט?', tip: 'Rapaport = רשימת מחירי שוק שבועית. הצעה ב-60% מטה = חשד' },
    ],
  },
  sefarim: {
    name: 'ספרי קודש עתיקים',
    icon: '📜',
    intro: 'דפוסים, חתימות, נייר - כל פרט חשוב',
    items: [
      { id: 'imprint', q: 'דף שער - מקום + שנת הדפסה?', tip: 'ויניציאה (וונציה), אמשטרדם, וילנא, וורשא - דפוסים יקרים', critical: true },
      { id: 'paper', q: 'נייר תקופתי - מרקם, צהיבות?', tip: 'נייר ‏400+ שנה - גס, מעט שקוף, "watermark" של בית הדפוס' },
      { id: 'binding', q: 'כריכת עור/קלף תקופתית?', tip: 'כריכת עור גס מקורית = ערך מוסף. כריכה חדשה = ערך נמוך' },
      { id: 'signatures', q: 'חתימות בעלים / הגהות יד?', tip: 'חתימת רב מפורסם = ערך פי 10. בדוק אצל מומחה כתב יד', critical: true },
      { id: 'completeness', q: 'שלמות הספר - דפים חסרים?', tip: 'גם דף שער חסר = ירידה משמעותית בערך. ספרו דפים' },
      { id: 'censorship', q: 'סימני צנזורה (קווים שחורים)?', tip: 'דווקא סימני צנזורה = הוכחה לתקופה - מוסיפים אותנטיות' },
      { id: 'haskama', q: 'הסכמות רבנים בתחילת הספר?', tip: 'הסכמות מקוריות מרבנים מפורסמים מוסיפות לערך' },
      { id: 'price', q: 'בדיקה ב-Bidspirit / Kedem בעבר?', tip: 'מאגר מכירות פומביות יהודיות - ‏מציג מחירי עבר על אותו ספר' },
    ],
  },
  judaica: {
    name: 'יודאיקה ועתיקות',
    icon: '🕎',
    intro: 'תקופה, חומר, סגנון אזורי - מפתחות לאותנטיות',
    items: [
      { id: 'silver-mark', q: 'סימן כסף (800/925) + סימן בודק?', tip: 'יודאיקה גרמנית/אוסטרית - סימוני state. רוסי: kokoshniki', critical: true },
      { id: 'patina', q: 'פטינה טבעית - אחידה ועמוקה?', tip: 'פטינה אמיתית 50+ שנה - לא מתפזרת בניקוי. זיוף "מזדקן" יורד' },
      { id: 'maker', q: 'חתימת אומן / סדנה?', tip: 'בצלאל ירושלים, Rosenthal, Posen, Bachrich = שמות יוקרתיים', critical: true },
      { id: 'period', q: 'סגנון תקופתי תואם (ארט נובו, ביידרמייר)?', tip: 'חנוכייה Art Nouveau ≠ סגנון בארוקי. אנכרוניזם = זיוף' },
      { id: 'wear', q: 'שחיקה במקומות לוגיים?', tip: 'ידיות, נקודות אחיזה - שחוקים יותר. שחיקה אחידה = חשד' },
      { id: 'soldering', q: 'חיבורים - הלחמה תקופתית?', tip: 'הלחמה ישנה = כסף עבה, אטית. מודרנית = כסף דק, מבריק' },
      { id: 'origin', q: 'מקור / היסטוריה תיעודית?', tip: 'תמונות ישנות, רישומים, ירושה משפחתית = מוסיף ערך' },
      { id: 'price', q: 'בדיקה ב-Sotheby\'s / Christie\'s עבר?', tip: 'מכירות עבר של בית מכירות גדול = הוכחה לערך' },
    ],
  },
  coin: {
    name: 'מטבעות נומיסמטיים',
    icon: '🪙',
    intro: 'משקל, חומר, חריטה - כל פרט קובע',
    items: [
      { id: 'weight-spec', q: 'משקל מדויק תואם מפרט?', tip: 'כל מטבע = משקל ידוע. חרגה ‏‎>‎0.1g = חשד', critical: true },
      { id: 'edge', q: 'קצה (Edge) - תווים/חירוץ תואמים?', tip: 'מטבעות זהב/כסף - קצה מחורץ או עם כתובת. חלק = חשד' },
      { id: 'magnet', q: 'בוחן מגנט - לא נמשך לזהב/כסף?', tip: 'אסור שמטבע זהב/כסף יימשך למגנט', critical: true },
      { id: 'mint-mark', q: 'סימן מטבעה (Mint mark)?', tip: 'אות קטנה ליד התאריך - מציינת איפה הוטבע. חיוני לערך' },
      { id: 'date-detail', q: 'פרטי תאריך חדים וברורים?', tip: 'מתחת זכוכית מגדלת - ספרות חדות, ‏לא מטושטשות' },
      { id: 'patina-coin', q: 'פטינה אחידה / טבעית?', tip: 'מטבע נחושת/ארד - פטינה ירוקה-חומה אחידה. זיוף = כתמים' },
      { id: 'sound', q: 'צליל זהב/כסף בנקישה?', tip: 'מטבע אמיתי - "פעמון" צלול. מתכת חיקוי = צליל מעוך' },
      { id: 'pcgs-ngc', q: 'בעטיפה PCGS / NGC / ICCS?', tip: 'בתי דירוג בינלאומיים - המטבע סגור עם דירוג. מאמת אותנטיות', critical: true },
      { id: 'rarity', q: 'נדירות אמיתית (Krause catalog)?', tip: 'מטבע "נדיר" שמוצע הרבה = לא נדיר. בדוק במאגר' },
    ],
  },
  art: {
    name: 'יצירות אומנות',
    icon: '🎨',
    intro: 'אותנטיות יצירת אומנות = מקצועי ויקר. רק לוודא לפני קנייה גדולה',
    items: [
      { id: 'signature', q: 'חתימת האמן - מיקום + סגנון תואם?', tip: 'כל אמן עם סגנון חתימה ייחודי. השוו ל-catalogue raisonné', critical: true },
      { id: 'provenance', q: 'תיעוד היסטוריית בעלות (Provenance)?', tip: 'מסמכים, תצלומים, קבלות. שרשרת בעלות עוקבת = מאמת', critical: true },
      { id: 'canvas', q: 'בד / נייר תקופתי?', tip: 'בד פשתן ישן ≠ בד מודרני. ניתן לבדוק במעבדה (yarn count)' },
      { id: 'paint-age', q: 'גיל הצבע - סדקים (craquelure) טבעיים?', tip: 'שמן 100+ שנה - סדקים עדינים אופייניים. זיוף = ללא סדקים' },
      { id: 'frame', q: 'מסגרת תקופתית מקורית?', tip: 'מוסיפה ל-15-30% מהערך. מסגרת חדשה = איבדה את המקור' },
      { id: 'expert', q: 'בדיקת מומחה (UV/IR/Carbon)?', tip: 'בדיקות מעבדה לאמת תקופה. בלי זה - אין ערוב מלא', critical: true },
      { id: 'auction', q: 'מופיע בסוטבי\'ס/כריסטיס/ת"א?', tip: 'מאגרי מכירות פומביות - עוקבים אחר ערך אמיתי' },
    ],
  },
  sneakers: {
    name: 'נעלי ספורט (Air Jordan, Yeezy)',
    icon: '👟',
    intro: 'תפרים, גלגלים, תוויות פנימיות - כל פרט',
    items: [
      { id: 'box-label', q: 'תווית קופסה - גודל, צבע, פונט תואם?', tip: 'נייקי: SKU 9 ספרות במבנה XXX-XXX. תווית בצד הקופסה', critical: true },
      { id: 'sku-shoe', q: 'תווית פנימית בנעל תואמת לקופסה?', tip: 'SKU + גודל בתווית פנימית = חייבים תואם לקופסה' },
      { id: 'stitching-snk', q: 'תפרים - אחידים וצפופים?', tip: 'נייקי אמיתי: תפרים ישרים, ללא חוטים תלויים. זיוף = רשלני', critical: true },
      { id: 'glue', q: 'דבק - נקי, ללא שאריות?', tip: 'נעלי יוקרה - דבק מקצועי. זיוף = שאריות דבק לבן/חום' },
      { id: 'sole-pattern', q: 'דוגמת סוליה תואמת מודל מקור?', tip: 'כל מודל - דוגמת סוליה ייחודית. בדוק תמונות רשמיות' },
      { id: 'logo-snk', q: 'לוגו Swoosh/Adidas - חד וסימטרי?', tip: 'נייקי: Swoosh עם זווית ספציפית. אדידס: 3 פסים שווים' },
      { id: 'weight-snk', q: 'משקל סביר (לא קל מדי)?', tip: 'נעל אמיתית בעלת חומר איכותי = כבדה יחסית' },
      { id: 'smell', q: 'ריח עור/גומי איכותי, לא כימי חזק?', tip: 'זיוף סיני = ריח כימי חזק (פלסטיק/דבק זול). מקור = ריח עור נעים' },
      { id: 'price-snk', q: 'מחיר 70%+ ממחיר StockX?', tip: 'StockX = שוק שני אמין. הצעה ב-50% מ-StockX = חשד גבוה', critical: true },
      { id: 'receipt-snk', q: 'קבלה מחנות רשמית/StockX?', tip: 'StockX מנפיק תעודת אותנטיות. גם Goat ו-Stadium Goods' },
    ],
  },
  electronics: {
    name: 'טלפונים ואלקטרוניקה',
    icon: '📱',
    intro: 'IMEI, מסך, חיבורים - כל סימן חשוב',
    items: [
      { id: 'imei', q: 'IMEI מודבק תואם הגדרות?', tip: 'הגדרות → כללי → IMEI. השווה למדבקה מאחור ולקופסה. 3 חייבים תואמים', critical: true },
      { id: 'imei-check', q: 'בדיקת IMEI ב-imei.info / Apple GSX?', tip: 'מאגר רשמי - מאמת אם המכשיר מקורי, מסטוס אחריות, מודל מדויק', critical: true },
      { id: 'screen-quality', q: 'מסך - חדות, צבעים, ללא ‏artifacts?', tip: 'אייפון אמיתי: צבעים מדויקים, ללא הילה. זיוף = פיקסליות, צבעים שטוחים', critical: true },
      { id: 'apple-id', q: 'אייפון - לא נעול ל-iCloud של מישהו?', tip: 'הפעלה מחדש - אם דורש Apple ID זר = פטור גנוב', critical: true },
      { id: 'connectors', q: 'מחבר Lightning/USB-C מקורי?', tip: 'אפל: מחבר מתכת איכותי. זיוף = פלסטיק רע, חיבור רעוע' },
      { id: 'sound', q: 'רמקולים - צליל נקי בלי חיתוך?', tip: 'בדוק שיר באמצע. זיוף = רמקול פצפץ, חיתוכים' },
      { id: 'haptic', q: 'הרגשת ויברציה - חדה לא מורגעת?', tip: 'אייפון 11+: Taptic Engine - חזק וחד. זיוף = ויברציה רגילה' },
      { id: 'battery-health', q: 'בריאות סוללה > 80%?', tip: 'הגדרות → סוללה → בריאות. מתחת ל-80% = החלפת סוללה בקרוב' },
      { id: 'price-elec', q: 'מחיר 70%+ ממחיר אמזון/יד2?', tip: 'אייפון 15 חדש = ₪4500. מחיר 1500 = זיוף 100%', critical: true },
    ],
  },
  vehicle: {
    name: 'רכב משומש',
    icon: '🚗',
    intro: 'בדיקה לפני קנייה - חוסך עשרות אלפי שקלים',
    items: [
      { id: 'vin-check', q: 'מספר שלדה (VIN) תואם רישיון?', tip: '17 ספרות מתחת לשמשה הקדמית. חייב להיות זהה ברישיון רכב', critical: true },
      { id: 'history', q: 'היסטוריית טיפולים מלאה?', tip: 'מוסכים מורשים - חותמות בכל טיפול. חוסר = ‏סימן רע' },
      { id: 'accidents', q: 'בדיקה לתאונות באתר משרד התחבורה?', tip: 'אתר תחבורה.gov.il → בדיקת רכב. כל פגיעה רשומה', critical: true },
      { id: 'mileage', q: 'קילומטראז\' תואם גיל הרכב?', tip: 'ממוצע 20K ק"מ לשנה. אם רכב 10 שנה = ~200K ק"מ. חצי = חשד' },
      { id: 'paint', q: 'צבע אחיד בכל הפנלים?', tip: 'הבדל גוון = צבע מחדש = תאונה. השתמש ב-app מד עובי צבע (חינם)' },
      { id: 'underbody', q: 'תחתית - חלודה / נזילות?', tip: 'דורש מכון בדיקה. חלודה = ירידה ב-30% מהערך. נזילות = תיקון יקר' },
      { id: 'engine-sound', q: 'מנוע - ריצה חלקה ושקטה?', tip: 'הקפד: ריצה חמה (15 דק\'), בלי רעידות, בלי עשן כחול/לבן' },
      { id: 'gearbox', q: 'תיבת הילוכים - מעבר חלק?', tip: 'אוטומט: מעברים בלי קפיצות. ידני: סנכרון תקין, ללא רעש מצמד' },
      { id: 'wear-tires', q: 'צמיגים - שחיקה אחידה?', tip: 'שחיקה לא אחידה = ‏בעיות בכוונון/בלמים/מתלים' },
      { id: 'price-vehicle', q: 'מחיר במסגרת מחיר ‏לוי יצחק?', tip: 'levyitzhak.co.il - מחירון רכבים רשמי בישראל. הצעה ב-30% מתחת = חשד', critical: true },
    ],
  },
  perfume: {
    name: 'בשמי יוקרה',
    icon: '🌹',
    intro: 'אריזה, קוד אצווה, ריח - מפתחות לאותנטיות',
    items: [
      { id: 'box-shrink', q: 'אריזה עטופה בניילון מקורי הדוק?', tip: 'בשם חדש = ניילון הדוק לקופסה. רפוי = פתחו או זיוף', critical: true },
      { id: 'batch-code', q: 'קוד אצווה - חרוט בתחתית הבקבוק?', tip: 'בדוק ב-checkfresh.com / checkcosmetic.net. מאמת תאריך ייצור' },
      { id: 'spray-quality', q: 'ריסוס דק ואחיד?', tip: 'בשם אמיתי = ריסוס מיקרו, ענן עדין. זיוף = טיפות גדולות' },
      { id: 'liquid-color', q: 'צבע נוזל תואם בדיוק לתמונות?', tip: 'אצל יצרן - בקרת איכות חמורה. גוון שונה = זיוף', critical: true },
      { id: 'smell-stage', q: 'פירמידה אמיתית (Top → Heart → Base)?', tip: 'בשם איכותי - מתפתח לאורך 2-4 שעות. זיוף = ריח שטוח קבוע' },
      { id: 'longevity', q: 'אורך חיים 6+ שעות על העור?', tip: 'EDP אמיתי: 6-10 שעות. זיוף: 1-2 שעות בלבד', critical: true },
      { id: 'cap-fit', q: 'פקק - מתאים בדיוק לבקבוק?', tip: 'מקור: פקק כבד, קליק חזק. זיוף: רופף, פלסטיק זול' },
      { id: 'serial-perfume', q: 'מספר סדרתי תואם בקופסה ובבקבוק?', tip: 'יצרנים גדולים מסמנים בשני המקומות. אי-התאמה = זיוף' },
      { id: 'price-perfume', q: 'מחיר 70-90% ממחיר Sephora?', tip: 'בשם 100ml ב-30% מתחת לסניף = זיוף. גם דיוטי פרי לא זול ב-50%', critical: true },
    ],
  },
};

let currentAuthCategory = null;
let authResults = {};

function openAuthChecker(category) {
  currentAuthCategory = category;
  authResults = {};
  renderAuthChecker();
}

function renderAuthChecker() {
  const cat = AUTH_CHECKLISTS[currentAuthCategory];
  if (!cat) return;

  const passedCount = Object.values(authResults).filter(v => v === 'pass').length;
  const failedCount = Object.values(authResults).filter(v => v === 'fail').length;
  const criticalFailed = cat.items
    .filter(item => item.critical && authResults[item.id] === 'fail')
    .length;

  // Calculate authenticity score
  const totalItems = cat.items.length;
  const answeredCount = Object.keys(authResults).length;
  const score = answeredCount === 0 ? null :
                criticalFailed >= 2 ? 0 :
                criticalFailed >= 1 ? 25 :
                Math.round((passedCount / totalItems) * 100);

  let verdict = '';
  let verdictClass = '';
  if (score === null) {
    verdict = 'התחל לסמן כל בדיקה';
    verdictClass = 'pending';
  } else if (criticalFailed >= 2) {
    verdict = '🚨 סבירות גבוהה לזיוף - אל תקנה';
    verdictClass = 'fake';
  } else if (criticalFailed >= 1) {
    verdict = '⚠ דגל אדום קריטי - דרוש בדיקה מקצועית';
    verdictClass = 'warning';
  } else if (score >= 85) {
    verdict = '✓ סבירות גבוהה לאמיתי';
    verdictClass = 'genuine';
  } else if (score >= 60) {
    verdict = '~ אמיתות בינונית - שווה לבדוק עוד';
    verdictClass = 'medium';
  } else {
    verdict = '⚠ דגלים אדומים - חשד לזיוף';
    verdictClass = 'warning';
  }

  $('#auth-view').innerHTML = `
    <div class="auth-header">
      <div class="auth-icon">${cat.icon}</div>
      <h3>בדיקת אמיתות: ${cat.name}</h3>
    </div>
    <div class="auth-intro">${cat.intro}</div>

    ${score !== null ? `
      <div class="auth-verdict auth-verdict-${verdictClass}">
        <div class="auth-score">${score}<span>%</span></div>
        <div class="auth-verdict-text">${verdict}</div>
        <div class="auth-stats">
          <span>✓ ${passedCount}</span>
          <span>✗ ${failedCount}</span>
          <span>○ ${totalItems - answeredCount}</span>
        </div>
      </div>
    ` : ''}

    <div class="auth-items">
      ${cat.items.map(item => {
        const status = authResults[item.id];
        return `
          <div class="auth-item ${status ? `auth-item-${status}` : ''}">
            <div class="auth-q">
              ${item.critical ? '<span class="auth-critical">קריטי</span>' : ''}
              ${escapeHtml(item.q)}
            </div>
            <div class="auth-tip">💡 ${escapeHtml(item.tip)}</div>
            <div class="auth-buttons">
              <button class="auth-btn auth-pass ${status === 'pass' ? 'active' : ''}" data-auth-id="${item.id}" data-auth-val="pass">✓ עובר</button>
              <button class="auth-btn auth-fail ${status === 'fail' ? 'active' : ''}" data-auth-id="${item.id}" data-auth-val="fail">✗ נכשל</button>
              <button class="auth-btn auth-skip ${status === 'skip' ? 'active' : ''}" data-auth-id="${item.id}" data-auth-val="skip">⊘ דלג</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    ${score !== null ? `
      <div class="auth-actions">
        <button class="btn-primary" id="btn-auth-save">💾 שמור דוח אותנטיות</button>
        <button class="btn-secondary" id="btn-auth-reset">↻ איפוס</button>
      </div>
    ` : ''}
  `;

  $$('.auth-btn').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.authId;
      const val = b.dataset.authVal;
      // Toggle: clicking same value clears it
      if (authResults[id] === val) {
        delete authResults[id];
      } else {
        authResults[id] = val;
      }
      renderAuthChecker();
    });
  });

  $('#btn-auth-reset')?.addEventListener('click', async () => {
    if (await ssDialog.confirm('לאפס את כל הבדיקות?', { danger: true })) {
      authResults = {};
      renderAuthChecker();
    }
  });

  $('#btn-auth-save')?.addEventListener('click', async () => {
    const name = await ssDialog.prompt('שם הפריט שנבדק:');
    if (!name) return;
    const opp = {
      id: uid(),
      name,
      category: 'general',
      status: 'watching',
      created: Date.now(),
      notes: `דוח אמיתות ${cat.name}\nציון: ${score}%\nמסקנה: ${verdict}\n\n${cat.items.map(item => {
        const s = authResults[item.id];
        if (!s) return '';
        const symbol = s === 'pass' ? '✓' : s === 'fail' ? '✗' : '○';
        return `${symbol} ${item.q}`;
      }).filter(Boolean).join('\n')}`,
      authReport: { category: currentAuthCategory, score, verdict, results: { ...authResults } },
    };
    // גם ציון 0 ("סבירות גבוהה לזיוף") נשמר — דווקא הוא חשוב לתיעוד. שמירה שהמחסן דחה — הפריט יוצא מהפנקס,
    // ורשימת הבדיקה נשארת על המסך (פעם נמחקה בכל מקרה; סקירת קוד 2.11.2026). ההודעה — מ-Storage.save
    state.opportunities.unshift(opp);
    if (!Storage.save('opportunities', state.opportunities)) {
      state.opportunities = state.opportunities.filter(o => o !== opp);
      return;
    }
    toast('✓ דוח נשמר בפנקס', 'success');
    authResults = {};
    renderAuthChecker();
  });
}

function renderAuthHubView() {
  const c = $('#auth-hub-view');
  if (!c) return;
  c.innerHTML = `
    <div class="auth-intro-main">
      <div style="font-size:48px;text-align:center;margin-bottom:8px">🔍</div>
      <h3 style="text-align:center;margin-bottom:8px">בדיקת אמיתות vs זיוף</h3>
      <div class="text-faint" style="text-align:center;font-size:13px;margin-bottom:20px">
        בחר סוג מוצר לבדיקה. תקבל צ'קליסט מקצועי + ציון אמיתות + דוח לשמירה
      </div>
    </div>
    <div class="hub-grid">
      ${Object.entries(AUTH_CHECKLISTS).map(([k, v]) => `
        <button class="hub-card" data-auth-cat="${k}">
          <div class="hc-icon">${v.icon}</div>
          <div class="hc-name">${v.name}</div>
          <div class="hc-desc">${v.items.length} נקודות בדיקה</div>
        </button>
      `).join('')}
    </div>
  `;
  $$('.hub-card[data-auth-cat]').forEach(b => {
    b.addEventListener('click', () => {
      $('#auth-hub-view').hidden = true;
      $('#auth-checker-view').hidden = false;
      openAuthChecker(b.dataset.authCat);
    });
  });
}


// Wire auth checker back button
(function wireAuth() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(wireAuth, 600));
    return;
  }
  setTimeout(() => {
    document.addEventListener('click', e => {
      if (e.target.id === 'btn-back-to-auth-hub') {
        $('#auth-checker-view').hidden = true;
        $('#auth-hub-view').hidden = false;
      }
    });
  }, 600);
})();
