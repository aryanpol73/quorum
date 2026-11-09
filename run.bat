@echo off
REM Starts the QUORUM backend (FastAPI on :8000) in a new window and the frontend (Vite on :5173) here.
REM First run creates .venv, installs Python + npm dependencies and copies .env.example -> .env.
setlocal
cd /d "%~dp0"

if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example - add GEMINI_API_KEY for live LLM reasoning ^(optional^).
)

if not exist .venv\Scripts\python.exe (
  echo Creating virtual environment ^(.venv^)...
  py -3.11 -m venv .venv 2>nul || python -m venv .venv
  if errorlevel 1 (
    echo Python 3.11+ is required. Install it from https://www.python.org/downloads/
    exit /b 1
  )
)

if not exist .venv\.deps-installed (
  echo Installing Python dependencies...
  .venv\Scripts\python -m pip install --upgrade pip >nul
  .venv\Scripts\python -m pip install -r backend\requirements.txt
  if errorlevel 1 exit /b 1
  type nul > .venv\.deps-installed
)

if not exist frontend\node_modules (
  echo Installing frontend dependencies...
  pushd frontend
  call npm install
  if errorlevel 1 exit /b 1
  popd
)

echo Starting backend on http://localhost:8000 ...
start "QUORUM backend" cmd /k ".venv\Scripts\python -m uvicorn backend.main:app --port 8000"

echo Starting frontend on http://localhost:5173 ...
cd frontend
call npm run dev
