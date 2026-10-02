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

The screen tells a story first and keeps the proof underneath.

```
OBSERVE → SANITIZE → REASON → VALIDATE → AUTHORIZE → ACT → VERIFY
```

| Region | Shows | Built from |
|---|---|---|
| **Task** | the goal, the act, a live status and the pipeline | the run's recorded transitions |
| **On your device** — Trusted | each sensitive field and **its real value** | the first reading of the page |
| **Privacy boundary** | the barrier between the two | — |
| **What the reasoner sees** — Untrusted | the reference and safe hint that crossed for each field; the OTP with **no reference at all** | the verified handoff the reasoner was given |
| **Model proposes** | which reasoner answered and the plan it returned | the parsed plan, with any literal shown only as a class marker |
| **Client decides** | ✓ ALLOWED or ✕ BLOCKED, and why | the validator's own verdict |
| **Human approval** | the one-time request, and the answer | the grant the orchestrator requested |
| **Restore & act** | the reference restored locally, the field filled, the click, verified | the rehydration record and the permit gate's outcome |
| **Outcome** | TASK COMPLETED, BLOCKED or a fallback completion, with its checks | `VERIFY RESULT` and the refusal, verbatim |
| **Data leaving device** | references, verified payload, value scan, **both digests** | the egress record |
| **Technical evidence** | the full observation, sanitized representation, plan and gates, ledger | the same record, in full |

**The boundary is the demo.** The device side shows the registered mobile number itself; the
reasoner side shows `<PII:PHONE:1>` and `10 digits`. Both are real. Nothing else on the screen carries
a value, and `apps/demo/test/story.test.ts` checks that against real runs.

The values live in the fixture and nowhere else in this repository's prose or source
(`SECURITY.md` §2).

### Every word is derived, not written

Each status, verdict and check comes from [`src/story.ts`](src/story.ts): pure functions over the run
record, tested without a browser. Where the evidence is absent the screen says so — "not claimed",
"not requested" — instead of rounding up to reassurance. `src/view.ts` only turns that model into
markup.

### How it fills in while the run is still going

The orchestrator returns its record only when a run ends, but the approval moment happens before
that. So `src/main.ts` places **read-only taps** on three things the pipeline already does: the first
page reading, the verified handoff a reasoner is given, and the grant request. They pass every call
through unchanged. Each catches its own rendering errors, because a throw inside `propose` would be
read as `REASONER_THREW` and trigger a fallback — a display bug changing what the system does.

## The three acts are the same code path

They are declared as data in [`src/demoScript.ts`](src/demoScript.ts), and differ in exactly two
things a real deployment would also choose: **which reasoner answers, and at what address.**

| Act | Reasoner | Address | Ends at |
|---|---|---|---|
| **Run the task** | local Qwen2.5-0.5B | `127.0.0.1:8978` | TASK COMPLETED |
| **Compromised reasoner** | a service that answers with a value the client holds | `127.0.0.1:8979` | BLOCKED |
| **Model outage** | a port with nothing behind it | `127.0.0.1:8989` | TASK COMPLETED — via fallback |

Nothing below this file can tell which act is running, and no branch asks. The compromised run is
stopped by the same `validatePlan` → `checkLiteral` the normal run passes through, at
`VALIDATE_PLAN`, before any grant, rehydration or action. The model's raw answer is never shown: the
record keeps only a class marker, and the device-side row whose value came back is highlighted
instead. The outage is a genuinely refused connection, not a flag — the `ERR_CONNECTION_REFUSED` in
the console is asserted as evidence.

The hostile service has to be **handed** the number by the harness, because it cannot obtain it from
the request — the request contains no values. That necessity is the demonstration.

`Reset` puts back everything in `RESET_CONTRACT`, so a presenter can run the acts in any order,
repeatedly, without restarting anything.

## Built for a projector

A light surface, system fonts only (a web-font request would be a third-party network call from a
privacy demo), one accent colour, and semantic colour only for meaning. Entrance motion is
transform-only — never a fade — so a browser that pauses animations still shows everything. The
header stays on one line down to 1366px wide.

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
