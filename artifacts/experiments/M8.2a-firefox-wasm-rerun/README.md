# M8.2a — amended Firefox liveness, and the Firefox WASM (Linux) re-run

> **W1 only, 2026-09-30.** Owner authority: Ronit Saha — remove the MV3 background-idle liveness
> confound M8.2 identified, and re-run the required **Firefox WASM (Linux)** QG-03 cell for **both**
> TR-01 and TR-02. It answers one question: *under a deterministic, non-idling Firefox Linux harness,
> what happens to the required QG-03 WASM cell for both candidates?*
>
> **Answer: ACCEPT for both, 6/6 launches each.** Every output and box is byte-identical to M8.1 and
> to M8.2's completed launches. RE-1 passes, with 0 / 306 sensitive glyphs exposed. With only this
> cell replaced, QG-03 reads **TR-01 PASS (unchanged)** and **TR-02 PASS (was FAIL)**. Both are
> **eligible for adoption review**. Neither is adopted or ranked.
>
> **M8.2 is historical evidence and is not edited.** This experiment is additive.

- **Protocol (frozen first):** [`protocol.md`](protocol.md) — committed in `1cc058f` before any
  M8.2a launch
- **Per candidate:** [`TR-01.md`](TR-01.md) · [`TR-02.md`](TR-02.md) · **Decision:** [`decision.md`](decision.md)
- **Evidence:** `results/` (re-run launches, `m82a-summary.json`) · `results/validation/` and
  `results/validation-summary.json` (harness validation, never QG-03 evidence) ·
  `logs/environment.json`
- **Harness:** `harness/amendment.mjs` (the amendment as data, 7 tests in
  `tests/browser/support/m82a-amendment.test.mjs`) · `harness/run-m82a.sh` ·
  `harness/aggregate-m82a.mjs` · M8.2's `browser/run-firefox.mjs` (recording-only additions)

## Hypothesis

That the one launch M8.2 recorded as silent was the Firefox idle confound and not the model. If so,
under an amended harness that removes only that confound, the Firefox WASM (Linux) cell reproduces
the same outputs M8.1 and M8.2 recorded, in every launch, for both candidates.

**What would falsify it:** any amended launch that fails to report, is incorrect, or differs from
M8.1 or M8.2 in output or boxes. A failure would count **for either candidate** — TR-01's M8.2
ACCEPT is not protected.

## The amendment — exactly one pref

`--pref extensions.background.idle.timeout=900000` is added to each launch's `web-ext run`
invocation. It applies only inside that launch's temporary profile, which `web-ext` copies and then
discards. The value is the one M8.2's diagnostic established, and it equals the runner's unchanged
900 s deadline. The installed Firefox, Windows Firefox and every other pref are untouched.

**Why it is technically justified:** Firefox reads this pref in its background-page idle manager,
and M8.2's A/B showed it is the variable that decides whether an over-30 s probe can report (0/4
against 4/4). The probe does ~25–36 s of uninterrupted WebAssembly work with no extension event, so
the default limit terminates some launches regardless of the model. Raising the limit removes the
termination. It changes no computation, and V2 below proves that byte for byte.

**Recording-only runner additions** (defaults unchanged, M8.2 records untouched):

- `--out-dir` and `--experiment`;
- the redacted `web-ext` args and the running profile's `user.js` pref lines, per launch;
- the Firefox version after the run.

## Harness validation (protocol §3) — not QG-03 evidence

| test | result |
|---|---|
| **V1** amended probe at `warm=40` | TR-01 ran **56.1 s**, TR-02 **44.6 s** inside the event page; both reported and were correct |
| **V2** default vs amended ordinary launch (TR-01) | **attempt 1: NOT EVALUABLE** (see Deviations) · **attempt 2:** running profiles differ by exactly `user_pref("extensions.background.idle.timeout", 900000)` — 71 vs 72 prefs, nothing removed; web-ext args differ by exactly that `--pref`; every output, box and the synthetic output identical |
| **V3** amended teardown + coexistence, each candidate | teardown plateau (grows 11/10, then 0), output hash = M8.2's Linux teardown; coexistence bit-identical, solo hashes = M8.2's Linux coexistence |
| **product side** | bundle byte-identical, no change under `apps/` or `packages/*/src` (repository gates) |

## Environment

