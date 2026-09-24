---
id: ADR-0009
title: "Gesture-authorised capture — replacing tabs.captureVisibleTab in the product path"
version: 1.1
status: APPROVED — owner decision recorded in §0; constitution §5 amended
owner: pratibimb-architect
proposed_by: browser-engineer · privacy-security-engineer
approved_by: ronitsaha11 (Ronit Saha)
approved_on: 2026-09-24
created: 2026-09-24
modified: 2026-09-24  # rev 1.1: owner approval recorded, constitution §5 amended per the procedure
supersedes: none
amends: "docs/architecture/constitution.md §5 (FROZEN STACK — Capture); ADR-0002 scope note"
related_gates: ["QG-03b-2c"]
related_invariants: none weakened
---

# ADR-0009 — Gesture-authorised capture

> **STATUS: APPROVED 2026-09-24** by the repository owner and architecture decision-maker,
> **Ronit Saha** (`ronitsaha11`), whose decision is recorded verbatim in §0.
>
> Approval covers **the architectural direction**: gesture-authorised tab capture replaces
> `tabs.captureVisibleTab` as the product capture path, together with the `CaptureFrame`
> consequence in §5. Per the amendment procedure step 6, `docs/architecture/constitution.md` §5 and
> `docs/adr/README.md` have been updated; the constitution edit is the minimum one the procedure
> requires and is itself covered by this approval.
>
> **Approval is not a readiness claim.** The owner stated this explicitly. Three things are
> deliberately kept apart throughout this ADR and must stay apart wherever it is cited:
>
> | | |
> |---|---|
> | **ARCHITECTURALLY APPROVED** | the direction, by the owner, here |
> | **EXPERIMENTALLY VERIFIED** | that it works on W1, by M4 (12/12) and M5 (29/29), **human-in-the-loop** |
> | **NOT production readiness** | not claimed by this ADR, by M5, or by the owner |

---

## 0. The owner decision, as given

> I, Ronit Saha, as the repository owner / architecture decision-maker, explicitly APPROVE ADR-0009.
>
> Approved architectural decision:
>
> REPLACE THE FORMER PRODUCT CAPTURE ASSUMPTION `tabs.captureVisibleTab` with:
>
> USER-INITIATED TOOLBAR GESTURE → activeTab authorization → tabCapture / getMediaStreamId →
> opaque stream handle → OFFSCREEN PERCEPTION REALM → getUserMedia(handle) → ImageCapture / live
> ImageBitmap → LOCAL PERCEPTION
>
> This approval covers the architectural choice demonstrated by M5.
>
> The product SHALL use the gesture-authorized stream architecture.
>
> The product SHALL NOT:
> - use captureVisibleTab as the normal product capture path
> - silently fall back to captureVisibleTab
> - broaden to `<all_urls>` merely to avoid the gesture requirement
> - simulate the required user gesture through CDP or test-only browser injection
> - weaken activeTab/tabCapture security semantics
>
> The UX cost is explicitly accepted:
> - a fresh user invocation may be required after navigation/reload because activeTab authorization
>   is revoked
> - this is a deliberate fail-closed behavior, not a defect to be hidden
>
> Do NOT claim that this approval means the architecture is production-ready. It means the
> architectural direction itself is formally approved.

### 0.1 What each prohibition maps to in the tree

Recorded so the decision is enforceable by reading rather than by memory. Every row is checked by a
test, a build-artifact scan, or both.

| The owner's prohibition | Where it is enforced |
|---|---|
| no `captureVisibleTab` as the product path | `chrome.tabs.captureVisibleTab` is an **optional property** of the capture adapter, supplied only under `M3_WORKER_FRAME`; product bundle count is **0** |
| no silent fallback | `CaptureAuthority.ticketFor` returns `NO_ACTIVE_TAB_GRANT` and never reaches for another route; the degraded branch is absent from the bundle, not merely unreached |
| no `<all_urls>` to avoid the gesture | product `host_permissions` is `["http://127.0.0.1/*"]`; a test asserts the default build's manifest |
| no simulated gesture | measured: `<all_urls>` does not grant `activeTab`, a real click inside an extension page does not, and a CDP `_execute_action` keypress never reaches Chrome's accelerator table. The evidence harnesses **stop and wait for a person** |
| no weakened `activeTab`/`tabCapture` semantics | the authority mirrors Chrome's own lifetime — a grant is revoked on navigation and on tab close |

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

**What that evidence is and is not.** It is one operator, on one machine, in one browser cell, on
one synthetic fixture, with one click per act. It establishes that the route works and that the
worker sees no pixels while it does. It establishes nothing about reliability, about other
viewport sizes or device pixel ratios, about other displays, or about any page that is not the
fixture. `EXPERIMENTALLY VERIFIED` is the whole of the claim.

## 8. What this approval covers, and what it does not

**Covers:** replacing the §5 capture mechanism for the **product** path with gesture-authorised tab
capture, the `CaptureFrame` consequence in §5 above, and the minimum constitution amendment the
procedure requires.

**Does not cover, and is not implied by, this approval:**

- adopting any detector, or promoting QG-03 — the UI head remains `CONDITIONAL`;
- changing ADR-0002's format policy, which is untouched and still in force wherever an encoded
  frame arrives;
- removing the degraded test route, which remains as `DEGRADED_TEST_ROUTE` regression
  infrastructure and is never mixed into product evidence;
- any text or OCR capability — none exists, and the one candidate is blocked by a separate frozen
  rule;
- **production readiness**, which the owner ruled out in the decision itself.

## 9. The rejected alternative, recorded

This ADR was written with a genuine rejection option: revert to `captureVisibleTab` and **record
that pixels transit the worker as an accepted limitation**, rather than keep the stream route and
describe it as free.

**The owner rejected that alternative and accepted the UX cost explicitly**, in the words quoted in
§0: *"a fresh user invocation may be required after navigation/reload because activeTab
authorization is revoked — this is a deliberate fail-closed behavior, not a defect to be hidden."*

It is recorded here rather than deleted because the cost is real and recurring: on a multi-step task
across navigations, it is one invocation per document, not one per session. A future milestone that
finds that cost intolerable should reopen **this** decision with evidence, not work around it.

## 10. Consequences accepted

1. **Re-authorisation after navigation is product behaviour**, not a bug. A harness that stops and
   waits for a person is the correct shape for evidence about it, and is what M4 and M5 use.
2. **No automated harness can exercise the product capture route.** Automated regression therefore
   runs on `DEGRADED_TEST_ROUTE` and its numbers may not be used to claim product-route
   verification.
3. **The capture policy is explicit and fail-closed** — see
   `docs/architecture/capture-policy.md`. No polling, no autonomous repeat capture, no retry after
   a quota refusal, no silent substitution.
