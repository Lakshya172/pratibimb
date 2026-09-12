# ADR-0004 — W-A source authorisation (D5) and the item-11 acceptance bar (D2)

- **Status: PROPOSED. Both decisions are PENDING the owner. Neither is approved here.**
- **Date:** 2026-09-12
- **Decision owner:** `ronitsaha11`
- **Prepared by:** implementation engineer, workstation 1, at main `cb3771ab`
- **Related:** [ADR-0002](ADR-0002-t1-capture-format-policy.md) (capture format) ·
  `artifacts/experiments/WA-item11-real-ui-evaluation/` (the W-A design) ·
  `artifacts/reviews/AUDIT-0004-wa-approval-checklist.md` (D1–D10 status) ·
  `artifacts/reviews/AUDIT-0002-detector-adoption.md` (item 11) ·
  `artifacts/reviews/AUDIT-0003-w1-arm-a-cross-machine.md` (the variance measurement)

> This record **prepares** two decisions. It does not take them. Nothing in it authorises data
> collection, and no number in it is adopted as a threshold.

## Context

Adoption item 11 — *"acceptable detector metrics"* — is the gating item for the T1 detector and
is **FAIL**. `AUDIT-0002` establishes why it cannot be closed by re-scoring: no unread split
exists, the required real-UI evidence source does not exist, and everything measured so far is
synthetic. Track B (merged, `cb3771ab`) completed the synthetic attribution work and changed
none of that.

Two decisions block progress, and both are the owner's.

---

# D5 — may the proposed real-world sources be captured at all?

## The question the owner must answer

**Is the project authorised to capture screens from Indian government and banking web
interfaces for W-A's evaluation corpus — and if so, from which specific sources, under what
conditions?**

## What the repository actually contains

**No source is named anywhere in this repository.** A search across all Markdown and JSON for
allowlists, site lists, and the obvious candidate domains returns nothing that is a collection
target. (`seva.gov.in` appears once as an *example origin* in `manifest-schema.md`; `paytm` and
`okaxis` appear as UPI-handle regex patterns in the same file. Neither is a source.)

What exists is a **category**, from `docs/testing/benchmark-contract.md` Rule 2:

> *ScreenSpot-v2 web subset plus **300 self-labelled Indian government and banking screens**,
> including scanned-document pages where the DOM is empty*

and a set of **inclusion/exclusion rules** in the W-A design §3.2.

## Proposed sources and their evidence state

| # | source | type | purpose | status | access method | auth? | ToS/robots evidence | automated access permitted? | written permission | sensitive content | status in repo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **A** | **ScreenSpot-v2**, web subset only | third-party public dataset | second corpus, or a separate point-grounding figure, or scoped out (D3) | **PROPOSED** | dataset download, not web capture | no | **UNKNOWN — licence not recorded** | **UNKNOWN — owner/legal confirmation required** | **none** | unknown; not our capture | design §2 |
| **B** | **300 Indian government + banking screens** | **category, not a source list** | the primary item-11 corpus | **PROPOSED, and unenumerated** | `captureVisibleTab({format:"png"})` per ADR-0002 | test accounts only; **real authenticated views excluded** | **UNKNOWN — no site has been assessed** | **UNKNOWN — owner/legal confirmation required** | **none** | **excluded by rule** (fabricated values, public pages, test accounts) | design §3 |

**Neither row can be advanced without information this repository does not hold.** For source A
the licence has never been read at a pinned revision, which is the project's own standard for
provenance. For source B there is nothing to assess yet, because **no site has been proposed by
name**.

> **UNKNOWN — owner/legal confirmation required**, for both. This is not converted to YES
> anywhere in this record, and "technically reachable" is not treated as evidence of permission.

## What is missing before D5 can be decided

1. **A named source list for B.** D5 is not answerable in the abstract: permission is a property
   of a specific site's terms, not of a category. Until sites are named, there is nothing to
   review.
2. **A per-source terms-of-service and robots assessment**, recorded with URL and date.
3. **ScreenSpot-v2's licence**, read at a pinned revision, covering redistribution, local
   processing and derived annotations.
4. **A legal determination** — the W-A design states plainly that *"whether a given site's terms
   permit capture is a legal question this design does not answer"*. This record does not answer
   it either, and an engineering document is not the place where it gets answered.

## Data-minimisation requirements — already in the design, not invented here

Carried verbatim from W-A §3.2 and §9, and from the existing invariants (INV-04, INV-05,
INV-21):

- **No real person's data, including the collector's own.** Excluded at the source; redaction is
  a second line of defence, never the first.
