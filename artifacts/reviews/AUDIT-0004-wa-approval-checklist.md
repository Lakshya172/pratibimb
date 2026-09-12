---
id: AUDIT-0004-wa-approval-checklist
title: "W-A real-data approval — the executable checklist"
status: recorded
date: 2026-09-12
label: DOCUMENTATION ONLY — no data was collected
workstation: 1 (LAPTOP-6E14K34L)
---

# AUDIT-0004 — W-A approval checklist

> **No real-data collection occurred.** No site was visited, no screenshot captured, no PII
> touched. This document converts the W-A design into decisions someone can actually action.
> **A checklist existing does not make W-A ready.**

## Where the design lives, and why this document exists

The W-A design — corpus, annotation protocol, split discipline, threshold rule, metrics, privacy
rules — is pre-registered in **PR #51** (`docs/wa-item11-real-ui-evaluation-design`, open,
unmerged), which already names ten decisions **D1–D10**. This document does not restate that
design. It does three things the design does not:

1. records the **status** of each decision against the four permitted values;
2. names the **blocking consequence** of each, so sequencing is visible rather than implied;
3. adds the **one constraint this workstation measured** — see D2.

**Current W-A status: step 0. Nothing in the collection sequence has been performed.**

## The decisions

| id | decision | status | evidence required | if unresolved | next action |
|---|---|---|---|---|---|
| **D1** | May item 11 close on the **clean half alone**, with the redacted half deferred to T2? | **OWNER DECISION NEEDED** | A recorded owner ruling, plus the statement that QG-05 stays partial either way | Item 11 cannot be declared closable even on a perfect run — the finish line is undefined | Owner rules; record in the gate |
| **D2** | What numeric bar is **"acceptable detector metrics"**? | **OWNER DECISION NEEDED** | A number per metric, fixed **before** the split is sealed | The run produces figures nobody can grade; worse, the bar could be chosen after seeing them | Owner sets it. **See the measured constraint below** |
| **D3** | ScreenSpot-v2's exact role, and its licence/provenance restrictions | **OWNER DECISION NEEDED** | Licence text, redistribution terms, and a choice of role: exhaustive re-label / separate point-grounding figure / scoped out with reason | Corpus composition is undefined, so collection cannot start | Owner picks the role; engineering records the licence |
| **D4** | **DOM-empty / scanned** subset size | **OWNER DECISION NEEDED** | A sample count with a power or sufficiency argument | The subset the detector is *most* likely to justify itself on stays unmeasured | Owner sets N |
| **D5** | May the proposed Indian **government / banking** sources be captured at all? | **BLOCKED** | Legal and ToS review per source. **The design makes no legal claim** | **Hard blocker.** No capture of source B may begin | Legal/ToS review, per source, recorded |
| **D6** | Inter-annotator agreement: protocol, overlap size, statistic, acceptance level | **OWNER DECISION NEEDED** | A statistic (e.g. Cohen's kappa on a defined overlap), a sample size, an acceptance level, and whether single-annotator labelling is permitted at all | Label quality is unquantified, so every downstream metric inherits unknown noise | Owner sets the protocol |
| **D7** | The frozen **annotation policy**: taxonomy, grounding definition, ambiguity and rejection rules | **OPEN** | Guidelines frozen with worked examples per boundary rule | Annotators disagree on cases the rules do not cover, which shows up as a bad D6 number and cannot be fixed afterwards | Engineering drafts from design §4; owner freezes |
| **D8** | What **uncertainty reporting** is required? | **OWNER DECISION NEEDED** | An interval policy — bootstrap resampling policy, aggregation rule — or a recorded decision that none is required | A single point estimate on ~300 screens will be read as more precise than it is | Owner rules; the contract currently requires none |
| **D9** | **Storage and access**: who collects, labels, adjudicates; artifact location, permissions, retention, deletion, audit trail | **OWNER DECISION NEEDED** | A named location outside Git, a permission model, a retention and deletion rule, an audit trail | Real screens of banking and government UI would be handled with no defined custody. This is the highest-risk unresolved item after D5 | Owner defines custody before any capture |
| **D10** | How does **T2 / redaction** affect the gate? | **BLOCKED** | T2 must exist to produce the redacted half | The redacted half of the visual-context metric cannot be produced at all, so QG-05 stays partial regardless of W-A's outcome | Nothing to do until T2 exists; feeds D1 |

## Category tracking

| category | status | governing decisions |
|---|---|---|
| licensing | **OWNER DECISION NEEDED** | D3 |
| privacy | **OPEN** | D9, and the design's §9 hard stop |
| source / site terms | **BLOCKED** | **D5** |
| annotation | **OPEN** | D7, D6 |
| DOM-empty subset | **OWNER DECISION NEEDED** | D4 |
| agreement | **OWNER DECISION NEEDED** | D6 |
| acceptance threshold | **OWNER DECISION NEEDED** | **D2** |
| uncertainty | **OWNER DECISION NEEDED** | D8 |
| storage / access | **OWNER DECISION NEEDED** | D9 |
| redaction dependency | **BLOCKED** | D10, D1 |

**Nothing is SATISFIED.** Two items are hard-**BLOCKED** (D5, D10), seven need an owner ruling,
and one is engineering drafting work that still ends in an owner freeze.

## The measured constraint on D2

**This is an input to the owner's decision, not a proposed number.** No bar is selected here.

W-1 arm A was reproduced on workstation 1 against workstation 2
([AUDIT-0003](AUDIT-0003-w1-arm-a-cross-machine.md)). The V1-vs-V0 **effect** transferred almost
exactly, but the **absolute** metrics did not:

| | cross-machine variance |
|---|---|
| recall | **~0.0015** |
| grounding | **~0.0015** |
| false-positive count | **~2** |

That variance appeared on *identical* inputs, model, ORT version and evaluator — the entire
difference sat in **localization** false positives, consistent with a few borderline boxes
crossing the matcher's IoU 0.5 gate.

The consequence for D2 is narrow and concrete: **a bar expressed as a bare number within roughly
±0.0015 of a measured result is not decidable**, because two honest runs of the same evaluation on
different hardware can land on opposite sides of it. D2 should therefore either sit well clear of
that band, or state a tolerance, or specify the machine. Which of those three is the owner's call.

## Sequencing — what unblocks what

1. **D5 first.** It is the hard legal blocker and it gates all of source B. Nothing about
   collection should be built before it is answered.
2. **D2, D1, D3, D4 next.** These define the finish line and the corpus. D2 in particular must be
   fixed *before the split is sealed*, or the bar can be chosen to fit the result.
3. **D6, D7 then.** Label quality; D7 drafts, D6 sets the acceptance for it.
4. **D8, D9 before any frame exists.** Custody and uncertainty policy are cheaper to set now than
   to retrofit onto collected data.
5. **D10 rides on T2** and is not actionable in this workstream.

## What must not happen

No collection, no site visits, no screenshots, no real PII, and **no self-approval of any owner
decision above**. The frozen TEST discipline is unchanged: the rule is applied once, to an unread
split, and a consumed split is never re-reported as a first look.
