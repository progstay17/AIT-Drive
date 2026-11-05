@echo off
rem Cloud Drive agent launcher. Copy agent.env.example to agent.env and fill in values first.
cd /d %~dp0
if not exist agent.env (
  echo agent.env not found. Copy agent.env.example to agent.env and edit it.
  pause
  exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("agent.env") do set "%%a=%%b"
node server.js
pause
