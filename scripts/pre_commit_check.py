from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BFF_DIR = REPO_ROOT / "bff"
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".docx", ".lock", ".pyc"}

SECRET_PATTERN = re.compile(
    r"AKIA[0-9A-Z]{16}|"
    r"ASIA[0-9A-Z]{16}|"
    r"ghp_[A-Za-z0-9]{36}|"
    r"github_pat_[A-Za-z0-9_]{20,}|"
    r"sk-[A-Za-z0-9]{20,}|"
    r"-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----|"
    r"postgresql(\+asyncpg)?://\S+:\S+@\S+|"
    r"[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]\s*[:=]\s*[\"'][^\"']+[\"']|"
    r"[Ss][Ee][Cc][Rr][Ee][Tt]\s*[:=]\s*[\"'][^\"']+[\"']|"
    r"[Tt][Oo][Kk][Ee][Nn]\s*[:=]\s*[\"'][^\"']+[\"']"
)
IGNORE_PATTERN = re.compile(
    r"change-me|example|sample|dummy|placeholder|local-dev|test-token|test-secret|mock-secret|fake-secret|"
    r"your[_-]|<[^>]+>|{{[^}]+}}|redis://redis:6379|http://ollama:11434|http://rag-service:8000"
)


def run_command(command: list[str], *, cwd: Path | None = None) -> None:
    completed = subprocess.run(command, cwd=cwd or REPO_ROOT)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def capture_command(command: list[str]) -> str:
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout


def scan_staged_secrets() -> None:
    print("pre-commit: scanning staged changes for secrets...")
    output = capture_command(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    files = [REPO_ROOT / line.strip() for line in output.splitlines() if line.strip()]

    if not files:
        print("pre-commit: no staged files to scan.")
        return

    findings: list[str] = []
    for file_path in files:
        if not file_path.is_file() or file_path.suffix.lower() in SKIP_SUFFIXES:
            continue

        try:
            lines = file_path.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue

        relative = file_path.relative_to(REPO_ROOT).as_posix()
        for line_number, line in enumerate(lines, start=1):
            if SECRET_PATTERN.search(line) and not IGNORE_PATTERN.search(line):
                findings.append(f"{relative}:{line_number}:{line.strip()}")

    if findings:
        print("Potential secret leak detected:")
        for finding in findings:
            print(finding)
        print()
        print("Resolve the findings or replace them with environment-driven placeholders before commit.")
        raise SystemExit(1)

    print("pre-commit: secret scan passed.")


def resolve_npm_command() -> str:
    if sys.platform.startswith("win"):
        return "npm.cmd"
    return "npm"


def run_bff_tests() -> None:
    print("pre-commit: running BFF test suite...")
    run_command([resolve_npm_command(), "test"], cwd=BFF_DIR)


def run_rag_service_tests() -> None:
    print("pre-commit: running rag-service test suite...")
    run_command([sys.executable, "-m", "unittest", "discover", "-s", "rag-service/tests", "-v"])


def main() -> None:
    scan_staged_secrets()
    run_bff_tests()
    run_rag_service_tests()
    print("pre-commit: all checks passed.")


if __name__ == "__main__":
    main()
