# Architecture Constitution — PratiBimb

> **What is frozen, what is replaceable, and what is not yet known.**
> Source: `docs/dossier/PratiBimb-Engineering-Dossier-v4.0.pdf`
> Changing anything in sections 1–7 requires an approved ADR in `docs/adr/`.

---

## 0. The one-line architecture

> **Freeze the interfaces. Pin the implementations. Benchmark the candidates behind them.**

Interfaces are abstract and frozen. The implementation behind each interface is pinned to
an exact revision, quantisation and runtime asset — because a silent upstream change
twelve hours before judging is an avoidable way to lose. The two rules are not in tension.

---

## 1. FROZEN — the pipeline

Twelve stages. Six local stages surround the server call, and they are the entire
contribution.

```
1  OBSERVE       capture + DOM
2  PERCEIVE      elements, faces
3  SANITIZE      detect + redact
4  VERIFY        or block               <-- nothing crosses until this passes
5  REASON        server VLM
6  PLAN          action JSON
7  VALIDATE      allowlist              <-- nothing executes until 7 and 8 both pass
8  REFRESH       action freshness - target still real?
9  RE-HYDRATE    vault lookup
10 ACT           execute
11 VERIFY RESULT
12 repeat, or stop and ask
```

- Stage 4 is the **egress gate**. Stages 7 and 8 together are the **execution gate**.
- Stage 8 (action freshness, new in v4.0) re-checks that the target element still exists,
  that its role and accessible name still match what was reported to the server, that it
  is visible and enabled, and that its bounding box has not moved beyond a tolerance.
  A failed freshness check **discards the plan and re-observes**. It never guesses.
  This closes the window in which a page can swap a benign control for a harmful one
  after the screenshot but before the click.

**FROZEN.** No stage may be removed, reordered, or made conditional.

---

## 2. FROZEN — the trust boundary

| Side | Components | Trust |
|---|---|---|
| **User machine** | Content script, offscreen document + workers, redaction engine, privacy verifier, re-hydration vault, privacy ledger, local validator, egress guard, action executor | **Trusted** |
| **Wire (down)** | Sanitized context only: WebP frame + redaction manifest + user goal | — |
| **Wire (up)** | Action plan in placeholders | — |
| **Server** | FastAPI + Pydantic v2, vLLM + Qwen3-VL, PII tripwire | **Untrusted with respect to PII** |

The client and server are **intentionally asymmetric**. The server is given enough
structure to plan and never enough content to identify. The client is the only component
that ever holds a real value.

The server-side **PII tripwire** is deliberate defence in depth: an independent,
adversarial measurement of the client's redaction quality. It logs class, request id,
bbox and detector — **never the plaintext**. Any hit is a logged defect.

**FROZEN.** The vault never crosses. The verifier is never advisory. The egress guard is
the only network caller in the extension.

---

## 3. FROZEN — the interfaces

Every model role sits behind a typed interface. A model is a replaceable component; the
interface is not.

| Interface | Shape | Notes |
|---|---|---|
| `UIElementDetector` | screenshot in → boxes + roles out | **Highest-risk interface in the project.** Three ranked implementations — see section 8. |
| `OCRProvider` | image region in → text + boxes out | Selective in T2; full-frame at low threshold in the verifier |
| `FaceDetector` | image in → face boxes out | |
| `PIIDetector` | text + entity list in → typed spans out | Zero-shot; the entity list is config, not a training run |
| `LocalVLM` | image + goal in → action out | **Offline fallback only.** Never in the normal path. Isolated worker, lazy-loaded, torn down after use. |
| `ServerPlanner` | manifest + frame + goal in → action plan out | Guided JSON decoding |

**FROZEN.** Do not hard-wire the architecture around any particular third-party model.

---

## 4. FROZEN — engineering contracts

Each has its own file. All are testable, and all are frozen.

| Contract | File |
|---|---|
| Security invariants (25) | `docs/security/security-invariants.md` |
| Threat model (4 adversaries) | `docs/security/threat-model.md` |
| Coordinate contract (CSS viewport pixels canonical) | `docs/architecture/coordinate-contract.md` |
| Redaction manifest v1.1 | `docs/architecture/manifest-schema.md` |
| Action schema, allowlist, literal rules | `docs/architecture/action-schema.md` |
| Benchmark / measurement contract | `docs/testing/benchmark-contract.md` |

---

## 5. FROZEN STACK — technology choices

Substitution requires an ADR.

### Client

