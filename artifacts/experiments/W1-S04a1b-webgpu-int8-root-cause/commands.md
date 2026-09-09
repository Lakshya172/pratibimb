# S-04a-1b — commands, and which configuration produced which log

Loopback `127.0.0.1:8909` only. Temporary Chrome profiles, deleted after each run. No egress.
Model weights and ORT `.wasm` artifacts are packaged as extension resources at build time and
are never committed.

## 0. Model

Re-verified against the S-04a-1 pin before use:
`sha256 d534ab668d3563e6d1d809bbbf1ff18308ded48651178614dbcc4a1de13d16f7`, 94,247,927 bytes.
Fetched by `W1-S04a1-four-model-residency/harness/fetch-models.py`.

## 1. Minimal synthetic graphs

```bash
python harness/build_micro.py          # MatMulInteger, DynamicQuantizeLinear, DQL->MMI, ConvInteger, fp32 control
python harness/build_micro_large.py    # 256x512x256 variants -- the fallback detector
python harness/build_dql_repro.py      # DequantizeLinear across rank / size / dtype / zero-point
python harness/build_dql_repro2.py     # scalar vs rank-1 vs no-zero-point vs per-channel
python harness/micro_ref.py            # native onnxruntime 1.29.0 reference, FULL tensors
node harness/build-ext.js
PLATFORM_LABEL=windows CHROME_PATH='C:\Users\OMEN\cft\chrome.exe' RUNS=1 node harness/run-chrome.js
```

| Log | What it shows |
|---|---|
| `results-s04a1b-chrome-windows.json` | first 5 micro graphs, all exact on both backends |
| `results-s04a1b-chrome-windows-large.json` | **the fallback detector** — fp32 MatMul rounds differently on WebGPU, int8 is bit-identical |
| `results-s04a1b-chrome-windows-dql.json` | DequantizeLinear across rank/size/dtype |
| `results-s04a1b-chrome-windows-dqlv.json` | all four parameter forms fail |
| `results-s04a1b-chrome-windows-rewrite.json` | `Cast` alone exact; `Cast→Sub→Mul` exact; `DequantizeLinear` fails |
| `results-s04a1b-chrome-windows-mmi3d.json` | 3-D quantised Linear exact at the model's shapes |

## 2. Layer-wise bisection

```bash
python harness/build_instrumented.py    # coarse: embeddings + 12 encoder layers + tail
python harness/build_instrumented2.py   # fine: inside the embedding region
python harness/layer_ref.py
LAYERWISE=1 OPT_LEVELS=all,disabled node harness/build-ext.js
LAYERWISE=1 OPT_LEVELS=all,disabled PLATFORM_LABEL=windows-full ... node harness/run-chrome.js
```

| Log | What it shows |
|---|---|
| `results-s04a1b-chrome-windows-layerwise.json` | coarse sweep: divergence already at the first checkpoint |
| `results-s04a1b-chrome-windows-full.json` | **fine sweep — first divergence at `DequantizeLinear`**, both optimisation levels |
| `results-s04a1b-chrome-windows-opt.json` | `all` vs `disabled`: same failure, so not a fusion bug |

**Two harness defects were found and fixed during this bisection, and both would have hidden
the answer:**

1. **Promoted outputs need explicit types.** Without them ORT Web silently returned 5 of 15
   outputs while native ORT returned all 15. Fixed by running `onnx.shape_inference` and
   copying the inferred `ValueInfo`.
2. **int64 outputs arrive as `BigInt64Array`.** `sum += v` throws *"Cannot mix BigInt and other
   types"*, which aborted the comparison loop after the five float32 checkpoints — so ten
   checkpoints vanished from every earlier run with no error surfaced. Fixed by explicit
   conversion, plus a per-checkpoint `try` so one bad tensor can no longer hide the rest.

## 3. Version variation

```bash
cd harness && npm install onnxruntime-web@1.27.0                       # then rebuild + run
cd harness && npm install onnxruntime-web@1.30.0-dev.20260904-d47fd8824
```

| Log | ORT Web |
|---|---|
| `results-s04a1b-chrome-windows-ort127.json` | 1.27.0 — same failure, same values |
| `results-s04a1b-chrome-windows-ort130dev.json` | 1.30.0-dev — same failure, same values |

**The project pin was restored to 1.29.0 immediately afterwards and verified.** It was never
changed in the repository.

## 4. The fix, and the second defect

```bash
python harness/apply_fix.py                                                  # original -> dqlfix
python harness/apply_fix.py <instrumented> <instrumented+fixed>              # for re-bisection
LAYERWISE=1 MODEL_FILES="sliced/...instrumented.onnx,sliced/...dqlfix.onnx" node harness/build-ext.js
```

| Log | What it shows |
|---|---|
| `results-s04a1b-chrome-windows-fixvalidate.json` | original vs fixed, both backends — WebGPU 2.185 → 1.603, **still wrong** |
| `results-s04a1b-chrome-windows-next.json` | fixed model: embedding region now bit-exact on WebGPU |
| `results-s04a1b-chrome-windows-defect2.json` | **defect 2 first appears at encoder layer 0** |
| `results-s04a1b-chrome-windows-l0.json` | **inside layer 0: `self_attn/out_proj`** |

## 5. Linux

```bash
DISPLAY=:0 PLATFORM_LABEL=linux-wsl2 CHROME_PATH=/opt/chrome-linux64/chrome RUNS=1 node run-chrome.js
```
→ `results-s04a1b-chrome-linux-wsl2.json`. WASM: all 19 graphs correct. **WebGPU: `Failed to
get GPU adapter` — not testable in WSL2, recorded as such rather than as a failure.**

## 6. Repository checks

```bash
python scripts/verify-repo.py
bash scripts/check-secrets.sh
```
