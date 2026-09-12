---
id: D2-acceptance-gate-protocol
title: "D2 — acceptance-gate protocol for adoption item 11"
status: PROTOCOL — numeric values PENDING the owner
date: 2026-09-12
workstation: 1 (LAPTOP-6E14K34L)
owner_decision: PENDING
---

# D2 — acceptance-gate protocol

> **No numeric threshold is chosen here.** This fixes the *structure* of the eventual gate and
> the *measurements* required to calibrate it. Every `G`, `R`, `M`, `δ`, `S` below is a symbol,
> not a value. **D2 remains PENDING.**

## 1. Item 11 today — FIXED / PROVISIONAL / UNDEFINED

| element | state | value |
|---|---|---|
| Metrics required | **FIXED** | element **mAP@0.5**, element **recall**, **grounding accuracy** — benchmark contract Rule 2 |
| Corpus required | **FIXED** | ScreenSpot-v2 web subset **+ 300 self-labelled Indian government/banking screens**, including DOM-empty scanned pages |
| Clean **and** redacted reporting | **FIXED** | Rule 2 requires both. **Currently unproducible — T2 does not exist** |
| Grounding definition | **FIXED** | per-prediction precision, `groundedHits / predictions`, from `evaluator.ts`. **Never instruction-level grounding** |
| Recall definition | **FIXED** | element recall, read **against the measured CLIPPED ceiling**, never against 1.0 |
| mAP definition | **FIXED** | element mAP@0.5 |
| Threshold-**selection** rule | **FIXED** | maximise `F1(recall, grounding)` on **dev**, ties to the higher threshold. Needs **no** owner decision |
| Synthetic operating point | **FIXED (synthetic only)** | **0.55** |
| `PROVISIONAL_THRESHOLDS.score` | **PROVISIONAL** | **0.25** — moving it is a separate decision (D7) |
| Recall ceiling | **PROVISIONAL / measured-per-corpus** | 94.4% on synthetic dev; the real corpus's ceiling is **unmeasured** |
| **The acceptance bar itself** | **UNDEFINED** | *"acceptable metrics and usable grounding"* — qualitative, **no number behind it** |
| **Per-cell vs aggregate** | **UNDEFINED** | no record says which |
| **Environment/robustness requirement** | **UNDEFINED** | W-A §3.1 coverage axes are *corpus composition*, not acceptance |
| **Uncertainty reporting** | **UNDEFINED** | contract requires p50/p95 for **latency only** (D8) |
| **Minimum sample size for acceptance** | **UNDEFINED** | 300 is a corpus size, not a statistical requirement |

The contract sets `recall ≥ 0.98` for **PII detection**, so it is capable of expressing a numeric
bar and does not do so for visual context. That asymmetry is recorded as an observation; **why**
it is absent is not something this document knows.

## 2. Candidate gate structures

Let the reported figures on the sealed test split be `g` (grounding), `r` (recall, against the
measured ceiling `c`), `m` (mAP@0.5).

### Option A — aggregate performance gate

```
PASS  ⇔  g ≥ G  ∧  r ≥ R  ∧  m ≥ M
```

- **Frozen before the real evaluation:** `G`, `R`, `M`; the corpus and its hash; the split
  assignment; the selection rule; the CLIPPED definition; which figure is pooled.
- **Measurements needed to set the numbers:** a real-corpus dev read to know the achievable
  range at all. Today the project has **no real-data figure**, so any `G/R/M` would be invented.
- **False-accept risk: HIGH.** One pooled number can hide an entire failing environment — strong
  on Chromium, broken on Firefox, still passes.
- **False-reject risk: MEDIUM-HIGH.** A bare inequality at four decimals is not decidable between
  two honest runs (see §4).
- **Complexity: LOW.**
- **Compatibility: PARTIAL.** It matches the contract's PII style, but **not** the project's
  dominant pattern, which is per-cell.

### Option B — variance-aware gate with an inconclusive band

```
PASS          ⇔  g ≥ G + δ   (and likewise for r, m)
FAIL          ⇔  g <  G − δ
INCONCLUSIVE  ⇔  otherwise → requires a second independent environment before any verdict
```

- **Frozen before:** everything in A, plus `δ` **and the measurement that produced δ**.
- **Measurements needed:** `δ` must be a *measured repeatability* of the whole real evaluation —
  the same sealed corpus scored **k ≥ 3 times across the environments the bar applies to**, with
  `δ` derived from that spread. **`AUDIT-0003` cannot supply it** (§4).
- **False-accept risk: MEDIUM** — a `δ` set too wide swallows a real shortfall.
- **False-reject risk: LOW** — marginal results become INCONCLUSIVE rather than FAIL.
- **Complexity: MEDIUM**, and it adds a repeat-measurement obligation.
- **Compatibility: GOOD** — the project already distinguishes UNKNOWN from REJECT (B3-1's
  harness-error rule does exactly this).

