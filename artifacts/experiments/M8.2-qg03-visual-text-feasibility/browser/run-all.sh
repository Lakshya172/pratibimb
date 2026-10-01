#!/bin/bash
# M8.2 — every recorded measurement, in the protocol's order, strictly one launch at a time.
# Git Bash on W1. The Linux cell runs inside the WSL2 guest through run-firefox-linux.sh.
#
#   CHROME_PATH=<chromium-1243 chrome.exe> WEB_EXT_WIN=<web-ext.js> bash run-all.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${CHROME_PATH:?}"; : "${WEB_EXT_WIN:?}"
FF_WIN="C:/Program Files/Mozilla Firefox/firefox.exe"
LINUX_SH="/mnt/d/PratiBimb/artifacts/experiments/M8.2-qg03-visual-text-feasibility/browser/run-firefox-linux.sh"
chromium() { node "$HERE/run-chromium.mjs" "$@"; }
ffwin() { FIREFOX_PATH="$FF_WIN" WEB_EXT="$WEB_EXT_WIN" PLATFORM_LABEL=windows node "$HERE/run-firefox.mjs" "$@"; }
fflinux() { MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu-26.04 -u root -- bash "$LINUX_SH" "$@" 2>&1 | tr -d '\r'; }
step() { echo "=== $(date -u +%H:%M:%S) $*"; }

for C in TR-01 TR-02; do
  for B in wasm webgpu; do for H in false true; do step "cell chromium $C $B headless=$H"; chromium --candidate $C --mode cell --backend $B --headless $H --launches 3; done; done
  for B in webgpu wasm; do for H in false true; do step "cell firefox-windows $C $B headless=$H"; ffwin --candidate $C --mode cell --backend $B --headless $H --launches 3; done; done
  for H in false true; do step "cell firefox-linux $C wasm headless=$H"; fflinux --candidate $C --mode cell --backend wasm --headless $H --launches 3; done
done
for C in TR-01 TR-02; do
  step "teardown $C"
  chromium --candidate $C --mode teardown --backend wasm --headless false --launches 1
  chromium --candidate $C --mode teardown --backend webgpu --headless false --launches 1
  ffwin --candidate $C --mode teardown --backend wasm --headless false --launches 1
  fflinux --candidate $C --mode teardown --backend wasm --headless true --launches 1
  step "coexist $C"
  chromium --candidate $C --mode coexist --backend wasm --headless false --launches 3
  ffwin --candidate $C --mode coexist --backend wasm --headless false --launches 1
  fflinux --candidate $C --mode coexist --backend wasm --headless true --launches 1
done
step "controlled benchmark"
chromium --plan bench --rounds 10 --label bench-chromium-wasm
step "done"
