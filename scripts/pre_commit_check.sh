#!/bin/sh

set -eu

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

echo "pre-commit: scanning staged changes for secrets..."
sh scripts/scan_secrets.sh --staged

echo "pre-commit: running BFF test suite..."
cmd.exe /c "cd /d bff && npm.cmd test"

echo "pre-commit: running rag-service test suite..."
if command -v python3 >/dev/null 2>&1; then
  python3 -m unittest discover -s rag-service/tests -v
elif command -v python >/dev/null 2>&1; then
  python -m unittest discover -s rag-service/tests -v
elif cmd.exe /c "where py >NUL 2>NUL"; then
  cmd.exe /c "py -3 -m unittest discover -s rag-service/tests -v"
else
  echo "pre-commit: no supported Python interpreter found. Expected python3, python, or py -3." >&2
  exit 1
fi

echo "pre-commit: all checks passed."
