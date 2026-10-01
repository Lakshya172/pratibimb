# Visual text — the redaction-oriented criterion (RE-1), pre-registered

> **STATUS NOTE, appended 2026-09-25 (QG-03 decision) — no criterion, threshold or held-out file below
> has changed.** §8 question 4 is answered: the owner approved **Option A** in
> [`qg03-wasm-correctness-decision.md`](../testing/qg03-wasm-correctness-decision.md). For a
> text-region model, QG-03's WASM correctness cell is decided on the fixed realistic text-bearing
> fixture, relative `sumAbs` ≤ 2e-2, unchanged; the synthetic input is recorded as reference,
> regression and diagnostic evidence. G5 below is untouched and still applies to every realistic input.

> **STATUS NOTE, appended 2026-09-25 (M7.3) — no criterion, threshold or held-out file below has changed.**
> The union §3 describes is now implemented once, in `packages/privacy/src/redactionGeometry.ts`, and the
> scorer imports it instead of carrying its own copy. A golden record taken from the scorer **as
> pre-registered here** (`aabf558`) is reproduced exactly — 90 cases, masks and verdicts — so RE-1
> judges with the same code the product would redact with. §3's *"not yet implemented in product
> code"* and §8 question 3 are resolved by that. The v1 policy is recorded in
> [`visual-only-text-policy.md`](visual-only-text-policy.md); §8 question 4 is now a decision record,
> [`qg03-wasm-correctness-decision.md`](../testing/qg03-wasm-correctness-decision.md), still open.

> **Status: PRE-REGISTERED, 2026-09-25. NEXT-CANDIDATE CRITERION.** Written, and committed with its
> executable scorer and a frozen held-out set, **before any candidate was scored under it**.
>
> **RE-1 applies to candidates evaluated after this date. It does not re-score, re-interpret or
> explain `PP-OCRv5_mobile_det`.** That candidate's verdict of record is **`REJECTED FOR V1`**,
> reached under [`text-region-acceptance.md`](text-region-acceptance.md) and recorded in
> [`M7.1`](../../artifacts/experiments/M7-visual-text/M7.1-ppocrv5-det-validation.md). Both documents
> stay exactly as they are, and PP-OCRv5 is scored against RE-1 **nowhere** — not as a diagnostic,
> not as a comparison.
>
> Owner direction (2026-09-25, Ronit Saha): the next model-selection criterion should reflect the
> product objective — **safe visual redaction** — rather than tight bounding-box localisation, set
> before another candidate is judged.

| | |
|---|---|
| **Executable definition** | [`tests/browser/support/redaction-metrics.mjs`](../../tests/browser/support/redaction-metrics.mjs) — 18 hand-computed tests in `redaction-metrics.test.mjs` |
| **Held-out set** | `tests/browser/extension/fixture/heldout/` — 6 synthetic images, frozen in `groundtruth.json` by SHA-256 |
| **Development screen** | `tests/browser/extension/fixture/visual.html`, key `redactionTruth` — never an acceptance input |
| **Freeze check** | `run-heldout-groundtruth.mjs --check` |

---

## 0. A disclosure that shapes the rest of this document

**The author of RE-1 has seen PP-OCRv5's development-fixture numbers** (M7.1). A criterion written
by someone who has seen a candidate's results cannot be an unbiased test of that candidate, and
could be drawn, consciously or not, around it. Three measures follow:

1. **Every threshold is derived from a frozen rule, from redaction geometry, or from an existing
   value carried over unchanged** (§4). None was chosen by reference to 0.427, 0.365, 1.000, 2.98 or
   any other PP-OCRv5 figure, and §4 states the derivation for each.
2. **PP-OCRv5 is excluded from RE-1** — it is not scored against it anywhere, so the question of
   whether RE-1 was fitted to it never becomes a claim about it.
3. **Acceptance is decided only on a held-out set that no model has seen.** It was created and
   frozen in this milestone; nothing — not the UI head, not PP-OCRv5 — has been run on it.

