# M13 — CSP hardening and stream determinism

> **Status:**
>
> - **CSP v2 implemented and verified** ([ADR-0013](../../../docs/adr/ADR-0013-extension-pages-csp-v2.md)).
>   Every channel a CSP directive governs is closed against injected code, and every legitimate
>   resource still loads.
> - **STOPPED on F-M13-1.** Injected code still reaches an unauthorised origin by **top-level
>   navigation** (`window.open`, `<a target=_blank>`, `chrome.tabs.create`, `chrome.windows.create`).
>   No CSP directive governs that. It matches the M13 stop condition "injected code can still reach an
>   unauthorized origin", so the J7 characterisation (Parts E–N) has **not been run** pending the
>   owner's decision.
> - **Production frame egress remains impossible** (M12, unchanged).

## Hypothesis

1. A minimal amendment to the extension_pages CSP — closed by default, naming only what the
   extension's pages load — stops code injected into any extension realm from reaching an
   unauthorised origin through img, iframe, object, embed, connect, WebSocket, EventSource,
   sendBeacon, XHR and fetch.
2. That holds without breaking any legitimate resource.
3. The product and evidence builds differ only in the evidence build's test sink, machine-verifiably.

## Environment

- **Workstation:** W1 (`LAPTOP-6E14K34L`), Windows 11 10.0.26200, Intel Core 7 240H, Node v24.19.0,
  Playwright 1.63.0.
- **Browser:** Chrome for Testing `chromium-1243`, headed.
- **Date:** 2026-10-01.
- **Builds:** product (no flags), and evidence (`TR01_PROBE=1 M3_WORKER_FRAME=1`), each built by the
  harness.

## Expected result

- Hypotheses 1–3: PASS.
- Channels outside CSP's reach, if any exist, are measured and reported separately, never counted as
  a pass.

## Actual result — [`logs/w1-cft-csp-negative.json`](logs/w1-cft-csp-negative.json)

`tests/browser/extension/run-csp-negative.mjs`:

- **Injection:** raw CDP into the offscreen document and the service worker, plus the TR-01 dedicated
  worker in the evidence build, reached by auto-attach.
- **Independent arrival points:** an HTTP and WebSocket server on `127.0.0.1:8996`, a UDP socket on
  the same port, and the collector/sink on `8995`, which records any path.

**The policies**, both built and both checked:

```
product:  default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' http://127.0.0.1:8995/v1/chat/completions; style-src 'sha256-m8177FDykU5Du1Rd/j5mkhTgw4bPCr4KkGCjgcTQlvI='; object-src 'none'; base-uri 'none'; form-action 'none'
evidence: … connect-src 'self' http://127.0.0.1:8995 …   (otherwise identical; differOnlyInConnectSrc: true)
```

The built side panel's `<style>` hashes to the policy's `style-src` source.

### CSP-governed channels: product PASS, evidence PASS

0 foreign arrivals from the offscreen document, the service worker and (evidence) the TR-01 worker.
Each attempt produced a `securitypolicyviolation` naming its directive:

- **connect-src:** fetch, XHR, WebSocket, EventSource, sendBeacon.
- **script-src:** `import()`, `<script>`, `importScripts` (worker).
- **img-src:** `<img>`, CSS `background-image`.
- **frame-src:** `<iframe src>`.
- **object-src:** `<object>`, `<embed>`.
- **style-src:** `<link rel=stylesheet>`.
- **Others:**
  - `<link rel=prefetch>`;
  - `<video>` and `<audio>`;
  - `FontFace`;
  - `new Worker(foreign)`;
  - `form` POST (`form-action`);
  - `<a ping>`.

More results:

- **Product sink path:** a POST to `127.0.0.1:8995/m10/frame` was **blocked**, from both realms.
- **Evidence sink path:** the same POST **arrived**, which is the test-sink allowance.
- **Reasoner endpoint:** reachable in both builds (positive control).
- **WebRTC/STUN:** 0 UDP datagrams from the offscreen document. The same code in a web page sent 5,
  so the observer works. This was measured, not explained.

### Legitimate resources

- The offscreen document reloads with **0** CSP violations.
- `ORT_SMOKE` passes in both builds: the WASM pin `db816fad…`, a session and a first run.
- The side panel renders with its hashed style and its script runs.
- The evidence-build perception pass runs with 0 violations: the TR-01 worker, ORT and the UI head.

### F-M13-1: top-level navigation (OPEN, outside CSP)

| Realm | Channel | Foreign arrival |
|---|---|---|
| offscreen | `window.open` | **yes** |
| offscreen | `<a target=_blank>` click | **yes** |
| offscreen | `open()` from an about:blank `<iframe>` | **yes** |
| service worker | `chrome.tabs.create` | **yes** |
| service worker | `chrome.windows.create` | **yes** |
| offscreen | `location.href =` (itself) | no |

The same results held in both builds.

### Regressions under v2

These were re-run on W1. The records they rewrote were restored; the historical logs are unchanged.

**PASS:**
- M12 QG-04 interception, both phases. Its F-M12-1 probe now finds **no** img/iframe arrival and no
  reach to the sink path from the product.
- RE-1 through the product path, equal to M8.1.
- The M10.6, M10.7 and M10.8 dry runs and the M12 stream RE-1 dry run, 4 windows each.

**M2 extension loop** (`run-extension-loop.mjs`, product build):
- Every reasoner, refusal, outage, value-boundary and capability check passes. That includes the
  pinned reasoner endpoint under v2.
- Its eight perception checks fail (`NO_CAPTURE`).
- **The same eight fail identically when the same harness runs under the M12 (v1) policy.** The
  failure predates M13: the harness's committed PASS (2026-09-25) predates gesture-only capture
  (ADR-0009), and with no click the product route captures nothing.
- It is recorded here, not fixed in this unit.

## Conclusion

- **The CSP-governed boundary is closed:** hypotheses 1–3 hold, measured.
- **F-M12-1 is resolved for every channel it named** (img, iframe), and for every other channel a CSP
  directive governs.
- **The network boundary against injected code is NOT closed.** Top-level navigation is outside CSP
  (F-M13-1), and that is an M13 stop condition.
- **B7 stays OPEN** until the owner decides how F-M13-1 is treated. The options are in ADR-0013 §9.
- **J7 has not been characterised in this unit.**

## Reproducibility

```
CHROME_PATH=<chrome for testing> node tests/browser/extension/run-csp-negative.mjs
npx vitest run packages/security/test/cspV2.test.ts apps/extension/test/extensionCsp.test.ts
```

The harness builds both extensions and restores the product build.
