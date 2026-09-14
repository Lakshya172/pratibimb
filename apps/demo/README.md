# `@pratibimb/demo` — the Planning View

The visible product loop, and the surface the SIH demo is presented from. One task, one page, one
action.

```bash
npm run demo             # rehearse all three acts and judge them
npm run demo:present     # start everything and hand over a browser
```

For the presenter's script and the defensible answers, see
[`docs/demo/presenter-runbook.md`](../../docs/demo/presenter-runbook.md) and
[`docs/demo/judge-cheat-sheet.md`](../../docs/demo/judge-cheat-sheet.md).

## What you are looking at

```
LOCAL VALUE → SANITIZE → TOKEN → SERVER → PLAN → HUMAN GRANT → LOCAL REHYDRATION → CLICK → VERIFIED
```

| Pane | Shows | Built from |
|---|---|---|
| 1 Goal | the user's own words, the session, the state | `RunRecord` |
| 2 What the page contains — **LOCAL ONLY** | element, role, accessible name, **the real value**, sensitivity, geometry | the observation the plan was made against |
| 3 What the reasoner receives — **LEAVES THIS MACHINE** | the references, classes and safe hints that crossed, and the sanitized representation | `record.handoffSerialized` — the string itself |
| 4 Plan · validation · human grant · action | the received plan, the verdict, freshness, the grant, the rehydration | the validator's own result |
| 5 Privacy ledger | destination, size, **both digests**, references, leak scan, VERIFY RESULT | the egress record and the ledger entry |

**Panes 2 and 3 are the demo.** The left shows the registered mobile number itself. The right shows
`<PII:PHONE:1>` with `len 10 · numeric · tel`, and the OTP with **no reference at all** — CRITICAL is
masked without a token, so there is no way to ask for it back. Both panes are real: pane 3 prints the
bytes that were handed to the reasoner, not a mock-up of them.

The values live in the fixture and nowhere else in this repository's prose or source
(`SECURITY.md` §2).

## The three acts are the same code path

They are declared as data in [`src/demoScript.ts`](src/demoScript.ts), and differ in exactly two
things a real deployment would also choose: **which reasoner answers, and at what address.**

| Act | Reasoner | Address | Ends at |
|---|---|---|---|
| **Run the task** | local Qwen2.5-0.5B | `127.0.0.1:8978` | `CONFIRMED` |
| **Compromised reasoner** | a service that answers with a value the client holds | `127.0.0.1:8979` | `LEAKAGE BLOCKED` |
| **Model outage** | a port with nothing behind it | `127.0.0.1:8989` | `CONFIRMED · FALLBACK` |

Nothing below this file can tell which act is running, and no branch asks. The compromised run is
stopped by the same `validatePlan` → `checkLiteral` the normal run passes through, at
`VALIDATE_PLAN`, before any grant, rehydration or action. The outage is a genuinely refused
connection, not a flag — the `ERR_CONNECTION_REFUSED` in the console is asserted as evidence.

The hostile service has to be **handed** the number by the harness, because it cannot obtain it from
the request — the request contains no values. That necessity is the demonstration.

`Reset` puts back everything in `RESET_CONTRACT`, so a presenter can run the acts in any order,
repeatedly, without restarting anything.

## What is real, and what is not

**Real:** the page, the frame, the observation, `sanitize()`, the verifier, the egress choke point
and its real loopback HTTP request, the local model, the plan parser and validator, `bind`/
`rehydrate`, the human grant, the permit gate, the hit test, the dispatch (E6 mechanism B at the
exact permitted point) and VERIFY RESULT. The packages are the built `dist/`.

**Experimental:** the model. `MODEL_PATH = EXPERIMENTAL`, `FALLBACK_PATH = VERIFIED` — the
deterministic planner behind it is the path with the evidence.

**Absent entirely:** the extension path, screen capture, VLM, OCR, detector, retries, recovery,
multi-step planning, production vault, TLS, authentication.

**EXTENSION E2E = NOT PROVEN.** This app drives a same-origin frame through its own `PageAdapter`; no
content script, service worker, offscreen document or side panel takes part.

## Evidence

- [`DEMO-1-sih-rehearsal`](../../artifacts/experiments/DEMO-1-sih-rehearsal/README.md) — the demo,
  rehearsed on W2.
- [`LOOP-2-local-reasoner-egress`](../../artifacts/experiments/LOOP-2-local-reasoner-egress/README.md)
  — the model, the network boundary and the outbound payload.
- [`LOOP-1-server-orchestrator-planning-view`](../../artifacts/experiments/LOOP-1-server-orchestrator-planning-view/README.md)
  — the deterministic loop, 31/31.
