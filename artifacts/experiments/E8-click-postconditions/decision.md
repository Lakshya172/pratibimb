# E8 (click half) — verdict

**Date:** 2026-09-13 · **Workstation:** W2 · **Pre-registered:** `0009184`

**Verdict:**
- **UNKNOWN does not dominate** (1 of 10 dispatched actions).
- **The existing postcondition kinds confirm landing, not effect.** They test the intended effect for
  only 3 of 10 dispatched actions, and confirmed a cancelled checkbox toggle 10/10 times.

| Question | Answer |
|---|---|
| Is the task dominated by UNKNOWN? | **No.** 10 of 100 dispatched runs, all from the self-removing Next button |
| Does CONFIRMED mean the intended effect happened? | **Not in general.** 10 of 80 CONFIRMED runs had the effect absent (A5) |
| Do existing kinds cover the demo's clicks? | Textbox and select focus: yes. Checkbox, radio, disclosure, toggle: landing only. Label: wrong rule |
| Prediction accuracy | 10 / 11 (A8 miss: identity is selector + role, names not compared) |

## Owner decisions this creates

| # | Decision |
|---|---|
| **D-E8-1** | Add `checked`, `expanded` and the label→control relation to the perception contract, and the verifier kinds `CHECKED_STATE_IS`, `EXPANDED_STATE_IS`, `FOCUS_ON_LABELLED_CONTROL`. All three are derived locally, with no planner input |
| **D-E8-2** | Whether a demo may treat a landing-only CONFIRMED as progress, or must require an effect postcondition wherever one exists |
| **D-E8-3** | Whether post-click identity should stay selector + role (toggles confirm) or also compare names (toggles become UNKNOWN) |

## Not done

No postcondition kind added, no perception contract change, no retry loop, no model, no real site.