---

## 1. Audit of the criterion used for PP-OCRv5

`text-region-acceptance.md` pre-registered six criteria. They remain the criterion of record for
PP-OCRv5. This section asks what each was meant to protect and whether it is the right gate for a
**redaction** system. It changes nothing retrospectively.

### 1.1 Criterion 2 — localisation, IoU ≥ 0.5: the one that decided PP-OCRv5

**Where the number came from.** It was *quoted*, not invented — from `constitution.md` §7:
*"Fused element graph — matched on IoU > 0.5 … Disagreement above threshold flags an overlay."* That
rule answers an **identity** question: does this detection *belong to* that DOM element, so the agent
can act on the element by selector? The overlay test is the same question inverted. Borrowing it
gave the text criterion a frozen provenance instead of a number made up for the occasion, which was
the intent. But it imported a threshold designed for matching, not for masking.

**What it controls.** Localisation quality: a box that is neither much bigger nor much smaller than
the thing it claims to be. That is the right property for fusion, grounding and action targeting.

**Why it is the wrong gate for redaction — four reasons, each from the repository's own rules:**

1. **It is symmetric, and the redaction rules are not.** `security-invariants.md`, *Redaction union
   semantics — FROZEN*: *"Recall is prioritised over precision, because over-masking is free and
   under-masking is fatal."* IoU charges a box that is 20 px too tall exactly as it charges one that
   is 20 px too short. Only one of those leaks.
2. **It scores a box the redaction path never uses.** The same frozen section defines the mask:
   *"Boxes dilated 4 px and merged at IoU > 0.3."* IoU was measured on undilated detector boxes, so
   the gate judged something other than what would reach the pixels.
3. **Its ground truth and its subjects used different conventions.** The fixture's truth is the tight
   ink box (`actualBoundingBoxAscent/Descent`); line-level text detectors emit padded line boxes by
   design. When a box is taller than the ink, the IoU is capped by the height ratio however well the
   text is found. That is a statement about conventions, and it holds for any padded-box detector.
4. **It does not measure a leak at all.** A box can clear IoU 0.5 and still leave the last glyph of
   an identifier visible, because IoU is a whole-box ratio.

**Verdict of the audit:** IoU against tight ink is a sound **localisation diagnostic** and the right
gate for fusion. It is **not the right acceptance gate for redaction**. Under RE-1 it is reported and
gates nothing.

### 1.2 Criterion 3 — ≥ 95 % containment per sensitive string: right idea, too coarse

It asks the redaction question — is the secret covered? — but at **string** level, by area. **A
whole glyph can go uncovered and still pass.** One glyph of a 20-glyph string is 5 %; of a 30-glyph
string, 3.3 %. A 30-character account number with its last character fully visible scores 96.7 % and
passes. `redaction-metrics.test.mjs` pins exactly that case. It was also measured on undilated boxes.
RE-1 replaces it with a **per-glyph** gate on the dilated mask.

### 1.3 Criterion 4 — flood ≤ 3× ink area; no box ≥ 90 % of the canvas

The flood ratio's **denominator is tight ink**, so ordinary line padding — the space above and below
the letters that every line of type has — counts as flood. It was grounded in a real failure mode
(QG-05: 3947 predictions for 202 buttons) and was right to exist. RE-1 keeps its purpose, moves the
free zone out to the font line box plus the frozen dilation, and keeps the **90 % blanket-box clause
unchanged**.

### 1.4 Criteria 1, 5, 6 — carried over

WASM correctness (1), no plaintext (5) and determinism (6) measure the right things. RE-1 keeps
them; criterion 1's *application* is made explicit in §4.

---

## 2. The threat model RE-1 serves

- **What leaks is visible ink.** The frozen redaction method is a constant-colour opaque fill. Pixels
  under the fill are gone; pixels outside it ship. Any visible part of a sensitive glyph can identify
  it, and a single visible digit narrows an identifier.
