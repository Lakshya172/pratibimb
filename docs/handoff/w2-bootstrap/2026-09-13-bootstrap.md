---
id: HANDOFF-W2-BOOTSTRAP-2026-09-13
title: "W2 bootstrap — consumption and independent verification of the W1 → W2 handoff"
status: bootstrap record
date: 2026-09-13
workstation: W2 (LAPTOP-SRCINK2B, GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a)
consumes: docs/handoff/w1-to-w2/ (PR #72, merge 59ead6892ddf13d11c70a67d0eab4156790b3e24)
---

# W2 bootstrap — 2026-09-13

> **What this is.** W2's independent check of the W1 handoff: which commit was consumed, what this
> machine actually is, what reproduced and what did not.
>
> **What this is not.** It promotes nothing. A matching test count is a property of the repository
> on this machine, not a claim that W2 equals W1. Nothing here is W1 evidence.

## 1. Canonical state consumed

| Field | Value |
|---|---|
| Canonical repository | `https://github.com/ronitsaha11/pratibimb` |
| **Canonical `main` HEAD** | **`59ead6892ddf13d11c70a67d0eab4156790b3e24`** |
| **W1 handoff merge** | **PR #72** → `59ead68`, merged by `ronitsaha11` 2026-09-13T14:49:37Z; head `272b616ed65d5d39bb332f2f9d00d153f311bbc8` (`docs/w1-to-w2-handoff`). PR #71 (same title) closed unmerged |
| **W1 source commit** | `75e5cd16147a087236ea206b6af635bd79fbecf2` (per the handoff front matter) |
| Handoff files read in full | `docs/handoff/w1-to-w2/{README,repository-inventory,evidence-index,artifact-manifest,reproduction-guide}.md` · `scripts/verify-handoff.mjs` · the one-line addition to `docs/operations/repository-structure.md` |
| Open PRs at consumption | none |
| History / tags | nothing rewritten, nothing force-pushed, no tag moved |

## 2. W2 machine identity — observed this session

Recorded **2026-09-13T14:55:24Z** from live queries. Hostname and GPU UUID were read in the same
session; the GPU model alone identifies nothing (W1 carries the same model).

| Field | Value |
|---|---|
| Hostname | **`LAPTOP-SRCINK2B`** |
| Machine | HP OMEN Gaming Laptop 16-ap0xxx |
| OS | Windows 11 Home Single Language **10.0.26200.9445** |
| CPU | **AMD Ryzen AI 7 350 w/ Radeon 860M**, 16 logical |
| RAM | 24,717,639,680 B |
| Integrated GPU | AMD Radeon 860M, driver 32.0.22042.29001 |
| Discrete GPU | NVIDIA GeForce RTX 5050 Laptop GPU, driver 32.0.15.9282 (nvidia-smi **592.82**) |
| **GPU UUID** | **`GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a`** |
| GPU PCI / memory / compute cap | `00000000:04:00.0` · 8151 MiB · 12.0 |
| Node / npm | **v26.4.0** / **11.17.0** |
| Python (Windows) | **3.12.10** |
| git / gh | 2.55.0.windows.3 (`core.autocrlf=true`) / 2.97.0 |
| Docker | **not installed** (not on PATH) |
| WSL | 2.7.13.0, kernel 6.18.33.2-2; distribution `Ubuntu` (v2) **Stopped** — not started this session, so guest facts are **not re-measured** (see ENV-0004) |
| Chrome (branded) | 153.0.8010.36 |
| Chrome for Testing | **153.0.8010.12** — `C:\Users\OMEN\cft\chrome.exe` and Playwright `chromium-1243` |
| Edge | 153.0.4234.32 |
| Firefox | **155.0.1** |
| Free disk `C:` | 364.8 GB |

The UUID, hostname, PCI address and driver match [ENV-0004](../../../artifacts/environment/ENV-0004-w2-windows-wsl-gpu-link.md).
The historical W1 and W2 records are not edited.

**Checkouts on this machine** (all clean at inspection):

| Path | Branch @ commit | Role |
|---|---|---|
| `C:\Users\OMEN\Desktop\PratiBimb\.claude\worktrees\pratibimb-context-bootstrap-b8c1c9` | `spike/w2-e4-offscreen-revalidation` @ `59ead68` | **the verification checkout** |
| `C:\Users\OMEN\Desktop\PratiBimb` | `spike/webgpu-int8-defect-2` @ `cf52032` | older clone; not used |
| `C:\Users\OMEN\Desktop\PratiBimb-main` | `spike/e6-mv3-dispatch` @ `9ed71c9` | older clone; not used |

Remotes in the verification checkout: `upstream` = canonical (fetch only, push disabled);
`origin` = fork `Lakshya172/pratibimb` (B-04 Option A: owner merges).

## 3. Repository verification — W2 results

| Command | Result on W2 | W1 handoff baseline |
|---|---|---|
| `npm ci` | **OK** — 191 packages. npm also reports 2 audit findings (1 moderate, 1 critical), **not investigated**; `esbuild` / `protobufjs` postinstall blocked by the allow-scripts policy, as on W1 | OK — 191 packages |
| `node scripts/verify-handoff.mjs` | **PREFLIGHT OK** — REQ 3/3; OPT 1/3 (detector artifact **absent** in this checkout; dataset **absent**; Chromium **OK** via Playwright `chromium-1243`) | REQ 3/3; OPT 1/3 (dataset, Chromium absent) |
| `python scripts/verify-repo.py` | **PASS** — 0 failures, 0 warnings | PASS |
| `npm run pin:check` | **OK** — `ort-wasm-simd-threaded.jsep.wasm` `db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea` | same |
| `npx tsc -b --force` | **clean** (exit 0) | clean |
| `npm test` | **41 files · 806 passed · 0 failed · 15 skipped** (821) | 806 · 0 · 15 |
| `npm run verify` | **exit 0** (all four stages, same counts) | — |

The W1 test baseline **reproduces in count** on W2 (Node 26.4.0 / npm 11.17.0 vs W1's 24.19.0 / 12.0.2).

## 4. Deterministic reproduction

Harnesses that write into their own `logs/` were run **from copies outside the repository**, so no
committed log was overwritten. Mutation tools that edit source restore it; `git status` was clean
afterwards.

| Check | Result | Matches the record? |
|---|---|---|
| E2 `run-e2.mjs` | **PASS**; 34/34 exact binding outcomes; every log field equal to the committed `logs/e2.json` except `recordedAt` | **yes** |
| E2 `mutate-e2.mjs` | 19 mutations, **17 killed**, survivors **B5, B7** | **yes** |
| `tools/mutation/permit-core.mjs` | 16 mutations, **14 killed**, 2 layered survivors (M17, M18), 0 unexpected | **yes** (ADR-0008 §7) |
| **E4 `run-e4.mjs` as committed on `main`** | **DOES NOT PARSE** — `SyntaxError: Invalid regular expression: missing /` at line 253 | **no — see §6, D-1** |
| E4 runner at **`b027fc5`** (the revision before `c497aee`), unchanged scanner and collector | **PASS**; `totals`, `blindSpotSummary` and all 10 per-run records **equal as JSON** to the committed attempt-2 log; seed block 20260923–32; scanner raw SHA-256 `feeb1be8…` equals the logged value | **yes**, with one explained difference: collector raw hash `6e8de684…` vs logged `1ff60ed5…` — the logged value is over LF bytes and this checkout is CRLF (E4 `decision.md` §Instrument identity); LF-normalised collector here = `1ff60ed52539d6beb6c1f545aea15283a3cb8563eee4994b2b2b1adc4298ea77` |

**Instrument identity, verified on the committed tree:**

| File | LF-normalised SHA-256 | Record |
|---|---|---|
| `E4-leak-instrument/harness/scanner.mjs` (`e4-scanner-2`) | `96979ebde6774f734fa14e4ae94dcabc33c962358874e850148cdccb0f0b6fab` | equals E4 `decision.md` |
| `E4-leak-instrument/harness/collector.cjs` | `1ff60ed52539d6beb6c1f545aea15283a3cb8563eee4994b2b2b1adc4298ea77` | equals `logs/e4.json` |

This E4 reproduction ran on **the same machine as the original E4 run (W2)**. It shows the result
is reproducible here; it is **not** an independent replication and **not** a new cell.

## 5. Artifact availability

| Artifact | State on W2 |
|---|---|
| `artifacts/models/t1-ui-head/t1-ui-head.onnx` | **Not present in the verification checkout.** Files with the recorded size (302,960 B) and **exact** SHA-256 `ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0` exist elsewhere on this machine (`Desktop\PratiBimb-main\artifacts\models\…`, `Downloads\`), consistent with `agentos/state.md`'s record that the owner placed the artifact on W2. How the `Downloads` copy arrived is **not** established by this session. **Placing it into the checkout was blocked by this session's permission policy and is awaiting explicit approval.** Nothing was downloaded, retrained or substituted |
| Dataset `t1-ui-rendered@4bbc57de` | absent; regenerable; not generated |
| ORT runtime | present via `npm ci`; pin OK |
| Chromium | Chrome for Testing 153.0.8010.12 present |
| Server model weights / vLLM | absent; **not approved; not downloaded** |

## 6. Discrepancies found

| # | Where | Statement | Observed | Severity |
|---|---|---|---|---|
| **D-1** | `artifacts/experiments/E4-leak-instrument/harness/run-e4.mjs` @ `main`; handoff `reproduction-guide.md` §7, §9; E4 `decision.md` | the runner is listed as a runnable deterministic check, and "the runner now computes identity that way" | **Commit `c497aee` wrote a literal line break inside a regex literal** (`replace(/⏎/g, "⏎")`, blob bytes confirmed). The file fails `node --check`. `b027fc5` parses and reproduces the PASS log. **E4 cannot be re-run from `main` on any machine.** Scanner and collector are unaffected | **HIGH** |
| D-2 | handoff `README.md` front matter | `branch: handoff/w1-to-w2` | merged branch was `docs/w1-to-w2-handoff` | LOW |
| D-3 | handoff `README.md` | "The four documents" | the table lists five | LOW |
| D-4 | `reproduction-guide.md` §1 | "`main` is protected: PRs required …" | `agentos/blockers.md` B-05 still says unprotected (OPEN); W2's non-admin identity gets HTTP 404 and cannot verify either | MEDIUM |
| D-5 | `reproduction-guide.md` §8 | "Firefox … W2 per ENV-0004 has none" | ENV-0004 makes no Firefox statement; **Firefox 155.0.1 is installed on W2** (also B-01) | MEDIUM |
| D-6 | `reproduction-guide.md` §1 | canonical remote is `origin`, fetch and push | on W2 the canonical remote is fetch-only and contributions go through the fork (B-04 Option A) — a W1-local fact, not wrong for W1 | LOW |
| D-7 | `reproduction-guide.md` §9 | E4 "need not rerun" as machine-independent | true of the measurement, but the committed runner does not execute (D-1) | MEDIUM |

None of these documents was edited here.

## 7. Governed state — unchanged

**Proven / implemented** (engineering or experimental evidence, as recorded): ACT permit core ·
HIT-TEST · VERIFY RESULT · fixture geometry evidence · MV3 host **experimental shell** · E4
scanner/instrument (instrument proof only) · E2 initial evidence (not generalisation) · E7 evidence
(GO not met) · E8 evidence (landing, not effect) · E6 TYPE experimental evidence.

**Not complete / not approved:** production SANITIZE · privacy VERIFY · production egress/privacy
pipeline · REASON/PLAN production path · RE-HYDRATE production path · production TYPE · production
orchestrator · production MV3 transport bridge · E1 · E9 · detector adoption · W-A data gate.

No status was upgraded by this bootstrap. **B-02 remains OPEN; QG-04 remains unsigned.**

## 8. Blocked items

| Item | Blocked on |
|---|---|
| **E4 re-validation in the MV3 offscreen document** | (a) approval to place the digest-verified detector artifact in the checkout — the host build hard-fails without it; (b) a decision on D-1: which runner revision the offscreen harness reproduces, and whether `main`'s runner is repaired |
| E9 / E1 / detector adoption / W-A / QG-04 | unchanged — see the handoff and `agentos/blockers.md` |

## 9. Recommended next action

Obtain the two decisions in §8. Then run the E4 offscreen re-validation with the scanner
(`96979ebd…`) and collector (`1ff60ed5…`) unchanged, the ATTEMPT-2 seed block, and a pre-registered
protocol committed before the run. No E4-offscreen harness code was written by this bootstrap.

## 10. Decisions taken after this record was drafted — same session, 2026-09-13

Both §8 decisions were taken by the user in this session. They are appended here; §§1–9 above are
left as drafted.

| Decision | Outcome | Effect |
|---|---|---|
| Detector artifact in the verification checkout | **Copy approved.** Copied from `C:\Users\OMEN\Desktop\PratiBimb-main\artifacts\models\t1-ui-head\t1-ui-head.onnx`, SHA-256 verified **before and after** the copy (`ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0`, 302,960 B). Gitignored by `.gitignore:128`; **never committed**. Preflight then reported it present, and the MV3 host built (28.99 MB, `chrome-mv3`) | Used **only** to satisfy the host build. No detector-dependent work was run |
| E4 runner defect (D-1) | **Reuse `b027fc5`** (`b027fc54fad51511153689b347bb77bc053a3691`), the code that produced the committed evidence. `main`'s broken `run-e4.mjs` is left unedited and the defect stays recorded | See [`artifacts/experiments/E4-offscreen-revalidation/`](../../../artifacts/experiments/E4-offscreen-revalidation/README.md) |
| E4 offscreen re-validation — outcome | **PASS** on W2, Chrome for Testing 153.0.8010.12. Instrument validation only; B-02 and QG-04 unchanged | [`decision.md`](../../../artifacts/experiments/E4-offscreen-revalidation/decision.md) |
