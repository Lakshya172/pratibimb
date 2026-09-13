# Track G — the minimal MV3 host: does the architecture physically run in an extension?

> **Yes, for everything this host could measure, in two Chromium-family cells.**
> - It loads.
> - ORT runs the T1 artifact through ADR-0001's pinned path **inside the offscreen document**.
> - The browser supplies `documentId` with every content-script message.
> - A round trip from content script to service worker to offscreen document and back takes about a millisecond.
> - `connect-src` blocks a foreign loopback origin before the wire.
> - **The offscreen document survives a service-worker restart.**
>
> **Two things stay unmeasured and are said so:**
> - natural service-worker termination under automation (it did not happen in 45 s);
> - the real side-panel context (it needs a user gesture).

- **Date:** 2026-09-13 · **Workstation:** W2 (`LAPTOP-SRCINK2B`) · **Cells:** Chrome for Testing
  153.0.8010.12 and branded Microsoft Edge 153.0.4234.32, headful, Windows host
- **Host source:** `apps/extension/` (WXT 0.21.4). **Harness:** `harness/run-host.mjs`. **Log:**
  [`logs/host.json`](logs/host.json)
- **Not the product.** No sanitizer, no privacy verifier, no production vault, no egress module, no
  server client. The vault is a synthetic-canary stub that never leaves the offscreen document.

## Hypothesis

The trusted-context placement the architecture assumes — ORT and the vault in an offscreen document, a
value-free service worker, an isolated-world content script, browser-attested sender identity, a pinned
`connect-src` — works in a real MV3 extension.

## Environment

| Part | Contents |
|---|---|
| Manifest | `offscreen`, `sidePanel`; content script and host permission on `http://127.0.0.1/*` only; CSP from `buildExtensionPagesCsp` (ADR-0001): `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' http://127.0.0.1:8995`. No `debugger`, no `externally_connectable`, no web-accessible resources |
| Service worker | Creates the offscreen document (`WORKERS`), routes messages, checks senders. **Holds no values.** A `bootId` exists only to detect restarts |
| Content script | Accepts commands only from this extension's service worker. **No `window.postMessage` listener; writes nothing to the page** |
| Offscreen document | `ort.all.min.js` + `entrypoints/ortRuntime.ts` (the sanctioned bootstrap, unchanged); synthetic vault stub; CSP probe |
| Side panel | Inert shell: goal, synthetic profile, disabled grant buttons, Payload Inspector placeholder, status |
| Packaging | ORT's three pinned files and the T1 artifact are copied from `node_modules` / `artifacts` at build time and **not committed** |
| Control plane | Playwright `launchPersistentContext --load-extension`, with measurements through service-worker evaluate (DevTools). No web page can reach it |
| Collectors | B-02's `collector.js` from `main`, unchanged, on the pinned port 8995 and a foreign port 8998 |

## Expected result

Loads in both cells; one offscreen document; ORT output `[1,12,6400]`; `documentId` present; page
cannot reach the extension; foreign origin blocked with zero arrivals; offscreen state survives a
service-worker restart.

## Actual result

| Measure | Chrome for Testing 153.0.8010.12 | Edge 153.0.4234.32 |
|---|---|---|
| Unpacked extension loads, service worker live | yes | yes |
| Offscreen contexts after ensure | 1 | 1 |
| **ORT in the offscreen document** (ADR-0001 pinned WASM, T1 artifact, 1 zero-tensor run) | **ok**, output `[1,12,6400]`; bootstrap 85 ms · session 384 ms · first run 71 ms | **ok**, `[1,12,6400]`; 69 · 378 · 58 ms |
| Sender identity on a content-script message | tabId, frameId 0, origin, **`documentId` present** | same, **`documentId` present** |
| `chrome.runtime.sendMessage` visible to the page's main world | `undefined` | `undefined` |
| Round trip content → SW → offscreen → back (150 samples) | p50 **0.8 ms** · p95 1.2 · max 2.9 | p50 **1.0 ms** · p95 1.4 · max 2.8 |
| `connect-src` probe from the offscreen document | pinned: reached, 1 arrival · **foreign: `TypeError`, 0 arrivals** | same |
| Service worker after **45 s idle** | **not restarted** (same `bootId`) | not restarted |
| Service worker after forced `ServiceWorker.stopAllWorkers` | **restarted** (new `bootId`) | restarted |
| **Offscreen document across both** | **same `instanceId`: survived** | survived |
| Side panel page opened as a tab | renders; its status request was **refused `SENDER_NOT_ACCEPTED`** | same |

**Reading the two surprises correctly:**
- **"Not restarted after 45 s idle" is not evidence that the worker lives forever.** The harness is
  attached through DevTools, which plausibly keeps it alive. Natural termination under automation is
  **UNKNOWN**. What *is* measured is the forced restart, and that the offscreen document, and therefore
  anything held in it, survives it.
- **The side-panel refusal is the host's own sender check working as written.** It accepts extension
  pages only when there is no `sender.tab`, and a side panel opened as a tab has one. The real side-panel
  context (no tab) needs a user gesture to open and was **not measured**. The check failed closed, which
  is the right direction.

## Conclusion

1. **The architecture's context placement is physically viable in MV3, in both cells:**
   - ORT and a vault stub live in an offscreen document that outlives service-worker restarts;
   - the service worker stays value-free;
   - senders are browser-attested, including `documentId` (the identity §14's TYPE contract binds to);
   - pages have no channel in;
   - `connect-src` pins egress pre-wire.
2. **The message path costs about 1 ms** at p50, so a hit-test → value-fetch → insertion sequence adds
   little to the TOCTOU window. That window must still be measured in E6 with real dispatch.
3. **Not established here:**
   - Firefox (no offscreen document, no side panel API; D-J undecided, and no Firefox on W2);
   - natural service-worker termination under automation;
   - the real side-panel context;
   - any dispatch or typing mechanism (that is E6).

## Reproducibility

```bash
npm ci
npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing>" node artifacts/experiments/G-mv3-host/harness/run-host.mjs
```

Headful: an automated browser will open twice for about a minute each. Branded Chrome ignores
`--load-extension` under automation (S-01b), which is why the cells are Chrome for Testing and Edge.
