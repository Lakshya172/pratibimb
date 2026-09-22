# M1 — the product loop through the real MV3 extension

> **W1 evidence, 2026-09-22.** A real page in a real tab is observed, sanitized, sent to a real local
> model over loopback, planned, validated, approved by a human, restored through a one-shot
> capability, clicked through `guardedAct`, and verified by reading the page back — **inside the
> extension**, with no iframe, no `PageAdapter` and no mock anywhere in the path.
>
> **The value never crosses the service worker.** Not in the rehydration, and not in the record the
> run returns.

- **Workstation:** **W1** (`LAPTOP-6E14K34L`, Intel Core 7 240H, 16 cores, Windows 11 10.0.26200) ·
  **Node** v24.19.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headed, `--load-extension` · GPU not used
- **Runner:** [`tests/browser/extension/run-extension-loop.mjs`](../../../tests/browser/extension/run-extension-loop.mjs)
- **Log:** [`logs/w1-cft153-extension-loop.json`](logs/w1-cft153-extension-loop.json) ·
  **Verdict and open boundary:** [`decision.md`](decision.md)
- **Predecessor:** [`M1-extension-observation`](../M1-extension-observation/README.md) proved the
  reading. This proves the loop.

## Hypothesis

The demo runs the whole pipeline in one realm, against a same-origin iframe. The question M1 has to
answer is whether the same pipeline — the same packages, unmodified — still runs when the page is in
a tab, the core realm is an offscreen document, and a service worker sits between them.

**What would falsify it:** a layer that had to be rewritten to work at that distance; a security
gate that had to be relaxed; a value that had to be put into a message to get where it was needed; a
refusal that became a fallback; an act that passed for the wrong reason.

## Environment

| | |
|---|---|
| Page | the synthetic fixture at `http://127.0.0.1:8975/fixture/` — real tab, real document |
| Content script | reads the page, answers hit tests, dispatches the click, performs the authorised write |
| Service worker | routes. Holds no permit, no decision and no value |
| Offscreen document | `runTask` over `@pratibimb/orchestrator`, `privacy`, `plan`, `reasoner`, `egress`, `agent` |
| Reasoner | **Qwen2.5-0.5B** behind a loopback front at the manifest's one pinned `connect-src` origin |
| Human | the operator, answering through the worker's control plane — the rehearsal's `auto` mode |
| Not present | no capture, no detector, no OCR, no pixel redaction, no second fetch path |

The three acts differ in **one thing**: what is listening at the reasoner's address. An honest front
proxying the model, a hostile front that answers with a value the client never sent, or nothing at
all. Nothing in the extension is told which act is running.

## Expected result

1. **SUCCESS** — the model plans it, a human agrees, one capability is armed and collected once, the
   click is dispatched at the permitted point, and the page reads back as submitted.
2. **REFUSAL** — the plan carrying the raw value is refused at `VALIDATE_PLAN`, **before** a human is
   asked: no grant, no capability, no write, no click, and no fallback.
3. **OUTAGE** — a real connection failure, the deterministic planner, and the same gates to the same
   ending.
4. A capability is refused when forged, reused, presented by a replaced document, or presented by
   another tab; and the page's own world cannot reach the core realm at all.
5. No synthetic value appears in anything that crossed a boundary, or in what the reasoner received.

## Actual result

**PASS — 30 of 30 checks.**

| Act | State | VERIFY RESULT | Fell back | Restored | Raw events at `#submit` | Total |
|---|---|---|---|---|---|---|
| **SUCCESS** | `DONE` | **CONFIRMED** | no | 1 | **5** | 2383 ms |
| **REFUSAL** | `REFUSED` | — | **no** | **0** | **0** | 34 ms |
| **OUTAGE** | `DONE` | **CONFIRMED** | yes | 1 | **5** | 225 ms |

- **SUCCESS** — the model answered in 1988 ms; the human was asked and agreed; the capability was
  armed once and collected once; the page ended holding the registered number and reading
  "Application submitted", with the submit control disabled, which is the postcondition VERIFY RESULT
  read back.