| Layer | Choice | Why this one |
|---|---|---|
| Extension framework | **WXT (Vite)** | One codebase producing a Chrome MV3 service worker and a Firefox MV3 event page; the manifest divergence is handled for you |
| Language | **TypeScript, strict** | Manifest and action schema types are **generated from the server's Pydantic models** |
| Interface | **React + Tailwind, Side Panel API** | A side panel survives page interaction; a popup does not, and multi-step tasks need it to |
| Inference runtime | **ONNX Runtime Web**; **Transformers.js** for NER and the local VLM | Raw ORT gives manual control of pre-processing and NMS for the detectors; Transformers.js is faster to integrate for the transformer models |
| Acceleration | **WebGPU when genuinely available and validated; WASM/SIMD always** | Feature-detect `navigator.gpu`; surface the live backend in the ledger |
| Execution context | **Offscreen document + dedicated worker** | MV3 service workers have no DOM and terminate when idle; they cannot hold inference sessions |
| Capture | **`tabs.captureVisibleTab`** | Faster than screen capture and raises no OS picker mid-demo. **Rate-limited, particularly under `activeTab`** — which is why the change gate does not depend on it. |
| Element source | **Derived element graph** | Built from roles, ARIA attributes, accessible-name computation, computed styles and geometry. **NOT the browser's accessibility tree** — `chrome.automation` is ChromeOS-only for extensions and no content-script API exposes the native AX tree. Never claim otherwise to a panel. |
| Same-origin frames | `all_frames` | |
| Change signal | **MutationObserver (structural) + bounded dHash polling (visual) + low-rate full-frame dHash (safety net)** | See section 6 |

### Server

| Layer | Choice |
|---|---|
| API | **FastAPI + Pydantic v2** — the typed contract, and the source of truth for the client's generated types. Schema validation on both inbound and outbound payloads. |
| Inference | **vLLM**, OpenAI-compatible, **guided JSON decoding** |
| Model | **Qwen3-VL-4B-Instruct** default; **Qwen3-VL-8B-Instruct** as the benchmarked upgrade |
| Session state | **In-process dictionary for v1.** Redis is deferred until horizontal scale is actually needed — **Redis is not part of v1** |
| Deployment | **Docker Compose + CUDA**, fully offline-deployable per the brief |

### Testing and evaluation

**Vitest** · **Playwright** (including the egress interception suite) · a **custom
benchmark harness** reporting all five scored metrics plus task success.

### Explicitly NOT in the stack

LangChain · CrewAI · AutoGen · Redis · model ensembles · multi-model routing · streaming
action execution · a large local VLM in the normal path · differential privacy ·
k-anonymity · a confidentiality policy engine · an embedding-based change gate ·
a telemetry pipeline.

---

## 6. FROZEN — the change policy

A **changed frame** is one in which the change policy reports an observable-state change,
from either signal. This is the definition T1 is gated on. It is **not** every rendered
frame.

MutationObserver is the **structural** signal, not a claim to see everything visual.
A page can change on screen with no mutation record at all: CSS animations and
transitions, canvas and WebGL drawing, video frames, pseudo-element content, timer- and
scroll-driven visual state, and repaints inside cross-origin frames.

| Signal | Mechanism | Covers | Cost |
|---|---|---|---|
| Structural | MutationObserver on the document; ResizeObserver on tracked elements | Subtree edits, attribute and text changes, geometry, insertion and removal | Free, event-driven, names the dirty node |
| Visual | dHash over **enumerated** dynamic regions, at a bounded poll rate, only while they intersect the viewport | canvas, video, WebGL, elements with running animations | One partial capture per poll, not per rendered frame |
| Safety net | Full-frame dHash at a low fixed interval | Anything both signals miss | One capture per interval, capped |

Dynamic regions are **enumerated, not guessed**: `<canvas>` and `<video>` elements, plus
anything reporting a running animation through `document.getAnimations()`. The
enumeration re-runs on structural change, not per frame, and `IntersectionObserver`
suppresses polling for regions that are off screen.

**We do not claim to detect every visual change for free.** On a page that is one
full-screen canvas animation this degrades to the poll rate, and we say so.

---

## 7. FROZEN — perception tiers

| Tier | Contents | Weights | Firing (10-step form task) |
|---|---|---|---|
| **T0** | Change gate — structural signal plus bounded visual polling. Sub-millisecond for the structural half. No model. | — | ~100 evaluations / ~8 captures |
| **T1** | **Perceive** — UI element detector + YuNet faces. Runs on **every changed frame**. **This is the local vision model the brief requires, and it is on the normal path.** | 12.3 MB | ~8x |
| **T2** | **Sanitize** — selective OCR + GLiNER-PII. Runs when a request is about to leave, on non-DOM regions and dirty subtrees only. | 105 MB | ~3x |
| **T3** | **Local VLM** — offline fallback. Loaded on demand in an isolated worker, torn down immediately after. Kept out of the normal path so the resource figure stays defensible. | ~240 MB | 0x online |

