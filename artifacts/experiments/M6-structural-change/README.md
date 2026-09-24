# M6 — the structural change signal

> **W1, 2026-09-24.** Constitution §6 says the structural change signal is **IN FORCE** for v1
> (ADR-0010, Option B, owner-approved). Nothing implemented it. This milestone closes that gap and
> does nothing else.
>
> **It is event-driven, local, low-cost and non-capturing.** Its entire job is to say that the last
> observation *may be stale*. It never takes a frame, and there is no code path by which it could.
>
> **No OCR. No scheduler. No dHash. No safety net. No polling. No new permission. No detector
> change. No change to the frozen demo.**

- **Workstation:** **W1** (`LAPTOP-6E14K34L`, Intel Core 7 240H, 16 cores, Windows 11 10.0.26200) ·
  **Node** v24.19.0 · **Playwright** 1.63.0
- **Cell:** **Chromium 1243** (`chrome-win64`), headed, `--load-extension` · GPU not used
- **Contract:** [`constitution.md`](../../../docs/architecture/constitution.md) §6 ·
  [`ADR-0010`](../../../docs/adr/ADR-0010-change-signal-under-explicit-capture.md) (APPROVED) ·
  [`capture-policy.md`](../../../docs/architecture/capture-policy.md)
- **Predecessor:** [`M5.1`](../M5.1-post-approval-hardening/README.md)

## Hypothesis

That §6's structural signal could be built inside the observation infrastructure that already
exists — one `PageSurface`, one page agent, one freshness validator — without creating a second
observation system, and **without giving anything in the product a new reason to capture**.

**What would falsify it:** a second change-gate or observer system; a structural event that reached
a capture, a measurement or a perception pass; a page value or a pixel inside a structural message;
a staleness that defaulted to fresh; or an implementation claimed complete that is not.

## Environment

| | |
|---|---|
| Product build | `permissions: [offscreen, sidePanel, activeTab, tabCapture]`, `host_permissions: ["http://127.0.0.1/*"]`, **0** `captureVisibleTab` call sites |
| Degraded build | the same plus `M3_WORKER_FRAME=1`, used only for automated regression |
| Page | the demo `application.html` fixture, **unchanged**. No timers, no animation |
| Observers | `MutationObserver` + `ResizeObserver`, content script only, installed once per document |
| Detector | `pratibimb-t1-ui-head` rev `ba6d9e93695b`, untouched |
| Capture route | untouched by this milestone |

## Expected result

1. The structural observers install in a real browser and report `watching: true`.
2. A structural event increments a counter and causes **nothing else** — no capture, no
   measurement, no perception pass.
3. The reading crossing the worker contains no selector, no text, no value and no pixel.
4. Asking whether an observation is still current takes no capture and negligible time.
5. Staleness fails closed when nothing is watching or no sequence is held.
6. The existing loop regression still passes, with the signal live.

## What the signal is

```
PAGE DOM ──▶ MutationObserver (childList, characterData, filtered attributes, subtree)
         ──▶ ResizeObserver (document.documentElement)
                    │
                    ▼   one delivered batch → four booleans
             STRUCTURAL EVENT { nodes, attributes, text, resized }
                    │            ← nothing about WHICH node, attribute or text
                    ▼
             page agent: seq += 1, category counters, timestamp
                    │
                    ▼   asked, never pushed
             STRUCTURE op → { watching, seq, nodes, attributes, text, resizes, at }, stale
                    │
                    ▼
             VALIDATE refuses OBSERVATION_STALE → the existing RE_OBSERVE path
```

### Where each part runs

| Part | Realm | Why there |
|---|---|---|
| `MutationObserver`, `ResizeObserver` | **content script** (`page-surface-dom.ts`) | as close to the DOM as the architecture allows; the worker has no DOM and must not grow one |
| Counters, sequence, staleness rule | **content script** (`pageAgent.ts`) | the page agent already owns per-document state; a second owner would be a second system |
| `STRUCTURE` request/reply | **worker relays, decides nothing** | control plane only, exactly as `OBSERVE` already is |
| The refusal | **core realm** (`actionFreshness.ts`) | the one freshness implementation; no second one was created |

