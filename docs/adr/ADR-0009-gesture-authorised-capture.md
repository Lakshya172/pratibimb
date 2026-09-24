---
id: ADR-0009
title: "Gesture-authorised capture — replacing tabs.captureVisibleTab in the product path"
version: 1.0
status: PROPOSED — awaiting the human architect
owner: pratibimb-architect
proposed_by: browser-engineer · privacy-security-engineer
approved_by: none
approved_on: none
created: 2026-09-24
modified: 2026-09-24
supersedes: none
amends: "docs/architecture/constitution.md §5 (FROZEN STACK — Capture); ADR-0002 scope note"
related_gates: ["QG-03b-2c"]
related_invariants: none weakened
---

# ADR-0009 — Gesture-authorised capture

> **STATUS: PROPOSED. This ADR has not been approved and must not be read as approval.**
> The amendment procedure is explicit: *"No agent approves its own ADR. The human architect
> approves or rejects."* It is written because the deviation it describes **is already in the
> tree** — shipped across M3.1, M4 and M5 — and an undocumented deviation from a frozen entry is
> worse than a documented one awaiting a decision.
>
> On approval, `docs/architecture/constitution.md` §5 and `docs/adr/README.md` are updated. Until
> then the constitution stands as written and this file is the record of the discrepancy.

## 1. The frozen entry this deviates from

`docs/architecture/constitution.md` §5, **FROZEN STACK**:

> | Capture | **`tabs.captureVisibleTab`**, **PNG, explicit (ADR-0002)** | Faster than screen capture and raises no OS picker mid-demo. **Rate-limited, particularly under `activeTab`** — which is why the change gate does not depend on it. |

The product path no longer calls `tabs.captureVisibleTab`. It calls
`chrome.tabCapture.getMediaStreamId` in the service worker and `navigator.mediaDevices.getUserMedia`
in the offscreen document. The built product bundle contains **zero** `tabs.captureVisibleTab` calls.

## 2. Why

**`captureVisibleTab` can only be called from the service worker, and it returns the image there.**
Measured on W1 across seven routes (M3.1): a content script has no `chrome.tabs`; an offscreen
document has none at all; the worker has both capture APIs. So every `captureVisibleTab` frame puts
a page's pixels in the worker's heap.

That is the one thing M2's architecture exists to prevent for DOM values — *no page value is present
in a service-worker message* — and it does not extend to pixels under the frozen mechanism.

`getMediaStreamId` returns an **opaque handle**: a 24-character string the worker carries and cannot
read an image out of. The offscreen document redeems it for pixels itself, through a media pipeline
that is not a message. It is the same shape as M2's value release — the worker carries a capability,
the other realm goes and collects.

**Measured, product build, human-in-the-loop (M4, M5):** the worker's own recording across three
full acts was **103 messages, 82 848 bytes, zero PNG signatures, zero `data:` URLs, longest base64
run zero characters.**

## 3. What it costs

| | `captureVisibleTab` | gesture stream |
|---|---|---|
| Worker holds the frame | **yes** | **no** |
| Requires a user gesture | no (with `<all_urls>`) | **yes — every time, per tab, revoked on navigation** |
| Host permissions | `<all_urls>` **or** `activeTab` | `activeTab` only; product manifest is loopback-only |
| Rate limit | `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` — fired in real runs | none observed |
| Frame is | the tab's own pixels | a stream frame, **not** the tab's aspect ratio unless constrained |
| Cost per pass (W1) | 144–166 ms | 155–221 ms |

**The gesture requirement is a real product cost and is not being minimised.** An agent that can
only look at a tab a person has just pointed at is less autonomous than one that cannot. That is the
trade being proposed: strictly less capability, strictly better containment.

## 4. What it does NOT change

- **ADR-0002 is not weakened.** It governs the format `captureVisibleTab` requests and accepts,
  because the browser's default is JPEG and a lossy T1 frame is input the detector has no robustness
  evidence for. A stream frame is never compressed, so there is no default to fall into and no
  format to declare. Where an encoded frame still arrives — the degraded test route — PNG-explicit
  remains in force unchanged.
- **The change gate still does not depend on capture**, which is the reason §5's note gives for the
  rate-limit caveat.
- No invariant is weakened. No second vault, no second boundary, no second egress path.
- `EXECUTABLE_ACTIONS` is unchanged.

## 5. The consequential contract change

`CaptureFrame` gains `source: "encoded" | "live"`, and `pixels`/`format` become present only on an
encoded frame. This is a package type, not one of §4's three named engineering contracts.

The alternative was to re-encode every stream frame to PNG purely to populate a field. That was
implemented in M4 and **measured at 1040 ms of a 1252 ms pass on W1**, producing bytes that were
audited and found to have **no consumer**: the detector preprocesses decoded RGBA, and the only
reader of `pixels` in the package (`frameHash`) is called nowhere in the product. After removal the
same pass is **155–221 ms**.

`frameHash` now refuses on a live frame rather than hashing an absent buffer, because hashing
nothing would give every live frame the same hash and make the change gate report "unchanged"
forever.

## 6. The degraded route, and why it survives

`M3_WORKER_FRAME=1` compiles in a `captureVisibleTab` path for automated regression, because **no
harness can produce the invocation `activeTab` requires** — measured: `<all_urls>` does not
substitute, a real click inside an extension page does not, and a CDP keyboard command never reaches
Chrome's accelerator table.

It is a build-graph decision, not a runtime flag: `captureVisibleTab` is an optional property of the
browser adapter and the reference is absent from a product bundle. Evidence taken on it carries
`routeCategory: DEGRADED_TEST_ROUTE` and is never combined with product-route evidence.

## 7. Evidence

| | |
|---|---|
| Route table, seven routes | `artifacts/experiments/M3.1-visual-evidence/README.md` |
| Capture route, 12/12, real click | `artifacts/experiments/M4-gesture-text-perception/` |
| Three acts, 29/29, `REAL_GESTURE_STREAM` | `artifacts/experiments/M5-gesture-loop/` |

All **HUMAN-IN-THE-LOOP** on W1, Chrome for Testing 153.0.8010.12, and labelled as such.

## 8. What approval would cover

Replacing the §5 capture mechanism for the **product** path with gesture-authorised tab capture, and
the `CaptureFrame` consequence in §5 above. It would **not** adopt any detector, promote QG-03,
change ADR-0002's format policy, or authorise removing the degraded test route.

## 9. Rejection is a real option

If the gesture requirement is judged too costly for the demonstration — a presenter must click the
toolbar before each act — the honest alternative is to revert to `captureVisibleTab` **and record
that pixels transit the worker as an accepted limitation**, rather than to keep the stream route and
describe it as free. The code supports both; only one of them can be the default.
