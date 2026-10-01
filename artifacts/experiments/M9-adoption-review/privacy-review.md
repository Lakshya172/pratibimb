# M9 — adoption-focused privacy review (Part E)

Each property is stated with its **evidence** and the **existing rule** it serves. Nothing here is
a new security claim, and **no recall is claimed**.

| # | property | status | evidence | existing rule |
|---|---|---|---|---|
| P1 | the candidate outputs no text | **VERIFIED (structural)** for both | one float32 `[1,1,H,W]` map; no STRING tensor; boxes carry only `x,y,w,h,score` — M8.1 G6 and every M8.2 / M8.2a cell (`plaintextCheck`) | INV-07 (values only as tokens); visual-only policy (*"never supplies … the recognised text"*) |
| P2 | no recognition model is required | **VERIFIED** | neither candidate has or needs a recognition companion; `PP-OCRv5_mobile_rec` stays REJECTED for this role; no recogniser was ever loaded (M8.1 / M8.2 / M8.2a audits) | `text-perception.ts`: *"never recognise … needs no vault"* |
| P3 | no plaintext path exists | **VERIFIED for the candidate; DESIGN for the product.** No string is produced, and the proposed `UNREAD_REGION` has no field to carry one (reference model, 14 tests) | the candidate records above; `textfinding-semantics.md` | INV-21; one vault / no second vault (`text-perception.ts`) |
| P4 | raw pixels remain local | **VERIFIED for the existing capture path; unchanged by adoption.** The detector runs in the perception realm on the pixels that realm already holds | ADR-0009 gesture route: the worker never holds a frame (`perception-realm.ts`, `workerSawPixels: false`); the detector adds no message | ADR-0009; realm split |
| P5 | no candidate-specific egress | **VERIFIED in the harness; must be re-proved in product.** Model bytes are a packaged same-origin asset; ORT is the pinned runtime | M8.2 / M8.2a network logs: **0** foreign requests in every launch, both candidates | INV-01 (single egress module); ADR-0001 (`connect-src` pin) |
| P6 | no new permission needed | **DESIGN — holds if the detector runs in the existing offscreen perception realm**, which already has everything it uses (ORT, WASM CSP, the frame) | product manifest: `offscreen, sidePanel, activeTab, tabCapture` (`wxt.config.ts`) | QG-04 / manifest review |
| P7 | no new external service | **VERIFIED** | fully local inference; nothing contacts a model host at runtime | INV-01 |
| P8 | no secret/token material enters inference | **VERIFIED by construction.** The detector's only input is the frame's pixels; vault values and tokens live in other realms and are never fed to it. Secrets that are *visibly rendered* are in the pixels by definition, which is what the mask exists for | `perception-realm.ts` input = the decoded frame; vault location per M2 | INV-04 – INV-07 |
| P9 | failure is fail-closed | **DESIGN, executed in the reference model; NOT implemented in product** (no mask exists) | `planRedaction`: ERROR / TIMEOUT / UNAVAILABLE / malformed → `failClosedMask` for every visual-only region | INV-23; INV-22 |
| P10 | timeout / error masks the visual-only region | **DESIGN** — as P9. **The timeout budget is an open OWNER DECISION** (see below) | — | INV-23; threat model A3 (*"a timeout counts as a positive"*) |

## Mapped to the threat model

| adversary | what adoption changes |
|---|---|
| **A1 — curious server** | **Nothing yet.** The server sees what the manifest carries, and today **no frame is sent**: the reasoner receives JSON only (`packages/reasoner/src/localModel.ts`). Adoption matters for A1 only once a frame is sent under the constitution's wire contract (*"WebP frame + redaction manifest + user goal"*). Then the mask is what stands between canvas text and the server |
| **A2 — malicious page** | The detector is an untrusted input like the UI head. Its boxes must pass `validateDetections`-style checks (finite, in-frame) before becoming geometry. A page can draw text **designed to be missed** (tiny, rotated, low contrast). That is a recall limitation, not a bypass of the boundary, and it is untested beyond the synthetic set |
| **A3 — faulty local detector** | Addressed **by design** through INV-23 (error or timeout → region masked whole). **Not addressed**: a detector that runs cleanly and misses. The frozen verifier's backstop for that case is a full-frame **OCR** re-read (`security-invariants.md`, verifier steps 3–5), which the v1 no-recognition policy excludes, so canvas text has **no verifier backstop** (already recorded in `visual-only-text-policy.md`) |
| **A4 — hostile VLM** | Unchanged. The detector's output never reaches the model as text, and nothing it produces is an action |

## Two findings the owner should see

1. **The fail-closed test matrix lists "detector timeout at 200 ms"** (`security-invariants.md`).
   Both candidates' measured warm inference is **~470 ms (TR-01)** and **~557 ms (TR-02)** in the
   M8.2 controlled benchmark. If 200 ms were read as the product's detector deadline, **every** pass
   would time out and mask each visual-only region whole. That is safe, and it makes the detector
   useless. The matrix row is a test case (inject a timeout, expect zero outbound requests), not a
   budget the repository has set. **The product's text-detector timeout is an OWNER DECISION
   REQUIRED.** M9 does not invent one.
2. **`UNKNOWN → PUBLIC`.** Mapping unread regions to `piiClass: "UNKNOWN"` would transmit them
   unmasked. The proposed type makes that unrepresentable (`textfinding-semantics.md`).

## Not claimed

Full PII recall · zero leakage · protection of canvas text the detector misses · that
visual-only PII protection works in the product (**NOT VERIFIED**; no mask is applied anywhere
today).
