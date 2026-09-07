#!/usr/bin/env bash
# Advisory pre-commit scan of STAGED content for secret-shaped and PII-shaped material.
#
# THIS SCRIPT CANNOT PROVE THE ABSENCE OF A SECRET. It catches common shapes.
# You are still responsible for reading `git diff --cached`. See SECURITY.md.
set -uo pipefail
cd "$(dirname "$0")/.."

staged=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$staged" ] && { echo "check-secrets: nothing staged"; exit 0; }

fail=0
note() { echo "  [$1] $2"; }

echo "check-secrets: scanning $(echo "$staged" | wc -l | tr -d ' ') staged file(s)"

# ── Banned file shapes ──────────────────────────────────────
while IFS= read -r f; do
  case "$f" in
    .env|.env.*) [ "$f" = ".env.example" ] || { note FAIL "$f — .env must never be committed"; fail=1; };;
    *.pem|*.key|*.p12|*.pfx|*.crt|*.cer) note FAIL "$f — key material"; fail=1;;
    *.onnx|*.safetensors|*.gguf|*.pt|*.pth|*.bin) note FAIL "$f — model weights must be referenced, not vendored"; fail=1;;
  esac
  # Large blobs
  if [ -f "$f" ]; then
    sz=$(wc -c < "$f" | tr -d ' ')
    [ "$sz" -gt 5242880 ] && { note WARN "$f — ${sz} bytes (>5 MB); is this really source?"; }
  fi
done <<< "$staged"

# ── Secret-shaped content ───────────────────────────────────
scan() { git diff --cached -U0 -- $staged | grep -nEi "^\+.*($1)" 2>/dev/null | head -5; }

declare -a PATS=(
  "gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"
  "hf_[A-Za-z0-9]{30,}"
  "sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}"
  "-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"
  "(api[_-]?key|secret|passwd|password|token)[\"' ]*[:=][\"' ]*[A-Za-z0-9/+=_-]{16,}"
)
declare -a NAMES=("GitHub token" "HuggingFace token" "Generic API key" "Private key block" "Assigned credential")
for i in "${!PATS[@]}"; do
  hit=$(scan "${PATS[$i]}")
  [ -n "$hit" ] && { note FAIL "${NAMES[$i]}"; echo "$hit" | sed 's/^/        /'; fail=1; }
done

# ── PII-shaped content (synthetic fixtures only!) ───────────
# Aadhaar-shaped: 12 digits. PAN-shaped. Indian mobile. These are WARNINGS —
# synthetic fixtures legitimately contain them. A human confirms they are synthetic.
piihit=$(git diff --cached -U0 -- $staged \
  | grep -nE "^\+.*([^0-9][0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[^0-9]|[A-Z]{5}[0-9]{4}[A-Z]|\+91[ -]?[6-9][0-9]{9})" 2>/dev/null | head -5)
[ -n "$piihit" ] && {
  note WARN "PII-shaped literal(s) found. Confirm these are SYNTHETIC (SECURITY.md §2):"
  echo "$piihit" | sed 's/^/        /'
}

if [ "$fail" -ne 0 ]; then
  echo "check-secrets: FAIL — do not commit. See SECURITY.md."
  exit 1
fi
echo "check-secrets: no blocking findings (advisory only — still read your diff)"