### Option C — two-level gate: pooled performance + per-environment stability

```
(i)  pooled:      g ≥ G  ∧  r ≥ R  ∧  m ≥ M
(ii) stability:   max_e(g_e) − min_e(g_e) ≤ S   ∧   min_e(g_e) ≥ G_min
PASS ⇔ (i) ∧ (ii)
```

- **Frozen before:** everything in A, plus `S`, `G_min`, and **the exact environment list** `e`
  the spread is computed over.
- **Measurements needed:** a real-corpus dev read **per environment**, to know the natural spread
  before constraining it. Constraining `S` below the pipeline's own reproducibility would fail
  correct detectors.
- **False-accept risk: LOWEST** — an unstable detector fails (ii) even when (i) passes.
- **False-reject risk: HIGHEST** — three ways to fail, and `S` set blind is the likeliest
  mis-set constant in the whole scheme.
- **Complexity: HIGH.**
- **Compatibility: STRONGEST.** QG-03, QG-03b-2a, B2, B3-1 and Track B **all** report per cell
  and gate on the weakest cell. This is the house pattern, stated as a formula.

## 2a. RECOMMENDED FRAMEWORK — Option C (owner decision still PENDING)

**Recommended: Option C, the two-level gate.** Recommended as a *structure* only — **every
numeric value below remains PENDING and none is proposed here.**

Why C rather than A or B: it is the pattern the project already uses everywhere that matters.
QG-03, QG-03b-2a, B2, B3-1 and Track B all report **per cell** and gate on the **weakest** cell,
and B3-1's own verdict was CONDITIONAL precisely because one cell of eight failed while the
pooled picture looked fine. A pooled-only gate (Option A) would have passed that run. Option C
makes the project's existing habit explicit rather than introducing a new one.

Its cost is stated plainly: it has the **highest false-reject risk** of the three, and `S` set
blind is the likeliest mis-set constant in the scheme — which is exactly why §3's repeatability
measurement is a hard prerequisite rather than a nicety.

### Formal statement

Let `e` range over the frozen environment list, and let `g_e`, `r_e`, `m_e` be that
environment's grounding, recall (against **its own** measured CLIPPED ceiling) and mAP@0.5.
Pooled figures `g`, `r`, `m` are computed over the whole sealed test split.

```
Gate 1 — pooled performance
    g ≥ G        AND    r ≥ R        AND    m ≥ M

Gate 2 — environment robustness
    max_e(g_e) − min_e(g_e) ≤ S      AND    min_e(g_e) ≥ G_min

PASS ⇔ Gate 1 ∧ Gate 2
```

| symbol | meaning | value |
|---|---|---|
| `G` | pooled grounding threshold | **PENDING** |
| `R` | pooled recall threshold | **PENDING** |
| `M` | pooled mAP@0.5 threshold | **PENDING** |
| `S` | allowable across-environment grounding spread | **PENDING** |
| `G_min` | per-environment grounding floor | **PENDING** |

**Environment list, clean/redacted reporting, corpus, splits, leakage rules, CLIPPED handling,
DEV-only calibration and the TEST read-once rule are as specified in §3 and are unchanged.**

**No option is selected as an owner decision, and no number is chosen. That remains the owner's.**

## 3. The minimum real-world measurement required before any number is chosen

**Protocol only. Nothing here has been executed. No dataset exists, no page was fetched, no split
was created or sealed.**

