# S-01b — commands and raw output

Every command below was run in Git Bash on the workstation described in
[`environment.json`](environment.json), on 2026-09-07.

## 1. Install the automation stack

```bash
npm init -y
npm install --no-audit --no-fund playwright@latest
node -e "console.log('playwright', require('playwright/package.json').version)"
# -> playwright 1.63.0
```

## 2. Attempt to install Playwright's own browser — FAILED

```bash
npx playwright install chromium
```

```
Failed to install browsers
Error: Failed to download Chrome for Testing 153.0.8010.12 (playwright chromium v1243),
caused by Error: Download failure, code=1
```

Attempted twice. Both attempts ended in a socket timeout / gateway error. The endpoints
were then probed directly:

```bash
curl -sSL -o /dev/null -w "%{http_code}\n" --max-time 45 -r 0-100000 \
  "https://playwright.download.prss.microsoft.com/dbazure/download/playwright/builds/chromium/1243/chromium-win64.zip"
# -> 400

curl -sSL -o /dev/null -w "%{http_code}\n" --max-time 45 -r 0-100000 \
  "https://playwright.azureedge.net/builds/chromium/1243/chromium-win64.zip"
# -> 400

curl -sSL -o /dev/null -w "%{http_code}\n" --max-time 45 -r 0-100000 \
  "https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/win64/chrome-win64.zip"
# -> 206      (Google's bucket serves it; Playwright's CDN does not)
```

`npm install` had succeeded moments earlier in the same shell, so general network egress
works. **The failure is specific to Playwright's browser CDN.**

## 3. Substitute the named build from Google's official bucket — STILL FAILED

Playwright's own error names the build it wanted: *Chrome for Testing 153.0.8010.12*. That
exact build was fetched from Google's official bucket and placed at Playwright's expected
path.

```bash
curl -sSL --max-time 900 --retry 3 -o cft.zip \
  "https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/win64/chrome-win64.zip"
sha256sum cft.zip
# -> 415968b02065d4a9e2c10b85f0ae9f489b8fba500e94d9d0a7b7c4852a7234c1

unzip -q -o cft.zip -d "$LOCALAPPDATA/ms-playwright/chromium-1243"
"$LOCALAPPDATA/ms-playwright/chromium-1243/chrome-win64/chrome.exe" --version
# -> Permission denied
```

Re-extracted cleanly with PowerShell `Expand-Archive` to rule out a bad extraction:

```
Program 'chrome.exe' failed to run: The application has failed to start because its
side-by-side configuration is incorrect.
```

**Not remediated.** Installing a system-wide Visual C++ redistributable is a human
decision, not a spike action. Variants A, B and C are therefore recorded as blocked, and
the literal S-01b question stays `UNKNOWN`.

## 4. The five-variant matrix

```bash
node run-s01b.js          # -> results.json  (committed as logs/results-matrix.json)
```

```
=== A-bundled-chromium-headed-observe ===
{ "launched": false, "launchError": "browserType.launchPersistentContext: spawn UNKNOWN",
  "extensionLoaded": false, "observedByPlaywright": 0, "actuallyArrived": 0 }

=== B-bundled-chromium-headed-block ===
{ "launched": false, "launchError": "browserType.launchPersistentContext: spawn UNKNOWN",
  "extensionLoaded": false, "observedByPlaywright": 0, "actuallyArrived": 0 }

=== C-bundled-chromium-headless-observe ===
{ "launched": false, "launchError": "Executable doesn't exist at ...
  chromium_headless_shell-1243\\chrome-headless-shell-win64\\chrome-headless-shell.exe" }

=== D-branded-chrome-stable-headed-observe ===
{ "launched": true, "launchError": null, "extensionLoaded": false,
  "observedByPlaywright": 0, "routed": 0, "actuallyArrived": 0, "probe": null }

=== E-branded-edge-stable-headed-observe ===
{ "launched": true, "launchError": null, "extensionLoaded": true,
  "observedByPlaywright": 2, "routed": 2, "actuallyArrived": 3,
  "probe": { "serviceWorker": { "ok": true, "status": 200 },
             "offscreen":     { "ok": true, "status": 200 } } }
```

Variant E, itemised — **2 observed, 3 arrived**:

```
collector actually received      playwright observed
  GET  /ready/service-worker       GET  .../ready/service-worker
  POST /egress/service-worker      POST .../egress/service-worker
  POST /egress/offscreen-document  (nothing)
```

## 5. The decisive blocking test — 3 runs

A route handler aborts **every** request to the collector, from every context. Anything
that still arrives was not interceptable.

```bash
node run-s01b-block.js    # -> results-block.json
```

Runs 1, 2 and 3 were identical:

```
extensionLoaded: true
aborted:   http://127.0.0.1:8901/ready/service-worker
           http://127.0.0.1:8901/egress/service-worker
LEAKED_TO_COLLECTOR: POST /egress/offscreen-document
probe: { serviceWorker: { ok: false, error: "TypeError: Failed to fetch" },
         offscreen:     { ok: true,  status: 200 } }
```

The service worker's fetch was blocked. **The offscreen document's fetch was not, and
reached the wire, in all three runs.**

## 6. Target visibility — why

```bash
node run-s01b-targets.js  # -> results-targets.json
```

```json
{
  "playwrightPages":          ["about:blank"],
  "playwrightServiceWorkers": ["chrome-extension://kapobnekdfajlhifmcpdgfpenmifefbg/background.js"],
  "cdpTargets": [
    { "type": "service_worker",  "url": "chrome-extension://.../background.js" },
    { "type": "background_page", "url": "chrome-extension://.../offscreen.html" },
    { "type": "page",            "url": "about:blank" }
  ],
  "cdpOffscreenPresent": true,
  "collectorReceived": ["GET /ready/service-worker",
                        "POST /egress/service-worker",
                        "POST /egress/offscreen-document"]
}
```

**CDP sees the offscreen document. Playwright's `BrowserContext` does not surface it**, so
`context.route()` never attaches to it.

## Cleanup

Every browser profile is created under the system temp directory and deleted after each
run. No profile, capture, credential or personal data is committed. The harness contacts no
host other than `127.0.0.1:8901`.
