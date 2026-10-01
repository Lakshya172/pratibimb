# M5.1 — formalising the approved architecture

> **W1, 2026-09-24.** The owner approved ADR-0009. This milestone adds no perception capability and
> changes no security boundary: it turns an approved direction into something the repository states,
> enforces and can regress against.
>
> **ADR-0009 is APPROVED**, the owner's decision is recorded verbatim, and `constitution.md` §5 is
> amended — the minimum edit, because the amendment procedure's step 6 requires it on approval.
>
> **A capture grant now belongs to a page, not a tab number.** Chrome revokes `activeTab` on
> navigation; the authority already mirrored that, and now also binds on first use, so a frame for a
> different document is refused by its own bookkeeping even if the revocation listener never fired.
>
> **No OCR. No scheduler. No detector tuning. No change to the frozen demo.**

- **Workstation:** **W1** (`LAPTOP-6E14K34L`, Intel Core 7 240H, 16 cores, Windows 11 10.0.26200) ·
  **Node** v24.19.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headed, `--load-extension` · GPU not used
- **Decision:** [`ADR-0009`](../../../docs/adr/ADR-0009-gesture-authorised-capture.md) — **APPROVED**
  2026-09-24 by `ronitsaha11` (Ronit Saha)
- **Policy:** [`docs/architecture/capture-policy.md`](../../../docs/architecture/capture-policy.md)
- **Predecessors:** [`M4`](../M4-gesture-text-perception/README.md) verified the capture route;
  [`M5`](../M5-gesture-loop/README.md) verified the whole loop on it

## The three statuses, kept apart

| | |
|---|---|
| **ARCHITECTURALLY APPROVED** | gesture-authorised capture, by the owner, in ADR-0009 §0 |
| **EXPERIMENTALLY VERIFIED** | that it works on W1 — M4 12/12, M5 29/29, **human-in-the-loop** |
| **NOT production readiness** | not claimed by the ADR, by M5, by this record, or by the owner |

## Hypothesis

That an approved architectural direction could be made formally coherent and regression-safe
without adding capability — no OCR, no scheduler, no detector tuning — and that doing so would
surface whatever the approval had left implicit.

**What would falsify it:** a hardening change that closed a path that should be open; a prohibition
in the approval with nowhere in the tree enforcing it; a conflict quietly resolved instead of
recorded; degraded-route numbers used to claim product-route verification.

## Environment

| | |
|---|---|
| Product build | `permissions: [offscreen, sidePanel, activeTab, tabCapture]`, `host_permissions: ["http://127.0.0.1/*"]`, **0** `captureVisibleTab` |
| Degraded build | the same plus `M3_WORKER_FRAME=1`, used only for automated regression |
| Invocation | a person clicked the toolbar action, once per act; nothing simulated it |
| Page | the demo `application.html` fixture and the M4 `visual.html` fixture, both **unchanged** |
| Detector | `pratibimb-t1-ui-head` rev `ba6d9e93695b`, untouched |
| Text tier | **none.** `TEXT_PERCEPTION_UNAVAILABLE` on every pass |

## Expected result

1. ADR-0009 reaches APPROVED with the owner's decision recorded verbatim, and the constitution
   carries the minimum amendment the procedure requires.
2. The lifecycle is a named state machine, and a grant binds to a page rather than a tab number.
3. A person is told, on the existing surface, when they need to act.
4. `frameHash`/`ChangeGate` are audited and left unwired, with the reason written down.
5. Both regressions pass and stay in separate records.

## Actual result

Every part below. Headline: all automated gates green, the real-route three acts **29/29** on
`REAL_GESTURE_STREAM` after the hardening (see [`REAL-ROUTE.md`](REAL-ROUTE.md)), and one genuine
constitution conflict found and recorded rather than resolved (Part E).

## Part A — ADR-0009 finalised

The decision is quoted verbatim in a new §0 rather than paraphrased. §0.1 maps each of the owner's
five prohibitions to the place in the tree that enforces it, so the decision is checkable by reading:

| prohibition | enforcement |
|---|---|
| no `captureVisibleTab` as the product path | optional adapter property under `M3_WORKER_FRAME`; **product bundle count 0** |
| no silent fallback | `ticketFor` refuses and reaches for nothing; the branch is absent, not unreached |
| no `<all_urls>` to dodge the gesture | product `host_permissions` `["http://127.0.0.1/*"]`, asserted by test |
| no simulated gesture | measured seven ways; the harnesses **stop and wait for a person** |
| no weakened semantics | the authority mirrors Chrome's own grant lifetime |

`constitution.md` §5's capture row now names gesture-authorised tab capture, keeps ADR-0002's PNG
policy in force wherever an encoded frame still arrives, and records the accepted cost in the row.
§9 keeps the **rejected** alternative rather than deleting it, so a future milestone that finds the
gesture cost intolerable reopens the decision with evidence instead of working around it.

## Part B — the capture lifecycle, named

```
NO_GRANT ──(person invokes)──▶ GRANTED ──(first frame)──▶ STREAM_AVAILABLE
    ▲                                                            │
    │                                            (page changes)  │
    └──(navigation / tab close)── REVOKED ◀───── DOCUMENT_CHANGED ┘
```

`REQUIRES_REAUTH` = `NO_GRANT` ∪ `DOCUMENT_CHANGED` ∪ `REVOKED`, reported as a field rather than
inferred. `revokedBecause` distinguishes `NAVIGATION` from `TAB_CLOSED`.

**Eighteen unit tests** over the authority, all with the browser faked because the granted branch
cannot be reached from a harness. New in this milestone: the lifecycle walk, binding on first use,
refusal for a changed document *without asking the browser*, revocation reasons, duplicate grants
being one authorisation, a repeated handle being refused, and one tab's grant not reaching another.

