# Decision — M3 local visual perception

| Field | Value |
|---|---|
| **Verdict** | **PASS** — 68 of 68 checks |
| **Status** | **EXPERIMENTALLY VERIFIED** on W1. Not PROVEN. |
| **Date** | 2026-09-22 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Cell** | Chrome for Testing 153.0.8010.12, headed, extension loaded |
| **Evidence** | `../M2-page-value-boundary/logs/w1-cft153-extension-loop.json` (`perception` block) |

## What this authorises

Treating `packages/perception` as the extension's perception tier rather than as a substrate waiting
for one. The capture adapter, the letterbox, the tensor contract, the head decode, the coordinate
spaces and the DOM/vision fusion all run in the shipped product path, on every reading, and the
manifest the reasoner receives says which tiers fired and which elements have pixel evidence.

It also authorises the provenance claim as a *claim*: `capability.tiers_fired` and per-element
`source` are assertions to a party that cannot check them, and a client that captured nothing now
declares the structural floor — observed live, because Chrome's capture quota refused two passes.

## What this does not authorise

- **Any statement about detection quality.** The artifact is `CONDITIONAL`; W1-QG03 measured that
  browser preprocessing moves 16–34% of its detections, and 94 vision-only boxes on a six-field form
  is noise. The pipeline is verified. The detector is not.
- **Vision-only elements as action targets.** They are counted and they are not made actionable —
  they have a synthetic id and no selector, and M3 does not give them one. ACT remains DOM-bound.
- Any reliability claim beyond one run of each act on one machine in one browser cell.
- Any relaxation of the status vocabulary. **EXPERIMENTALLY VERIFIED.**

## Open, and stated rather than hidden

### 1. A page's pixels pass through the service worker — the central M3 limitation

M2's guarantee is that no page value is present in a service-worker message. **That guarantee does
not extend to pixels, and M3 does not pretend otherwise.** `captureVisibleTab` exists in exactly one
realm, and the alternative that would avoid it — `tabCapture.getMediaStreamId`, where the worker
holds an opaque id and the pixels reach the offscreen document through the media pipeline — refuses
without an `activeTab` gesture. Both were measured on W1 rather than read off a documentation page.

What is enforced instead: the hop is singular, the worker retains nothing, and its own recording
carries no PNG signature, no `data:` URL and no base64 run at all. What is *not* enforced is the
thing that cannot be: during that hop, the worker's heap holds the frame.

**The way out is a product decision, not a code change**: an agent invoked by a user gesture gets
`activeTab`, and `getMediaStreamId` then delivers pixels to the perception realm without the worker
ever holding one. That is the right architecture and it needs a UI surface this milestone does not
have.

### 2. The evidence build substitutes a flag for a gesture

`M3_CAPTURE_WITHOUT_GESTURE=1` adds `<all_urls>` so a Playwright harness can capture at all. The
default build declares `activeTab` and `http://127.0.0.1/*`, and a test asserts it. Nothing else
differs between the two builds — same capture call, same transfer, same realm, same downstream — but
the evidence was taken on a build whose permission a user did not grant, and that is worth saying.

### 3. The fixture was deliberately not extended

The brief asked for a sensitive-looking *visual* region the DOM does not describe. The fixture at
`tests/browser/demo/fixture/application.html` is shared with the frozen demo branch and is a
standing immutable baseline, so adding one would change the demo's recorded payload digest. It was
left alone. What it already provides is real: five sensitive values rendered on screen, a real form
target, non-sensitive UI, and enough geometry to exercise a 1600×900-to-1280×720 coordinate mapping
that is nothing like the identity. **A vision-only sensitive region is therefore not exercised**, and
the vision-only path is verified only by count.

### 4. Chrome's capture quota is a policy nobody has set

`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` refused two of seven passes in a single three-act run.
The adapter classifies it and the loop degrades correctly, which is the designed behaviour — but
there is no scheduler deciding *when* to capture, so the current answer to "how often" is "every
reading, and accept the refusals". S-05 left the real rate unmeasured; this is the first time the
product path has hit it.

### 5. Perception adds ~140–225 ms to every reading

On W1: capture 37–49 ms, decode 10–17 ms, preprocess 42–71 ms, inference 42–86 ms, fusion 0–1 ms.
Bootstrap is 602 ms once per document. Nothing here is optimised and nothing should be until the
detector is worth running — but the obvious cost is visible: the frame is decoded **twice** per
pass, once to measure it and once to rasterise it, because the capture adapter measures dimensions
before the detector preprocesses. That is one redundant full-frame decode per reading.

### 6. Everything M2 and M2-EXEC left open is still open

The refused literal insert, the missing human-facing grant surface, `apps/extension` outside the
typecheck graph, the undecided lifetimes, `E6_ARM`/`E6_RELEASE` remaining as a value-release stub,
and the attribution epsilon.
