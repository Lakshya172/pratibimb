# MVP-0 — DOM sufficiency on a controlled page, and what vision adds

> ## THIS IS NOT THE AGENT LOOP, AND THE TASK DID NOT COMPLETE.
>
> **Nine of the loop's eleven stages have no implementation** — no vault, no PII detector, no
> redaction, no verifier, no egress module, no action validator, no executor, no server, and no
> MV3 extension (there is no `manifest.json` in the repository at all). See
> [`AUDIT-0005`](../../reviews/AUDIT-0005-mvp-loop-readiness.md).
>
> **No SANITIZE, VERIFY, REASON, PLAN, VALIDATE, REFRESH or RE-HYDRATE stage ran, because none
> exists.** Nothing was sanitised, nothing was transmitted, no server was contacted, no vault was
> read. **No privacy claim is made by this experiment**, and none may be quoted from it.
>
> The detector is used **experimentally**. No weight, threshold, NMS or decode change was made.

## Hypothesis

**H-DOM.** On a conventional form the DOM exposes enough to act: roles, names, labels, geometry.

**H-VISION.** On a canvas-rendered form the DOM exposes nothing actionable, and the visual
detector supplies the missing candidates.

**H-NULL.** Either the DOM also succeeds on the canvas page — in which case the page tests
nothing and must be redesigned — or vision fails too, in which case the gap is real and
unclosed.

## Environment

| | |
|---|---|
| Machine | **workstation 2** (`LAPTOP-SRCINK2B`), Node v26.4.0 |
| Pages | served from **127.0.0.1** by the harness itself. Mode A is the repo's own QG-02 fixture; Mode B is `harness/fixture/mode-b-canvas-form.html`, generated locally from fabricated strings |
| Authorisation | **we host both pages.** No external site is contacted, no security control is touched, no credential or real datum exists |
| Viewport | 1024 × 768, DPR 1 |
| Model | `ba6d9e93…`, 302,960 B, hash-verified, **unmodified**; ORT Web 1.29.0 WASM in Node |
| Operating point | **0.55**; shipped `PROVISIONAL_THRESHOLDS` asserted unchanged (score 0.25, nmsIou 0.5) |
| Values | fabricated: `Asha Example`, `asha@example.invalid`, `1990-01-02`, `9000000001`, `12 Test Lane, Example City`, PIN `4321`. **No real PII** |

## Expected result

Written before the run: Mode A's DOM yields named actionable elements; Mode B's DOM yields
**zero**; vision grounds most of Mode B's seven targets. The pre-registered honesty clause: **if
DOM-only also succeeds on Mode B, say so and redesign the page rather than claim a visual win** —
and if vision fails, report the failure rather than lowering the IoU gate.

## Actual result

**MEASURED 2026-09-12 on workstation 2.**

### Perception

| | Mode A (DOM-rich) | Mode B (DOM-poor, canvas) |
|---|---|---|
| DOM nodes | 18 | 11 |
| DOM actionable elements | **5** | **0** |
| …with an accessible name | **5** | **0** |
| vision candidates at 0.55 | not run | **46** |

### Grounding the seven targets Mode B's task needs, at the frozen IoU 0.5 fusion rule

| target | DOM best IoU | DOM | vision best IoU | vision |
|---|---|---|---|---|
| fullName | 0 | ✗ | **0.8566** | ✓ |
| email | 0 | ✗ | **0.7874** | ✓ |
| dob | 0 | ✗ | **0.6329** | ✓ |
| phone | 0 | ✗ | **0.6861** | ✓ |
| address | 0 | ✗ | 0.4850 | ✗ *(near miss)* |
| pin | 0 | ✗ | 0.4250 | ✗ *(near miss)* |
| **submit** | 0 | ✗ | **0.0665** | ✗ *(nothing overlaps it)* |
| **total** | — | **0 / 7** | — | **4 / 7** |

### Acting from those coordinates — and the task **FAILED**

| path | fields typed | submit grounded | submitted | end state |
|---|---|---|---|---|
| DOM-only | **0 / 6** | IoU 0 | no | no receipt |
| vision | **4 / 6** | IoU 0.0665 | **no** | **no receipt** |

**Neither path completed the task.** The vision path filled four of six fields and then **refused
to click submit**, because no candidate overlapped the button at IoU ≥ 0.5. The form was
incomplete and was never submitted, so the page shows no receipt — which is the correct end
state, not a bug.

Detector latency on this page: preprocess **25 ms**, inference **44 ms**, decode + project
**4 ms**.

## Conclusion

**H-DOM supported. H-VISION partly supported. The task failed, and that is the headline.**

1. **DOM insufficiency is demonstrated, not assumed.** Mode B's DOM exposes **zero** actionable
   elements, grounds **0 of 7** targets and types **0 of 6** fields. H-NULL's first branch is
   excluded: DOM-only did not succeed here.
2. **Vision contributes materially** — 0 → 4 of 7 targets grounded, 0 → 4 of 6 fields typed, on
   a page where the DOM contributes nothing. That is a real improvement, and it is the first
   direct evidence in this repository for *why the detector exists*.
3. **Vision is not sufficient on this page.** The **submit button is not grounded at all**
   (IoU 0.0665), and `address` and `pin` are **near misses just under the gate** (0.485, 0.425).
   A form you can fill but not submit is not a completed task.
4. **46 candidates for 7 real targets** is consistent with W-1's finding that precision, not
   recall, is this detector's problem — and a wrong click is worse than no click, which is why
   the IoU 0.5 refusal matters.

**No threshold was lowered to manufacture a success**, and no near miss was counted as a hit. The
gate is the frozen fusion rule, and both 0.485 and 0.425 are failures.

## Fail-closed behaviour observed

Both refusals came from the rule, not from an error path: where no candidate reached IoU 0.5 the
harness recorded `NO_CANDIDATE_AT_IOU_0.5` and **did not click the nearest thing**. The DOM-only
path refused all seven targets; the vision path refused three. **Nothing guessed, and nothing was
bypassed.** This is the harness's own refusal mirroring the frozen fusion threshold — it is *not*
a demonstration of the product's fail-closed verifier, which does not exist.

## Reproducibility

```bash
npm ci && npm run typecheck
node artifacts/experiments/MVP-0-dom-sufficiency/harness/run-mvp0.mjs
# needs a Chromium; set CHROME_PATH if Playwright's own download is unusable
```

The harness refuses rather than guessing: a changed `PROVISIONAL_THRESHOLDS`, a model hash or
byte-length mismatch, a missing fixture, a decode refusal, or an RGBA buffer that is not
`w × h × 4`. The DOM probe reads only what a content script could — roles, names, labels,
enabled state, geometry — and never the fixture's ground truth.

## Files

| path | purpose |
|---|---|
| `harness/fixture/mode-b-canvas-form.html` | the DOM-poor page, drawn on a canvas from fabricated strings |
| `harness/run-mvp0.mjs` | serves both pages, probes the DOM, runs the detector, acts from each path's coordinates |
| `harness/decode-png.py` | PNG → RGBA via Pillow |
| `logs/mvp0.json` | the full record, including every candidate and every refusal |
| `logs/mode-b.png` | the captured frame (locally generated; no external content) |