Approximately **120 MB resident** across the four models. The expensive tiers are gated.
**The vision tier is not.**

**T0 is a debounce, not an avoidance strategy.** A run where the DOM does all the work
invites the line *"you built a DOM scraper with a redaction layer."* The demonstration
must include content where the DOM is empty by construction.

### DOM and vision are fused, not alternatives

| The DOM already knows | Only vision can see |
|---|---|
| role, accessible name, label | scanned PAN and Aadhaar cards |
| input type, autocomplete token | text inside images and PDFs |
| exact text and its box | canvas-rendered interfaces |
| visibility, enabled state, ARIA | faces, signatures, stamps |
| free, exact, no inference error | cross-origin iframes, overlays |

**Fused element graph — matched on IoU > 0.5.** DOM-matched elements are actioned by
selector (robust to reflow); vision-only elements are actioned by coordinate with a
synthetic id. **Disagreement above threshold flags an overlay** — which is why the same
mechanism appears in the threat model.

---

## 8. REPLACEABLE — behind frozen interfaces, on benchmark evidence only

These may change. Changing one requires: a completed feasibility row
(`agentos/registry/feasibility-matrix.md`), a benchmark run in `artifacts/benchmarks/`, and an
ADR. Nothing else. **No model is accepted because its documentation says it should work.**

| Role | Pinned default | Ranked alternatives |
|---|---|---|
| `UIElementDetector` | **A:** OmniParser `icon_detect_v3`, ONNX INT8 | **B:** our own detector head trained on the synthetic set — **starts week 3 regardless of whether A is working** · **C:** DOM-only degradation, vision limited to faces and OCR — the floor, and a floor we can demonstrate |
| `FaceDetector` | YuNet (OpenCV Zoo) | — |
| `OCRProvider` | PP-OCRv5-mobile via paddle2onnx | — |
| `PIIDetector` | `gliner_multi_pii-v1`, INT8 | — |
| `LocalVLM` | SmolVLM-256M-Instruct | — |
| `ServerPlanner` | Qwen3-VL-4B-Instruct | Qwen3-VL-8B-Instruct — benchmarked upgrade, week 5; the data decides |

Also replaceable: the confidentiality entity list (a JSON config passed to GLiNER at
inference time — adding a category is a one-line change, not a training run); WebP
quality; poll rates; dilation and IoU constants — **provided the fail-closed semantics
are unchanged**.

---

## 9. NOT DECIDED — resolved only by measurement

These are **UNKNOWN** (see `AGENTS.md` section 5) and must not be written into any
document, slide or design as though settled:

- Whether WebGPU is available at all inside a Chrome `chrome.offscreen` document.
- Whether WebGPU is available inside a Firefox MV3 event page.
- Whether each of the five models loads and produces correct output in each of the four
  browser/backend combinations — 20 cells, `agentos/registry/feasibility-matrix.md`.
- Whether `UIElementDetector` implementation A is viable at all.
- Whether three ONNX Runtime Web sessions can coexist in one WebAssembly heap inside an
  extension offscreen document.
- Every latency figure in the dossier. All are **projected budgets**; none is measured.
- The actual licence of each pinned model **revision**, as opposed to its repository.
- Real-world `tabs.captureVisibleTab` rate limits under `activeTab`.

---

## 10. Scope — what ships, what waits, what we refuse

| Area | Ships in v1 | v1.1 if week 6 is calm | Not building |
|---|---|---|---|
| Perception | Derived element graph, UI detector, YuNet, selective OCR, off-screen element reporting, coordinate contract | Fine-tuned visual-PII head | Embedding-based change gate |
| Privacy | All four channels, manifest v1.1, opaque fill + semantic label, differential verifier, value-aware check, vault, egress guard, fail-closed suite | Signature and ID-card classes; CONFIDENTIAL entity list expansion | Differential privacy, k-anonymity, a policy engine, universal confidentiality detection |
| Server | FastAPI, vLLM, Qwen3-VL-4B, guided JSON, tripwire, origin policy | Redis, trajectory replay, 8B upgrade | Model ensembles, multi-model routing |
| Local reasoning | Local-decision path for unambiguous fields | SmolVLM offline mode — click, scroll, basic form interaction only | A local VLM in the normal path; autonomous offline browsing |
| Performance | Screen-state cache, ROI re-analysis, warm start, benchmarked WASM path | Streaming action execution | Telemetry pipeline |

Cut deliberately: the embedding gate, Redis, two detector classes, the confidentiality
policy engine, and the local model from the normal path. Five fewer moving parts — and,
usefully, fewer inference sessions competing for the shared WebAssembly heap.

> The largest risk to this project is building a research programme instead of a submission.
