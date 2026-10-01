---
id: ADR-0013
title: "Extension-pages CSP v2: close every fetch directive by default, and pin the product to the reasoner endpoint"
version: 1.0
status: ACCEPTED — directed by the owner in the M13 brief (2026-10-01); implemented; amends ADR-0001 §7 (policy v1 → v2). F-M13-1 (top-level navigation) OPEN — outside CSP
owner: pratibimb-architect
proposed_by: privacy-security-engineer · browser-engineer
created: 2026-10-01
modified: 2026-10-01
amends: ADR-0001 §7.1/§7.2 (the extension_pages policy). ADR-0001 itself is unchanged except for a forward pointer.
related_findings: ["F-M12-1 (M12)", "F-M13-1 (this ADR, §9)"]
related_blockers: ["B7 (ADR-0012 §13)", "B-02 (agentos/blockers.md)"]
related_invariants: ["Invariant E (mechanism 3)", "INV-01", "INV-15", "INV-16"]
related_gates: ["QG-04 item 2"]
evidence: artifacts/experiments/M13-csp-and-stream-determinism/ (logs/w1-cft-csp-negative.json)
---

# ADR-0013 — Extension-pages CSP v2

> **STATUS: ACCEPTED (owner-directed, M13) and IMPLEMENTED.**
>
> - **Every channel a CSP directive governs is now closed** against code injected into the
>   offscreen document, the service worker and the TR-01 worker. This was measured with 0 arrivals at
>   an independent foreign origin.
> - **Top-level navigation is not governed by any CSP directive and remains OPEN (F-M13-1, §9).**
>   That is an owner decision, not something this policy can fix.

## 1. Current weakness (before this ADR)

ADR-0001's policy (v1) is:

```
script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' http://127.0.0.1:8995
```

It pins `connect-src` and nothing else that fetches. M12 measured **F-M12-1**. Code injected into the
offscreen document reached an independently instrumented foreign origin through `<img>` (GET, 200) and
`<iframe>`, because `img-src` and `frame-src` were unrestricted. It could also POST to any path on the
collector origin, including the test frame sink, from a **product** build.

## 2. Exact threat

The threat is code executing in an extension realm (offscreen document, service worker or a
dedicated worker) that tries to put bytes — a frame, a value, a hash — on the wire to a destination
the build does not name.

This ADR bounds what such code can reach. It does not address how the code got there; that is the
job of INV-15/INV-16, `script-src`, and the absence of `eval`.

## 3. What the product legitimately loads (Part A inventory, read from the build)

| Resource | Class | Source |
|---|---|---|
| WXT chunks, `ort.all.min.js`, the TR-01 worker's `importScripts` of the pinned ORT bundle | script | `'self'` |
| WebAssembly compile (ORT) | wasm | `'wasm-unsafe-eval'` |
| `tr01-worker.js` (`new Worker(packaged URL)`) | worker | `'self'` |
| `t1-ui-head.onnx`, the TR-01 model, the ORT `.wasm` (via a verified buffer), the ORT glue `.mjs` | connect / script | `'self'` |
| The loopback reasoner (`localModelReasoner` → `sendVerified`) | connect | `http://127.0.0.1:8995/v1/chat/completions` |
| The side panel's one inline `<style>` | style | its SHA-256 |

Images, frames, media, fonts, objects, `<base>` and forms are not used by any extension page.

- Frames reach the realm through `getUserMedia` and `createImageBitmap(Blob)`, which no CSP fetch
  directive governs, and are drawn to canvases.
- The WebP round trip uses `createImageBitmap(Blob)`.

## 4. Decision — policy v2

```
default-src 'none';
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self';
connect-src 'self' <build sources>;
style-src 'sha256-<side panel style>';
object-src 'none';
base-uri 'none';
form-action 'none'
```

| Build | `connect-src` sources |
|---|---|
| **product** (no evidence flag) | `http://127.0.0.1:8995/v1/chat/completions`: the reasoner endpoint, **exact path** |
| **evidence** (any of `TR01_PROBE`, `EGRESS_EVIDENCE_PROBE`, `E6_PROBE`, `STRUCTURAL_PROBE`, `M3_WORKER_FRAME`) | `http://127.0.0.1:8995`: the collector origin, so the test frame sink and the M10/M11 evidence POSTs work |

- **Denied:** every fetch directive not named, by `default-src 'none'`. That covers img, media, font,
  frame/child, manifest and prefetch. `object-src 'none'` (v1 had `'self'`). `base-uri` and
  `form-action` are `'none'`, because `default-src` does not cover them.
- **Implementation:**
  - `buildExtensionPagesCspV2` in `packages/security/src/csp.ts` is `CSP_POLICY_VERSION = 2`. It
    rejects wildcards, prefix paths, queries, fragments and scheme sources.
  - `extensionPagesCsp` in `apps/extension/host-lib/extension-csp.ts` selects the product or
    evidence sources.
  - `apps/extension/wxt.config.ts` computes the style hash from `host/sidepanel/index.html` with LF
    line endings, which is what the bundler emits.