- **REFUSAL** — the hostile front returned the number itself. Refused at `VALIDATE_PLAN` with
  `literalSeverity: LEAKAGE_EVENT`, **before** a human was asked: no grant, **no capability armed**,
  no write, no click, the field still empty, and `fellBack: false` — the client did not quietly run a
  different plan and call it a success.
- **OUTAGE** — the connection failed for real (`TRANSPORT_FAILED` at the egress guard, not a flag),
  the deterministic planner answered, and the identical gates ran to the identical ending.

### What left the device

```
destination  http://127.0.0.1:8995/v1/chat/completions   transport LOOPBACK_HTTP
payload      2679 bytes   sha256 26d7c09f78e318eb…       leakCheck CLEAN
```

**That is the same digest and the same byte count the demo records.** The extension sends the
reasoner exactly what the demo sends it — same handoff, 14 elements, 5 redactions, no values — from
a different realm, over a different path, on a different machine from the one that first recorded it.

### The capability, in a real browser

| Attempt | Answer |
|---|---|
| A nonce nobody armed | `UNKNOWN_OR_CONSUMED_NONCE` |
| Armed, presented by the right document | **released, written, 10 characters** |
| The same nonce a second time | `UNKNOWN_OR_CONSUMED_NONCE` |
| Armed, then the document reloaded under it | `SENDER_DOCUMENT_MISMATCH` |
| Armed for one tab, presented by another | `SENDER_DOCUMENT_MISMATCH` |
| The **page's own world** asking the core realm directly | unreachable — no messaging in the page world |

The harness never learns a real run's nonce, and cannot: the core realm mints it and the page
collects it. So these use the E6 arming hook, which since this milestone goes through the same
authority and the same refusals as the product path. The remaining cases — wrong frame, wrong field,
expiry, expiry-before-identity, revocation — are the nineteen tests in
[`apps/extension/test/valueRelease.test.ts`](../../../apps/extension/test/valueRelease.test.ts),
which run on every `npm test`.

## Four defects, all found by running it

None were in `packages/`. Each would have looked like something else from the outside:

1. **No zoom in the observation.** The transport does not carry one, so the manifest verifier refused
   every handoff as malformed and all three acts died at SANITIZE — a privacy refusal that was really
   a missing number.
2. **Form controls reached the planner unnamed**, because the content script named elements by their
   text content and an `<input>` has none. The planner could not find the field, and the binder
   answered `AMBIGUOUS_FIELD`, so no human grant could authorise anything.
3. **Two release authorities.** The run armed capabilities into a map nothing redeemed from. Every
   restoration refused with `UNKNOWN_OR_CONSUMED_NONCE` — which is exactly what a correctly working
   capability system says when someone cheats.
4. **The bridges named a stale frame** after REFRESH took a newer reading, and the execution gate
   refused with `BRIDGE_FRAME_MISMATCH`. The gate was right.

A fifth was caught by the harness rather than by a stage: the run's record carried the client's own
details inside its two observations, so returning it whole would have put values into a message the
service worker receives — undoing the entire point of the release mechanism through a convenience.
The record now crosses with the readings replaced by counts, allow-listed.

## Conclusion

**EXPERIMENTALLY VERIFIED on W1** — one run of each act, one fixture, one browser cell.

The product loop runs in the extension, and it ran without a single change to `packages/`. Every
refusal still belongs to the package that owns it, the security pipeline is the same object graph in
all three acts, and the one thing the transport has no field for — a value — reached the page without
ever being sent.

**Status vocabulary, used strictly.** This is not PROVEN. One run of each act is not a reliability
claim, a second machine has not reproduced it, and one fixture is not a corpus.

**And one thing this does not claim at all:** the field values the privacy layer works on are the
client's own synthetic details, not values read from the page. That is a real narrowing, it is there
for a boundary rather than a shortcut, and [`decision.md`](decision.md) says what the boundary is.

## Reproducibility

```bash
npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-extension-loop.mjs
```

The runner refuses rather than guessing if `CHROME_PATH` is unset or the host is not built, starts
and stops the reasoner services itself, and takes its workstation identity from
`tests/browser/support/workstation.mjs`, so a run on another machine writes its own evidence file and
cannot overwrite this one.
