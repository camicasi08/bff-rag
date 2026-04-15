#!/usr/bin/env sh

set -eu

usage() {
  cat <<'EOF'
Usage: scripts/scan_secrets.sh --staged | --all

Scans staged changes or tracked repository files for likely secrets.
Blocks on high-confidence findings and ignores explicit placeholder values
such as change-me examples.
EOF
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

mode="$1"
case "$mode" in
  --staged|--all)
    ;;
  *)
    usage
    exit 2
    ;;
esac

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to scan secrets." >&2
  exit 2
fi

workdir="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$workdir"

tmp_files="$(mktemp)"
tmp_hits="$(mktemp)"
trap 'rm -f "$tmp_files" "$tmp_hits"' EXIT INT TERM

if [ "$mode" = "--staged" ]; then
  git diff --cached --name-only --diff-filter=ACMR >"$tmp_files"
else
  git ls-files >"$tmp_files"
fi

if [ ! -s "$tmp_files" ]; then
  echo "No files to scan."
  exit 0
fi

patterns='AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----|postgresql(\+asyncpg)?://[^[:space:]'"'"'"]+:[^[:space:]'"'"'"]+@[^[:space:]'"'"'"]+|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd][[:space:]]*[:=][[:space:]]*["'"'"'"][^"'"'"']+["'"'"'"]|[Ss][Ee][Cc][Rr][Ee][Tt][[:space:]]*[:=][[:space:]]*["'"'"'"][^"'"'"']+["'"'"'"]|[Tt][Oo][Kk][Ee][Nn][[:space:]]*[:=][[:space:]]*["'"'"'"][^"'"'"']+["'"'"'"]'

ignore_patterns='change-me|example|sample|dummy|placeholder|local-dev|test-token|your[_-]|<[^>]+>|{{[^}]+}}|redis://redis:6379|http://ollama:11434|http://rag-service:8000'

while IFS= read -r file; do
  [ -f "$file" ] || continue
  case "$file" in
    *.png|*.jpg|*.jpeg|*.gif|*.pdf|*.docx|*.lock|*.pyc)
      continue
      ;;
  esac
  if git grep -nI -E "$patterns" -- "$file" >>"$tmp_hits" 2>/dev/null; then
    :
  fi
done <"$tmp_files"

if [ ! -s "$tmp_hits" ]; then
  echo "Secret scan passed."
  exit 0
fi

if grep -Eiv "$ignore_patterns" "$tmp_hits" >"$tmp_hits.filtered"; then
  mv "$tmp_hits.filtered" "$tmp_hits"
else
  rm -f "$tmp_hits.filtered"
  echo "Secret scan passed."
  exit 0
fi

echo "Potential secret leak detected:"
cat "$tmp_hits"
echo
echo "Resolve the findings or replace them with environment-driven placeholders before commit/push."
exit 1
