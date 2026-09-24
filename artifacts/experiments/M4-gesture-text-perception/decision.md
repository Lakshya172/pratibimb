# Decision — M4 gesture capture and local text perception

| Field | Value |
|---|---|
| **Verdict** | **PASS** — gesture route 12/12 (human-in-the-loop); three acts 72/72 (degraded route) |
| **Status** | **EXPERIMENTALLY VERIFIED (HUMAN-IN-THE-LOOP)** for the capture route · **NOT YET VERIFIED** for local text perception, which was audited and declined |
| **Date** | 2026-09-24 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Cell** | Chrome for Testing 153.0.8010.12, headed, extension loaded |

## What this authorises

**Calling the gesture capture route verified.** A genuine browser user action caused the grant, and
the stream was actually consumed by the offscreen perception realm — the two conditions the brief
set. It ran on the product build, which the harness checks before it starts: no `<all_urls>`, no
`captureVisibleTab` anywhere in the bundle.

It also authorises the shape of the answer about text: **the repository's own frozen rule decides
it**, not a preference formed in this milestone.

## What this does not authorise

- **The three acts on the gesture route.** They ran on the degraded route and the record says so in
  a top-level field. The product cell verified capture and perception, not the whole loop.
- **Any claim about visual PII protection.** The fixture's canvas identifier is neither read nor
  protected, and the seam built for it has no model behind it.
- **Any accuracy claim.** The detector numbers are unchanged from M3.1 and remain CONDITIONAL.

## Open, and stated rather than hidden

### 1. The gesture route is verified for capture, not for the loop

One click proves capture, perception and the worker's blindness. It does not prove SUCCESS /
REFUSAL / OUTAGE on that route. Extending the human-in-the-loop harness to run the three acts after
the grant is the obvious next step and is not done here — each iteration costs an operator a click,
and the capture defect found on the first one was worth spending them on instead.

### 2. A 1 040 ms PNG encode that nothing reads

`CaptureFrame.pixels` is typed as encoded PNG because `captureVisibleTab` produces one. A media
stream produces an `ImageBitmap`, so the gesture route re-encodes to keep the type truthful — 1 040
ms of a 1 252 ms pass, against 144–166 ms for the whole degraded pass.

**Nothing reads those bytes.** The detector's preprocessing takes the decoded RGBA this realm
already holds. Removing the encode means letting `CaptureFrame` describe a decoded frame, which is a
change to a package contract and wants its own decision. It is one sample and probably includes
codec initialisation; it should be measured again before it is designed around.

### 3. The realm problem under any future recogniser

A recognised string would exist in the perception realm. The vault is in the content script's realm.
Moving one to the other crosses the worker, which M2 exists to prevent. **This is unsolved**, and it
is the thing that should be settled before a recogniser is adopted rather than after — the cheapest
resolution is to never recognise at all and redact regions unread, which needs `ocr_det`, which is
the half that fails WASM.

### 4. The tab stream is not the tab's pixels

An unconstrained stream came back at a different aspect ratio than the viewport. The fix asks for
the viewport's dimensions, and Chrome honoured it on W1 at 1280×720 — **once**. Whether it honours
it at other viewport sizes, on other displays, or under a device pixel ratio other than this one is
unmeasured. The geometry guard refuses rather than approximating if it does not, so the failure mode
is safe; the coverage is one configuration.

### 5. The detector still floods, and still has no text class

Unchanged from M3.1 and re-measured identically: 63 detections, two of four targets found, ten boxes
in regions with nothing in them, 20 boxes inside the card describing none of it. No threshold was
moved.

### 6. Everything M2, M2-EXEC, M3 and M3.1 left open is still open

The refused literal insert, no human-facing grant surface, `apps/extension` outside the typecheck
graph, the undecided lifetimes, `E6_ARM`/`E6_RELEASE` as a value-release stub, the attribution
epsilon, and Chrome's unscheduled capture quota.
