# M2 — the real page-value boundary, inside the MV3 extension

> **W1 evidence, 2026-09-22.** The page's own field values are read from the DOM by the content
> script, classified there, and held in a vault there. The offscreen document runs the orchestrator,
> the reasoner and the egress guard over the sanitized handoff and a set of references it cannot
> resolve into anything.
>
> **The service worker recorded every message it saw — 101 messages, 82 474 bytes — and none of the
> page's five values appears anywhere in them.**

- **Workstation:** **W1** (`LAPTOP-6E14K34L`, Intel Core 7 240H, 16 cores, Windows 11 10.0.26200) ·
  **Node** v24.19.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headed, `--load-extension` · GPU not used
- **Runner:** [`tests/browser/extension/run-extension-loop.mjs`](../../../tests/browser/extension/run-extension-loop.mjs)
- **Log:** [`logs/w1-cft153-extension-loop.json`](logs/w1-cft153-extension-loop.json) ·
  **Verdict and what is still open:** [`decision.md`](decision.md)
- **Predecessors:** [`M1-extension-observation`](../M1-extension-observation/README.md) proved the
  reading; [`M1-extension-loop`](../M1-extension-loop/README.md) proved the loop, over values the
  client held rather than values from the page. **This closes that gap**, and supersedes M1's
  architecture.

## Hypothesis

M1's agent filled in details compiled into the extension, because a value read from a page could not
reach the offscreen core realm without being present in a message the service worker receives. The
question here is whether the boundary can be moved to the values instead — the privacy layer and the
vault into the content script's isolated world — **without** duplicating any privacy logic, without
weakening a package invariant, and without the loop losing anything it could already do.

**What would falsify it:** a second vault or a second classifier; a page value in any message; a
verifier or a leak check that passes because it could not ask; a refusal that became a fallback; an
act that stopped working.

## Environment

| | |
|---|---|
| Page | the synthetic fixture at `http://127.0.0.1:8975/fixture/`, whose five registered details are read from the live DOM |
| Content script | reads values, runs `classifyObservation`, **owns the vault**, answers `holdsLiteral`, runs `rehydrate`, performs the one local write, and answers hit tests and dispatches |
| Service worker | routes, and records every message it sees so the claim can be checked against its own traffic |
| Offscreen document | orchestrator, planner, reasoner client, egress guard, execution gate, human grant; assembles and verifies the manifest |
| Reasoner | **Qwen2.5-0.5B** behind a loopback front at the manifest's one pinned `connect-src` origin |
| Not present | no capture, no detector, no OCR, no pixel redaction, no second fetch path, no `chrome.storage` |

The three acts differ in one thing: **what is listening at the reasoner's address.**

## Expected result

1. The page realm sees every form control on the page and classifies them; references are issued for
   what is tokenisable and the OTP gets none, because a CRITICAL class is masked.
2. Only the sanitized handoff crosses; the plan refers to references.
3. SUCCESS restores one value locally and submits; REFUSAL is blocked at the literal before a human
   is asked, with zero releases; OUTAGE falls back and reaches the same ending.
4. A capability is refused when forged, reused, aimed at the wrong field, presented by a replaced
   document, or presented by another tab; the page's own world cannot reach the core realm.
5. **No fixture value appears anywhere in the worker's own recording of its traffic.**

## Actual result

**PASS — 42 of 42 checks.**

### The boundary

| | |
|---|---|
| Form controls read by the page realm | **6** (five registered details + the empty confirm field) |
| References issued | **4** — NAME, PHONE, AADHAAR, DOB, all `token_reference` |
| OTP | **`masked_no_token`, token `""`** — no reference exists, so there is nothing to rehydrate later |
| Values released back | **1**, into the field a human approved |
| Literal inserts carried to the page | **0**, in all three acts |

### What the service worker saw

```
101 messages · 82 474 bytes · fixture values found in them: 0
port:ATTACHED 7   port:OBSERVE 20   port:HIT_TEST 4   port:DISPATCH 4
in:HELLO 7        in:RELAY 14       in:TO_PAGE_BOUNDARY 15   in:BOUNDARY_COLLECT 15
to-tab:CLASSIFY 3 to-tab:CAPABILITY 9   to-tab:FORGET 3
```