- **For canvas and image text there is no backstop today.** The frozen verifier's safety net is a
  full-frame OCR re-read and a value check; PratiBimb has no OCR (M4, M5, M7). For visually rendered
  text, **detector coverage is the entire safety story.** That is why coverage is absolute.
- **The policy that decides what gets masked is fail-closed.** Without reading characters, the client
  cannot tell a sensitive string from a heading. So **every text region the detector finds inside a
  visual-only region is masked**, and INV-23 applies: a detector that errors or times out counts as a
  positive, and the whole region is masked. Ground-truth sensitivity therefore decides **which misses
  are safety failures**, not which boxes are masked.
- **Over-masking is free for privacy and costly for the task.** The reasoner loses whatever is masked.
  RE-1 bounds it for utility, and to stop a degenerate detector buying coverage by masking everything
  — never in a way that could be traded against coverage.
- **No text crosses any boundary.** The detector emits boxes and scores; the scorer reads geometry;
  the ground truth contains no characters. The one vault, one classifier, one redaction path and one
  egress authority are untouched, and nothing here enters the product.

---

## 3. From boxes to a redaction mask

```
DETECTOR OUTPUT         boxes (+ scores) — rectangles, rotated boxes or quadrilaterals
      ↓ toRect          a non-axis-aligned box becomes its axis-aligned bounds (can only ADD area)
      ↓ dilate 4 px     quoted: "Boxes dilated 4 px …"            (security-invariants.md, FROZEN)
      ↓ merge           "… and merged at IoU > 0.3" — pairwise into bounding rectangles, until stable
      ↓ clip            to the visual-only region (the canvas / image the DOM cannot describe)
REDACTION MASK          union of rectangles
      ↓ compare         with ground truth, exactly (coordinate compression — no pixel sampling)
METRICS                 per glyph · per string · per image · per set
```

- **Boxes outside the visual-only region are reported and not scored.** Text the DOM describes is the
  DOM path's responsibility, and RE-1 does not reach into it.
- **Scores do not gate masking.** The detector's own post-processing threshold decides which boxes
  exist; every box that exists is masked. A candidate may not be re-thresholded on the held-out set.
- **The frozen union is not yet implemented in product code.** The scorer is its first executable
  reading. When the product builds it, the two must agree, or RE-1 is re-registered.

### How padded detector boxes are handled

