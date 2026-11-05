@echo off
rem Local preview of the web app (talks to the agent on this PC). Start agent\start-agent.bat first.
cd /d %~dp0
if not exist local.env (
  echo local.env not found.
  pause
  exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("local.env") do set "%%a=%%b"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("..\agent\agent.env") do if "%%a"=="AGENT_TOKEN" set "AGENT_TOKEN=%%b"
set AGENT_URL=http://127.0.0.1:4001
set COOKIE_SECURE=false
echo Open http://localhost:3000  (username/password are in web\local.env)
node server.js
pause
