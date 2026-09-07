# B-02 — commands and raw output

All commands run in Git Bash on workstation 2 (see [`environment.json`](environment.json)),
2026-09-07.

## Setup

```bash
npm install playwright@1.63.0        # 1.63.0
```

Node's built-in `WebSocket` (Node >= 22) is used for the raw CDP client — no `ws` dependency.
Browser: branded **Microsoft Edge 152.0.4191.66**, headful, driven via Playwright
`channel: "msedge"` with `--remote-debugging-port=9444`.

## 1. The five-case mechanism matrix

```bash
node run-b02.js        # -> results.json  (committed as logs/results-mechanisms.json)
```

```
=== A-observe-authorised ===
{ "m1_observed": 0, "m1_blocked": 0, "m1_surfacesOffscreen": false,
  "m2_attached": true, "m2_targetType": "background_page", "m2_observed": 1, "m2_blocked": 0,
  "m3_arrived": ["/egress hashMatches=true declared=true"] }

=== B-observe-unauthorised ===
{ "m1_observed": 0, "m1_blocked": 0, "m1_surfacesOffscreen": false,
  "m2_attached": true, "m2_targetType": "background_page", "m2_observed": 1, "m2_blocked": 0,
  "m3_arrived": ["/rogue hashMatches=null declared=false"] }

=== C-observe-tampered ===
{ "m1_observed": 0, "m1_blocked": 0, "m1_surfacesOffscreen": false,
  "m2_attached": true, "m2_targetType": "background_page", "m2_observed": 1, "m2_blocked": 0,
  "m3_arrived": ["/egress hashMatches=false declared=true"] }

=== D-block-with-playwright ===
{ "m1_observed": 0, "m1_blocked": 0, "m1_surfacesOffscreen": false,
  "m2_attached": true, "m2_targetType": "background_page", "m2_observed": 1, "m2_blocked": 0,
  "m3_arrived": ["/egress hashMatches=true declared=true"] }

=== E-block-with-cdp ===
{ "m1_observed": 0, "m1_blocked": 0, "m1_surfacesOffscreen": false,
  "m2_attached": true, "m2_targetType": "background_page", "m2_observed": 1, "m2_blocked": 1,
  "m3_arrived": [] }
```

The three lines that carry the result:

- **Case D** — Playwright was told to abort every request to the collector. It blocked
  **zero**, and the payload **arrived**.
- **Case E** — CDP `Fetch.failRequest` on the offscreen target blocked **one**, and the
  collector received **nothing**. A real block, confirmed from outside the browser.
- **Case C** — the collector recomputed SHA-256 over the received bytes and reported
  **`hashMatches=false`** against the hash the sender declared. The payload-pin violation was
  caught externally.

Case B is the unauthorised-sender check: the rogue request arrived with
`declared=false` — no correlation id, no declared hash. An arrival without egress-module
provenance is detectable without trusting anything inside the browser.

## 2. The regression guard

```bash
node regression/false-green-guard.js     # -> regression/guard-result.json
```

```
{ "total": 3, "groundTruthDetected": 3, "falseGreenReproduced": 3,
  "playwrightNowSeesIt": 0, "verdict": "PASS" }
  run 1: playwright observed=0 blocked=0  |  actually arrived=1
  run 2: playwright observed=0 blocked=0  |  actually arrived=1
  run 3: playwright observed=0 blocked=0  |  actually arrived=1

PASS: independent arrival check detected egress that a Playwright-only
      assertion reported as absent, in 3/3 runs.
```

Exit code **0** on PASS, **1** on FAIL. The assertion is on **our methodology**: it fails if
the independent arrival check ever stops detecting offscreen egress. It deliberately does
**not** assert that Playwright stays blind — pinning a third-party bug would make the suite
fail on an upstream fix. If Playwright gains offscreen coverage, the guard still passes and
prints a notice to re-evaluate B-02.

Run it with a different repeat count:

```bash
RUNS=5 node regression/false-green-guard.js
```

## 3. Target visibility, for the record

The mechanism matrix records this in every case:

| Surface | Sees the offscreen document? |
|---|---|
| `context.pages()` | NO |
| `context.backgroundPages()` | NO |
| **CDP `Target.getTargets`** | **YES** — `type: "background_page"` |

which is why M2 uses a raw CDP session (`Target.attachToTarget` with `flatten: true`, then
`Fetch.enable` on the returned `sessionId`) rather than Playwright's `newCDPSession`.

## Data and cleanup

Payloads are synthetic and deterministic —
`{"marker":"authorised|unauthorised|authorised-MUTATED","frame":"SYNTHETIC","n":4242}`.
**No PII, no secrets, no real capture data.** Every browser profile is created under the
system temp directory and deleted after each run. The harness contacts no host other than
`127.0.0.1:8902` (collector) and `127.0.0.1:9444` (CDP).
