# Start RouteGuard locally (SQLite + fixtures by default)
$root = Split-Path -Parent $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; .\venv\Scripts\Activate.ps1; python manage.py runserver 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend'; npm run dev -- --host 127.0.0.1 --port 5173"
Write-Host "Backend:  http://127.0.0.1:8000/api/health/"
Write-Host "Frontend: http://127.0.0.1:5173/"
