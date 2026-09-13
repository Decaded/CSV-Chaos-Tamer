#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install it from https://nodejs.org (the latest LTS version), then double-click this file again."
  read -r -p "Press Enter to exit…" _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install
fi

node web-server.js

echo
read -r -p "Press Enter to close…" _
