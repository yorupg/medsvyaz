# Запуск самостоятельной Lite-версии. Старые Docker-контейнеры не трогаются.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path 'data/processed/kaliningrad-pilot.json.br')) { throw 'Нет обязательных данных Light. Распакуйте НОВЫЙ self-contained архив полностью.' }
$env:MEDSVYAZ_PORT = '5182'
Write-Host 'Проверка и сборка Lite...' -ForegroundColor Cyan
docker compose -p medsvyaz24-lite up --build -d
if ($LASTEXITCODE -ne 0) { throw 'Docker build failed. Read the error above.' }
Start-Sleep -Seconds 4
Write-Host 'Контейнеры:' -ForegroundColor Cyan
docker compose -p medsvyaz24-lite ps -a
$ok=$false
for ($n=1;$n -le 10;$n++) {
 try { $res=Invoke-RestMethod 'http://localhost:5182/api/health' -TimeoutSec 3; if ($res.status -eq 'ok') { $ok=$true; break } } catch { Start-Sleep -Seconds 2 }
}
if ($ok) { Write-Host 'ГОТОВО: http://localhost:5182' -ForegroundColor Green }
else { Write-Warning 'Сервер ещё не отвечает. Вывод ошибок:'; docker compose -p medsvyaz24-lite logs --tail=80 web }
