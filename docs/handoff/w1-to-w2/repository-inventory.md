---
id: HANDOFF-W1-W2-INVENTORY
title: "W1 → W2 handoff — repository inventory"
status: handoff record
date: 2026-09-13
---

# Repository inventory

At `75e5cd16`. 863 tracked files, 5.86 MiB packed.

## Directories

| Path | What lives there | Transferred by clone? |
|---|---|---|
| `packages/perception/` | the perception substrate: capture, coordinates, letterbox, preprocess, element graph, fusion, detector decode, change detection | **yes** |
| `packages/agent/` | the execution loop that exists: VALIDATE/REFRESH, HIT-TEST, the dispatch permit, ACT, VERIFY RESULT | **yes** |
| `packages/security/` | CSP construction, the ORT runtime pin, WASM capability checks | **yes** |
| `packages/evaluation/` | dataset, generator, labels, evaluator, baselines, thresholds | **yes** |
| `apps/extension/` | **the minimal MV3 host — experimental, not the product** | **yes** (build needs the model, see below) |
| `artifacts/experiments/` | 40 experiment directories: harnesses, committed logs, `decision.md` verdicts | **yes** (except `generated/`) |
| `artifacts/gates/` | frozen gate records: QG-02, QG-05, T1 fusion, T1 training | **yes** |
| `artifacts/environment/` | ENV-0002/0003/0004 machine records | **yes** |
| `artifacts/governance/` | D5 source registry, D2 protocol, the real-world collection gate | **yes** |
| `artifacts/reviews/` | AUDIT records | **yes** |
| `artifacts/adr/` | per-ADR evidence | **yes** |
| `docs/architecture/` | constitution, action schema, coordinate contract, manifest schema, preprocessing contract | **yes** |
| `docs/security/` | security invariants, threat model, WASM provenance | **yes** |
| `docs/adr/` | ADR-0001 … ADR-0008 and the index | **yes** |
| `docs/testing/` | benchmark contract, threshold selection | **yes** |
| `docs/operations/` | git workflow, repository structure | **yes** |
| `docs/dossier/` | the frozen v4.0 dossier (PDF + text) | **yes** |
| `agentos/` | `state.md`, `blockers.md`, registries, gates, templates | **yes** |
| `tools/dataset/` | the deterministic dataset builder | **yes** |
| `tools/detector/` | training, reference and evaluation scripts (Python + Node) | **yes** |
| `tools/mutation/` | mutation harness for the permit core | **yes** |
| `tests/browser/` | browser fixtures, including the QG-02 coordinate fixture | **yes** |
| `scripts/` | `verify-repo.py`, `check-secrets.sh`, `generate-ort-pin.mjs`, and the new `verify-handoff.mjs` | **yes** |
| `artifacts/models/` | **the detector artifact — gitignored, NOT transferred** | **no** |
| `artifacts/datasets/` | **generated dataset — gitignored, regenerable** | **no** |
| `node_modules/`, `dist/`, `.output/`, `.wxt/` | build output | **no** |

## Entry points

| Package | Entry | Notable exports |
|---|---|---|
| `@pratibimb/perception` | `packages/perception/src/index.ts` | `buildElementGraph`, `preprocessToTensor`, `decodeHeadOutput`, `computeLetterbox`, `PROVISIONAL_THRESHOLDS` |
| `@pratibimb/agent` | `packages/agent/src/index.ts` | `guardedAct` *(the composed path)*, `validateActionFreshness`, `establishHitAgreement`, `mintDispatchPermit`, `act`, `verifyActionResult` |
| `@pratibimb/security` | `packages/security/src/index.ts` | `buildExtensionPagesCsp`, `ORT_PIN`, `assertOrtRuntimePinned` |
| `@pratibimb/evaluation` | `packages/evaluation/src/index.ts` | `evaluate`, `sealDataset`, `taxonomy` |
| MV3 host | `apps/extension/wxt.config.ts` → `apps/extension/host/` | background · content · offscreen · sidepanel |

**`guardedAct` is the composed path.** `act` accepts only a permit that the gate minted after a
hit-test MATCH, and `validateAndAct` has been removed — but the individually exported lower-level
functions are **not** equivalent to the guarded production path and must not be described as such.

## Commands

