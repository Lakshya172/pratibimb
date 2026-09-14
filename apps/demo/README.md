# `@pratibimb/demo` — the Planning View

The first visible product loop. One task, one page, one action.

```bash
npm run typecheck                        # the page imports the BUILT packages
node tests/browser/demo/server.mjs       # http://127.0.0.1:8975/
```

Then press **Run the task**, or **Run with a compromised reasoner** to watch it refuse.

## What you are looking at

```
LOCAL VALUE → SANITIZE → TOKEN → SERVER → PLAN → HUMAN GRANT → LOCAL REHYDRATION → CLICK → VERIFIED
```

| Pane | Shows | Built from |
|---|---|---|
| 1 Goal | the user's own words, the session, the state | `RunRecord` |
| 2 Page — local | element, role, accessible name, **the real value**, sensitivity, geometry | the observation the plan was made against |
| 3 Server view | the references, classes and safe hints that actually crossed, and the exact payload | `record.handoffSerialized` — the string itself |
| 4 Plan · validation · grant | the received plan, the verdict, freshness, the grant, the rehydration | the validator's own result |
| 5 Egress & result | identity, digest, classes, timings, VERIFY RESULT | the privacy layer's ledger entry |

**Panes 2 and 3 are the demo.** The left shows the registered mobile number itself. The right shows
`<PII:PHONE:1>` with `len 10 · numeric · tel`. Both are real: pane 3 prints the bytes that were
handed to the reasoner, not a mock-up of them, and the line above the table reports a check that none
of the local values appears in them. (The values are in the fixture and nowhere else in the
repository's prose or source — SECURITY.md §2.)

## Why the two buttons are the same code

They differ by one argument to `deterministicReasoner`. There is no demo-only branch and no UI-only
refusal: the compromised run is stopped by the same `validatePlan` → `checkLiteral` the normal run
passes through, at VALIDATE_PLAN, before any grant, rehydration or action.

The hostile reasoner has to be **handed** the number by the page, because it cannot obtain it from
the handoff — the handoff contains no values. That necessity is the demonstration.

## What is real, and what is not

**Real:** the page, the frame, the observation, `sanitize()`, the verifier, the plan parser and
validator, `bind`/`rehydrate`, the human grant, the permit gate, the hit test, the dispatch (E6
mechanism B at the exact permitted point) and VERIFY RESULT. The packages are the built `dist/`.

**Not real:** the reasoner's intelligence. It is a deterministic planner in this realm — no model, no
network request, no egress. `transport: "IN_PROCESS"` is recorded everywhere so no screenshot can
imply otherwise. Swapping it for a small open-weight model on loopback is one implementation of
`ReasonerClient` and no change to anything after the boundary.

**Absent entirely:** extension, screen capture, VLM, OCR, detector, retries, recovery, multi-step
planning, production vault, production egress guard.

## Evidence

[`artifacts/experiments/LOOP-1-server-orchestrator-planning-view/`](../../artifacts/experiments/LOOP-1-server-orchestrator-planning-view/README.md)
— W2, Chrome for Testing 153.0.8010.12, 31/31 checks.
