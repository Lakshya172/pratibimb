# M9 — the local text-region provider contract (Parts B and D)

## What exists today

| element | source | what it is |
|---|---|---|
| `OCRProvider` | `docs/architecture/constitution.md` §3 (FROZEN): *"image region in → text + boxes out"*; §8 pinned default *"PP-OCRv5-mobile via paddle2onnx"* | a **role name** in the constitution, and one member of `DetectorRole` in `packages/perception/src/detector.ts`. **No implementation exists.** Its det half is REJECTED FOR V1; its rec half is REJECTED for this role |
| `Detector` / `DetectorRegistry` / `Admissibility` | `packages/perception/src/detector.ts` | role → `ADMISSIBLE` / `UNAVAILABLE` / `EXCLUDED`, resolved per **measured** backend, with no fallback chain. A `Detection` is `{ box, label, score }` |
| `TextPerception` / `TextFinding` / `perceiveText` | `apps/extension/host-lib/text-perception.ts` | the seam in the perception realm. `read(image) → TextFinding[]`, `TextFinding = { box, length, piiClass: TextClass \| null, ref }` with no string field. **Shipped with `null`**, so every pass reports `TEXT_PERCEPTION_UNAVAILABLE` |
| canonical geometry | `packages/privacy/src/redactionGeometry.ts` | `redactionMask(boxes, region)`, `failClosedMask(region)` — the one implementation, EXPERIMENTALLY VERIFIED equal to RE-1's scorer (M7.3) |

**The mismatch:** the constitution's `OCRProvider` promises *text out*. The v1 visual-only policy
(owner-directed, M7.3) forbids reading, and both candidates are detectors that **cannot** produce
text. A detector-only producer does not satisfy the frozen `OCRProvider` shape. Pretending it does
is exactly the ambiguity that makes `piiClass: null` dangerous.

## The two shapes evaluated

### Option A — a detector-only role: `TextRegionDetector`

A new member of `DetectorRole`, implemented through the **existing** `Detector` interface: `detect`
returns `Perceived<Detection[]>`, the same admissibility registry, measured `acceptedBackends`. A
detection's `label` is the single constant `"text-region"`. Its findings enter the text seam as
**`UNREAD_REGION`** (see `textfinding-semantics.md`). `OCRProvider` stays in the constitution with
**no admissible implementation**, so that a reading producer, if one is ever proposed, needs its own
ADR and cannot slip in through the same slot.

### Option B — keep `OCRProvider`, make its text optional

`OCRProvider` would become *"image region in → (text?) + boxes out"*. A detector-only model registers
as `OCRProvider` and returns boxes with no text, and a per-finding flag says "recognised" or
"unread".

### Side by side

