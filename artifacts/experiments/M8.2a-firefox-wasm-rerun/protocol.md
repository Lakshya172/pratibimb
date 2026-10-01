# M8.2a — protocol: amended Firefox liveness, and the Firefox WASM (Linux) re-run

> **Status: FROZEN before any M8.2a launch.** Committed with the amendment and its harness. M8.2 is
> historical evidence and is not edited: its results, verdicts and records stay exactly as
> committed in `627f118`.
>
> **Owner authority:** Ronit Saha, 2026-09-30 — M8.2a authorised to remove the identified MV3
> background-idle liveness confound and re-run the required **Firefox WASM (Linux)** cell for
> **both** TR-01 and TR-02. Not a rescue, not relaxed criteria, not adoption, not ranking.

## 1. Why

M8.2's diagnostic established that Firefox 155.0.1 at release defaults does not let a probe that
runs past the MV3 background idle timeout report from an event page. Over-30 s probes reported 0/4
at defaults and 4/4 with only `extensions.background.idle.timeout` raised, for both candidates. One
TR-02 launch in the required Linux cell failed with exactly that symptom, so that cell's result
cannot be read as model evidence.

## 2. The amendment — the only thing that changes

| | |
|---|---|
| what | `--pref extensions.background.idle.timeout=900000` added to the `web-ext run` invocation of every M8.2a launch |
| where it applies | the **temporary profile** `web-ext` creates for that one launch, which is deleted afterwards. The installed Firefox and every other pref are untouched |
| value | 900 000 ms — the value M8.2's diagnostic used, and equal to the runner's unchanged 900 s per-launch deadline |
| defined in | `harness/amendment.mjs` (`AMENDMENT.arg`), used verbatim by `harness/run-m82a.sh` |
| unchanged | model, fixture, preprocessing, post-processing, ORT runtime and pin, probe logic (`m82-probe.js`), output validation, the 2e-2 bound, launch count, timing definitions, the extension build (M8.2's, reused and hash-checked in every launch by the probe itself), the runner's deadline |

**Runner changes that are recording only, with defaults unchanged** (`M8.2/browser/run-firefox.mjs`):

- `--out-dir` and `--experiment`, so M8.2a records live in this directory and never enter M8.2's
  aggregate;
- each launch now also records its `web-ext` arguments (paths redacted) and the pref lines of its
  temporary profile's `user.js`;
- the Firefox version is read after the launches as well as before.

## 3. Validation of the amendment — harness evidence, never QG-03 evidence

All launches in Linux headless, recorded under `results/validation/`:

| # | test | pass criterion |
|---|---|---|
| **V1** | amended probe at `warm=40`, each candidate | it runs **past 30 s** inside the event page **and reports**, and is correct |
| **V2** | TR-01: one ordinary cell launch at defaults, one amended | both report; the profiles' `user.js` differ by **exactly** `AMENDMENT.userJsLine` and nothing else; every output and box hash is identical |
| **V3** | amended teardown and coexistence, each candidate (the targeted regression of the owner's Part J) | teardown passes (plateau, identical outputs) with the same output hash as M8.2's Linux teardown; coexistence passes with the same solo hashes as M8.2's Linux coexistence |

The re-run (§4) proceeds only if V1–V3 pass. If they do not, M8.2a stops and records why. The
product side of validation — bundle byte-identical, no change under `apps/` or `packages/*/src` —
is part of the repository gates.

## 4. The re-run — Firefox WASM (Linux), both candidates

- Firefox **155.0.1** in W1's WSL2 Ubuntu 26.04.1 guest, version checked before and after, and
  `rv:155.0` required in every report.
- **3 launches headful + 3 launches headless per candidate** — M8.2's count per display mode,
  which the cell rule needs. That is 6 launches per candidate, never fewer, and the run does not
  stop at the first pass.
- Each launch is M8.2's cell launch unchanged (protocol §4.2 of M8.2).

## 5. Comparisons (per completed launch)

- **vs M8.1 native:** exact element count and relative `sumAbs` for every realistic input (the
  probe's `judgeWasm`, as in M8.2); the maximum absolute difference follows from byte identity
  with M8.1's WASM outputs where that holds.
- **vs M8.1 WASM:** output and box sha256, every realistic input.
- **vs M8.2 Firefox Linux:** output and box sha256 against every completed M8.2 Linux launch.
- **post-processing:** the probe's injected `dbPostprocess` is today's module source, byte for byte.
- **determinism:** within each launch (4 fixed-fixture runs) and across all 6 launches.

Any difference is recorded as measured. Nothing is claimed equal without a hash comparison.

## 6. RE-1

The committed scorer on the re-run's boxes, on the frozen held-out set: G1–G6, the set floor, and
the development screen. Nothing about RE-1 changes.

## 7. Verdict and interpretation

- The **Firefox WASM (Linux)** cell is re-determined by M8.2's rules: `modeVerdict` per mode,
  `cellVerdict` for the cell.
- QG-03 is then re-interpreted by `qg03Verdict`, **replacing only that one cell**. Every other
  input is M8.2's recorded value.
- **Either direction may change:** TR-02's CONDITIONAL may become ACCEPT or stay otherwise, and
  TR-01's ACCEPT is **not protected**.
- If the amended result is clean, it supersedes M8.2's Linux cell **for adoption review**. M8.2's
  record itself is never edited.

## 8. Performance

Recorded only to characterise the re-run: cold load, warm p50, probe runtime and wall time. It is
**not** a benchmark and does not replace M8.2's controlled benchmark.
