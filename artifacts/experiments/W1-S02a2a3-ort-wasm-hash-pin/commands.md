# S-02a-2a-3 — exact reproduction

## Prerequisites

- Node 20+ (this run: v24.19.0)
- Python with `onnx` (only to regenerate the 174-byte model): `pip install onnx`
- A Chromium-family browser that honours `--load-extension`. **Branded Chrome 152 does
  NOT** (W1-S01). Used here: unbranded Chromium `151.0.7922.34` from the Playwright cache.
- **Mozilla Firefox 155.0.1** for the Firefox cell.
- Ports **8910** and **8911** free. They are two different origins; that is the experiment.
- A display. **Headful** — the headless shell cannot load extensions.

```bash
cd artifacts/experiments/W1-S02a2a3-ort-wasm-hash-pin/harness
npm install onnxruntime-web@1.29.0
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright@1.63.0
npm install web-ext@8.3.0
python build_model.py && python -c "import base64,pathlib; pathlib.Path('model.b64').write_text(base64.b64encode(pathlib.Path('tiny.onnx').read_bytes()).decode())"
node build-extension.js
```

`build-extension.js` prints the artifact name, size and SHA-256, and writes `pin.json`.
**ORT artifacts are 14–28 MB and are never committed** — CI blocks files over 5 MB.

## Run

```bash
# Chromium
PLATFORM_LABEL=windows-ws1 BROWSER_LABEL=chromium-151 \
  CHROME_PATH="C:\Users\RONIT\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe" \
  RUNS=3 node run-s02a2a3-chrome.js

# Firefox  (run separately - it binds the SAME ports)
RUNS=3 node run-s02a2a3-firefox.js
```

If a previous run was interrupted, free the ports first — a stale collector will fail with
`EADDRINUSE` and the run will produce nothing:

```powershell
Get-NetTCPConnection -LocalPort 8910,8911 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## What the harness does, and why each part matters

1. Serves the ORT `.wasm` from **two arrival-logged origins**: `8910` (in `connect-src`)
   and `8911` (not). Both serve **byte-identical** bytes.
2. **Does NOT package the `.wasm` in the extension.** This is the point: if ORT ever loads
   WebAssembly without our buffer, it must fetch, and the fetch must appear in the log. A
   packaged copy would make "zero arrivals" ambiguous.
3. Packages only `ort.all.min.js` and the `.jsep.mjs` glue — the glue is loaded by dynamic
   `import()`, which MV3 governs with `script-src`, so it **must** be local.
4. Tags our own fetches with `x-pratibimb-probe`. **An untagged artifact request is ORT's.**
5. Runs **one scenario per fresh dedicated worker**, because ORT caches its WebAssembly
   module per JS realm.
6. Holds the servers open ~3 s after the run so a late fetch still counts as an arrival.

## Reading the result

- **s2 pinned** — session created, `correct: true`, and `wasmArrivals_ORT` contains **no**
  request for the real artifact → ORT used our verified buffer.
- **s3 tampered** — session **must fail**. If it succeeds, ORT did not consume our buffer
  and the binding is disproved.
- **s4** — one untagged fetch of the real artifact. This proves the observer works.
- **s5** — three untagged fetches of `/no-such-file.wasm`, then failure.
  `fellBackSilently: false`.
- **s6** — `foreignOriginArrivals: 0`.
- **s7** — both sessions succeed with no additional fetch.

## Cleanup

Browser profiles are deleted by the runners. Nothing is written inside the repository
except the artifact files.

```bash
rm -rf harness/node_modules harness/served harness/ext-chrome harness/ext-firefox harness/tiny.onnx
```