| property | Option A — `TextRegionDetector` | Option B — optional-text `OCRProvider` |
|---|---|---|
| **type safety** | The role itself says "no text". Nothing about a detector-only finding can hold a class or a string: the `UNREAD_REGION` variant has no such fields | One type must admit both "text present" and "text absent". Safety rests on every consumer checking a flag, and the type admits a reader in the same slot |
| **privacy properties** | Structural: the producer's output type has no text field, as `UI_CLASSES` does for the UI head today (`perception-realm.ts`, *"structurally incapable"*) | Conditional: the type **permits** text, so the no-plaintext property becomes a runtime convention for this producer instead of a property of the role |
| **migration impact** | `DetectorRole` gains one member, and `TextFinding` becomes a discriminated union (reader shape kept). The constitution §3/§8 needs an ADR amendment either way. No shipped behaviour changes, because the tier is `null` today | The frozen §3 wording changes meaning, and every reader of `TextFinding.piiClass` must learn a second meaning of absence |
| **model interchangeability** | Any detector with box + score output fits: TR-01, TR-02, or a later DB/FAST/CRAFT-family detector. Swapping is a registry change | The same, but a recogniser also fits the slot, which is the substitution the M7/M8 records exist to prevent |
| **testing burden** | Existing registry tests plus the discriminated-union cases (the reference model's 14). The no-text property is checked on the type's keys | Every consumer needs tests for both meanings; the no-text property needs a runtime assertion on every producer |
| **failure semantics** | The existing `Perceived` refusals (`DETECTOR_UNAVAILABLE`, `DETECTOR_BACKEND_UNSUPPORTED`) plus INV-23: error or timeout → the visual-only region masked whole | Same refusals, plus a new failure class: "text present from a producer declared detector-only", which must also be caught |
| **fit with the current architecture** | Fits the realm split as it stands. No string is produced, so nothing needs a vault, and `text-perception.ts`'s *"never recognise"* option is taken literally | Keeps the door open to the realm problem `text-perception.ts` names: a recognised string in the perception realm has no vault it may legally reach |

### Recommendation to the owner

**Option A — a detector-only `TextRegionDetector` role**, with `OCRProvider` retained in the
constitution but left with no admissible implementation.

It is the only shape in which "no plaintext" is a property of the type rather than a promise of the
producer. It reuses the registry, refusal and provenance machinery that already carries the UI head.
And it makes the two candidates, and any later detector, interchangeable without widening the slot
to readers. It needs the constitution amendment in ADR-0011. It is a recommendation, not a decision:
**ADR-0011 is PROPOSED until the owner approves it.**

## Part D — how the contract feeds the canonical geometry

```
frame (CaptureFrame, capture pixels)
  └─ TextRegionDetector.detect ─► Detection[] in CAPTURE pixels      (model-specific: preprocess, infer, DB post-process)
       └─ capture → CSS (captureToCss, CaptureGeometry)               INV-24: convert at the edge
            └─ assign each box to its visual-only region (id)          ─► UNREAD_REGION { box, score, regionId }
                 └─ per region: redactionMask(boxes of that region, region.rect)   ◄── FROZEN, unchanged
                      axis-align → dilate 4 px → merge while IoU > 0.3 → clip to region
                 └─ tier ERROR / TIMEOUT / UNAVAILABLE / malformed ─► failClosedMask(region.rect) for EVERY region (INV-23)
                      └─ opaque fill of the mask rectangles, in the perception realm, before any encode
```

**What was screened is this geometry.** In M8.1 and M8.2a, the boxes went to the RE-1 scorer, which
calls this exact `redactionMask` (M7.3: 90/90 golden cases identical, and the only implementation in
product source). The geometry needs no re-screening.

**What was screened is NOT yet the product path, in four places.** Each is recorded as an adoption
blocker requiring re-screening, not corrected here:

| # | mismatch | screened (M8.1–M8.2a) | product would do | blocker |
|---|---|---|---|---|
| **G-1** | where post-processing lives | `dbPostprocess` in `tests/browser/support/text-detector-screening.mjs`: 8-connected components, axis-aligned box, DB unclip | nothing yet; the product has no DB post-processing | port **verbatim** into product source, with a test pinning its source hash and output boxes to M8.1's records. Any other variant (e.g. PaddleOCR's rotated `minAreaRect`) needs a **new screening** |
| **G-2** | coordinates | frames were 1280×720 at DPR 1, so capture px = CSS px and boxes were used as CSS directly | stream frames are `maxWidth/maxHeight`-constrained to the CSS viewport, then measured (`geometryFrom`); DPR ≠ 1 and a scaled capture are possible | the capture→CSS step (INV-24) is **unscreened** for this detector; re-screen on frames where `scaleToCss ≠ 1` |
| **G-3** | pixel source | PNG screenshots (Playwright), one decode path | `getUserMedia` tab stream → `ImageCapture.grabFrame` → `ImageBitmap` → canvas RGBA | pixel equivalence between the two sources is **UNKNOWN — NOT YET VERIFIED** (no record measures it); RE-1 must be re-measured on product-path frames |
| **G-4** | the visual-only region | known from the fixture's ground truth (`region` = the canvas rect) | the DOM observation measures only `a, button, input, select, textarea, label, [role]` (`page-surface-dom.ts`), so an unrolled `<canvas>` or `<img>` is **never measured** | the product cannot name a visual-only region today; enumeration must be designed, and screened for coverage, before masking can clip to anything |

Preprocessing is **not** a mismatch: M8.2's benchmark showed the in-browser JS preprocessing equals
the screened Python tensor **byte for byte** (max difference 0, 20 launches per candidate), given
the same decoded RGBA. G-3 is about whether that RGBA is the same.
