# S-04 — commands and raw output

## 1. Build

```bash
python3 build_model.py            # tiny.onnx, 174 bytes, sha256 2718406b...
npm install onnxruntime-web@1.29.0 playwright@1.63.0 web-ext@10.6.0
node build-extension.js
```

## 2. Which config produced which log

The harness config lives in `build-extension.js` / `run-s04-chrome.js`. Two configs were
used, and the logs are named accordingly:

| Log | Config |
|---|---|
| `results-s04-chrome-windows.json`, `results-s04-chrome-linux-wsl2.json`, `results-s04-firefox-*.json` | `[{wasm, numThreads:1, cycles:5}, {webgpu, cycles:5}]` |
| `results-s04-chrome-windows-threads.json` | `[{wasm, numThreads:1, cycles:3}, {wasm, numThreads:4, cycles:3}]` — the **S-03b** threading comparison |

The committed harness carries the **threading** config, since that was the last run. Restore
the first config to reproduce the main matrix.

```bash
PLATFORM_LABEL=windows        CHROME_PATH='C:\Users\OMEN\cft\chrome.exe' RUNS=1 node run-s04-chrome.js
PLATFORM_LABEL=linux-wsl2     CHROME_PATH=/opt/chrome-linux64/chrome     RUNS=1 node run-s04-chrome.js
PLATFORM_LABEL=windows        FIREFOX_PATH='C:\Program Files\Mozilla Firefox\firefox.exe' RUNS=1 node run-s04-firefox.js
PLATFORM_LABEL=linux-wsl2     FIREFOX_PATH=/opt/firefox/firefox          RUNS=1 node run-s04-firefox.js
PLATFORM_LABEL=windows-threads CHROME_PATH='C:\Users\OMEN\cft\chrome.exe' RUNS=1 node run-s04-chrome.js
```

## 3. Result — Chrome (headful; headless identical in every cell)

```
chrome-mv3-service-worker          threw: ... import() is disallowed on ServiceWorkerGlobalScope
chrome-offscreen-document          3 concurrent sessions on wasm;   5 create/infer/destroy cycles; all output correct
chrome-offscreen-document          3 concurrent sessions on webgpu; 5 create/infer/destroy cycles; all output correct
chrome-offscreen-dedicated-worker  3 concurrent sessions on wasm;   5 create/infer/destroy cycles; all output correct
chrome-offscreen-dedicated-worker  3 concurrent sessions on webgpu; 5 create/infer/destroy cycles; all output correct
```

Memory, Chrome offscreen document, `wasm` — representative of every Chrome cell:

```
label                 inst  wasmMB   jsMB
baseline              0     0        3.5
after-create-1        1     16       5.4
after-create-2        1     16       5.4     <- session 2 added NOTHING
after-create-3        1     16       5.4     <- session 3 added NOTHING
after-infer-all-3     1     16       5.4
after-destroy-1       1     16       5.4
after-destroy-2       1     16       5.4
after-destroy-3       1     16       5.4     <- WASM cannot shrink; correct, not a leak
after-cycle-1         1     16       12.4
after-cycle-2         1     16       12.4
after-cycle-3         1     16       12.4
after-cycle-4         1     16       12.4
after-cycle-5         1     16       24.7    <- WASM FLAT across 15 further lifecycles
correctness: 18 inferences, ALL CORRECT
```

### The JS-heap counter-example, in full

The same run, `webgpu` cell:

```
after-create-3        1     16       25.9
after-infer-all-3     1     16       10.8    <- dropped 15 MB in ONE step
```

**That is why no JS-retention conclusion is drawn.** The rise to 24.7 MB in the `wasm` cell
looks like a leak; this shows the same counter is simply GC-timing. Reported as `UNKNOWN`.

## 4. Result — Firefox

```
Windows:      wasm:   3 concurrent sessions; 5 cycles; all output correct
              webgpu: 3 concurrent sessions; 5 cycles; all output correct
Linux (WSL2): wasm:   3 concurrent sessions; 5 cycles; all output correct
              webgpu: threw: ... WebGPU is not supported in current environment
```

```
firefox-mv3-event-page | wasm | SAB: False | threads: 1
  baseline              0     0
  after-create-1        2     16     <- TWO Memory instances, unlike Chrome's one
  after-create-2        2     16
  after-create-3        2     16
  after-destroy-3       2     16
  after-cycle-5         2     16     <- flat
  correctness: 18 inferences, ALL CORRECT
```

`performance.memory` does not exist in Firefox, so no JS figure is available there.

## 5. S-03b — threading (Chrome, `SharedArrayBuffer` present)

```
context                           req   actual  SAB    inst  wasmMB   correctness
chrome-offscreen-document         1     1       True   1     16       12 inf, ALL CORRECT
chrome-offscreen-document         4     4       True   1     16       12 inf, ALL CORRECT
chrome-offscreen-dedicated-worker 1     1       True   1     16       12 inf, ALL CORRECT
chrome-offscreen-dedicated-worker 4     4       True   1     16       12 inf, ALL CORRECT
```

**Feasibility only.** ORT reporting `4` is not proof four pthreads materialised, and a two-op
model would show no benefit even if they did. **No performance claim is made.**

## 6. WASM provenance (task §8)

```
onnxruntime-web 1.29.0   license MIT
resolved  https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.29.0.tgz
integrity sha512-LuQlpX6MFLJZu756erwUeb1mNfoJGbs1kzDwJGNlf5RvfYMdqhcY3vNpDPK40CUV2HoWTkIj+uS0o36GFHjeYw==

ort-wasm-simd-threaded.wasm        13961845  ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d
ort-wasm-simd-threaded.jsep.wasm   27797172  db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea
ort-wasm-simd-threaded.mjs            24218  5a15f1fd086b3f6c2baf1f35105b8f502653b567e165cef80028870b39748747
ort-wasm-simd-threaded.jsep.mjs       46676  3d68fa7af88c48894d4b0c8629de12018ab73b77519bc0b05dc8d908ad82749f
ort.all.min.js                       819591  292feb81eb47989f30d40e62e29e2373979e7588231c189e6dd494ff294f069d
```

**Not generated, not transformed, not fetched at runtime.** Copied byte-for-byte from the
pinned package into the extension, and loaded from there via `ort.env.wasm.wasmPaths`.

## Data and cleanup

Temporary browser profiles, deleted after each run. Synthetic input verified element-by-element
on **every** inference. **No PII, no secrets, no production model.** No host other than
`127.0.0.1:8907`.
