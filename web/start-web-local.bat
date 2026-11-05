@echo off
rem Local preview of the web gateway. Agent source/config lives in the separate AIT-Drive-Agent checkout.
cd /d %~dp0
if not exist local.env (
  echo local.env not found.
  pause
  exit /b 1
)
set "AGENT_DIR=%~dp0..\..\AIT-Drive-Agent"
if not exist "%AGENT_DIR%\agent.env" (
  echo Agent env not found at %AGENT_DIR%\agent.env
  echo Clone progstay17/AIT-Drive-Agent beside the AIT-Drive repository and configure it first.
  pause
  exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("local.env") do set "%%a=%%b"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%AGENT_DIR%\agent.env") do if "%%a"=="AGENT_TOKEN" set "AGENT_TOKEN=%%b"
set AGENT_URL=http://127.0.0.1:4001
set COOKIE_SECURE=false
echo Open http://localhost:3000  (username/password are in web\local.env)
node server.js
pause
