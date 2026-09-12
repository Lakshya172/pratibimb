---
id: MVP-0-decision
experiment: MVP-0 — DOM sufficiency on a controlled page, and what vision adds
verdict: DOM INSUFFICIENCY DEMONSTRATED · VISION CONTRIBUTES · TASK FAILED · LOOP NOT DEMONSTRABLE
date: 2026-09-12
decided_by: pratibimb-architect (L1 — recommends; the human decides)
---

# MVP-0 — decision record

## Verdict

**Measured 2026-09-12 on workstation 2. SYNTHETIC, locally hosted, perception-stage only.**

| | |
|---|---|
| **MVP end-to-end loop** | **NOT DEMONSTRABLE.** 9 of 11 stages have no implementation — see `AUDIT-0005`. Nothing was faked to cover the gap |
| **DOM insufficiency** | **DEMONSTRATED.** Mode B's DOM exposes 0 actionable elements, grounds 0/7 targets, types 0/6 fields |
| **Vision contribution** | **REAL AND MATERIAL** — 4/7 grounded, 4/6 fields typed, where the DOM gives nothing |
| **Task completion** | **FAILED, on both paths.** The submit control is not grounded (IoU 0.0665); `address` and `pin` are near misses under the gate (0.485, 0.425) |
| **Privacy** | **NOT TESTED AND NOT CLAIMED.** No sanitize, verify, vault or egress stage exists; none was simulated |
| **Detector** | **UNADOPTED.** Experimental use only; artifact, threshold, NMS and decode all unchanged |

## Why the task failed, precisely

The vision path filled four fields and then **refused to click submit**, because nothing
overlapped the button at the frozen IoU 0.5 fusion threshold — best overlap **0.0665**, which is
not a near miss but an absence. Two further targets sat **just under** the gate (`address` 0.485,
`pin` 0.425). The form was therefore incomplete and was never submitted.

**The gate was not lowered, and the near misses were not counted.** Lowering it to 0.4 would have
"completed" the task and would have been a manufactured result.

## What is proven

1. **The DOM-poor case is real, not a strawman.** A canvas-rendered form exposes no role, no
   name, no label and no input to the DOM. The element graph sees one opaque box.
2. **Vision supplies candidates where the DOM supplies none**, and four of them are accurate
   enough to act on (IoU 0.63–0.86).
3. **Perceived coordinates are actionable**: clicking and typing at vision-derived positions
   drove a real widget and changed real page state.
4. **Refusal works.** Seven DOM refusals and three vision refusals, all from the IoU rule, with
   no fallback to the nearest candidate.

## What is NOT proven

- **Nothing about the agent loop.** Stages 3–11 do not exist; this is stages 1–2 plus a click.
- **Nothing about privacy.** No value was sanitised or transmitted; there is no firewall to test.
- **Nothing about task completion** — the task failed.
- **Nothing about real websites**, government or banking pages, or the W-A corpus.
- **Nothing about detector adoption.** 46 candidates for 7 targets is a precision problem, not an
  adoption case.

## Recommended owner decisions

1. **Accept that the MVP is blocked on unbuilt stages, not on evidence.** The next real step is
   `AUDIT-0005`'s build order, starting with **VALIDATE + REFRESH** — pure functions, no network,
   no model, no secrets, and the stage whose absence makes every other stage untestable.
2. **Do not let the demo pressure lower the IoU gate.** This run shows why: at 0.4 the task
   "succeeds" and the evidence becomes worthless.
3. **Treat the ungrounded submit button as the first concrete perception defect worth chasing** —
   a filled-green button with white text is not a control shape the synthetic training set
   contains much of. That is a data question, not a threshold question, and it is *not* authority
   to retrain.

## What is NOT done

No production code written or changed. No vault, no sanitiser, no verifier, no egress path, no
executor, no server — **deliberately not stubbed**, because a stubbed privacy firewall in a
privacy submission is worse than an absent one. No model, threshold, NMS or decode change. No
retraining. No capture-size policy. No real data, no real PII, no credential, no external site.
No security control touched. The W-A gate is untouched and remains **CLOSED**.
