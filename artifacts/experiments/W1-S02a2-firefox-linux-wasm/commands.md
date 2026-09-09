# S-02a-2 — commands and raw output

Run **inside the WSL2 Ubuntu 26.04 guest**, 2026-09-07.

## 1. Build the kernels from source

```bash
cd /root/spikes/s02a2
npm install wabt
node -e "
const fs=require('fs'), wabtInit=require('wabt');
(async()=>{ const wabt=await wabtInit();
  for (const [src,out,feat] of [['kernel.wat','kernel.wasm',{}],['kernel-simd.wat','kernel-simd.wasm',{simd:true}]]) {
    const m=wabt.parseWat(src, fs.readFileSync(src,'utf8'), feat);
    fs.writeFileSync(out, Buffer.from(m.toBinary({}).buffer));
  }})();"
# kernel.wasm 102 bytes ; kernel-simd.wasm 112 bytes
```

Both are embedded in the probe as base64, so it runs in any context without a fetch. **The
WAT source is committed**, so the binary is reproducible rather than opaque.

## 2. Run

```bash
export DISPLAY=:0
RUNS=3 node run-s02a2-linux.js     # -> results-linux.json
```

## 3. Result

Substrate detection, **identical in every variant and both contexts**:

```
wasm=True  simd=True  SAB=False  crossOriginIsolated=False  threadsUsable=False  cores=16
```

Feature detection still succeeds where compilation does not, because `WebAssembly.validate`
is **not** CSP-gated while `WebAssembly.compile` is.

```
defaults-headful    firefox-mv3-event-page     threw: call to WebAssembly.compile() blocked by CSP   (3/3)
defaults-headful    ordinary-web-page-CONTROL  WASM available and correct                            (3/3)
                       scalar correct=[T,T,T] mism=[0,0,0] compile=[4,6,6] cold=[2,2,2] warm_p50=[0,0,0]
                       simd   correct=[T,T,T] mism=[0,0,0]

defaults-headless   firefox-mv3-event-page     threw: call to WebAssembly.compile() blocked by CSP   (3/3)
defaults-headless   ordinary-web-page-CONTROL  WASM available and correct                            (3/3)

wasm-unsafe-eval-headful  firefox-mv3-event-page     WASM available and correct                      (3/3)
                       scalar correct=[T,T,T] mism=[0,0,0] compile=[1,2,1] cold=[0,2,2] warm_p50=[0,0,0]
                       simd   correct=[T,T,T] mism=[0,0,0]
```

Full error object from the event page at defaults:

```json
{ "name": "CompileError",
  "message": "call to WebAssembly.compile() blocked by CSP",
  "stack": "benchmark@moz-extension://.../probe.js:78:40\nrunWasmProbe@.../probe.js:120:24\n@.../background.js:44:32" }
```

**The two extension directories differ in exactly one line** — `harness/extension/` declares
no CSP, `harness/extension-wasm-csp/` declares
`script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. That single line is the
difference between "blocked 3/3" and "correct 3/3".

## 4. On the timings

Warm p50 reads 0 ms — below the reported timer resolution for this kernel. The same kernel
through **WebGPU** on the same machine and browser (S-02a, forced on) was **~100 ms**.

**Do not quote that as WASM beating WebGPU.** The S-02a WebGPU path was almost certainly
**software-backed** (no `/dev/dri`, 0 Vulkan ICDs, `llvmpipe`), so the comparison is a
software WebGPU implementation against native WASM. On hardware WebGPU the ordering could
reverse. It is also a trivial integer kernel, **not a model**.

## Data and cleanup

Fresh temporary Firefox profile per run, deleted afterwards. Synthetic `Int32Array` payload.
**No PII, no secrets.** The harness contacts no host other than `127.0.0.1:8904`.
