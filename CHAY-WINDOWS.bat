@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Chua tim thay Node.js. Hay cai Node.js LTS tai https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules call npm install
if not exist .env copy .env.example .env
start "Binh chon Tay Nam" http://localhost:3000/admin
echo Dang khoi dong may chu. Trang quan tri: http://localhost:3000/admin
npm start
pause
