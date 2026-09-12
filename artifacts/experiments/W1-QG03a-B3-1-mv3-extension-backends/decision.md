# QG-03a-B3-1 — decision record

## Verdict

**QG-03a-B3-1 = PASS**, measured on **workstation 1**, in all four MV3 extension cells.

Four statements, deliberately kept apart, because collapsing them is the whole risk here:

| | |
|---|---|
| **Harness implementation** | **COMPLETE and TESTED.** 21 unit tests; both fail-closed paths exercised against real evidence |
| **B3-1 measurement** | **PASS.** Four workstation-1 cells, against a native ORT 1.29.0 CPU reference, on the approved 18-fixture UI gating corpus |
| **QG-03a-B** | **still CONDITIONAL.** B3-1 closes the extension context and the Intel cell; **B3-2 (NVIDIA) is unmeasured** |
| **QG-03a / QG-03** | **OPEN / CONDITIONAL.** Not closed by this result. The detector remains **UNADOPTED** |

**B3-1 = PASS does not mean QG-03a is closed, QG-03 is closed, the detector is adopted, or the
project is submission-ready.** None of those follow, and none is claimed.

## Governance — B1 and B4 are APPROVED

| gate | status | what was approved |
|---|---|---|
| **QG-03a-B1** | **APPROVED by ronitsaha11** | the criterion below, reused unchanged for backend-noise robustness |
| **QG-03a-B4** | **APPROVED by ronitsaha11** | the fixture scope below |

**Approved interpretation, recorded verbatim:**

- the **18 UI fixtures are the gating corpus** — the adoption gate is decided on these alone;
- **all 20 fixtures are executed and reported**, and none is dropped;
- **`gradients-edges` (2 fixtures, headful and headless) is STRESS-ONLY**;
- **stress fixtures do not decide the UI adoption gate.**

**No numerical threshold changed, and no new criterion was invented.** B1 approves *applying* the
QG-03b-2 numbers to backend-noise robustness; the numbers themselves are inherited. The 20-fixture
result is **analytical** and is **not** the gate.

**Provenance of the approval, stated plainly rather than dressed up:** the owner (`ronitsaha11`)
gave this approval as a direct instruction during the workstation-1 session of 2026-09-12, and this
document is the record of it. Unlike [ADR-0002](../../../docs/adr/ADR-0002-t1-capture-format-policy.md),
which was approved by the owner *merging* PR #41 (`27d71e3`), there is no prior merge or issue
comment to cite — the auditable act is the owner merging the PR that carries this file. A reader
who needs a stronger artifact than an in-session instruction should treat that merge as the
approval, exactly as ADR-0002 is treated.

## The measurement

| | |
|---|---|
| machine | **workstation 1**, `LAPTOP-6E14K34L`, Intel Core 7 240H, Windows 11 build 26200 |
| browser | **Chrome for Testing 151.0.7922.34**, headful, throwaway profile per launch |
| runtime | **ORT Web 1.29.0**, production pin `db816fad…`, `numThreads 1`, verified **in each realm** |
| reference | **native onnxruntime 1.29.0** CPU, 1 thread — the script refuses any other version (exit 3) |
| model | **`ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0`**, 302,960 B, re-verified inside every realm; never regenerated, modified or committed |
| fixtures | the **20** committed lossless PNG captures, hash-verified per run; **18 UI gating**, 2 stress |
| repetitions | 3 per fixture per cell; **all byte-identical** |

### The four cells, each judged independently

| cell | realm | GPU submits | adapter | worst displacement | true failures | UI-18 |
|---|---|---|---|---|---|---|
| **A** | offscreen document | **0** | — | 0.001477 px | **0** | **18/18** |
| **B** | offscreen document | **180** | **`intel / gen-12lp`** | 0.002893 px | **0** | **18/18** |
| **C** | dedicated worker | **0** | — | 0.001477 px | **0** | **18/18** |
| **D** | dedicated worker | **180** | **`intel / gen-12lp`** | 0.002893 px | **0** | **18/18** |

Against the native reference, every cell: **100% matched at IoU 0.5, count change 0, 0 survivor
swaps, 0 true failures**, in **both** the shipped and the 0.55 views. Worst displacement across all
cells is **0.002893 CSS px** against a 2.0 px bound — inside it by a factor of ~690.

No cross-cell transfer: each cell is compared only to the reference, and `document` vs `worker` is
reported but never gating. The two realms are **bitwise identical** (raw difference exactly 0 on
20/20, both backends), as they were on workstation 2 — a reason to keep measuring the distinction,
not to drop it.

**Input tensors are identical across all five cells and equal to the committed digests, 20/20**, so
every difference above is backend arithmetic and not preprocessing.

### Complete 20-fixture corpus — analytical, not the gate

**20/20 in every gating pair, both views**, same worst displacement, 0 true failures. The stress
fixtures do not change the outcome; they were not permitted to decide it.