| padding | treatment under RE-1 |
|---|---|
| inside the font **line box** (`fontBoundingBoxAscent/Descent` across the string's advance) | **free** — it is where text lives |
| the frozen **4 px dilation** around the line box | **free** — the product adds it to every box anyway |
| beyond that | counted as over-masking, against the budget in §4 G2 |
| rotated or quadrilateral boxes | replaced by their axis-aligned bounds — conservative, never under-masks |

A padded line box is therefore neither rewarded nor punished for being a line box. It is judged on
whether the ink under it is covered and on how much *background* it additionally hides.

---

## 4. RE-1 — the gates, and where each threshold comes from

Every gate must hold on **every** image. An average would let one leaking image hide behind five clean
ones.

| gate | measures | threshold | derivation |
|---|---|---|---|
| **G1 — no exposed sensitive glyph** *(safety)* | for each sensitive glyph, whether its ink box lies **entirely** inside the mask | **0 exposed**, set-wide | **Not a tuned number.** Any visible part of a glyph can reveal it, and there is no downstream verifier for canvas text (§2). The only tolerance is the frozen 4 px dilation, which is part of the mask — no second tolerance is introduced. |
| **G2 — over-masking within budget** *(utility)* | masked area outside the union of font line boxes each grown by 4 px, divided by the line boxes' own area | **≤ 1.0** per image | **From geometry, not from a candidate.** A budget equal to the text's own line area admits a margin of about **half a line height above and below every line**, beyond the free zone — slightly less for short strings, since the mask is also 8 px wider after dilation (pinned exactly in the tests: a 98-px line at half a line prices at 1.08, at 0.45 of a line at 0.97). Half a line height is the scale at which a margin around one line starts to occupy the next at single spacing — i.e. starts erasing neighbouring layout the reasoner needs. G2 is a utility gate; it cannot be satisfied by giving up coverage, because G1 is independent. |
| **G3 — no blanket box** *(degeneracy)* | the largest single dilated box as a share of the region | **< 0.9** | **Carried over unchanged** from criterion 4. A box that size is the detector degenerating into "mask the region", which is the floor, not a detector. |
| **G4 — deterministic** | boxes across two complete runs; outputs across ≥ 5 inferences per input | **byte-identical** | Carried over (criterion 6). A redaction decision that moves between runs cannot be verified. |
| **G5 — WASM-valid** | the **frozen S-04a-1 rule** — exact output count, `sumAbs` relative error ≤ **2e-2** vs native `onnxruntime` of the same version | pass on **every realistic input**: the development screen and all six held-out images | Statistic and bound **quoted unchanged**. What RE-1 adds is where it is applied: M7.1 showed that a text-free synthetic input drives a segmentation output into saturation, where the ratio of two tiny sums exceeds the bound while absolute agreement is ~1e-7. RE-1 therefore requires the rule on real text-bearing inputs — every one — and **records** the synthetic input as data. QG-03's own WASM column remains the gate owner's sign-off. |
| **G6 — no plaintext output** | the candidate's output type and every stage after it | **no field capable of holding a character sequence**; no recognition stage | Carried over (criterion 5), structural, checked by reading the types. |
| **Set size** | held-out coverage | **≥ 6 images, ≥ 12 sensitive strings, ≥ 150 sensitive glyphs** | So that "zero exposed" means something. With zero exposures in *n* glyphs, the 95 % upper bound on the per-glyph miss rate is ≈ 3/*n* (rule of three) — ≤ 2 % at the floor. The frozen set has **306** sensitive glyphs: ≈ 0.98 %. |

**Diagnostics, reported and gating nothing:** best IoU against ink and against the line box; the
fraction of each string's ink masked; the fraction of non-sensitive glyphs masked (expected high under
the fail-closed policy — penalising it would reward a detector that *misses* text, which is exactly
the leak to avoid); the masked share of the region; load, pre-processing, inference and
post-processing time; WASM linear memory; artifact size.

**What passing does not prove.** Zero exposed glyphs in 306 bounds the per-glyph miss rate below
about 1 % with 95 % confidence on *this* distribution of synthetic pages. It does not prove zero, and
it does not transfer to fonts, scripts, rotations or photographs the set does not contain.

---

## 5. The PP-OCRv5 resource numbers, as context only

Measured on W1 in M7.1 (Chrome for Testing, ORT Web 1.29.0 `wasm`, one thread): **~1.2 s** model load,
**~720 ms** inference on a 640×1024 realistic frame, **~62 ms** post-processing, **125.4 MB** WASM
linear memory after inference, 4 766 440 B artifact.

**No performance threshold is set from these.** They are the only measured numbers for a text
detector on this machine, recorded so the next candidate's figures can be read honestly against
something real. They are single-machine, single-browser, single-thread figures and are not claimed to
hold anywhere else.

---

## 6. The held-out set

Six synthetic pages, one canvas each, rendered by one shared script (`heldout/render.js`) that draws
the text and measures its own ground truth from the same draw calls. **No real personal data:**
identifier-like numbers are checksum-invalid (Verhoeff and Luhn checked), phone numbers begin with 0
(not a valid Indian mobile), and addresses use the reserved `.example` domain.

| image | case | sensitive strings (glyphs) | what it tests |
|---|---|---|---|
| **H1** | identity card, large type, a photo block | 3 (40) | large bold values; a non-text visual region that must not be masked |
| **H2** | statement, long strings, 13 px monospace | 3 (64) | a **30-glyph** account string — the §1.2 loophole case — and small type on shaded rows |
| **H3** | wrapped letter | 3 (47) | sensitive tokens **inline**, visually adjacent to non-sensitive words on the same line; multi-line paragraph |
| **H4** | padded chips and highlight rows | 4 (45) | **padded-line-box cases**: text inside filled chips and bands; **1.0 leading** (a sensitive line directly above a non-sensitive one); same-line label/value |
| **H5** | corners and small type | 3 (51) | 11 px values in corners and mid-right; a 30 px heading |
| **H6** | two-column form, mixed fonts | 4 (59) | Georgia, Courier New, Consolas and Arial at 15–20 px beside a label column |

**Totals:** 6 images · 63 strings · **20 sensitive strings · 306 sensitive glyphs** · 43 non-sensitive
strings. Fonts: Arial, Georgia, Verdana, Consolas, Courier New. Sizes 11–30 px. Viewport 1280×720 at
DPR 1.

**Frozen.** `groundtruth.json` records the SHA-256 of every page and of the renderer — computed over
line-ending-normalised content, so a `core.autocrlf` checkout verifies the same — and the complete
geometry — **no characters**. Its invariants are checked when it is written: every sensitive glyph
inked and counted against the page spec, no two strings' ink overlapping, every ink box inside its
line box plus 4 px (so a perfectly tight detector is never charged for over-masking), every glyph
inside the region, and two loads measuring identical geometry. `--check` recomputes it in a fresh
browser and requires an exact match, which is how font or layout drift on another machine is caught
instead of silently moving the targets.

**Rules of use:**

1. Scored **once per candidate**, after the development screen, with the RE-1 scorer as committed.
2. **Never** used to choose a threshold, a post-processing parameter, an input resolution or a
   candidate configuration.
3. Results are recorded whatever they are, including a failure.
4. Any change to a page, the renderer or the ground truth is a **new version of the set**, which
   re-opens pre-registration.

**Its limits, stated:** horizontal Latin-script text only; synthetic canvas rendering, not photographs
or scans; one machine's fonts. It is a small set built to make a zero-exposure claim meaningful, not a
benchmark.

---

## 7. The model-selection procedure for the next candidate

1. **Inventory.** A candidate must locate text without recognising it, run in ORT Web, and be
   pinned to an exact revision. No download before this step is recorded.
2. **Licence** read at the pinned revision (blocking rule 3).
3. **No new product dependency**, or an ADR for one (AGENTS.md §4.6). Measurement-only tooling needs
   owner approval, as option A did.
4. **Reproducible acquisition** — pinned source hashes, recorded toolchain, output hash.
5. **Development screen** on `visual.html` (`redactionTruth`) under RE-1. It can reject cheaply; it
   **cannot accept**, because two models have already been seen on it.
6. **Held-out evaluation** under RE-1: G1–G6 and the set-size floor, on every image, once.
7. **QG-03 in full** — all feasibility cells, coexistence and teardown, a benchmark artifact.
8. **Owner decision** on adoption. Nothing enters the product before it, and the interface does not
   change to fit the model (blocking rule 4).

A candidate may be **REJECTED** at any step, recorded with its artifact (blocking rule 5).

---

## 8. Open questions for the owner — recorded, not assumed

1. **May a candidate `REJECTED FOR V1` under the old criterion be re-submitted under RE-1?** Not
   assumed either way. PP-OCRv5 remains `REJECTED FOR V1`, and this document does not score it.
2. **Visual-only text sensitivity.** RE-1 assumes the only policy available without reading
   characters: mask every detected text region in a visual-only area. A future sensitivity signal
   would not invalidate RE-1 — G1 judges sensitive glyphs and G2 judges background — but it would
   change what the product masks.
3. **The frozen union in product code** does not exist yet; when it does, it must match this reading
   of it.
4. **QG-03's WASM column** — whether a realistic-input pass supersedes a synthetic-input failure —
   remains the gate owner's judgement. RE-1 requires the realistic inputs and records the synthetic.