| | |
|---|---|
| Workstation | W1 `LAPTOP-6E14K34L` (W2 not used) |
| WSL | 2.6.3.0, WSLg 1.0.71; guest **Ubuntu 26.04.1 LTS**, kernel 6.6.87.2-microsoft-standard-WSL2 |
| Firefox (Linux) | **155.0.1** before and after every invocation; `rv:155.0` in every report; the M8.2 tarball, not modified |
| Driver | `web-ext` 8.3.0 (committed lockfile) |
| Extension | M8.2's Firefox builds, reused unchanged. `m82-ref.js` hash equals M8.2's build record; `candidate.onnx` equals the frozen hashes; the probe hash-checks the model and every input in every launch |
| Windows Firefox | **not touched, not run.** M8.2's 156.0.1 deviation stays documented in M8.2 |

## Expected result

If the hypothesis holds: 6/6 reports per candidate, relErr identical to M8.1 on every input,
outputs and boxes byte-identical to M8.1 and M8.2, RE-1 unchanged.

## Actual result

| | TR-01 | TR-02 |
|---|---|---|
| launches reported / correct | **6/6 · 6/6** (0 timed out) | **6/6 · 6/6** (0 timed out) |
| cell | M8.2 ACCEPT → **ACCEPT** | M8.2 CONDITIONAL → **ACCEPT** |
| fixed-fixture relErr | 6.52e-07, identical in all launches | 6.87e-07, identical in all launches |
| worst realistic relErr | 4.08e-06 | 1.10e-05 |
| output shape / count | 1×1×640×1024 / equal | 1×1×736×1312 / equal |
| vs M8.1 WASM · vs M8.2 Linux | **byte-identical · byte-identical** (outputs and boxes, 7 realistic inputs) | **byte-identical · byte-identical** (vs M8.2's 5 completed launches) |
| determinism | within and across all 6 launches | within and across all 6 launches |
| RE-1 | G1 0/306 · G2 0.376 · G3 0.046 · G4–G6 pass · **PASS** | G1 0/306 · G2 0.175 · G3 0.045 · G4–G6 pass · **PASS** |
| longest probe runtime | 29.5 s | **36.3 s** (reported only because of the amendment) |
| P50 headful / headless (characterisation) | 462 / 523 ms | 616 / 613 ms |
| foreign network requests | 0 | 0 |

**The confound is visible inside the formal re-run.** A TR-02 launch ran 36.3 s and another 30.2 s.
Both reported only because the idle limit was raised. TR-01's longest was 29.5 s, just under the
limit, so its M8.2 PASS had been exposed to the same risk.

**The outputs did not change.** There is no M8.2-vs-M8.2a numerical difference to explain: the
completed launches of both experiments are the same bytes.

## Deviations — disclosed

1. **V2 attempt 1 was not evaluable.** `web-ext` copies `--firefox-profile` into its own temporary
   profile, so the runner's directory held no `user.js` to read. The runner now reads the running
   Firefox's own `-profile` through `/proc`, and V2 was repeated as attempt 2. Attempt 1 is kept
   (`results/validation/v2-*`); it shows identical outputs and args that differ only by the
   amendment. The re-run began only after attempt 2 passed.
2. **M8.2's process reaper never matched a process**, for the same reason. It was harmless:
   `web-ext` terminates Firefox itself. This is recorded, not changed.

## Conclusion

| | |
|---|---|
| **Firefox WASM (Linux), amended** | **TR-01 ACCEPT · TR-02 ACCEPT** |
| **QG-03, only this cell replaced** | **TR-01 PASS · TR-02 PASS** |
| **Status** | both **ELIGIBLE FOR ADOPTION REVIEW**, independently; neither adopted, integrated or ranked |
| **M8.2** | unchanged as history. Its Linux cell for TR-02 is **superseded for adoption review** by this clean result |
| **NOT YET VERIFIED** | product visual-only PII protection; any product integration |

## Reproducibility

```bash
bash artifacts/experiments/M8.2a-firefox-wasm-rerun/harness/run-m82a.sh validate
bash artifacts/experiments/M8.2a-firefox-wasm-rerun/harness/run-m82a.sh validate-v2b
bash artifacts/experiments/M8.2a-firefox-wasm-rerun/harness/run-m82a.sh rerun
node artifacts/experiments/M8.2a-firefox-wasm-rerun/harness/aggregate-m82a.mjs
```

This needs M8.2's git-ignored extension builds and fixtures (`M8.2/browser/prepare-fixtures.mjs`,
`build-extension.mjs`) and the WSL2 guest described in `logs/environment.json`.
