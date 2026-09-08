# S-04a — commands, and which configuration produced which log

All servers bind `127.0.0.1:8908` (loopback only). Temporary browser profiles are deleted
after each run. No network egress, no telemetry, no external endpoint.

## 0. Model — fetched, never committed

```bash
cd harness
bash fetch-model.sh
```

Pins `opencv/opencv_zoo` revision `47534e27c9851bb1128ccc0102f1145e27f23f98`, records the
Apache-2.0 licence **read from that revision**, and **refuses to continue** unless the file is
232,589 bytes with sha256
`8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`.

## 1. Correctness reference — native ONNX Runtime on CPU

```bash
python3 -m pip install onnx==1.20.0 onnxruntime==1.29.0 numpy
python3 mkref.py            # -> reference.json
```

`onnxruntime` **1.29.0** — deliberately the same version as ORT Web 1.29.0. Writes, per output:
count, min, max, sum, and four values at fixed sampled indices.

## 2. Build the two extensions

```bash
npm install onnxruntime-web@1.29.0 playwright@1.63.0 web-ext@10.6.0
node build-extension.js
```

Emits `ext-chrome/` (service worker + offscreen document + dedicated worker) and
`ext-firefox/` (event page). The model is inlined as base64 — **no `.onnx` is committed and
none is fetched at runtime.**

## 3. Chrome

| Command | Log |
|---|---|
| `PLATFORM_LABEL=windows CHROME_PATH='C:\Users\OMEN\cft\chrome.exe' RUNS=1 node run-s04a-chrome.js` | `logs/results-s04a-chrome-windows.json` |
| `PLATFORM_LABEL=linux-wsl2 CHROME_PATH=/opt/chrome-linux64/chrome RUNS=1 node run-s04a-chrome.js` | `logs/results-s04a-chrome-linux-wsl2.json` |
| §2 pre-check, `mode: "growth-only"` | `logs/results-s04a-chrome-linux-precheck.json` |
| **`COLD_START_BACKEND=webgpu PLATFORM_LABEL=windows-webgpu-coldstart CHROME_PATH='...' RUNS=1 node run-s04a-chrome.js`** | `logs/results-s04a-chrome-windows-webgpu-coldstart.json` |

**The cold-start run is not optional.** In the default order both backends share one context
with `wasm` first, so the `webgpu` cell inherits an arena the `wasm` cell already grew and
appears to add zero pages. `COLD_START_BACKEND=webgpu` runs WebGPU alone from a cold heap,
which is where the **19.3 MB / 1 grow** figure comes from. `metrics.json` marks the four
inherited-arena cells `"confounded": true`.

Run under WSL2 with `DISPLAY=:0` for the headful cells. Headful and headless were run and
compared; they agree on every number.

## 4. Firefox — and the harness defect this experiment found

| Command | Log | Outcome |
|---|---|---|
| `PLATFORM_LABEL=windows FIREFOX_PATH='C:\Program Files\Mozilla Firefox\firefox.exe' RUNS=1 node run-s04a-firefox.js` | `logs/results-s04a-firefox-windows.json` | **empty, `timedOut: true`** — *before* the fix |
| same, `cycles: 1` | (superseded) | **empty, `timedOut: true`** — *before* the fix |
| same, `mode: "growth-only"` | `logs/results-s04a-firefox-windows-ffprobe.json` | **completed** — small payload |
| `PLATFORM_LABEL=windows-fixed FIREFOX_PATH=... RUNS=1 node run-s04a-firefox.js` | `logs/results-s04a-firefox-windows-fixed.json` | **after the fix: `chunk 1/9 ... 9/9`, `incompleteChunkSets: []`, `timedOut: false`, result identical to Chrome** |

### The root-cause reproduction

```bash
node harness/repro-collector-header-overflow.js   # -> logs/repro-collector-header-overflow.txt
```

Stands alone, needs no browser, and takes under a second. It shows a **default**
`http.createServer()` accepting a 16 KB request line and rejecting an 80 KB one with
`HPE_HEADER_OVERFLOW` **without ever invoking the request handler** — and the same server
accepting both once `maxHeaderSize` is raised.

**That is why the Firefox runs "timed out": the collector was silently discarding the report.**
Details in `decision.md`.

## 5. Repository checks

```bash
python scripts/verify-repo.py
bash scripts/check-secrets.sh
```
