# חתימת תעודה למפתח שרת הרישוי (docs/LICENSING-ACTIVATION.md שלב 7).
# הסיסמה נקלטת מוסתרת ונמחקת מהזיכרון של החלון בסוף — לא נשמרת בהיסטוריה ולא בקובץ.
# הרצה: לחיצה ימנית ← "Run with PowerShell", או: powershell -ExecutionPolicy Bypass -File tools\licensing\sign-relay-cert.ps1
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root
if (-not (Test-Path 'relay-key.pub.json')) { Write-Host 'Missing relay-key.pub.json in the project folder'; Read-Host 'Press Enter'; exit 1 }
$secure = Read-Host 'Owner password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:SS_OWNER_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  node tools/licensing/owner.js relay-cert --dir "$env:APPDATA\super-suite\owner" --relay-pub relay-key.pub.json --url https://supersuite-license.duckdns.org --months 24 --out relay-cert.json
} finally {
  Remove-Item Env:SS_OWNER_PASSPHRASE -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if (Test-Path 'relay-cert.json') { Write-Host 'OK: relay-cert.json created' } else { Write-Host 'FAILED: no relay-cert.json' }
Read-Host 'Press Enter to close'
