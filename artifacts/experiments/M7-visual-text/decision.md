# Decision — M7 visual text: inventory, criteria, floor

| Field | Value |
|---|---|
| **Verdict** | **NO CANDIDATE ADOPTED.** Gate-0 screen **NOT PASSED** by the only detector present; the only text-region candidate remains **BLOCKED** |
| **Status** | `PP-OCRv5_mobile_det` **DEFERRED** (blocked) · `PP-OCRv5_mobile_rec` **REJECTED** for this role (architectural) · visual-text privacy path **NOT YET VERIFIED** |
| **Date** | 2026-09-25 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Cell** | Chromium 1243 (`chrome-win64`), headed, degraded build |

## What this authorises

- **Citing the floor.** The shipped UI head has no text class, and even when every one of its 63
  detections is counted as text it localises neither sensitive string (best IoU 0.423 and 0.142
  against a 0.5 bar), leaves 29% of the holder's name uncovered, and floods at 11.75× against a 3×
  bar. Deterministic across two runs.
- **Citing the pre-registered criteria** in `docs/perception/text-region-acceptance.md` as the bar
  any future candidate is screened against. They were committed before the screen existed.

## What this does not authorise

- **Any download, conversion or integration.** None was done.
- **Any claim that visually rendered secrets are protected.** They are not. The canvas identifier
  remains neither read nor protected.
- **Any change to the frozen S-04a-1 WASM criterion.** It is quoted, not revisited.
- **Any change to the T1 UI detector.** Untouched.

## OWNER DECISION REQUIRED — the dependency that blocks the next measurement

The pinned revision `PaddlePaddle/PP-OCRv5_mobile_det @ 0d63e78e` contains **no ONNX file** — only
Paddle inference format (`inference.json`, `inference.pdiparams`, `inference.yml`). The artifact
S-04a-1 measured was a local `paddle2onnx` conversion that was not retained. Re-running S-04a-1a —
the p1 follow-up that could legitimately move the WASM result — therefore requires one of:

| option | what it means | governance |
|---|---|---|
| **A** | Install `paddle2onnx` (and `paddle`) on W1 as **measurement-only tooling**, re-convert at the pinned revision, verify the output against the recorded sha256 `5f353dec…4705b`, then run S-04a-1a with realistic text-bearing input | a dependency decision under `AGENTS.md` §4.6; tooling, not a runtime dependency, but still the owner's call |
| **B** | Obtain a pre-converted ONNX from another source | a **different artifact**: new provenance, new licence check, new QG-03 row — i.e. a new candidate, not the pinned one |
| **C** | Record `PP-OCRv5_mobile_det` as **REJECTED** now, per blocking rule 5, and open a search for a different region detector | abandons the one candidate without the measurement its own record says was never taken |

**No option is chosen here.** Recommendation, if one is wanted: **A**, because it is the only option
that measures the pinned artifact rather than replacing it, and the conversion output can be checked
byte-for-byte against the hash already on record.

## Recorded, not hidden

1. The screen runs on the **degraded** build, because it needs a frame and no harness can produce the
   human invocation `activeTab` requires. It is a detector screen, not a capture-route claim.
2. The fixture is **one synthetic page**. It is a gate-0 screen, as the acceptance document states;
   adoption would additionally need QG-03 in full and a held-out set.
3. The inference that realistic input would unsaturate `ocr_det`'s output and shrink its WASM error
   is **an inference from S-04a-1's logit analysis**, not a measurement.
