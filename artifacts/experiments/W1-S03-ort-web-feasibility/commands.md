# S-03 — commands and raw output

## 1. Build the model

```bash
python3 -m pip install onnx          # onnx 1.22.0
python3 build_model.py
# tiny.onnx bytes: 174
# sha256: 2718406b3ef228c72455dea388cd26569d462102f5a642a3bcbba1cedafe49b4
# opset: 13   ir_version: 9
```

**`tiny.onnx` is not committed** — `verify-repo.py` bans `.onnx`, and that rule is right. The
fixture is reproducible from `build_model.py` and pinned by the hash above.

## 2. Build the probe extensions

```bash
npm install onnxruntime-web@1.29.0
node build-extension.js
# built ext-chrome and ext-firefox
# model bytes: 174 base64 len: 232
```

`ext-chrome` is **41 MB**, almost all of it ORT Web's two `.wasm` artifacts. **They are pulled
from `node_modules` at build time and never committed.**

## 3. Run

```bash
PLATFORM_LABEL=windows    CHROME_PATH='C:\Users\OMEN\cft\chrome.exe' RUNS=3 node run-s03-chrome.js
PLATFORM_LABEL=linux-wsl2 CHROME_PATH=/opt/chrome-linux64/chrome     RUNS=1 node run-s03-chrome.js
PLATFORM_LABEL=windows    FIREFOX_PATH='C:\Program Files\Mozilla Firefox\firefox.exe' RUNS=2 node run-s03-firefox.js
PLATFORM_LABEL=linux-wsl2 FIREFOX_PATH=/opt/firefox/firefox          RUNS=2 node run-s03-firefox.js
```

## 4. Result — Chrome (identical headful and headless, both platforms)

```
--- chrome headful  run 1 loaded=true ---
   chrome-mv3-service-worker          wasm    threw: no available backend found. ERR: [wasm] TypeError: import() is disallowed on ServiceWorke
   chrome-mv3-service-worker          webgpu  threw: no available backend found. ERR: [webgpu] Error: previous call to 'initWasm()' failed.
   chrome-offscreen-document          wasm    ORT session created and ran correctly on wasm
   chrome-offscreen-document          webgpu  ORT session created and ran correctly on webgpu
   chrome-offscreen-dedicated-worker  wasm    ORT session created and ran correctly on wasm
   chrome-offscreen-dedicated-worker  webgpu  ORT session created and ran correctly on webgpu
```

Full service-worker error:

```
no available backend found. ERR: [wasm] TypeError: import() is disallowed on
ServiceWorkerGlobalScope by the HTML specification.
See https://github.com/w3c/ServiceWorker/issues/1356.
```

On **WSL2 Linux** the two `webgpu` rows instead read `Failed to get GPU adapter` — the guest
has no `/dev/dri` and 0 Vulkan ICDs. `wasm` succeeds there exactly as on Windows.

## 5. Result — Firefox

```
Windows:      wasm:   ORT session created and ran correctly on wasm
              webgpu: ORT session created and ran correctly on webgpu
Linux (WSL2): wasm:   ORT session created and ran correctly on wasm
              webgpu: threw: ... WebGPU is not supported in current environment
```

Firefox Linux `webgpu` fails because `dom.webgpu.enabled` is off by default (S-02a). **No
preference was changed for S-03.**

## 6. Timings — Chrome for Testing 153, Windows, 3 runs

```
offscreen-document          wasm    create=[290.1, 300.9, 301.1]  cold=[7.3, 8, 7.8]      warmP50=[0.3, 0.3, 0.4] release=[1.5, 1.7, 1.7] heap=4MB
offscreen-document          webgpu  create=[160, 115.6, 115.2]    cold=[27, 24.9, 25.7]   warmP50=[5.5, 5.2, 6.4] release=[0.5, 0.6, 0.6] heap=16-18MB
offscreen-dedicated-worker  wasm    create=[76.5, 74.6, 76.4]     cold=[2.1, 2, 1.8]      warmP50=[0.4, 0.3, 0.3] release=[0.4, 0.2, 0.3]
offscreen-dedicated-worker  webgpu  create=[34.6, 36.6, 34]       cold=[11.1, 11.3, 11.9] warmP50=[5.7, 4.9, 6.1] release=[0.4, 0.5, 0.6]
```

Firefox 155.0.1 event page:

```
Windows       wasm    create=[293, 265]   cold=[2, 2]     warmP50=[1, 1]
Windows       webgpu  create=[3135, 427]  cold=[102, 39]  warmP50=[100, 100]
Linux (WSL2)  wasm    create=[426, 416]   cold=[5, 2]     warmP50=[1, 1]
```

**These are not a backend comparison.** The model is two elementwise ops, so GPU transfer
cost cannot be amortised. They establish that the paths work.

The dedicated worker's lower session-create time is **confounded by run order** — it runs
after the document in the same session, so the wasm artifacts are already warm. Not a
property of the context, and not a usable figure.

## 7. Threads

`ort.env.wasm.numThreads` was **pinned to 1 in every run**, so all figures are
single-threaded and comparable. `SharedArrayBuffer` was `true` in every Chrome context and
`false` in Firefox, confirming S-02a-2b at the runtime layer. **Threaded WASM is untested.**

## Data and cleanup

Temporary browser profiles, deleted after each run. Synthetic input verified against a CPU
reference. **No PII, no secrets, no production model.** No host other than `127.0.0.1:8906`
is contacted.