- **No authenticated view of a real account.** Test accounts created for the purpose only.
- **Fabricated values** in any form that is filled.
- **Raw frames are never committed** — manifest and annotations can be committed with no pixels
  at all, which is the default. Retention only outside Git, in a named location, with access
  recorded.
- **Hashing at ingest**, `sealDataset` over the manifest, evaluator refuses on drift.
- **Hard stop:** no real screen is captured until the privacy and licensing approvals are
  recorded. A run that starts before them cannot be made compliant afterwards, because the
  frames already exist.

## The outcomes available to the owner

| outcome | meaning |
|---|---|
| **APPROVED** | named sources, assessed, permitted. **Not available today** — no source list exists |
| **APPROVED WITH CONDITIONS** | a named subset permitted under stated constraints |
| **BLOCKED** | capture of these sources is not permitted; item 11 needs a different corpus |
| **UNKNOWN / NEEDS LEGAL CONFIRMATION** | **the present state**, and the only one the evidence supports |

**No outcome is selected here.** The repository contains no prior decision that selects one.

## Consequence

Until D5 is resolved, **W-A cannot begin**, and therefore **adoption item 11 stays FAIL and the
detector stays UNADOPTED**. D5 is a hard gate: it blocks collection, not merely reporting.

---

# D2 — the numeric acceptance bar for item 11

## The question the owner must answer

**What numeric result on the W-A corpus constitutes "acceptable detector metrics", and is that
bar per-cell, aggregate, or both?**

## What exists today

- **Item 11's criterion is qualitative.** The gate reads *"Acceptable detector metrics"*; the
  feasibility matrix phrases it *"acceptable metrics and usable grounding"*. The W-A design
  states it exactly: **"that is the whole of it — it is qualitative, and there is no number
  behind it."**
- **The benchmark contract states no visual-context threshold.** Rule 2 names the three figures
  to report — element mAP@0.5, element recall, grounding accuracy — and sets no target. It does
  set a numeric target elsewhere (**PII detection recall ≥ 0.98**), so the contract is capable of
  expressing one and does not, for this metric.
- **The threshold-selection rule is already frozen and needs no decision**: maximise
  `F1(element recall, grounding accuracy)` on the **dev** split, ties to the higher threshold.
  It names no dataset and introduces no constant.
- **`PROVISIONAL_THRESHOLDS.score = 0.25` is provisional and separate** (D7). The synthetic
  operating point **0.55** stays frozen unless the rule, run on a real dev split, selects
  otherwise.
- **The recall ceiling is 94.4% on synthetic dev** and must be read against, never against 1.0:
  51 CLIPPED annotations, and for 42 of them IoU ≥ 0.5 is arithmetically unreachable. **The real
  corpus will have its own ceiling, which is not yet measured.**

## What is NOT accounted for today

- **Per-cell versus aggregate is undefined.** No existing record says whether item 11 is judged
  on one pooled figure or per environment (browser × backend × DPR/zoom).
- **Cross-machine variance is not accounted for** in any acceptance rule, because no acceptance
  rule exists.
- **No minimum sample size or environment count** is attached to item 11. W-A §3.1 requires
  coverage axes (Chromium and Firefox, DPR 1 and 1.5, ≥1 non-100% zoom, viewports spanning the
  measured scale range), but those are *corpus composition* requirements, not acceptance
  requirements.
- **Uncertainty reporting is not required** by the contract (p50/p95 are required for latency
  only). Adding an interval is D8.

## The ±0.0015 figure — exactly what it is, and what it is not

**This must not become a generic error bar, and the evidence does not let it.**

| | |
|---|---|
| **Source** | `AUDIT-0003`, one W1↔W2 reproduction of W-1 arm A |
| **Metric** | **grounding accuracy**, V0: 0.5716 (W2) → 0.5701 (W1) = **−0.0015**. The recall delta was **−0.0013**; mAP@0.5 moved **+0.0001** |
| **Corpus** | **40 synthetic dev screens**, dataset `4bbc57de`, 744 evaluatable annotations |
| **n** | **one paired difference.** Not a standard deviation, not a confidence interval, not a repeated-measures estimate |
| **Mechanism** | **entirely localization false positives** (±2 boxes on V0, ±1 on V1). duplicate, classConfusion and spurious were **identical** on both machines |
| **Attribution** | INFERENCE, not established: borderline boxes crossing the matcher's IoU 0.5 gate, consistent with the artifact's 1,402 exact score ties. **The cause was not isolated** |

**Three reasons it does not transfer as a tolerance:**

1. **It is a single observation**, so "±0.0015" describes a symmetric spread that was never
   estimated. Two machines is not a variance study.
