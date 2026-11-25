#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="${LEO_NODE_BIN:-}"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  for p in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$p" ]; then
      NODE_BIN="$p"
      break
    fi
  done
fi
exec "$NODE_BIN" "$DIR/askpass.mjs" "$@"