### gradients-edges — STRESS-ONLY

Ref 300 → 300 (saturated at the 300 cap), count delta 0, matched 300/300, worst displacement
0.000934 px, 0 true failures. **It passes at the real difference**, and it still did not decide the
gate. Margin: it first fails at **5×** the measured difference (workstation 2 recorded 2×);
`text-heavy` at 100×, `realistic-ui` at 50×; every other fixture never fails up to the cap.
Escalations: **none**.

## What this closes, and what it does not

**Closes:** B2's limitation 3 (a page, not the extension) and its workstation-1 coverage gap **for
Intel**. The extension context is now measured, in both realms, with the backend proved by counted
submits rather than inferred from configuration.

**Does not close:** QG-03a-B. **`QG-03a-B3-2` is `NOT MEASURED / OPTIONAL COVERAGE`** — Chrome selected the
Intel `gen-12lp` adapter on this machine, so the RTX 5050 was never exercised. That is an absence
of evidence and is recorded as such; it is **not** a failure, and no NVIDIA cell was simulated,
fabricated or inferred.

**Update 2026-09-12 — owner decision on NVIDIA coverage (ronitsaha11).** The governing
feasibility axis is **model × browser × backend**; the dossier defines **no GPU-vendor axis**. An
NVIDIA-backed cell is therefore **not a mandatory acceptance cell** for QG-03a-B, and **B3-1's
Intel `gen-12lp` WebGPU cell stands as the required WebGPU evidence**. NVIDIA execution remains
**NOT MEASURED / OPTIONAL COVERAGE**: its absence affects **coverage and labelling only**, it does
**not** invalidate B3-1, and **no NVIDIA compatibility or performance claim may be made**. No
retroactive mandatory B3-2 gate was created, and no numerical threshold changed.

**Two confounds, recorded rather than buried.** The browser is Chrome for Testing **151.0.7922.34**,
not the 153.0.8010.12 that Playwright 1.63 would fetch, because `npx playwright install` fails on
this machine (a workstation-1 environment limitation, not a harness defect); the cells ran via
`CHROME_PATH`, which the harness supports. Workstation 2's B2 and B3-1 development runs used
Chrome 153. And **"workstation 1 WebGPU" means Intel**, not NVIDIA.

## Evidence

Committed: `logs/workstation-1/` — the five cell logs, the analysis, and the decoded detections
(`detections/`, which `.gitignore` explicitly requires a workstation-1 run to commit).

**Raw `.f32` dumps are gitignored and are NOT committed**, and they were not deleted. 100 dumps
(5 cells × 20 fixtures, ~30 MB) are archived outside Git at:

```
C:\Users\RONIT\pratibimb-b31-evidence\QG-03a-B3-1\workstation-1
```

The analysis is reproducible from that archive: re-running it changed only `runAt`.

## What is NOT done

- No NMS, decoder, threshold, preprocessing or model change. The model was not regenerated,
  retrained, modified or committed. The frozen **0.55** operating point is untouched.
- The 20 fixtures were not regenerated; they are read and hash-verified on every run.
- **The harness was not modified.** No evidence-integrity defect was found, so nothing was touched.
- The held-out split, the model registry and adoption status are untouched. The detector stays
  **UNADOPTED**.
- No security change: ADR-0001, the CSP builder, `connect-src`, the ORT pin, the egress verifier,
  B-02 and QG-04 are as they were. The harness is loopback-only and is not product code.
- No status was promoted beyond the measurement: **B1 APPROVED, B4 APPROVED, B2 PASS (workstation 2),
  B3-1 PASS (workstation 1), B3-2 NOT MEASURED, QG-03a-B CONDITIONAL, QG-03a-C CONDITIONAL,
  QG-03a OPEN, QG-03 CONDITIONAL, detector UNADOPTED, QG-04 unsigned, B-02 open.**

## Follow-ups

| id | item |
|---|---|
| **QG-03a-B3-2** | **NOT MEASURED / OPTIONAL COVERAGE** (owner decision, 2026-09-12; not a mandatory acceptance cell). An NVIDIA-backed browser cell. Chrome chose Intel `gen-12lp` on workstation 1; forcing the discrete GPU is a distinct cell, not a re-run of B3-1 |
| QG-03a-B | remains CONDITIONAL. **Update 2026-09-12:** the owner accepted Intel-only WebGPU coverage as the required evidence, so **B3-2 no longer gates it**. Promoting QG-03a-B is a **separate architect decision** and is **not** recorded yet |
| QG-03a-C | unchanged, CONDITIONAL |
| B3-1-env | workstation 2's Playwright browser directory is broken, and `npx playwright install` also fails on workstation 1; both machines need `CHROME_PATH` |
| adoption 11, 14 | acceptable metrics and usable grounding, untouched by B3-1 |
