# QG-03a-B2 — decision

**B2 (real backend noise, workstation 2): PASS. QG-03a-B: CONDITIONAL. QG-03a: OPEN.**

## What the evidence settles

- **The real backend difference does not cross the NMS discontinuity on this machine.** Across
  4,848 decoded reference detections, in every measured pair (Chrome and Firefox WASM, Chrome
  and Firefox WebGPU, native CPU), there are **0 survivor swaps and 0 true failures**. The
  worst displacement is 0.0026 CSS px, and the pre-registered criterion passes 20/20, in
  both the shipped and the 0.55 views.
- **Why:** the output carries 1,402 overlapping exact score ties. Every backend reproduces
  them, and hard NMS resolves ties deterministically by anchor index.
- **iid perturbation is not a valid backend-noise model.** It destroys those ties, and fails
  from one ULP (1e-7). The QG-03a synthetic curve under-counted ties for the opposite reason.
  Neither curve should be quoted as a prediction of real behaviour.

## Acceptance criterion

**Outcome A and C together.** The existing pre-registered detector criterion (QG-03b-2/2a:
≥ 95% matched at IoU 0.5, |count Δ| ≤ 2, worst ≤ 2.0 CSS px) is sufficient **when evaluated
at measured backend noise**. The real difference is small enough that the discontinuity is
not a practical failure here.

**ARCHITECT APPROVAL REQUIRED (QG-03a-B1)** to adopt that as the formal criterion. The
proposal: *"B is evaluated, for each target machine × browser × backend cell, by feeding the
real ORT outputs of the exact artifact through the shipped decode, and passes when the
pre-registered detector criterion holds between backends, with zero true failures."*

## Why CONDITIONAL and not PASS

1. **Margin.** `gradients-edges`, a non-UI stress page saturated at the 300 cap, fails at
   **2×** the measured WebGPU − WASM difference. Real UI fixtures stay failure-free until
   50×. A GPU or driver with twice this machine's delta is plausible.
2. **Coverage.** Workstation 2 only (AMD RDNA-3). Intel (workstation 1), NVIDIA and other
   ORT versions are unmeasured.
3. **Context.** A page with the production pin and factory, not the MV3 extension.
4. **Criterion** not yet approved.

## What is NOT done

- No NMS change (soft NMS, weighted merge, epsilon tie-breaks, smoothing). The evidence shows
  no failure at real noise.
- Threshold 0.55, the model registry, the held-out split and adoption status are unchanged.
  **The detector stays UNADOPTED.**
- The model is not modified, regenerated, retrained or committed.
- C stays CONDITIONAL; B2 gives no reason to reopen it.
- There are no security-relevant changes.

## Follow-ups

| id | item |
|---|---|
| QG-03a-B1 | architect decision on the criterion above |
| QG-03a-B3 | repeat B2 on workstation 1 (Intel) and an NVIDIA-backed browser, and in the extension context |
| QG-03a-B4 | decide whether saturated non-UI frames (300-cap) belong in the adoption fixture set or are excluded as out of distribution |