## Part C — the smallest honest UX

The side panel already existed and already polled `HOST_STATUS`. It now shows one line:

> *"Authorisation ended when the tab navigated. Click the toolbar button again."*

No new surface, no redesign, no automation of the invocation. ADR-0009 says the re-auth requirement
is *"not a defect to be hidden"*; the smallest way not to hide it is to say it where a person is
already looking.

## Part D — the capture policy, written down

[`capture-policy.md`](../../../docs/architecture/capture-policy.md). **Explicit and fail-closed:** a
frame is taken only when a person has just asked for one. No polling, no autonomous repeat capture,
no retry after a quota refusal, no silent worker substitution, no permission widening. Every refusal
is a named code, and a refused capture degrades the *claim* (`["T0","T2"]` instead of
`["T0","T1","T2"]`) rather than the loop.

## Part E — `frameHash` / `ChangeGate`: **future infrastructure, partly obsolete, and one conflict**

Audited. `ChangeGate`, `frameHash`, `DEFAULT_CHANGE_POLICY` and `MEASURED_CAPTURE_ENVELOPE` are
exported from the package index and **called by nothing** in `apps/` or `tests/`. They are not wired
up, and this milestone does not wire them up.

`frameHash` is now **obsolete for the product path**: it hashes encoded bytes and a live frame has
none, so it throws rather than hashing an absent buffer — which would have given every live frame
the same hash and made a change gate report "unchanged" forever.

**The conflict, flagged rather than resolved.** `constitution.md` §6 is FROZEN and describes the
change policy as three signals: MutationObserver (structural), **bounded dHash polling** over
enumerated dynamic regions, and a **low-rate full-frame dHash safety net**. The approved capture
policy forbids polling and autonomous capture.

- The **structural** signal needs no capture and is compatible.
- The **visual** signal reads enumerated same-origin `<canvas>`/`<video>` elements; a content script
  can do that without any tab capture, so it is probably compatible — *unverified*.
- The **full-frame safety net** requires a capture with no person behind it. Under ADR-0009 it
  **cannot exist as described**.

That is a genuine tension between a FROZEN section and an APPROVED ADR. **It is recorded here and
not resolved**, because resolving it means either amending §6 or narrowing ADR-0009, and both are
owner decisions. Nothing depends on it today: no scheduler exists.

## Part F — text perception: unchanged

**VISUAL-ONLY TEXT / PII PROTECTION = NOT YET IMPLEMENTABLE WITH APPROVED LOCAL ARTIFACTS.**

`TextFinding` still has a box, a count and a class, and **no field for characters**. No OCR
provenance producer exists and none was invented. The canvas identifier in the M4 fixture remains
**neither read nor protected**, which is stated rather than worked around. Nothing was downloaded
and the frozen WASM criterion was not touched.

## Part G — detector quality: unchanged, deliberately

No threshold moved. The deterministic evaluation re-ran **identically**: 6400 anchors → 63, two of
four targets found (`reference` IoU 0.621 as `textbox`, `privacy-link` IoU 0.646 as `link` @0.90),
20 boxes inside the canvas describing none of it, 10 in regions with nothing interactable. It is a
UI-region detector, `CONDITIONAL / EXPERIMENTAL`, and model selection is a separate workstream.

## Quality gates

| gate | result |
|---|---|
| `npm test` | **1426 passed** / 0 failed / 15 skipped |
| typecheck | clean |
| `verify-repo.py` | **PASS — 0 failures, 0 warnings** |
| `pin:check` | OK `db816fad…a44dea` |
| extension build | green |
| `run-extension-observe.mjs` | **PASS 11/11** |
| `run-extension-loop.mjs` | **PASS 72/72** — `DEGRADED_TEST_ROUTE`, kept separate |
| dispatch stress | **25/25**, one fire each |
| detector evaluation | deterministic, identical |
| **real-route three acts** | see below |

**Product bundle audit:** `tabs.captureVisibleTab` **0** · `getMediaStreamId` 1 · `getUserMedia` 1
(offscreen) · `iVBORw0KGgo` 0 · `data:image` 0 · `host_permissions` loopback only · storage 0 · one
vault · one classifier · one redaction path · one egress authority · `EXECUTABLE_ACTIONS ["click"]`.

## The two bodies of evidence, still apart

| | route | verdict |
|---|---|---|
| Automated regression | `DEGRADED_TEST_ROUTE` | 72/72, its own record |
| Product cell | `REAL_GESTURE_STREAM` | M5: 29/29 — see `REAL-ROUTE.md` for this milestone's re-run |

Degraded-route numbers are never used to claim product-route verification.

## Conclusion

| | |
|---|---|
| **ARCHITECTURALLY APPROVED** | gesture-authorised capture (ADR-0009, owner, 2026-09-24) |
| **EXPERIMENTALLY VERIFIED** | the lifecycle, in 18 unit tests; the degraded regression; the product route by M5 |
| **CONDITIONAL / EXPERIMENTAL** | every detector number |
| **NOT YET VERIFIED** | any local text perception; §6's visual change signals under the new policy |

**Not claimed:** production readiness, perfect PII detection, perfect OCR, zero leakage in general,
broad visual understanding.

## Reproducibility

```bash
npm test && npm run typecheck && python scripts/verify-repo.py && npm run pin:check

npm run build -w @pratibimb/extension                      # product: no worker capture path
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-gesture-acts.mjs
#   … then click the extension's toolbar button once per act, when prompted.

M3_WORKER_FRAME=1 npm run build -w @pratibimb/extension    # degraded regression only
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-extension-loop.mjs
```

The gesture harnesses read the built manifest and worker and **refuse to start** on anything but a
product build, so real-route evidence cannot be taken on the degraded one by accident.
