---
id: REAL-WORLD-COLLECTION-GATE
title: "REAL-WORLD COLLECTION MAY BEGIN ONLY WHEN"
status: GATE — currently CLOSED
date: 2026-09-12
workstation: 1 (LAPTOP-6E14K34L)
---

# REAL-WORLD COLLECTION MAY BEGIN ONLY WHEN

> **Update 2026-09-12 — PR #56 is merged, and the gate is still CLOSED.** Merging it made the
> framework governing; it approved no source, adopted no gate structure, set no numeric
> threshold and authorised no collection. Conditions 1-5 are now **signable** on
> [`D5-D2-OWNER-DECISION-PACKAGE.md`](D5-D2-OWNER-DECISION-PACKAGE.md); every one of them is
> still **PENDING**, and none may be marked satisfied because a document exists.

> **This gate is CLOSED.** Every condition must be TRUE, and each is marked from repository
> evidence only — **PASS is never asserted without a record that proves it.**
>
> **Current state: 0 of 14 PASS.** No real-world capture has occurred.

| # | condition | state | evidence / what is missing |
|---|---|---|---|
| 1 | **D5 source decisions recorded** | **PENDING** | `D5-policy-evidence-pass-2.md` reduces the set to 3 (G1, G2, B1), all **DEFER**. No decision field is ticked. **No source is approved** |
| 2 | **Source-specific conditions recorded** | **PENDING** | Draft conditions exist per source in the decision matrix, unratified |
| 3 | **Required legal / owner review complete** | **PENDING** | **Not started.** G1's terms explicitly require written permission; B1's require written approval; G2's policy has never been retrieved (403) |
| 4 | **D2 framework approved as Option C** | **PENDING** | Option C is **RECOMMENDED** in `D2-acceptance-gate-protocol.md` §2a. The owner has not adopted it |
| 5 | **D2 numeric-calibration procedure frozen** | **PENDING** | Procedure is written (§4a, steps 1–9) but **not ratified**, and `G/R/M/S/G_min` are all PENDING |
| 6 | **D1/D3/D4/D6/D7/D8/D9 satisfy governance** | **PENDING** | `AUDIT-0004`: none SATISFIED. D10 (T2) additionally **BLOCKED** — the redacted half is unproducible |
| 7 | **Annotation guidelines frozen** | **PENDING** | W-A §4 drafted; worked examples not frozen (D7) |
| 8 | **Leakage-prevention procedure frozen** | **PENDING** | W-A §5.3 specifies split-by-page-then-origin; **not ratified**, and `assertNoLeakage` alone is insufficient for real screens |
| 9 | **Privacy / minimisation procedure frozen** | **PENDING** | W-A §9 drafted, carried from INV-04/05/21; **not ratified** |
| 10 | **Environment matrix frozen** | **PENDING** | W-A §3.1 lists axes; the exact environment list that Gate 2's spread is computed over is **undefined** |
| 11 | **Collection protocol frozen** | **PENDING** | Not written. Capture format is fixed by ADR-0002 (`png` only); the rest is not |
| 12 | **No credentials / authenticated screens** | **PASS (vacuously)** | None exist. Nothing has been collected, no account created, no credential used. **Remains a standing constraint, not an achievement** |
| 13 | **No private user data** | **PASS (vacuously)** | None exists. Same standing constraint |
| 14 | **No test split has been read** | **PASS (vacuously)** | **No real test split exists.** Separately: the *historical synthetic* test split was consumed under the old rule and is closed forever — it is never re-scored and never called independent |

**Rows 12–14 are marked "vacuously" deliberately.** They are true because nothing has happened,
not because a safeguard was built and verified. Counting them as progress would misread the gate.

**Substantive conditions met: 0 of 11.**

## The two hard blockers

1. **D5 (row 3).** No source has evidence permitting capture. The three retained candidates all
   carry a **written-permission requirement**, and obtaining that permission is an action outside
   this repository.
2. **D10 / T2 (row 6).** Benchmark contract Rule 2 requires the visual-context metric **twice —
   clean and redacted**. The redacted half needs T2, which does not exist. Even a perfect clean
   run leaves item 11 partially unmet, and that must be said up front rather than discovered at
   the end.

## What must never happen

No capture before rows 1–11 are TRUE. No dataset sealed before **D2's numbers are recorded**. No
TEST read before the DEV calibration is complete and the gate values are frozen. **No gate tuned
on TEST, ever.** A collection run that starts early cannot be made compliant afterwards — the
frames already exist.