## What counts as structural

Narrow by construction, and each entry earns its place from `measure()` — the function that builds
the element graph — rather than from a list of everything a `MutationObserver` can report.

| Category | Records | Because the graph derives |
|---|---|---|
| `nodes` | `childList` on the whole subtree | presence, the measured set, `parentIndex` |
| `attributes` | `id`, `role`, `aria-label`, `aria-disabled`, `disabled`, `hidden`, `class`, `style`, `for` | selector, role, accessible name, enabled, computed visibility |
| `text` | `characterData` | the accessible name of a button or a `<label>` |
| `resized` | `ResizeObserver` on `document.documentElement` | every box in the graph is viewport-relative |

An unfiltered `attributes: true` would report every `data-*` write a page makes to itself. That is
an event storm that says nothing about the graph, which is why the filter is a decision about what
"structural" means rather than a tuning knob.

**Coalescing, in full:** one sequence increment per **delivered observer batch**. No timer, no
debounce window, no queue, no rate. A batch carrying twenty insertions advances the sequence by one
because the browser delivered it once. It is deterministic and needs no measurement to justify,
which is precisely why it was chosen over anything rate-based.

## Staleness semantics

`stale` is decided in the page agent and **fails closed three ways**:

| Condition | Answer |
|---|---|
| Nothing watching (`watching: false`) | **stale** — an unestablished staleness is not a fresh one |
| The caller holds no sequence (`sinceSeq: null`) | **stale** — nothing to be current against |
| The sequence moved | **stale** |
| Watching, and the sequence is unchanged | current |

A graph is current for **exactly one sequence**, and the reading is taken *after* the measurement,
so a batch delivered during the measurement dates the graph earlier than the page — stale, which is
the honest direction.

## Integration: one mechanism, not a second one

`validateActionFreshness` gained an optional `StructuralWitness` — `{ watching, seq, observedAtSeq }`,
two numbers and a flag — and one reason, `OBSERVATION_STALE`. It is checked **before any per-node
check**, because a moved page invalidates the graph rather than the element: re-checking one element
against a graph the page has left is the wrong question asked carefully.

The orchestrator asks the page immediately before acting, which is the one window nothing else
covers — the hit test checks a point, not whether the graph the permit was built from still
describes the page. A port that throws is treated as nothing watching, and refuses.

**An unasked question is visible.** A caller supplying no witness gets exactly the previous
behaviour, and the `ALLOW` reports `structurallyCurrent: null`. Silence never reads as freshness.

## Actual result — measured on W1

Degraded-route regression, `run-extension-loop.mjs`, **PASS 72/72**, all three acts:

| Act | `structureReads` | `structureMs` | `structurallyCurrent` | agent's reading at the end |
|---|---|---|---|---|
| SUCCESS | 1 | **2 ms** | **`true`** | `seq 2` · nodes 1 · attributes 1 · text 0 · resizes 1 |
| REFUSAL | 0 | — | `null` | `seq 1` · resizes 1 |
| OUTAGE | 1 | **2 ms** | **`true`** | `seq 2` · nodes 1 · attributes 1 · text 0 · resizes 1 |

- **`watching: true` in a real browser**: the observers install and report.
- **Event volume for a whole run: two batches.** One is the `ResizeObserver`'s initial callback on
  `documentElement`, which fires once on `observe()` and before any observation is taken. The other
  is the page's own reaction to the run. This is not a system under pressure from its own signal.
- **Cost of asking: 2 ms**, and no capture in it.
- REFUSAL reads zero because the run stopped at `VALIDATE_PLAN`, before ACT. Correct, not a gap.

### It triggers no capture — three independent reasons, one of them measured

1. **Structural.** The callback is handed `onChange` and nothing else: no relay, no port, no
   capture authority, no element. There is no capture method on `PageSurface` at all.
2. **Tested.** 500 batches of mutations, resizes and text changes against a surface that records
   every method it is asked for leave that record holding exactly the one `watchStructure` call made
   at construction — no viewport read, no measurement, no element, no frame.
