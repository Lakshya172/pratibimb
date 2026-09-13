---
id: HANDOFF-W1-W2-REPRODUCTION
title: "W1 → W2 handoff — reproduction guide and starting point"
status: handoff record
date: 2026-09-13
---

# Reproduction guide

Every command below was run on W1 at `75e5cd16`, and the result shown is the result observed —
not an expectation.

## 1 · Clone and check out

```bash
git clone https://github.com/ronitsaha11/pratibimb.git
cd pratibimb
git fetch origin
git checkout handoff/w1-to-w2        # or: git checkout main, once this PR has merged
git rev-parse HEAD                    # base of this branch: 75e5cd16147a087236ea206b6af635bd79fbecf2
```

The canonical remote is `https://github.com/ronitsaha11/pratibimb.git` for both fetch and push.
`main` is protected: PRs required, force-push and deletion blocked, **"Governance and secret
hygiene" is a required status check**. Do not force-push, rewrite history, or move a tag.

## 2 · Install prerequisites

| Prerequisite | Version on W1 | Notes |
|---|---|---|
| Node | **v24.19.0** | ≥ 20 expected |
| npm | **12.0.2** | |
| Python | **3.13.14** | only for `scripts/verify-repo.py` and `tools/detector/*.py` |
| A Chromium | Chrome for Testing / Chromium 151.0.7922.34 | browser harnesses only |

```bash
npm ci
```

**Use `npm ci`, never `npm install`.** On W1 the `node_modules` tree had drifted from the
lockfile — `wxt` was in `package-lock.json` but absent from `node_modules`, so `npx wxt build`
silently resolved a temporary copy from the npm cache and failed with a module-resolution error
that looks like a broken config. `npm ci` fixed it. This is the single most likely way to lose an
hour on first contact.

Two postinstall scripts (`esbuild`, `protobufjs`) are blocked by the npm allowlist. That is the
configured policy; the build works without them.

## 3 · Preflight — what can this machine actually do?

```bash
node scripts/verify-handoff.mjs
```

Read-only; installs and downloads nothing. REQUIRED checks gate the exit code; OPTIONAL checks
tell you which experiments the machine can reproduce.

**Observed on W1, 2026-09-13:**

```
[  OK  ] REQ  Node runtime ................... node v24.19.0
[  OK  ] REQ  dependencies installed ......... node_modules present, including wxt and onnxruntime-web
[  OK  ] REQ  ORT artifact matches the pin ... 27797172 B sha256 db816fadbab47a75…
[  OK  ] OPT  detector artifact ............... present, 302960 B, sha256 matches the gate record
[ FAIL ] OPT  dataset t1-ui-rendered .......... absent (gitignored, deterministic)
[ FAIL ] OPT  Chromium for browser harnesses .. Playwright expects chromium-1243, which is absent
required: 3/3 passed · optional: 1/3 available
PREFLIGHT OK
```

Those two OPTIONAL failures are the **true state of W1**, reported rather than hidden.

## 4 · Verify the repository

```bash
npm run verify      # verify-repo.py + pin:check + typecheck + test
```

**Observed on W1 at `75e5cd16`:**

| Stage | Result |
|---|---|
| `python scripts/verify-repo.py` | **PASS** — 0 failures, 0 warnings |
| `npm run pin:check` | **OK** — `ort-wasm-simd-threaded.jsep.wasm` `db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea` |
| `npx tsc -b --force` | **clean**, no diagnostics |
| `npm test` (`vitest run`) | **806 passed · 0 failed · 15 skipped** — 821 total across 41 files |

The 15 skips are pre-existing in `preprocessConformance.test.ts` and are not a handoff artifact.

## 5 · Build the MV3 host

```bash
cd apps/extension && npm run build
```

**Requires `artifacts/models/t1-ui-head/t1-ui-head.onnx`** — the config throws `missing <path>`
without it. Obtain it per [artifact-manifest.md](artifact-manifest.md) §A1 first.

**Observed on W1:** built `chrome-mv3` in 2.9 s, **28.99 MB** total, including
`ort-wasm-simd-threaded.jsep.wasm` (27.80 MB) and `t1-ui-head.onnx` (302.96 kB). One benign
warning: `<script src="/ort.all.min.js"> can't be bundled without type="module"` — expected, the
bundle is copied as an asset by design.

**This is the experimental host, not the product.**

## 6 · Verify hashes

```bash
sha256sum artifacts/models/t1-ui-head/t1-ui-head.onnx
# expect ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0
npm run pin:check
```

**If the detector digest differs, stop.** It is a different artifact and no existing detector
evidence applies to it.

## 7 · Run deterministic experiments

No browser needed:

```bash
node artifacts/experiments/E2-class-binding/harness/run-e2.mjs
node artifacts/experiments/E2-class-binding/harness/mutate-e2.mjs
node artifacts/experiments/E4-leak-instrument/harness/run-e4.mjs
node tools/mutation/permit-core.mjs
```

Browser-backed — run `npm run typecheck` first, since several load `packages/*/dist/`:

