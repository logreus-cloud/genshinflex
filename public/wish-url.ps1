# GenshinFlex: finds your wish history link in the game cache and copies it to the clipboard.
# Sends nothing and changes nothing: it only reads the game log and the cache file.
# Before running, open Wish -> History in the game so the link gets cached.
# ASCII only on purpose: Windows PowerShell 5 may read downloaded scripts in a legacy encoding.

$ErrorActionPreference = 'Stop'
$logs = @(
  "$env:USERPROFILE\AppData\LocalLow\miHoYo\Genshin Impact\output_log.txt",
  "$env:USERPROFILE\AppData\LocalLow\miHoYo\$([char]0x539F)$([char]0x795E)\output_log.txt"
)
$log = $logs | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $log) { Write-Host 'Game log not found. Launch Genshin Impact at least once and try again.' -ForegroundColor Red; return }

$match = Select-String -Path $log -Pattern '([A-Z]:/.+?(GenshinImpact_Data|YuanShen_Data))' | Select-Object -Last 1
if (-not $match) { Write-Host 'Game path not found in the log. Open the game and try again.' -ForegroundColor Red; return }
$gameData = $match.Matches[0].Groups[1].Value

$cacheDir = Get-ChildItem (Join-Path $gameData 'webCaches') -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $cacheDir) { Write-Host 'Game browser cache not found. Open the wish history in the game.' -ForegroundColor Red; return }
$cacheFile = Join-Path $cacheDir.FullName 'Cache\Cache_Data\data_2'

# The game keeps the file open, so read a copy
$tmp = Join-Path $env:TEMP 'gf_data_2'
Copy-Item $cacheFile $tmp -Force
$text = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($tmp))
Remove-Item $tmp -Force

$url = ($text -split '1/0/') | Where-Object { $_ -match 'webview_gacha' -and $_ -match 'authkey=' } |
  ForEach-Object { ($_ -split "`0")[0] } | Select-Object -Last 1
if (-not $url) { Write-Host 'Link not found. Open Wish -> History in the game and run this again.' -ForegroundColor Red; return }

Set-Clipboard -Value $url
Write-Host 'Wish history link copied. Paste it on the GenshinFlex tracker page.' -ForegroundColor Green
