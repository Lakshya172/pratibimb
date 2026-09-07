# Workflow: Model Adoption

> **No model is accepted merely because documentation says it should work.**
> Exit gate: `agentos/gates/QG-03-model-feasibility.md`
> Owning reviewer: `ml-engineer`

---

## Entry condition

A model is proposed for a frozen interface (`UIElementDetector`, `OCRProvider`,
`FaceDetector`, `PIIDetector`, `LocalVLM`, `ServerPlanner`).

## Steps

```
1  PIN         record the exact repository AND revision hash in agentos/registry/model-registry.md
2  LICENCE     open the pinned revision. Read its licence file. Record URL + date.
                A licence claimed on a model card, in a README, or in the dossier is
                UNKNOWN until this step is done.
3  EXPORT      ONNX export / quantisation, with the exact toolchain versions recorded
4  FEASIBILITY fill all four cells: Chrome WebGPU, Chrome WASM, Firefox WebGPU,
                Firefox WASM (Linux). Each cell records:
                  - does the session load
                  - p50 latency on the FIXED fixture
                  - peak heap
                  - output correctness vs a known-good reference
5  HEAP         verify coexistence with the other resident sessions, and that teardown
                reclaims memory
6  BENCHMARK    run the harness; write artifacts/benchmarks/
7  REVIEW       ml-engineer + performance-engineer; privacy-security-engineer if the
                model is a detector
8  ADR          if this replaces a pinned default, or changes a ranked fallback order
9  ADOPT        status -> ADOPTED in agentos/registry/model-registry.md
```

## Blocking rules — FROZEN

1. **No model enters the build until its row is complete across all four combinations.**
2. **A model that fails the WASM columns is not shipped, whatever it does on WebGPU.**
   The judging machine is more likely to be the WASM one.
3. **A model whose pinned revision's licence is not verified is not adopted.**
   Particular care with any fine-tune of an Ultralytics YOLO — AGPL-3.0 section 13 has
   network-service implications that matter for anything handed to a government
   department. This is a defect that already occurred once, in v2.0.
4. **The interface does not change to accommodate the model.**
5. **A rejected model is recorded as `REJECTED` with its artifact.** It is not quietly
   swapped out.

## The ranked fallback rule

`UIElementDetector` is the highest-risk interface in the project: a third-party detector,
exported to ONNX, quantised, and run inside an extension worker in two browsers. **Every
step of that chain has failed for someone.**

The mitigation is **not to pick a better model** — it is to stop the architecture
depending on any particular one:

| Rank | Implementation | Rule |
|---|---|---|
| **A** | OmniParser `icon_detect_v3`, ONNX INT8 | Preferred. **Committed only once its feasibility row is green.** |
| **B** | Our own detector head, trained on the synthetic set | **Started in week three regardless of whether A is working.** No external dependency, no licence question. The labelled data pipeline already exists for evaluation, so the marginal cost is small. |
| **C** | DOM-only degradation; vision limited to faces and OCR | Always available. Lower grounding score, task still completes on DOM-rendered pages. **This is the floor, and it is a floor we can demonstrate.** |

> **A working fallback is more valuable than a perfect dependency that may fail at the venue.**

## Server model note

Qwen3-VL-4B-Instruct is the default and Qwen3-VL-8B-Instruct the upgrade. **Both are
benchmarked behind the same interface in week five, on our own 300 Indian screens, and the
data decides.** The published ScreenSpot figures (32B at 0.958, 4B at 0.940) are the reason
4B is the default, not a substitute for our own benchmark.
