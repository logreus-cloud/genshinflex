# GenshinFlex: находит ссылку на историю молитв в кэше игры и копирует её в буфер обмена.
# Ничего не отправляет и не меняет: только читает журнал игры и файл кэша.
# Перед запуском откройте в игре «Молитва» → «История», чтобы ссылка попала в кэш.

$ErrorActionPreference = 'Stop'
$logs = @(
  "$env:USERPROFILE\AppData\LocalLow\miHoYo\Genshin Impact\output_log.txt",
  "$env:USERPROFILE\AppData\LocalLow\miHoYo\$([char]0x539F)$([char]0x795E)\output_log.txt"
)
$log = $logs | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $log) { Write-Host 'Журнал игры не найден. Запустите Genshin Impact хотя бы раз и повторите.' -ForegroundColor Red; return }

$match = Select-String -Path $log -Pattern '([A-Z]:/.+?(GenshinImpact_Data|YuanShen_Data))' | Select-Object -Last 1
if (-not $match) { Write-Host 'В журнале нет пути к игре. Откройте игру и повторите.' -ForegroundColor Red; return }
$gameData = $match.Matches[0].Groups[1].Value

$cacheDir = Get-ChildItem (Join-Path $gameData 'webCaches') -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $cacheDir) { Write-Host 'Кэш браузера игры не найден. Откройте историю молитв в игре.' -ForegroundColor Red; return }
$cacheFile = Join-Path $cacheDir.FullName 'Cache\Cache_Data\data_2'

# Игра держит файл открытым — читаем копию
$tmp = Join-Path $env:TEMP 'gf_data_2'
Copy-Item $cacheFile $tmp -Force
$text = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($tmp))
Remove-Item $tmp -Force

$url = ($text -split '1/0/') | Where-Object { $_ -match 'webview_gacha' -and $_ -match 'authkey=' } |
  ForEach-Object { ($_ -split "`0")[0] } | Select-Object -Last 1
if (-not $url) { Write-Host 'Ссылка не найдена. Откройте в игре «Молитва» → «История» и запустите снова.' -ForegroundColor Red; return }

Set-Clipboard -Value $url
Write-Host 'Ссылка на историю молитв скопирована. Вставьте её на странице трекера.' -ForegroundColor Green
