#!/bin/bash
# M8.2 — run run-firefox.mjs inside W1's WSL2 Ubuntu guest: the Firefox WASM (Linux) cell.
# Measurement tooling lives in /opt/pratibimb-tooling (Firefox 155.0.1 tarball, signature-verified;
# web-ext 8.3.0 from the committed lockfile). Nothing here is a product dependency.
#
# Usage (from Windows):  wsl.exe -d Ubuntu-26.04 -u root -- bash <this file> <run-firefox.mjs args...>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export FIREFOX_PATH=/opt/pratibimb-tooling/firefox/firefox
export WEB_EXT=/opt/pratibimb-tooling/webext/node_modules/web-ext/bin/web-ext.js
export PLATFORM_LABEL=linux-wsl2
export DISPLAY="${DISPLAY:-:0}"
exec node "$HERE/run-firefox.mjs" "$@"
