# S-04a-1 — commands, and which configuration produced which log

All collectors bind `127.0.0.1:8908` (loopback only). Temporary browser profiles are deleted
after each run. No egress. Model weights are read from the extension's own packaged resources
at runtime, never fetched over the network by the probe.

## 0. Toolchain

```bash
python -m pip install onnx onnxruntime numpy
python -m pip install paddle2onnx "paddlepaddle==3.1.0"
```

**The paddle pin is required.** `paddlepaddle==3.3.1` with `paddle2onnx==2.1.0` fails at import
with `DLL load failed while importing paddle2onnx_cpp2py_export`. 3.1.0 matches the extension
ABI. There is no Linux wheel for the WSL2 guest's Python, so conversion is done on Windows.

## 1. Models — fetched and converted, never committed

```bash
python harness/fetch-models.py
```

Pins four revisions, records licence and sha256 for each, and **refuses on hash mismatch**.

**YuNet is Git LFS.** `raw.githubusercontent.com` returns a **131-byte pointer**, not the
model. The script uses `media.githubusercontent.com/media/...`, pinned to the revision. The
pointer's own `oid sha256` equals the expected hash, which independently confirms the pin.

The two PP-OCRv5 models are downloaded in Paddle inference format and converted in-process
through the `paddle2onnx` **Python API** — `python -m paddle2onnx` does not work, the package
has no `__main__`.

## 2. Reference — native ONNX Runtime on CPU

```bash
python harness/mkref.py       # -> reference.json
```

`onnxruntime` **1.29.0**, deliberately the same version as ORT Web 1.29.0. Records count, min,
max, sum, **sumAbs**, sumSq and four sampled values per output.

`pixel_attention_mask` must be **`tensor(bool)`** — the model rejects int64.

## 3. Build

```bash
node harness/build-extension.js
```

Env: `PHASE` (`full` | `baselines` | `resident`), `ONLY` (comma-separated model keys),
`BACKEND`, `CYCLES`, `PRESSURE=1`.

> **Both** `build-extension.js` **and** `run-s04a1-chrome.js` must honour these. The Chrome
> path takes its configs from the runner; only the Firefox event page takes them from the
> build. Setting them for the build alone silently re-ran the full phase — the first
> "cold start" attempt produced four identical 275.4 MB results for four different model
> subsets, which is how the mistake surfaced.

## 4. Chrome

| Command | Log |
|---|---|
| `PHASE=full CYCLES=3 PLATFORM_LABEL=windows CHROME_PATH=... RUNS=1 node harness/run-s04a1-chrome.js` | `logs/results-s04a1-chrome-windows.json` |
| `PHASE=resident CYCLES=3 PLATFORM_LABEL=windows-resident-coldstart ...` | `logs/results-s04a1-chrome-windows-resident-coldstart.json` |
| `BACKEND=webgpu PHASE=resident CYCLES=3 PLATFORM_LABEL=windows-webgpu-resident ...` | `logs/results-s04a1-chrome-windows-webgpu-resident.json` |
| `PHASE=baselines ONLY=<model> CYCLES=0 PLATFORM_LABEL=windows-solo-<model> ...` | `logs/results-s04a1-chrome-windows-solo-*.json` (4 files) |
| `PRESSURE=1 PHASE=resident CYCLES=0 PLATFORM_LABEL=windows-pressure ...` | `logs/results-s04a1-chrome-windows-pressure.json` |

**The cold-start runs are not optional.** With `PHASE=full`, the baseline sweep runs first *in
the same context* and grows the arena to its own high-water mark, so every later residency
number starts from a pre-grown arena. That is the run-order confound S-04a hit with its WebGPU
cell. The §6 table in the README comes from `PHASE=resident`, and the §5 table from four
separate `ONLY=` runs, each in a fresh browser.

### Linux (WSL2)

```bash
DISPLAY=:0 PHASE=resident CYCLES=3 PLATFORM_LABEL=linux-wsl2-resident \
  CHROME_PATH=/opt/chrome-linux64/chrome RUNS=1 node run-s04a1-chrome.js
```
→ `logs/results-s04a1-chrome-linux-wsl2-resident.json`

## 5. Firefox

```bash
PHASE=resident CYCLES=3 node harness/build-extension.js
PLATFORM_LABEL=windows-resident FIREFOX_PATH='C:\Program Files\Mozilla Firefox\firefox.exe' \
  RUNS=1 node harness/run-s04a1-firefox.js
```
→ `logs/results-s04a1-firefox-windows-resident.json`

Completed first time: `chunk 1/8 … 8/8`, `incompleteChunkSets: []`, `timedOut: false`. The
chunked-beacon fix from S-04a carried over unchanged and needed no further work.

**Firefox WebGPU was not run.** S-02a established that `dom.webgpu.enabled` is off by default
on Linux and that no accelerated path exists in this WSL2 guest; nothing here generalises WSL2
GPU visibility into Firefox WebGPU hardware use.

## 6. Section 10 — failure behaviour

`PRESSURE=1` appends `harness/pressure-probe.js`. It escalates real sessions to a **hard
ceiling of 1200 MB / 8 rounds**, then requests two allocations that cannot succeed in wasm32
(`WebAssembly.Memory({initial: 65537})` and `new Float32Array(2**31)`) — these cost the host
nothing and are what actually reveal the failure mode.

Host at run time: **23 GB total, ~4.1 GB free**. Real exhaustion was not attempted.

## 7. Repository checks

```bash
python scripts/verify-repo.py
bash scripts/check-secrets.sh
```
