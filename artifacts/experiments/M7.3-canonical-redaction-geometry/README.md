# M7.3 — one redaction geometry

> **W1, 2026-09-25.** Before another text detector is judged, the geometry that judges it and the
> geometry the product would redact with must be the same code. They now are.
>
> Until this milestone the frozen redaction union — *"Boxes dilated 4 px and merged at IoU > 0.3"* —
> had exactly one implementation in the repository, **and it was the RE-1 evaluation scorer**. The
> product had none. It now has one, in `packages/privacy`; the scorer imports it; and a golden record
> taken from the scorer **as it was pre-registered** proves the refactor moved nothing.
>
> **No model downloaded, no model run, no dependency, no threshold moved, no held-out geometry
> changed.** `PP-OCRv5_mobile_det` remains **`REJECTED FOR V1`**.

- **Workstation:** W1 (`LAPTOP-6E14K34L`, Intel Core 7 240H) · Node v24.19.0 · Chromium 1243
- **Canonical geometry:** [`packages/privacy/src/redactionGeometry.ts`](../../../packages/privacy/src/redactionGeometry.ts)
- **Equivalence test:** [`tests/browser/support/redaction-geometry-equivalence.test.mjs`](../../../tests/browser/support/redaction-geometry-equivalence.test.mjs)
- **Golden:** [`tests/browser/support/redaction-geometry.golden.json`](../../../tests/browser/support/redaction-geometry.golden.json) — recorded from `aabf558`
- **Policy:** [`docs/perception/visual-only-text-policy.md`](../../../docs/perception/visual-only-text-policy.md)
- **Gate question:** [`docs/testing/qg03-wasm-correctness-decision.md`](../../../docs/testing/qg03-wasm-correctness-decision.md) — **OWNER DECISION REQUIRED**

## Hypothesis

That the frozen union could be given one authoritative implementation, the RE-1 scorer moved onto it,
and the equivalence proven exactly rather than argued — without changing RE-1's behaviour, the
held-out set, or anything else in the product.

**What would falsify it:** any golden case whose mask or verdict changed; a second implementation
of dilation or merging surviving anywhere in product source; the held-out set failing its frozen
check; a behaviour change outside the new module.

## Environment

| | |
|---|---|
| Canonical module | self-contained TypeScript, erasable syntax only, no runtime import — loaded by the product build, Vitest and plain Node alike |
| Golden inputs | 15 box sets × 6 held-out images = **90 cases**, derived from the frozen ground truth by fixed arithmetic; no detector |
| Held-out set | unchanged since `115e2a9`; `--check` in a fresh browser |
| Product | no caller of the new module yet — no visual-text detector is adopted and no frame leaves the client |

## Expected result

1. Canonical mask = pre-registered scorer's mask, for all 90 cases, exactly.
2. Refactored scorer's verdict = pre-registered scorer's verdict, for all 90 cases, exactly.
3. One definition of dilation and merging in product source.
4. Held-out set identical to its frozen record.
5. No product behaviour change outside the new, uncalled module.

## Actual result — against each expectation

| # | expected | actual | detail |
|---|---|---|---|
| 1 | canonical mask = pre-registered scorer's mask | **90 / 90 identical** | Part B/D |
| 2 | refactored scorer's verdict = pre-registered verdict | **90 / 90 identical** | Part B/D |
| 3 | one definition of dilation and merging | **one file**: `privacy/src/redactionGeometry.ts` | Part B/D |
| 4 | held-out set identical to its frozen record | **files match · geometry matches** | Part E |
| 5 | no product behaviour change outside the new module | **none** — `git diff 115e2a9 -- apps` empty; module not in the bundle | Parts I/J |

## Part A — the canonical geometry, as the frozen text defines it

| step | rule | source |
|---|---|---|
| 1 · detector box | rectangle, rotated box or quadrilateral, CSS viewport px | INV-24 |
| 2 · axis-align | a quadrilateral becomes its bounding rectangle — can only add area | *"over-masking is free"* |
| 3 · dilate | **4 px** on every side | *"Boxes dilated 4 px"* |
| 4 · merge | pairwise at IoU **strictly > 0.3** into the bounding rectangle, restart until stable, fixed order | *"… merged at IoU > 0.3"* |
| 5 · clip | to the visual-only region (the canvas / image the DOM cannot describe) | RE-1 §3 |
| 6 · mask | the union of the resulting rectangles; INV-23 failure → the whole region | INV-23 |

Nothing here was invented. The one choice the frozen text leaves open — the merge order — was
inherited unchanged from the pre-registered scorer, which is exactly why the golden can match.

## Part B/D — equivalence, proven exactly

**Order of operations mattered.** The golden was recorded **first**, by a script that refuses to
run unless `redaction-metrics.mjs` is byte-identical to the pre-registration commit `aabf558`. Only
then was the scorer refactored. Afterwards the recorder refuses, exit 1 — the record cannot be
silently re-taken from the new code.

| check | result |
|---|---|
| canonical mask, through `@pratibimb/privacy`'s public export, vs golden | **90 / 90 identical** |
| refactored scorer's full verdict vs golden | **90 / 90 identical** |
| same, under **plain Node with no build step** | **90 / 90 identical** |
| canonical overlap ratio vs `@pratibimb/perception` fusion `iou` | **identical on 2000 deterministic pairs** |
| definitions of dilate / merge / mask in `apps/` and `packages/*/src` | **exactly one file**: `privacy/src/redactionGeometry.ts` |
| scorer | imports the canonical file; defines no geometry of its own |