| Purpose | Command |
|---|---|
| Install | **`npm ci`** (never `npm install` — see the handoff README) |
| Full verification | `npm run verify` → `verify-repo.py` + `pin:check` + `typecheck` + `test` |
| Types only | `npm run typecheck` (`tsc -b --force`) |
| Tests only | `npm test` (`vitest run`) |
| ORT pin | `npm run pin:check` · regenerate with `npm run pin:generate` |
| Repository structure/links/YAML | `python scripts/verify-repo.py` |
| Secret scan (staged) | `bash scripts/check-secrets.sh` |
| **Handoff preflight** | `node scripts/verify-handoff.mjs` |
| MV3 host build | `cd apps/extension && npm run build` (**requires the model**) |
| Dataset | `node tools/dataset/build-dataset.mjs --counts=120,40,40` |

### Experiment commands

Deterministic, no browser:

```bash
node artifacts/experiments/E2-class-binding/harness/run-e2.mjs
node artifacts/experiments/E2-class-binding/harness/mutate-e2.mjs
node artifacts/experiments/E4-leak-instrument/harness/run-e4.mjs
node tools/mutation/permit-core.mjs
```

Browser-backed — need a Chromium and, on W1, `CHROME_PATH`:

```bash
node artifacts/experiments/MVP-2-hit-test-verify-result/harness/run-mvp2.mjs
node artifacts/experiments/E6-mv3-dispatch/harness/run-e6.mjs
node artifacts/experiments/E7-visual-deception/harness/run-e7.mjs
node artifacts/experiments/E8-click-postconditions/harness/run-e8.mjs
node artifacts/experiments/G-mv3-host/harness/run-host.mjs
```

Several harnesses load `packages/*/dist/`, so run `npm run typecheck` first.

## Files that must NOT be written by hand

| File | Produced by |
|---|---|
| `packages/security/src/generated/ortPin.ts` | `npm run pin:generate` — the header says so |
| `artifacts/datasets/**` | `tools/dataset/build-dataset.mjs` at seed `20260910` |
| `artifacts/models/t1-ui-head/t1-ui-head.onnx` | `tools/detector/train.py` |
| every `artifacts/experiments/**/logs/*.json` | its harness. **Editing one fabricates evidence** |
| `.output/`, `dist/`, `.wxt/`, harness `generated/` and `ext-chrome/` trees | builds and harness runs |

## Known unfinished components

Absent by design, each recorded in `agentos/state.md` and `AUDIT-0005`:

SANITIZE · privacy verifier · production egress guard · vault · RE-HYDRATE · production TYPE ·
REASON / server client · PLAN / planner · Plan Ingress · human-grant channel · orchestrator loop ·
production `PageActionBridge` / `HitTestBridge` implementations (both are **interfaces**; the only
implementations are harness adapters) · Planning View (no document exists).

## Blocked items

| Item | Gate |
|---|---|
| **E9** server feasibility | stopped at the weight-download boundary; needs D-H (quantisation), D-I (host), download approval |
| **E1** representation experiment | no directory exists; needs an admissible E9 label, plus decisions "D-A"/"D-B" that are **not defined anywhere in the repository**, plus a Planning View draft that does not exist |
| Detector adoption | item 11 FAIL; needs W-A |
| W-A real-data collection | gate **CLOSED**, 0 of 11 substantive conditions |
| QG-04 | unsigned; **B-02** open (Invariant E mechanism 2 coverage gap) |
| B-03 | no vLLM host |
| E2 → production binder | needs an independently authored held-out table |
| E7 → production checks | pre-registered GO not met; D-E7-1..4 open |
| E8 → effect postconditions | D-E8-1..3 open |

## Preserved architectural constraints

Unchanged by this handoff and not to be weakened: the central egress invariant · exact
outbound-byte verification · **CSS viewport pixels as the canonical coordinate space** · explicit
capture/device/document conversion · change-detection rules · fail-closed behaviour ·
**permit-based action authority** · **HIT-TEST before dispatch** · **single-use dispatch permits** ·
post-action verification · the model as a proposal and never a security authority · network
authority at privacy VERIFY + egress guard · page-effect authority at the execution gate · human
authority for high-risk actions · **no selector fallback** replacing geometry/hit-test authority ·
**no `el.click()` as the production click path** · no silent permit bypass.