| element | requirement | source |
|---|---|---|
| Corpus size | **300 screens** for source B, per Rule 2. Whether 300 is *statistically* sufficient for the chosen gate is part of D2 and D8 | contract Rule 2 |
| Page/origin counts | reported **separately from sample counts** — 300 captures of 12 pages is not 300 captures of 300 pages | W-A §5.3 |
| Environments | **≥ 2 browsers** (Chromium, Firefox); DPR **1 and 1.5**; **≥ 1 non-100% zoom**; viewports spanning the measured scale range | W-A §3.1 |
| Backends | per the feasibility matrix axes (WASM and WebGPU where available) | feasibility matrix |
| Leakage control | split by **page identity**, then by **origin** — `assertNoLeakage` alone is insufficient, because the same page at a different scroll/viewport/zoom yields a different fingerprint and would pass | W-A §5.2–5.3 |
| Split assignment | **before labelling**, from a **recorded seed** | W-A §5.3 |
| Annotation | frozen guidelines with worked examples (D7); inter-annotator agreement protocol, overlap size, statistic and acceptance level (D6) | W-A §4, §11 |
| Clean/redacted pair | from **one** capture — clean, then the T2 union redaction. **Two captures would differ in content and the comparison would be meaningless.** Blocked: T2 does not exist (D10) | W-A §9.1 |
| CLIPPED ceiling | **measured on the real corpus** and reported alongside recall. The 94.4% synthetic figure does **not** transfer | AUDIT-0002 |
| **Repeatability for δ or S** | if Option B or C: the sealed corpus scored **k ≥ 3 times per environment**, δ/S derived from the observed spread. **This measurement does not exist and is the gating prerequisite for B and C** | this document |
| Uncertainty | interval policy — bootstrap/resampling, aggregation rule — or a recorded decision that none is required (D8) | W-A §7 |
| Reproducibility | dataset name/version/**hash**, split, model id/revision, backend, browser, preprocessing — all already carried by `RunContext`; evaluator refuses on `datasetHash` drift | W-A §7, evaluator |
| Sealing | `sealDataset` hash committed, **frames outside Git**, test manifest unopened; reading it is a **recorded, dated event** | W-A §5.3 |
| Test discipline | **DEV selects the threshold. TEST is read once. No sweep on TEST, ever.** The consumed historical test split is never re-scored and never called independent | W-A §6 |

**Order of operations:** D5 approved → collection protocol frozen → annotation guidelines frozen
→ splits assigned from a seed → collect and label → **D2 fixed and recorded** → test sealed →
dev read → test read **once**. **D2 must be fixed before the split is sealed**, or the bar can be
chosen to fit the result.

## 4. The cross-machine variance — what it is, and what it must not become

From `AUDIT-0003`, recorded exactly:

| | |
|---|---|
| metric | **grounding accuracy** |
| run | one **paired synthetic** W1/W2 reproduction of W-1 arm A |
| values | **0.5716** and **0.5701** → difference **−0.0015** |
| recall difference | **−0.0013** |
| mAP@0.5 difference | **+0.0001** |
| n | **40 synthetic screens** |
| association | **localization false-positive variation** (±2 boxes); duplicate, classConfusion and spurious were **identical** on both machines |

**It is not a standard deviation. It is not a confidence interval. It is not a generic pipeline
error. It is not a universal tolerance.** It is a single paired difference.

> **Because AUDIT-0003 is one synthetic paired observation, it does not determine `S` or any
> other D2 tolerance. Real-protocol repeatability must be measured before `S` is assigned.**

Three reasons it cannot be reused as `δ`: it is **one observation**, so any "±" describes a
spread never estimated; it is a **count effect on a fixed denominator** (2 boxes in ~4,848
predictions over 40 screens), and both the count and the denominator change on 300 real screens;
and it is **synthetic**, while the quantity that produced it — the density of boxes near the IoU
0.5 gate — is a property of the box-size distribution, which differs on real UI.

What it *does* establish, and this is a real constraint on D2's **form**: absolute metric values
from this pipeline are **not bitwise reproducible across machines**, so a bar expressed as a bare
equality or an unqualified inequality at four decimal places is not decidable by two honest runs.

## 4a. Numeric-calibration rule — how the numbers get chosen without being fitted to the answer

The ordering is the whole point: **the gate is frozen before the evidence that could bias it
exists**, and the numbers are derived from **DEV only**, by a rule recorded in advance.

1. **Freeze the evaluation design** — corpus definition, environment list, capture protocol,
   annotation guidelines, metric definitions, CLIPPED handling.
2. **Seal the dataset.** `sealDataset` hash committed, frames outside Git, **test manifest
   unopened**.
3. **Freeze the D2 structure** — Option C's *form* above, with `G/R/M/S/G_min` still unset.
4. **Collect independent development evidence** — DEV split only, across the full environment
   list.
5. **Estimate, from DEV only:** achievable pooled performance, and the **across-environment
   spread**, from the sealed corpus scored **k ≥ 3 times per environment**. This is the
   repeatability measurement; without it `S` and `G_min` are guesses.
6. **Choose `G/R/M/S/G_min` by a documented rule**, recorded with its justification **before**
   any test read. The rule must be written down, not the numbers alone, so the derivation can be
   audited.
7. **Record the numeric values** in this document, dated, as an owner-approved amendment.
8. **Only then unlock the final evaluation** — the TEST split is read **once**.
9. **Never tune the gate on TEST.** A gate adjusted after a test read is not a gate.

**Nothing in steps 1–9 has been performed.** No dataset exists, no split was created or sealed,
no measurement was taken.

## 5. Status

**D2 remains PENDING.** Option C is **RECOMMENDED as the framework**; the owner has not adopted
it, and no numeric value has been chosen. No numeric value is adopted. No gate structure is selected. The detector
remains **UNADOPTED** and item 11 remains **FAIL**.
