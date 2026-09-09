# S-02a-2a-4 — exact reproduction

## Prerequisites

- Node 20+ (this run: v24.19.0)
- A Chromium-family browser that honours `--load-extension`. **Branded Chrome 152 does
  NOT** (W1-S01 finding C1). Used here: unbranded Chromium `151.0.7922.34` from the
  Playwright cache, and branded Edge `152.0.4191.66` via the `msedge` channel.
- A display. **Headful is required** — the headless shell cannot load extensions.
- Ports **8907** and **8908** free. They are two different origins; that is the experiment.

```bash
cd artifacts/experiments/W1-S02a2a4-connect-src-provenance/harness
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright@1.63.0
```

> `npx playwright install` fails on this machine (`Download failure, code=1`), the same
> symptom W1-S01b recorded on workstation 2. Drive a browser already installed.

## Run — both cells, as reported

```bash
PLATFORM_LABEL=windows-ws1 BROWSER_LABEL=chromium-151 \
  CHROME_PATH="C:\Users\RONIT\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe" \
  RUNS=3 node run-s02a2a4.js

PLATFORM_LABEL=windows-ws1 BROWSER_LABEL=edge-152 CHANNEL=msedge \
  RUNS=3 node run-s02a2a4.js
```

Writes `../logs/results-s02a2a4-<platform>-<browser>.json`.

## What the runner does, and why each part matters

1. Starts **two** servers, each with its own arrival log:
   `8907` = ALLOWED (collector + `/allowed.wasm`), `8908` = FOREIGN (`/foreign.wasm`).
   Both serve **byte-identical** WASM, so origin is the only variable.
2. For each variant, launches headful with a throwaway profile and `--load-extension`.
   **Both origins are in `host_permissions` in every variant** — that is what makes a block
   attributable to `connect-src`.
3. Confirms the extension loaded via `ctx.serviceWorkers()` before falling back to
   `waitForEvent`, so an unloaded extension cannot look like a blocked one.
4. Waits for all three contexts, then **holds the servers open a further 2.5 s** so a late
   request still counts as an arrival.
5. Cross-checks the probe's self-report against the foreign arrival log and emits one of
   `CONSISTENT_BLOCKED` / `FALSE_GREEN` / `CONSISTENT_ALLOWED` / `ANOMALY`.

## Reading the result

- `ext-pinned` + `foreignOriginArrivals: 0` + `CONSISTENT_BLOCKED` → blocked before the wire.
- `ext-unpinned` + `foreignOriginArrivals: 6` → **the detector works**. Without this control
  a zero would be meaningless.
- `FALSE_GREEN` would mean the probe reported blocked while bytes reached the far end. It
  did not occur, and it is asserted for rather than assumed away.

## Cleanup

Profiles are deleted by the runner. `node_modules/` is gitignored.
```bash
rm -rf harness/node_modules
```
