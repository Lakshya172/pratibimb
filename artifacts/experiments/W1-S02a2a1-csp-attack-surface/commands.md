# S-02a-2a-1 — exact reproduction

## Prerequisites

- Node 20+ (this run: v24.19.0)
- A Chromium-family browser that honours `--load-extension`.
  **Branded Google Chrome 152 does NOT** (W1-S01 finding C1). Used here:
  - unbranded Chromium `151.0.7922.34` from the Playwright browser cache, or
  - branded Microsoft Edge `152.0.4191.66` via Playwright's `msedge` channel.
- A display. **Headful is required** — the headless shell cannot load extensions.

```bash
cd artifacts/experiments/W1-S02a2a1-csp-attack-surface/harness
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright@1.63.0
```

> `npx playwright install chromium` **fails on this machine** with
> `Download failure, code=1` — the same symptom W1-S01b recorded on workstation 2. Drive a
> browser that is already installed instead.

## Regenerate the fixtures (optional — they are committed)

```bash
python - <<'PY'
import hashlib, pathlib
wasm = bytes([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,
 0x01,0x07,0x01,0x60,0x02,0x7f,0x7f,0x01,0x7f, 0x03,0x02,0x01,0x00,
 0x07,0x07,0x01,0x03,0x61,0x64,0x64,0x00,0x00,
 0x0a,0x09,0x01,0x07,0x00,0x20,0x00,0x20,0x01,0x6a,0x0b])
p = pathlib.Path("fixtures"); p.mkdir(exist_ok=True)
(p/"add.wasm").write_bytes(wasm)
t = bytearray(wasm); t[-2] = 0x6b            # i32.add -> i32.sub
(p/"add-tampered.wasm").write_bytes(bytes(t))
print(hashlib.sha256(wasm).hexdigest())      # must equal PINNED_SHA256 in probe.js
PY
node -e "const fs=require('fs');console.log(new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync('fixtures/add.wasm'))).exports.add(2,3))"  # 5
```

If the fixture is regenerated, `PINNED_SHA256` in `harness/probe.js` must match:
`f61fd62f57c41269c3c23f360eeaf1090b1db9c38651106674d48bc65dba88ba`

## Run — both browser cells, as reported

```bash
cd artifacts/experiments/W1-S02a2a1-csp-attack-surface/harness

PLATFORM_LABEL=windows-ws1 BROWSER_LABEL=chromium-151 \
  CHROME_PATH="C:\Users\RONIT\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe" \
  RUNS=3 node run-s02a2a1.js

PLATFORM_LABEL=windows-ws1 BROWSER_LABEL=edge-152 CHANNEL=msedge \
  RUNS=3 node run-s02a2a1.js
```

Writes `../logs/results-s02a2a1-<platform>-<browser>.json`.

## What the runner does

1. Starts a loopback collector on `127.0.0.1:8907`. It receives probe results **and serves
   `/remote.wasm` with `Content-Type: application/wasm`**, which is how Q2 tests
   network-origin bytes fairly (a wrong MIME type would make `instantiateStreaming` look
   blocked when it is not).
2. For each variant, launches **headful** with a throwaway profile in the system temp
   directory and `--load-extension`.
3. Confirms the extension actually loaded by checking `ctx.serviceWorkers()` **before**
   falling back to `waitForEvent` — an extension that never loaded is otherwise
   indistinguishable from one whose contexts are all blocked.
4. Waits for all three contexts to report, closes the browser, deletes the profile.

## Cleanup

Profiles are deleted by the runner. Nothing is written inside the repository except the
artifact files. `node_modules/` is gitignored.

```bash
rm -rf harness/node_modules      # full rollback of the machine change
```
