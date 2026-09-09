# S-02a-2a-2 — exact reproduction

## Prerequisites

- **Mozilla Firefox 155.0.1** (release). Install on Windows with:
  ```bash
  winget install --id Mozilla.Firefox -e --silent
  ```
- Node 20+ (this run: v24.19.0)
- Port **8909** free
- A display. Headful.

```bash
cd artifacts/experiments/W1-S02a2a2-firefox-csp-tokens/harness
npm install web-ext@8.3.0
```

## Run — as reported

```bash
RUNS=3 node run-s02a2a2.js
# override the browser if it is elsewhere:
FIREFOX_PATH="C:\Program Files\Mozilla Firefox\firefox.exe" RUNS=3 node run-s02a2a2.js
```

Writes `../logs/results-s02a2a2-windows-ws1.json`.

## What the runner does

1. Starts a loopback collector on `127.0.0.1:8909` accepting three channels:
   `/alive` (liveness beacon), `/result` (fetch POST), `/sink?d=` (tab-navigation
   fallback, because Firefox MV3 gates `host_permissions` behind origin controls).
2. For each of four variants, uses **web-ext** to install the extension as a **temporary
   add-on** into a throwaway profile, with
   `--pref extensions.originControls.grantByDefault=true` **for reporting only**.
3. Waits for both contexts — event page and the dedicated worker spawned from it — then
   kills the browser and deletes the profile.
4. Captures the tail of the web-ext log, so a manifest Firefox rejects surfaces as an
   install failure rather than silently.

## Reading the result

- `aliveBeacon: true` means the event page **executed**. This is what separates *"the
  extension did not load"* from *"it loaded and the token blocked everything"* — and those
  two outcomes are exactly where Chrome and Firefox diverge.
- All four variants show `aliveBeacon: true` on Firefox. On Chrome, `'wasm-eval'` and
  `'unsafe-eval'` would show no service worker at all.
- `wasm.validate` is allowed in **every** variant. Only `wasm.compile` distinguishes them.

## Rollback of machine changes

```bash
rm -rf harness/node_modules          # web-ext
winget uninstall --id Mozilla.Firefox
```