2. **It is a count effect on a fixed denominator.** Two boxes out of ~4,848 predictions across
   40 screens. On 300 real screens both the count and the denominator change, and the *rate* of
   borderline boxes is a property of the box-size distribution, which differs between synthetic
   renders and real UI.
3. **It is synthetic.** Real screens have a different distribution of boxes near the IoU gate,
   which is precisely the population that produced the difference.

**What it does legitimately establish:** absolute metric values from this pipeline are **not
bitwise reproducible across machines**, so a bar expressed as a bare equality or an
unqualified inequality at four decimal places is not decidable by two honest runs. That is a
constraint on the *form* of D2, not a value for it.

## Candidate bars — options, not a recommendation

All three use the metrics the evaluator already emits, read against the measured CLIPPED
ceiling. **None is selected. The values shown are placeholders for the owner to set — the
project has no evidence that fixes any of them.**

### Option A — STRICT: a direct bar on the pooled figure

- **Rule:** on the sealed test split, pooled: grounding accuracy ≥ **G**, element recall ≥ **R**
  (read against the measured ceiling), mAP@0.5 ≥ **M**. Fail any ⇒ item 11 FAIL.
- **Supporting evidence:** simplest form; matches how the contract expresses the PII bar
  (`recall ≥ 0.98`), so it is consistent with existing house style.
- **Missing evidence:** the values themselves. Nothing in the repository supports any specific
  G, R or M, and the only real-data figures that would calibrate them do not exist.
- **False-accept risk:** a pooled figure can hide a whole failing environment — a detector that
  is strong on Chromium and broken on Firefox can pass.
- **False-reject risk:** a bare number near the measured result is not decidable across
  machines; a run could land either side of it for reasons `AUDIT-0003` shows are not the
  detector.

### Option B — VARIANCE-AWARE: a bar with a stated decision margin

- **Rule:** as Option A, but the bar is declared **met** only if the point estimate exceeds
  `G + δ`, **failed** below `G − δ`, and **INCONCLUSIVE** in between, requiring a second
  environment.
- **Supporting evidence:** `AUDIT-0003` establishes that absolute values move across machines,
  so a decision band is justified *in form*.
- **Missing evidence — and this is the load-bearing gap:** `AUDIT-0003` **cannot supply δ**. It
  is one paired difference on synthetic data with a different corpus size. Using 0.0015 as δ
  would be exactly the misuse this record warns against. **δ requires its own measurement** — a
  repeated-measures estimate on the real corpus, across the environments the bar applies to.
- **False-accept risk:** a δ set too wide swallows a genuine shortfall.
- **False-reject risk:** low; the band converts marginal results into INCONCLUSIVE rather than
  FAIL.

### Option C — TWO-PART GATE: central performance plus a stability guard

- **Rule:** **(i)** pooled bar as Option A; **and (ii)** a stability condition — the same metrics
  computed per environment must not vary by more than **S** across the required coverage axes,
  and no single environment may fall below **G_min**.
- **Supporting evidence:** the coverage axes already exist in W-A §3.1, and the project already
  measures per-cell rather than pooled elsewhere (QG-03, B3-1, Track B all report per cell and
  gate on the weakest). This is the house pattern.
- **Missing evidence:** G, S and G_min; plus a measured per-environment spread on real data,
  which does not exist. `AUDIT-0003`'s figure is cross-*machine* on synthetic data and is not a
  per-*environment* spread.
- **False-accept risk:** lowest of the three — an unstable detector fails (ii) even if it passes
  (i).
- **False-reject risk:** highest — two bars and a spread give three ways to fail, and with S
  unmeasured it could be set below the pipeline's own reproducibility.

## Consequence

Until D2 is set, a W-A run produces figures **nobody can grade**, and — worse — the bar could be
chosen after seeing them. The W-A design's own discipline requires D2 **before the split is
sealed**.

---

## Decision

**PENDING — both.** No approval is recorded in this document.

| id | decision | status |
|---|---|---|
| **D5** | source authorisation | **PENDING OWNER** — evidence state is UNKNOWN / NEEDS LEGAL CONFIRMATION |
| **D2** | item-11 numeric bar | **PENDING OWNER** — no value is proposed as adopted |

## Consequences of this record

**None to production.** No runtime, model, threshold, NMS, preprocessing, decode, capture
policy, privacy firewall, egress, CSP or coordinate-contract change. No data collected. The
detector remains **UNADOPTED**; item 11 remains **FAIL**; `PROVISIONAL_THRESHOLDS.score` remains
**0.25**; the synthetic operating point remains **0.55**.

## Rollback

Documentation only; reverting this file removes the package and changes no behaviour.