- **v1 stays in place:** `buildExtensionPagesCsp` and its tests remain as the ADR-0001 record and
  for the G-mv3-host gate builders, which test v1.

## 5. Why v2 is sufficient for the channels a CSP governs

These results were measured in the real extension, in Chrome for Testing `chromium-1243` on W1
([`logs/w1-cft-csp-negative.json`](../../artifacts/experiments/M13-csp-and-stream-determinism/logs/w1-cft-csp-negative.json)).

**Blocked, with 0 arrivals at the foreign origin.** The blocking directive is in brackets, as reported
by `securitypolicyviolation`.

- **Network APIs:**
  - fetch, XHR, sendBeacon, EventSource and WebSocket (`connect-src`);
  - `import()` (`script-src`);
  - `importScripts` from the worker (`script-src`).
- **Elements:**
  - `<img>` (`img-src`);
  - `<iframe>` (`frame-src`);
  - `<object>` and `<embed>` (`object-src`);
  - `<script>` (`script-src`);
  - `<link rel=stylesheet>` (`style-src`);
  - `<link rel=prefetch>`;
  - `<video>` and `<audio>` (`media-src`);
  - a CSS `background-image` (`img-src`);
  - `FontFace` (`font-src`);
  - `new Worker(foreign)` (`worker-src`).
- **Other:**
  - `form` POST (`form-action`);
  - `<a ping>`.
- **The product's test-sink path:** a POST to `127.0.0.1:8995/m10/frame` from a product build is
  blocked (`connect-src`). Only the reasoner endpoint is reachable, and the positive control shows
  it arriving.

**WebRTC.** An `RTCPeerConnection` with a STUN server on the foreign port produced **no UDP datagram**
from the offscreen document. The same code in an ordinary web page produced 5, so the observer works.
This was measured, not explained; no CSP directive is claimed for it.

**Legitimate resources still load under v2:**
- the offscreen document reloads with no CSP violation;
- `ORT_SMOKE`: the ORT bundle, the WASM pin and a UI-head session;
- the side panel renders with its hashed style (margin 12 px, status ok);
- an evidence-build perception pass runs: the TR-01 worker, ORT and the UI head, with no violation.

## 6. Impact on the extension

- **The product build** can reach exactly one network address. A loopback reasoner at any other path
  or port is refused by the browser (fail-closed, and stricter than v1).
- **Evidence builds** keep the collector origin. The product and evidence policies differ in that one
  `connect-src` source and nothing else:
  - `apps/extension/test/extensionCsp.test.ts` checks the selection function;
  - the negative harness checks the built manifests.
- **The gesture harnesses' route-identity check** (M10.6/M10.7/M10.8, M12 stream RE-1) now hashes the
  manifest with `connect-src` normalised. It refuses unless the evidence build's sources are exactly
  the product's widened to the collector origin (`tests/browser/support/build-route.mjs`).

## 7. Rollback

Revert the commit that switches `wxt.config.ts` from `buildExtensionPagesCsp` to
`extensionPagesCsp`. v1's builder is still in `csp.ts` and its tests still pass. No data, model or
other contract depends on v2.

## 8. Tests

- `packages/security/test/cspV2.test.ts` (21): the exact policy, closed-by-default directives,
  explicit `'none'`s, no permissive token, refusal of every widening source, and style hashes.
- `apps/extension/test/extensionCsp.test.ts` (5): the product/evidence distinction and the flag
  selection.
- `tests/browser/extension/run-csp-negative.mjs`:
  - the product and evidence builds;
  - three realms;
  - every channel in §5;
  - the legitimate-resource controls;
  - the built-policy comparison.

## 9. F-M13-1 — what CSP cannot close (OPEN)

In both builds, injected code reached the foreign origin by **top-level navigation**:

| Realm | Channel | Arrival |
|---|---|---|
| offscreen | `window.open(url)` | yes |
| offscreen | `<a target=_blank>` click | yes |
| offscreen | `open()` from a src-less (about:blank) `<iframe>`; `frame-src` does not apply to it | yes |
| service worker | `chrome.tabs.create({url})` | yes |
| service worker | `chrome.windows.create({url})` | yes |
| offscreen | `location.href = url` (navigating itself) | **no** |
| TR-01 worker | — (no navigation API) | — |

No CSP directive governs top-level navigation; `navigate-to` was never shipped. `chrome.tabs.create`
and `chrome.windows.create` need no permission. This is therefore not closable by this ADR.

The candidate directions each need their own measurement and decision:
- `declarativeNetRequest` rules scoped to the extension as initiator: a new permission, and unmeasured
  whether it sees the extension's own navigations;
- in-realm neutralisation of `window.open` and of anchors: bypassable from a fresh `about:blank` realm;
- accepting the class as residual, on the grounds that it requires code already executing in an
  extension realm.

**Until decided, B7 remains OPEN.**