3. **Measured in the browser.** Perception passes per act are unchanged at one, and every capture in
   the run is still the one an explicit observation asked for.

### Nothing crosses that should not

- The structural message is `{ watching, seq, nodes, attributes, text, resizes, at }` — booleans,
  numbers and `null`. **A string cannot appear**, so page text cannot.
- Asserted on the serialised message, not just the object: no selector, no accessible name, no
  `data:image`, no base64.
- Worker traffic across the three acts: **121 messages, 86 896 bytes, fixture values found: 0.**

## Quality gates

| gate | result |
|---|---|
| `npm test` | **1455 passed** / 0 failed / 15 skipped (was 1426; +29 new) |
| typecheck | clean |
| `verify-repo.py` | **PASS — 0 failures, 0 warnings** |
| `pin:check` | OK `db816fad…a44dea` |
| extension build | green, both configurations |
| `run-extension-loop.mjs` | **PASS 72/72** — `DEGRADED_TEST_ROUTE`, kept separate |
| structural-signal tests | **17/17** |
| structural-staleness tests | **8/8** |
| coverage-boundary tests | **4/4** |

**Product bundle audit:** `captureVisibleTab` **call sites 0** · `chrome.tabs.captureVisibleTab`
**0** · `getMediaStreamId` present · `getUserMedia` offscreen only · `iVBORw0KGgo` **0** ·
`chrome.alarms` **0** · no `storage` permission · `setInterval` in our own worker/offscreen code
**0** · `MutationObserver`/`ResizeObserver` **only in the content script** · `host_permissions`
`["http://127.0.0.1/*"]` · `EXECUTABLE_ACTIONS ["click"]`.

Three `captureVisibleTab` references remain in the offscreen chunk, down from six. All three are
**message text** — two in the perception decoder's error strings and one in the preprocessor's alpha
check — describing the degraded route. None is callable.

## What is NOT implemented, stated rather than implied

**§6 names "ResizeObserver on tracked elements". This installs one on `document.documentElement`
only.** Re-targeting it at the measured set would mean re-enumerating that set on every mutation —
polling by another name — and a `ResizeObserver` delivers an initial callback for every newly
observed element, which would make each observation instantly stale against itself. **An
element-level resize that changes no attribute, no node and no document geometry is therefore not
observed.** That is why the signal is `CONDITIONAL` below and not `EXPERIMENTALLY VERIFIED` in full.

Also not done, deliberately: `ChangeGate` is still unwired and still has no production caller. It
was left alone rather than pressed into service — its `STRUCTURAL` branch is the right home for this
signal on the day something needs debouncing, and nothing does yet. Wiring it now would have been
code written to make a contract look implemented.

## Conclusion

| | |
|---|---|
| **ARCHITECTURAL INVARIANT** | a structural event causes no capture, no measurement and no perception pass; the signal carries counters only |
| **EXPERIMENTALLY VERIFIED** | the signal installs and reports in a real browser; the loop passes 72/72 with `structurallyCurrent: true`; asking costs 2 ms and no capture |
| **CONDITIONAL** | §6's structural signal **as a whole** — node, attribute, text and document-geometry change are observed; **per-element resize is not** |
| **NOT YET VERIFIED** | behaviour on a page that mutates heavily; the refusal path firing in a real browser, which no fixture has yet provoked |

**Not claimed:** production readiness, that every visual change is detected, that the structural
signal substitutes for vision, or that §6 is now fully implemented.

## Reproducibility

```bash
npm test && npm run typecheck && python scripts/verify-repo.py && npm run pin:check

M3_WORKER_FRAME=1 npm run build -w @pratibimb/extension    # degraded regression only
CHROME_PATH="<chromium 1243>" node tests/browser/extension/run-extension-loop.mjs
```

The product capture route is **unchanged by this milestone**, and the content script that carries
the signal is byte-identical on both routes, so the human-in-the-loop gesture evidence was not
re-spent. Re-running it would re-measure a path M6 did not touch.
