; התאמות למתקין (PLAN.md 1.3). נכלל דרך build.nsis.include
; התקנה תמיד למשתמש הנוכחי — אותה תיקייה כמו ההתקנה השקטה של 3.10.0, כדי שעדכון לא ייצור התקנה שנייה
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; מסך ברוכים הבאים
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "ברוכים הבאים ל-SuperSuite"
  !define MUI_WELCOMEPAGE_TEXT "התוכנה תותקן במחשב שלך ותעבוד גם בלי אינטרנט.$\r$\n$\r$\nכל הנתונים נשמרים במחשב בלבד, מוצפנים.$\r$\n$\r$\nאם כבר יש לך גרסה קודמת — הנתונים שלך נשמרים כמו שהם.$\r$\n$\r$\nלחצו 'הבא' כדי להמשיך."
  !insertmacro MUI_PAGE_WELCOME
!macroend
