#!/bin/bash
# M8.2a — every launch, one at a time, in the WSL2 guest's Firefox 155.0.1 (Linux).
# Uses M8.2's runner UNCHANGED in behaviour; the amendment is the single --pref below.
#
#   bash run-m82a.sh validate   # harness validation (protocol §3) — never QG-03 evidence
#   bash run-m82a.sh validate-v2b  # V2 attempt 2 after the recording fix (README, deviations)
#   bash run-m82a.sh rerun      # the required Firefox WASM (Linux) cell, both candidates (protocol §4)
set -euo pipefail
PHASE="${1:?validate|rerun}"
LINUX_SH="/mnt/d/PratiBimb/artifacts/experiments/M8.2-qg03-visual-text-feasibility/browser/run-firefox-linux.sh"
OUT="/mnt/d/PratiBimb/artifacts/experiments/M8.2a-firefox-wasm-rerun/results"
AMEND="extensions.background.idle.timeout=900000"   # = AMENDMENT.arg in amendment.mjs
ff() { MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu-26.04 -u root -- bash "$LINUX_SH" --experiment M8.2a-firefox-wasm-rerun "$@" 2>&1 | tr -d '\r'; }
step() { echo "=== $(date -u +%H:%M:%S) $*"; }

if [ "$PHASE" = validate ]; then
  V="$OUT/validation"
  for C in TR-01 TR-02; do c=$(echo $C | tr A-Z a-z)
    step "V1 $C: amended probe run past 30 s"
    ff --candidate $C --mode cell --backend wasm --headless true --launches 1 --warm 40 --pref "$AMEND" --out-dir "$V" --label v1-$c-amended-warm40
  done
  step "V2 TR-01: default vs amended ordinary cell launch (profile prefs, outputs)"
  ff --candidate TR-01 --mode cell --backend wasm --headless true --launches 1 --out-dir "$V" --label v2-tr-01-default
  ff --candidate TR-01 --mode cell --backend wasm --headless true --launches 1 --pref "$AMEND" --out-dir "$V" --label v2-tr-01-amended
  for C in TR-01 TR-02; do c=$(echo $C | tr A-Z a-z)
    step "V3 $C: amended teardown + coexistence regression"
    ff --candidate $C --mode teardown --backend wasm --headless true --launches 1 --pref "$AMEND" --out-dir "$V" --label v3-$c-teardown-amended
    ff --candidate $C --mode coexist --backend wasm --headless true --launches 1 --pref "$AMEND" --out-dir "$V" --label v3-$c-coexist-amended
  done
elif [ "$PHASE" = validate-v2b ]; then
  # V2, attempt 2 (disclosed): attempt 1 could not read the profile prefs because web-ext copies the
  # profile; the runner now reads the running Firefox's own -profile. Same two launches, new labels.
  V="$OUT/validation"
  step "V2b TR-01: default vs amended ordinary cell launch (profile prefs, outputs)"
  ff --candidate TR-01 --mode cell --backend wasm --headless true --launches 1 --out-dir "$V" --label v2b-tr-01-default
  ff --candidate TR-01 --mode cell --backend wasm --headless true --launches 1 --pref "$AMEND" --out-dir "$V" --label v2b-tr-01-amended
elif [ "$PHASE" = rerun ]; then
  for C in TR-01 TR-02; do c=$(echo $C | tr A-Z a-z)
    for H in false true; do M=$([ $H = true ] && echo headless || echo headful)
      step "RERUN $C Firefox WASM (Linux) $M x3"
      ff --candidate $C --mode cell --backend wasm --headless $H --launches 3 --pref "$AMEND" --out-dir "$OUT" --label $c-cell-firefox-linux-wsl2-wasm-$M
    done
  done
fi
step done
