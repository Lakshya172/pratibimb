#!/usr/bin/env bash
# Sync .github/labels.yml to the GitHub repository.
# Idempotent: creates missing labels, updates existing ones. Never deletes.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v gh >/dev/null || { echo "gh CLI not found"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated"; exit 1; }

python - <<'PY' | while IFS=$'\t' read -r name color desc; do
import yaml
for l in yaml.safe_load(open(".github/labels.yml", encoding="utf-8")):
    print("%s\t%s\t%s" % (l["name"], l["color"], l["description"]))
PY
  if gh label create "$name" --color "$color" --description "$desc" 2>/dev/null; then
    echo "created  $name"
  else
    gh label edit "$name" --color "$color" --description "$desc" >/dev/null 2>&1 \
      && echo "updated  $name" || echo "SKIPPED  $name"
  fi
done