```bash
export CHROME_PATH="<path to a Chromium>"     # only if the Playwright browser is absent
node artifacts/experiments/MVP-2-hit-test-verify-result/harness/run-mvp2.mjs
node artifacts/experiments/E6-mv3-dispatch/harness/run-e6.mjs
node artifacts/experiments/E7-visual-deception/harness/run-e7.mjs
node artifacts/experiments/E8-click-postconditions/harness/run-e8.mjs
node artifacts/experiments/G-mv3-host/harness/run-host.mjs
```

**A rerun on W2 produces W2 evidence.** It does not become W1 evidence, and it does not replace
the committed W1 log. Write a new log; never overwrite one.

## 8 · Missing external dependencies

| Dependency | Status | Action |
|---|---|---|
| **Detector artifact** | **not in Git** | copy out of band and verify SHA-256, or retrain (byte-identity not guaranteed) |
| Dataset | regenerable | `node tools/dataset/build-dataset.mjs --counts=120,40,40` |
| Chromium | absent from Git | `npx playwright install chromium`, or `CHROME_PATH` |
| ORT runtime | via npm | `npm ci` |
| Firefox | system install | present on W1; W2 per ENV-0004 has none |
| **vLLM + model weights** | **not installed, not downloaded, not approved** | blocked on D-H, D-I and download approval. **Do not download** |
| Python packages for `tools/detector/*.py` | not pinned in this repo | torch / numpy / onnxruntime; only needed to retrain or regenerate references |

## 9 · Which experiments must be rerun on W2

**Must rerun to be W2 evidence** — every browser-backed experiment, because browser, GPU and
driver differ: MVP-2, E6, E7, E8, Track G, and any detector harness.

**Need not rerun** — the deterministic, machine-independent ones: E2, E4 (Node → loopback), the
permit mutation harness, and the whole unit suite.

**Cannot be rerun anywhere yet** — E9 (blocked at the download boundary) and E1 (no protocol
exists).

---

# W2 starting point

## Already implemented, with tests

VALIDATE + REFRESH (ADR-0005) · HIT-TEST AGREEMENT (ADR-0007) · **single-use dispatch permits**
(ADR-0008) · ACT, click only, permit-gated (ADR-0006) · VERIFY RESULT (ADR-0007) · the composed
`guardedAct` path · the perception substrate · the ORT pin and CSP construction · the evaluation
package.

**`act` accepts only a permit minted after a hit-test MATCH, and `validateAndAct` has been
removed** — so no exported path reaches dispatch without agreement. The individually exported
lower-level functions are still **not** the guarded production path and must not be described as
equivalent to it.

## Experimental only

The MV3 host (`apps/extension/`) · E2's binder · E7's candidate visibility checks · E8's
postcondition proposals · every harness under `artifacts/experiments/`. **None is promoted to
production by this handoff.**

## Absent

SANITIZE · privacy verifier · production egress guard · vault · RE-HYDRATE · production TYPE ·
REASON/server client · PLAN · Plan Ingress · human-grant channel · orchestrator loop · production
`PageActionBridge` / `HitTestBridge` implementations · Planning View.

## Blocked

**E9** (D-H, D-I, download approval) · **E1** (needs an admissible E9 label, plus "D-A"/"D-B"
which **are not defined anywhere in the repository**, plus a Planning View draft that does not
exist) · detector adoption (item 11) · W-A (gate CLOSED) · QG-04 (B-02 open) · B-03 (no vLLM host).

## Current critical path

```
OWNER DECISIONS ──┬─ D-H + D-I + download ──► E9 ──► E1 ──► Planning View ──► Plan Ingress
                  ├─ D-E6-2 / D-E7-2 ───────► extension-transport ACT/HIT-TEST/VERIFY rerun
                  ├─ D-C + D-D ─────────────► E2 held-out ──► SANITIZE ──► Privacy VERIFY
                  └─ D-E7-1..4 / D-E8-1..3 ─► mandatory visibility + effect postconditions
```

## Recommended first task after W2 verifies this handoff

**Re-validate the E4 leak instrument inside the MV3 offscreen document.**

Why this one:

- It is **unblocked today**. The MV3 host exists (PR #69) and the instrument is validated
  (PR #65); nothing else is waiting on an owner decision.
- E4's own decision record already requires it: the PASS licenses measurement *"after
  re-validation in the cell of use (the MV3 offscreen document)"*. Until that happens, the
  instrument is validated in a cell nobody ships.
- It is the only route to **B-02**, which has been open since 2026-09-07 and keeps **QG-04
  unsigned** — the gap is that Playwright cannot observe egress from the offscreen document.
- It touches no production code, needs no real data, no credentials and no external site.
- Its standing rule is already written: reuse `SCANNER_VERSION` identity
  `96979ebde6774f734fa14e4ae94dcabc33c962358874e850148cdccb0f0b6fab` (LF-normalised) unchanged —
  **a scanner change requires a new version, a fresh seed block and a full re-run.** Include
  synthetic canaries, known transports, exact byte collection with SHA-256, a **live sentinel in
  every run**, and the same declared blind spots.

**A PASS would mean the instrument measures leakage in the cell the product uses. It would still
not be a privacy claim about PratiBimb.**

Second choice, if a browser is unavailable on W2: author the **E2 held-out protocol** — but note
the cases must be written by someone other than the original harness author, so it needs a person
assigned before it can finish.
