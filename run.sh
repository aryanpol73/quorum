#!/usr/bin/env bash
# Starts the QUORUM backend (FastAPI on :8000) and frontend (Vite on :5173).
# First run creates .venv, installs Python + npm dependencies and copies .env.example -> .env.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example - add GEMINI_API_KEY for live LLM reasoning (optional)."
fi

PY=""
for candidate in python3.11 python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then PY="$candidate"; break; fi
done
[ -n "$PY" ] || { echo "Python 3.11+ is required."; exit 1; }

if [ ! -d .venv ]; then
  echo "Creating virtual environment (.venv)..."
  "$PY" -m venv .venv
fi
if [ -f .venv/bin/activate ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
else
  # Git Bash on Windows
  # shellcheck disable=SC1091
  source .venv/Scripts/activate
fi

if [ ! -f .venv/.deps-installed ] || [ backend/requirements.txt -nt .venv/.deps-installed ]; then
  echo "Installing Python dependencies..."
  python -m pip install --upgrade pip >/dev/null
  python -m pip install -r backend/requirements.txt
  touch .venv/.deps-installed
fi

if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend dependencies..."
  (cd frontend && npm install)
fi

echo "Starting backend on http://localhost:8000 ..."
python -m uvicorn backend.main:app --port 8000 &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT INT TERM

echo "Starting frontend on http://localhost:5173 ..."
cd frontend
npm run dev