"Identical" means `toEqual` on the full structures — every rectangle coordinate and every metric,
including floating-point values, with no tolerance.

## Part C — the v1 visual-only policy

Recorded in [`visual-only-text-policy.md`](../../../docs/perception/visual-only-text-policy.md):
**a text region the detector finds in a visual-only area is fully redacted, unread**; with nothing
read, every such region is classified sensitive (fail-closed); redaction is `redactionMask` followed
by the frozen opaque fill. The detector supplies box, confidence and region — never text.

**The limitation, stated as policy:** a region the detector does not find is not protected by this
mechanism, there is no OCR verifier backstop for canvas text, and no recall figure is claimed.

**Found while writing it, and left open deliberately:** the existing `TextFinding` seam was designed
for a *reading* producer. Its `length` counts recognised characters, and `piiClass: null` means
*"not sensitive by its rules"*. A region-only producer can supply neither, and reporting `null` would
declare unread text not sensitive — the opposite of fail-closed. The seam must gain a way to say
"unread, therefore sensitive" before any region detector is wired to it. That change belongs with
the integration of an accepted candidate; no producer exists, so it is not made here.

## Part E — held-out integrity

| | |
|---|---|
| images · strings | **6 · 63** |
| sensitive strings · sensitive glyphs | **20 · 306** |
| non-sensitive strings | **43** |
| fonts · sizes | **Arial, Consolas, Courier New, Georgia, Verdana · 11–30 px** |
| frozen check in a fresh browser | **files match · geometry matches** |
| ink inside line box + 4 px | **every string** |
| characters in the frozen truth | **none** |
| sensitive glyphs overlapping another string's glyphs | **0** |
| sensitive glyphs overlapping **within** a string | **135 pairs — all adjacent characters, median 0.56 px, max 2.06 px** |

The last row is not what the brief expected ("no overlapping sensitive glyphs"), and it is recorded
rather than repaired. Chrome reports each character's ink extent rounded outward, so neighbouring
glyph boxes in a string touch or overlap by up to about 2 px. RE-1 scores every glyph individually
(G1) and judges over-masking on line boxes (G2), so this cannot change a verdict. Editing the frozen
truth to remove it would have re-opened pre-registration for no gain. The test pins it as measured.

No candidate detection was added to the ground truth. The 90 golden box sets are derived from it,
live in a separate file, and are never written back.

## Part K — cost on W1

`bench-geometry.mjs`: canonical functions, per stage, median of 3000 calls after 300 warm-up, Node
v24.19.0, Intel Core 7 240H. **W1 only, Node only — not a browser, not a general claim.**

| box set (per image) | boxes | mask rects | dilate | merge | clip | **total** |
|---|---|---|---|---|---|---|
| ink / line / padded — line-level | 8–12 | 4–12 | 0.2–0.6 µs | 0.9–4.6 µs | 0.2–0.5 µs | **1.2–5.0 µs** |
| glyphs — character-level | 101–292 | 61–188 | 1.6–4.2 µs | **1.3–25.8 ms** | 1.5–4.4 µs | **1.3–25.6 ms** |

**The merge dominates, and it scales steeply.** The frozen rule is applied as written — restart
the pairwise search after every merge until nothing qualifies — which is cubic in the worst case.
For a line-level detector (a dozen boxes) it is microseconds; for a character-level one (hundreds) it
is up to 26 ms, still small beside ~0.7 s of inference but not free. It was **not** optimised here:
any faster algorithm must produce the same rectangles, and the golden test now exists to hold it to
that.

## Parts I/J — nothing else moved

| gate | result |
|---|---|
| `npm test` | **1601 passed** / 0 failed / 15 skipped, exit 0 (+117: 15 canonical-geometry, 102 equivalence) |
| `npm run typecheck` | **0 errors**, exit 0 |
| `verify-repo.py` | PASS once this record exists |
| `pin:check` | OK |
| extension build | green, product and degraded |
| perception + privacy + support suites | **783 passed** |
| held-out `--check` | files match, geometry matches |
| M7 floor on the development fixture | **identical** |
| extension loop — worker, reasoner and egress scans | **72/72**, fixture values in worker traffic: **0** |

`git diff 115e2a9 -- apps` is empty, and the only product-source change is the new privacy module and
its export. No permission, capture route, action type, egress path, dependency or model was added.
The product bundle does not contain the new module — nothing in it calls it yet.

## Conclusion

| | |
|---|---|
| **ARCHITECTURALLY APPROVED** | visual-only text is fully redacted, unread, fail-closed (owner direction) |
| **EXPERIMENTALLY VERIFIED** | the canonical geometry reproduces the pre-registered RE-1 geometry exactly (90/90, masks and verdicts); one implementation exists |
| **NOT YET VERIFIED** | any product path applying the mask to pixels — none exists; recall of any detector |
| **DEFERRED** | the `TextFinding` seam change for region-only producers, to the integration of an accepted candidate |
| **REJECTED** | `PP-OCRv5_mobile_det` for v1 — unchanged, not re-run |
| **OWNER DECISION REQUIRED** | which input decides QG-03's WASM correctness cell |

**Not claimed:** production readiness, perfect recall, that visually rendered secrets are protected
today. They are not — no detector is adopted.

## Reproducibility

```bash
npm test && npm run typecheck && python scripts/verify-repo.py && npm run pin:check
CHROME_PATH=<chromium 1243> node tests/browser/extension/run-heldout-groundtruth.mjs --check
node artifacts/experiments/M7.3-canonical-redaction-geometry/harness/bench-geometry.mjs
```
