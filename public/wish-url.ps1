# GenshinFlex: finds your wish history link in the game cache and copies it to the clipboard.
# Only reads the game log and cache, and checks links against the official HoYoverse
# wish history API. Sends nowhere else and changes nothing.
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

$cacheDirs = @(Get-ChildItem (Join-Path $gameData 'webCaches') -Directory -ErrorAction SilentlyContinue)
$versioned = @($cacheDirs | Where-Object {
  $parsedVersion = $null
  [version]::TryParse($_.Name, [ref]$parsedVersion)
})
$cacheDir = if ($versioned.Count) {
  $versioned | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
} else {
  $cacheDirs | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $cacheDir) { Write-Host 'Game browser cache not found. Open the wish history in the game.' -ForegroundColor Red; return }
$cacheFile = Join-Path $cacheDir.FullName 'Cache\Cache_Data\data_2'
if (-not (Test-Path $cacheFile)) { Write-Host 'Wish history cache not found. Open Wish -> History in the game and run this again.' -ForegroundColor Red; return }

# The game keeps the file open, so read a copy (unique name: two windows at once do not clash)
$tmp = Join-Path $env:TEMP "gf_data_2_$([guid]::NewGuid().ToString('N'))"
try {
  Copy-Item $cacheFile $tmp -Force
  $text = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($tmp))
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$urls = @(($text -split '1/0/') | Where-Object { $_ -match 'webview_gacha' -and $_ -match 'authkey=' } |
  ForEach-Object { ($_ -split "`0")[0] } | Where-Object { $seen.Add($_) })
if (-not $urls.Count) { Write-Host 'Link not found. Open Wish -> History in the game and run this again.' -ForegroundColor Red; return }
[array]::Reverse($urls)

# Only well-formed absolute links with an authkey: the network fallback below copies one unverified
$candidates = @($urls | Where-Object {
  $parsedUri = $null
  [uri]::TryCreate($_, [UriKind]::Absolute, [ref]$parsedUri) -and $parsedUri.Query -match '(^|[?&])authkey=[^&]+'
} | Select-Object -First 30)
if (-not $candidates.Count) { Write-Host 'Link not found. Open Wish -> History in the game and run this again.' -ForegroundColor Red; return }
Write-Host "Checking $($candidates.Count) cached links..." -ForegroundColor Gray
$responses = 0
$expired = 0
$networkErrors = 0
$requests = 0
$validUrl = $null
foreach ($url in $candidates) {
  $uri = [uri]$url

  $apiHost = 'https://public-operation-hk4e-sg.hoyoverse.com'
  if ($uri.Host -match 'mihoyo\.com') { $apiHost = 'https://public-operation-hk4e.mihoyo.com' }
  $queryParts = @($uri.Query.TrimStart('?') -split '&' | Where-Object {
    $_ -and $_ -notmatch '^(gacha_type|size|lang)(=|$)'
  })
  $query = ($queryParts + @('gacha_type=301', 'size=1', 'lang=en')) -join '&'
  $apiUrl = "$apiHost/gacha_info/api/getGachaLog`?$query"

  if ($requests) { Start-Sleep -Milliseconds 300 }
  try {
    $requests++
    $response = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 10
    $responses++
    if ($response.retcode -eq -110) {
      Start-Sleep -Milliseconds 1500
      $requests++
      $response = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 10
      $responses++
    }
  } catch {
    $networkErrors++
    continue
  }

  if ($response.retcode -eq 0) { $validUrl = $url; break }
  if ($response.retcode -eq -101) { $expired++ }
}

if ($validUrl) {
  Set-Clipboard -Value $validUrl
  Write-Host 'Wish history link copied. Paste it on the GenshinFlex tracker page.' -ForegroundColor Green
} elseif ($responses -gt 0 -and $expired -eq $responses) {
  Write-Host 'All cached links are expired. Open Wish -> History in the game (wait for it to load), then run this again.' -ForegroundColor Red
} elseif ($responses -eq 0 -and $networkErrors -gt 0) {
  Set-Clipboard -Value $candidates[0]
  Write-Host 'Could not verify the link because the requests failed. Newest cached link copied.' -ForegroundColor Yellow
} else {
  Write-Host 'Link not found. Open Wish -> History in the game and run this again.' -ForegroundColor Red
}
