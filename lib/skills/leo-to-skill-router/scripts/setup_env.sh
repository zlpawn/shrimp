#!/usr/bin/env bash
set -euo pipefail

# setup_env.sh - Initialize or update the Python virtualenv for leo-to-skill-router using uv.

VENV_DIR="${1:-$HOME/.shrimp/skills/leo-to-skill-router/.venv}"
echo "==> Target Python venv: $VENV_DIR"

if ! command -v uv >/dev/null 2>&1; then
  echo "[error] 'uv' is not installed or not in PATH." >&2
  echo "        Please install uv first: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi

mkdir -p "$(dirname "$VENV_DIR")"

if [ ! -d "$VENV_DIR" ]; then
  echo "==> Creating virtual environment with uv..."
  uv venv "$VENV_DIR"
else
  echo "==> Existing virtual environment found."
fi

PYTHON_BIN="$VENV_DIR/bin/python"
echo "==> Python binary: $PYTHON_BIN"

echo "==> Ensuring foundational dependencies for extraction..."
# Foundation libraries for document parsing
uv pip install --python "$PYTHON_BIN" pypdf python-docx ebooklib beautifulsoup4 trafilatura

echo "==> Environment ready at $VENV_DIR"
