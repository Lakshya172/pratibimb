# Decision — M3.1 visual evidence

| Field | Value |
|---|---|
| **Verdict** | **PASS** — 71 of 71 checks; detector evaluation identical across two runs |
| **Status** | **EXPERIMENTALLY VERIFIED** on W1 for the architecture and the acts; **CONDITIONAL** for every detector number; **NOT YET VERIFIED** for the gesture capture route |
| **Date** | 2026-09-24 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Cell** | Chrome for Testing 153.0.8010.12, headed, extension loaded |

## What this authorises

Treating the capture authority as the place that decides whether this extension may look at a tab,
and the opaque `getMediaStreamId` handle as the only thing the worker is given when it may. A
product build has no other route: `chrome.tabs.captureVisibleTab` appears zero times in its
`background.js` and its host permissions are loopback only.

It also authorises describing the detector the way this record describes it — high recall, about
four percent precision, two of four targets found on a fresh page, ten boxes in regions with nothing
in them — because those numbers come from the shipped configuration with nothing tuned, and they
agree with the model's own standing evaluation.

## What this does not authorise

- **Any claim that worker-free capture was exercised.** It was implemented and unit-tested. The
  invocation it requires cannot be produced by any automated harness, measured seven ways, so the
  three acts ran on the degraded build and every record says so in a field.
- **Any accuracy claim.** One page, one layout, one browser cell, no corpus.
- **Any claim that the client can protect what is rendered into the canvas.** It cannot read it.
- Vision-only elements as action targets or as value references. They are counted, and that is all.

## Open, and stated rather than hidden

### 1. The gesture route is unexercised, and that is the milestone's central gap

Every piece is in place: the authority records grants from `chrome.action.onClicked`, mints a handle
under one, and the offscreen realm turns a handle into pixels through `getUserMedia` and
`ImageCapture`. The path from a handle to an `ImageBitmap` has **never actually run**, because no
harness can mint a handle. What is tested is the authority's decision logic with the browser faked,
and what is measured is that the browser refuses everything short of a real invocation.

The next step is a human-in-the-loop evidence cell: a run that pauses, a person clicks the toolbar
button, and the run continues on the gesture route. That is a legitimate evidence shape for a
capability whose whole point is that a person initiated it, and it is not built here.

### 2. The evidence build is not the product build

`M3_WORKER_FRAME=1` compiles in `captureVisibleTab` and brings `<all_urls>`. One flag rather than
two, so the permission and the code path cannot drift apart, and a test asserts what a default build
declares. But the three-act numbers describe a build a user would not install, and the honest
reading of "no pixels in the worker" for **this run** is: the worker held a frame on seven hops and
retained none of them.

### 3. The canvas cannot be protected, and that is the honest result of the fixture

The fixture exists to create a region whose sensitive appearance the DOM cannot reach. It succeeded,
and the consequence is that this client can neither read nor redact what is drawn there. Twenty
detections fire inside the card and none describes it; the head has no class for a document and
there is no OCR. **A client that cannot read a value cannot claim to protect it**, and nothing in
M3.1 does.

### 4. The detector floods, and no filter was invented to hide it

Ten of sixty-three detections landed in regions with nothing interactable. The score floor is the
shipped 0.25 and was not moved; the gate's own threshold selection chose 0.05 for maximum mAP, so
the runtime is already the more conservative of the two. Raising it until the fixture looked better
would be tuning against the output being measured. The filter that actually matters is already
there and is architectural rather than statistical: vision-only boxes never reach the manifest.

### 5. One decode removed; no speedup claimed

Decodes per pass went from two to one, which is structural. At three passes per act the wall-clock
difference is inside run-to-run variance, and it is reported that way. The gesture route would
remove the remaining decode entirely and has not been measured.

### 6. Chrome's capture quota is still nobody's policy

`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` refused two of seven passes again. The adapter classifies
it, the client declares the DOM-only floor for the act that saw nothing, and the loop carries on —
but there is still no scheduler deciding when to capture.

### 7. Everything M2, M2-EXEC and M3 left open is still open

The refused literal insert, no human-facing grant surface, `apps/extension` outside the typecheck
graph, the undecided lifetimes, `E6_ARM`/`E6_RELEASE` as a value-release stub, and the attribution
epsilon.
