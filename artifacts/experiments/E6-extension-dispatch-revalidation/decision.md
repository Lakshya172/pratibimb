# E6-4 — verdict record

**Status: PRE-REGISTERED · NOT RUN · NO VERDICT.**

Pre-registration: [`README.md`](README.md) (D-E6-4 · W2 `LAPTOP-SRCINK2B`). This file exists because every
experiment directory carries a verdict record. **Until the run it records no verdict, no measurement and no
timing.** It may be cited only as evidence that none exists yet.

## What this record will hold after the run

- **Verdict per cell** (Chrome for Testing 153.0.8010.12, Edge 153.0.4234.32), from README §9.4:
  `ABORTED` · `INVALID_PATH` · `FAIL_CLOSED_VIOLATED` · `VERIFY_VIOLATED` · `INCOMPLETE` · `COMPLETED`.
- **Counts**, per row and axis: dispatch by the witness, dispatch by the core, effect, oracle.
- **Every** fail-closed or VERIFY violation, prediction miss, `RESIDUAL_WINDOW_HIT` and
  `LANDING_ONLY_FALSE_EFFECT`.
- **Timing evidence** from README §9.5, handed to the owner **without a TTL value**.
- **Baseline comparison**, labelled, and never pooled.

## Not decided by this experiment, before or after the run

- **No permit TTL is approved by this experiment in advance, and none is derived from its result.**
  ADR-0008 §5 stays unresolved until the owner decides.
- The open decisions in README §12.
- **Status stays as it is:**
  - B-02 OPEN; QG-04 unsigned;
  - detector UNADOPTED;
  - E1 and E9 not run;
  - W-A gate CLOSED;
  - MV3 host experimental;
  - no privacy claim.
