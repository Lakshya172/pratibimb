# S-02a-2b — commands and raw output

Two platforms, same browser build, same probe and kernel bytes as S-02a-2 so Chrome and
Firefox are directly comparable.

## Linux (WSL2 Ubuntu 26.04)

```bash
cd /root/spikes/s02a2b
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright@1.63.0
PLATFORM_LABEL=linux-wsl2 CHROME_PATH=/opt/chrome-linux64/chrome RUNS=3 node run-s02a2b.js
```

## Windows (native, not WSL)

```bash
PLATFORM_LABEL=windows CHROME_PATH='C:\Users\OMEN\cft\chrome.exe' RUNS=2 node run-s02a2b.js
```

Windows was run specifically to establish this is a **Chrome MV3 behaviour, not something
peculiar to WSL2**.

## Result — default CSP

Every context, every run, both platforms, headful and headless:

```
default-csp-headful   #1 loaded=true
      chrome-mv3-service-worker=threw: WebAssembly.compile(): Compiling or ins...
      chrome-offscreen-document=threw: WebAssembly.compile(): Compiling or ins...
      chrome-offscreen-dedicated-worker=threw: WebAssembly.compile(): Compiling or ins...
```

The full message, identical in all three contexts:

```
CompileError: WebAssembly.compile(): Compiling or instantiating WebAssembly module
violates the following Content Security policy directive because neither 'wasm-eval'
nor 'unsafe-eval' is an allowed source of script in the following Content Security
Policy directive: "script-src 'self'".
```

**Note the message names `'wasm-eval'`** — narrower than `'unsafe-eval'`, and **not tested
here**. Filed S-02a-2b-1.

## Result — `'wasm-unsafe-eval'` declared

```
wasm-unsafe-eval-headful   #1 loaded=true
      chrome-mv3-service-worker=WASM available and correct in this context
      chrome-offscreen-document=WASM available and correct in this context
      chrome-offscreen-dedicated-worker=WASM available and correct in this context
```

Scalar and SIMD element-exact, 0 mismatches, every context and platform. Timings, Linux:

```
wasm-unsafe-eval-headful   chrome-mv3-service-worker          compile=0.8ms cold=0.7ms p50=0.4ms
wasm-unsafe-eval-headful   chrome-offscreen-document          compile=0.3ms cold=0.7ms p50=0.3ms
wasm-unsafe-eval-headful   chrome-offscreen-dedicated-worker  compile=0.6ms cold=1.1ms p50=0.1ms
```

**A trivial integer kernel, not a model.** Recorded for reproducibility, not for a budget.

## Feature detection — the cross-browser asymmetry

Identical in all three Chrome contexts, both variants, both platforms:

```
wasm=True  simd=True  SAB=True  crossOriginIsolated=False  threadsUsable=True  cores=16
```

Firefox MV3 event page (S-02a-2), for comparison:

```
wasm=True  simd=True  SAB=False crossOriginIsolated=False  threadsUsable=False cores=16
```

**`SharedArrayBuffer` is `true` in Chrome extension contexts and `false` in Firefox**, in
both cases without cross-origin isolation. WASM threads are therefore available on Chrome
and unavailable on Firefox.

## The two extensions

`harness/ext-default/` and `harness/ext-wasm-csp/` are byte-identical except for one
manifest key:

```json
"content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" }
```

That single line is the difference between blocked in every context and correct in every
context.

## Data and cleanup

Temporary browser profiles under the system temp directory, deleted after each run.
Synthetic payload. **No PII, no secrets.** No host other than `127.0.0.1:8905` is contacted.
