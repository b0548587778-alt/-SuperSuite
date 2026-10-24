# חידוש הטוקן של GitHub (NEXT-CHAT-PROMPT.md, "הסביבה"): הטוקן נקרא מהלוח, נשמר במנהל האישורים של Windows
# (git credential approve), והלוח מתרוקן. הטוקן לא מוצג, לא נכתב לקובץ ולא נשמר בהיסטוריה.
# הרצה: לחיצה כפולה על renew-github-token.bat בתיקיית הפרויקט.
$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root
# בלי חלון התחברות של git אם הטוקן לא תקין — רק הודעה
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'

Write-Host ''
Write-Host 'חידוש הטוקן של GitHub'
Write-Host '1. ב-Chrome: GitHub ← Settings ← Developer settings ← Personal access tokens ← Tokens (classic) ← Generate new token (classic)'
Write-Host '2. לסמן repo ו-workflow, לבחור תוקף, וליצור.'
Write-Host '3. להעתיק את הטוקן (Ctrl+C) ולחזור לחלון הזה.'
Write-Host ''
Read-Host 'אחרי שהעתקת — Enter'

$token = Get-Clipboard -Raw
if ($token) { $token = $token.Trim() }
if (-not $token -or $token -notmatch '^(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})$') {
  $token = $null
  Write-Host 'בלוח אין טוקן של GitHub (מתחיל ב-ghp_ או ב-github_pat_). לא שונה כלום.'
  Read-Host 'Enter לסגירה'
  exit 1
}

# הטוקן הישן יוצא ממנהל האישורים, והחדש נכנס במקומו
"protocol=https`nhost=github.com`n" | git credential reject
"protocol=https`nhost=github.com`nusername=b0548587778-alt`npassword=$token`n" | git credential approve
$token = $null
Set-Clipboard -Value ' '

git ls-remote --heads origin master *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host 'הצליח: הטוקן נשמר והחיבור ל-GitHub עובד. הלוח נוקה.'
} else {
  Write-Host 'הטוקן נשמר, אבל החיבור ל-GitHub נכשל. בדוק שסימנת repo ו-workflow ושהעתקת את כל הטוקן, ונסה שוב.'
}
Read-Host 'Enter לסגירה'
