# ADR-0001 — implementation gate evidence

Raw output from the gate runs that ADR-0001 §12 conditions its approval on.
Recorded here rather than under `tests/`, because the harness regenerates its own
`build/` and `results/` on every run and neither is a source of truth.

| File | What it records |
|---|---|
| `gate-run.log` | Console output of the gate runs, both browsers |
| `gates-chromium.json` | Per-context G1/G2/G3 results and the full arrival log, Chromium |
| `gates-firefox.json` | The same, Firefox |
| `b02-regression-guard.json` | The B-02 false-green regression guard, re-run against this branch |

## How to reproduce

```
npm ci
npm run verify                                   # verify-repo, pin:check, typecheck, unit tests
node tests/browser/gates/run-gates.mjs           # Chromium
node tests/browser/gates/run-gates.mjs --browser=firefox
```

The B-02 guard lives with its original experiment and needs Playwright resolvable, which
after the pnpm→npm move means pointing `NODE_PATH` at a harness that has it:

```
NODE_PATH=artifacts/experiments/W1-S02a2a4-connect-src-provenance/harness/node_modules \
  node artifacts/experiments/W1-B02-invariant-e-observation/harness/regression/false-green-guard.js
```

## Reading the numbers

**`contexts` differs by browser and that is expected.** Chromium reports 3, Firefox 2.
Firefox MV3 has no offscreen document. This is a platform difference, not missing coverage.

**`foreignOriginPreflights` is reported separately and is excluded from the verdict.**
A CORS preflight is an `OPTIONS` request that carries no custom header. Counting preflights
as real requests produced a wrong conclusion once already during S-02a-2a-4, so the verdict
uses GETs only.

**`allowedOriginGETs` is the observer sanity control, and it must be non-zero.** Zero
foreign requests, observed by an observer that has demonstrably seen nothing at all, is not
evidence of blocking. When the allowed origin is also silent the harness reports FALSE
GREEN instead of passing.

**The B-02 guard PASSES by detecting a false green, not by being quiet.**
`falseGreenReproduced: 3` means the failure mode S-01b found is still live and still caught:
Playwright reported no request while the wire recorded arrival, three times out of three. If
this ever reports `playwrightNowSeesIt`, Playwright has gained coverage and the guard says
so rather than failing.

## What is NOT evidenced here

- **Firefox on Linux remains UNKNOWN.** Every run above is Windows. Nothing here promotes
  that cell, and it must not be read as doing so.
- **G4b is a build-time check.** It proves the shipped bundle still matches the pin. It does
  not, and cannot, statically prove which `.wasm` a minified bundle fetches — that mapping
  is experimental, from W1-S02a-2a-3.
- **Multi-threaded ORT (S-02a-2a-3a) is uncovered.** The runtime pins `numThreads = 1` so
  it cannot silently take an unmeasured path.