The scan runs **inside the worker** and returns which of the fixture's values were found, by index —
a value is not carried out of the browser in order to prove that it was not carried out of the
browser. `in:BOUNDARY_COLLECT` is the page realm asking for a capability: the worker sees the asking
and never the answer, which is the whole mechanism in one line of the census.

### The three acts

| Act | State | VERIFY RESULT | Fell back | Released | Raw events at `#submit` | Total |
|---|---|---|---|---|---|---|
| **SUCCESS** | `DONE` | **CONFIRMED** | no | 1 | 5 | 2132 ms |
| **REFUSAL** | `REFUSED` | — | **no** | **0** | **0** | 25 ms |
| **OUTAGE** | `DONE` | **CONFIRMED** | yes | 1 | 5 | 281 ms |

- **REFUSAL** stops at `VALIDATE_PLAN` with `literalSeverity: LEAKAGE_EVENT`, **before** a human is
  asked — and the leak is recognised by the vault in the content script, asked through a capability,
  so the literal that *is* the page's value never crossed the worker to be recognised.
- **OUTAGE**'s connection fails for real at the egress guard (`TRANSPORT_FAILED`).

### What left the device

```
destination  http://127.0.0.1:8995/v1/chat/completions   transport LOOPBACK_HTTP
payload      2679 bytes   sha256 26d7c09f78e318eb…       leakCheck CLEAN
handoff      4255 bytes · 14 elements · 5 redactions (4 tokenised, 1 masked)
```

**That is the same digest and the same byte count the demo and M1 both record.** The bytes that
reach the reasoner are unchanged by moving the boundary — which is the right result: where a value
is read should not change what is sent.

### The capability, on the production path

| Attempt | Answer |
|---|---|
| A nonce nobody armed | `UNKNOWN_OR_CONSUMED_NONCE` |
| Armed, presented correctly | accepted — then `NO_VAULT`, because no run was in progress |
| The same nonce again | `UNKNOWN_OR_CONSUMED_NONCE` |
| Armed for one field, presented for another | `TARGET_MISMATCH` |
| Armed, then the document replaced under it | `SENDER_DOCUMENT_MISMATCH` |
| Armed for one tab, presented by another | `SENDER_DOCUMENT_MISMATCH` |
| The **page's own world** asking the core realm | unreachable — no messaging in the page world |

The difference between `NO_VAULT` and `UNKNOWN_OR_CONSUMED_NONCE` is the signal: the first means the
capability was spent, the second that it was not there to spend.

### On every `npm test`

Thirteen further tests in
[`apps/extension/test/pageValueBoundary.test.ts`](../../../apps/extension/test/pageValueBoundary.test.ts)
run both halves of the boundary in Node against a real `Vault` over a small fake page, **record every
message that crosses**, and assert against the recording rather than anyone's internals — including
that the leak check refuses rather than answering "no" when the page realm cannot be reached.
Nineteen more in `valueRelease.test.ts` cover the capability's refusals.

## Conclusion

**EXPERIMENTALLY VERIFIED on W1** — one run of each act, one fixture, one browser cell.

The page-value boundary is real: the values are read where the page is, classified there by
`packages/privacy` itself, and never enter a message. No second vault, no second classifier, no
second redaction path, no second egress authority, and `EXECUTABLE_ACTIONS` is still `["click"]`.

**Status vocabulary, used strictly.** Not PROVEN: one run of each act is not a reliability claim, a
second machine has not reproduced it, and one synthetic fixture is not a corpus. **No claim of
perfect PII recall** — detection is the repository's deterministic D1/D2 channels, and a value they
do not classify is a value that is not protected. **No claim of zero leakage in general** — what was
checked is this fixture's five values against this run's traffic. **No claim of production
readiness** — the vault is memory-only, there is one loopback origin, no TLS and no real user data.

## Reproducibility

```bash
npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-extension-loop.mjs
```

The runner refuses rather than guessing if `CHROME_PATH` is unset or the host is not built, starts
and stops the reasoner services itself, and takes its workstation identity from
`tests/browser/support/workstation.mjs`, so a run on another machine writes its own evidence file and
cannot overwrite this one.
