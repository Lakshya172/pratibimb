# D5 + D2 — owner decision package

> **Status: AWAITING OWNER. Nothing here is approved, and nothing here approves anything.**
>
> PR #56 is merged, so the **framework** below is the governing one. **Merging PR #56 did not
> approve any source, did not adopt Option C, did not set any numeric threshold, and did not open
> the collection gate.** The real-world collection gate remains **CLOSED**.
>
> This document exists to make the remaining decisions **signable**: one page per retained
> source, a decision block per source, and a D2 sheet that explains each symbol without choosing
> its value. It adds **no new evidence** and **no new legal conclusion**.

**Prepared on workstation 2** (`LAPTOP-SRCINK2B`) at main `915b97d`. Documentation only — no
data was collected, no site was visited, no page was captured.

## Not legal advice

Everything in §1 is **engineering evidence about what a retrieved document says**. Whether a
headless browser capture is *"use of… other automatic devices"*, whether a retained screenshot is
a *"display… in any form"*, and whether annotations over a capture are *"derivative works"* are
**legal questions this document does not answer and must not be read as answering.** Each source
page below names the unresolved question rather than resolving it.

---

## 1. D5 — per-source decision pages

The candidate set was reduced from eight to three by
[`D5-policy-evidence-pass-2.md`](D5-policy-evidence-pass-2.md). The five dropped candidates
(G3 `incometax.gov.in`, G4 `rbi.org.in`, B2 `icici.bank.in`, B3 `hdfcbank.com`,
B4 `npci.org.in`) are **not on this form** and are not proposed for any decision.

---

### G1 · `www.mygov.in`

| | |
|---|---|
| **Proposed public surface** | public information and campaign pages only. **Never** `/user/`, `/admin/`, `/api/`. No login, no form submission |
| **Policy evidence** | **RETRIEVED.** `https://www.mygov.in/simple-page/terms-conditions` — *"Terms & Conditions \| MyGov"* |
| **Verbatim** | *"You will not use any robot, spider, other automatic software or device, or manual process to monitor or copy MyGov without Provider's prior written permission."* · *"The use of any software (e.g. bots, scraper tools) or other automatic devices to access, monitor or copy the website pages is prohibited unless expressly authorized by the MyGov in writing."* · *"You may not … create derivative works from MyGov."* |
| **Robots evidence** | `Crawl-delay: 10`; **no blanket disallow** |
| **Automated collection** | **PROHIBITED unless expressly authorised in writing** |
| **Known restriction** | an explicit written-permission requirement, plus a derivative-works prohibition |
| **Permission route** | **request written permission from the MyGov operator** (MeitY / NIC, per the portal's own ownership statements) before any capture. The route exists and is named in the terms themselves — which is the only reason G1 survived the reduction |
| **Proposed conditions** | written permission obtained and **filed in the repository** before collection; honour `Crawl-delay: 10`; public paths only; no login; no form submission |
| **Unresolved legal question** | whether a headless-browser visual capture is *"other automatic devices to access… the website pages"*, and whether stored annotations over a capture are *"derivative works"*. **Not answered here** |
| **Engineering recommendation** | **DEFER** — become APPROVE WITH CONDITIONS only once written permission is filed. The evidence supports a permission request; it does not support capture |

**Owner decision — G1**

```
SOURCE:   G1 · www.mygov.in
DECISION: [ ] APPROVE   [ ] APPROVE WITH CONDITIONS   [ ] BLOCK   [ ] DEFER
CONDITIONS (required verbatim if APPROVE WITH CONDITIONS):
  ______________________________________________________________
  ______________________________________________________________
DECIDED BY: ____________________   DATE: ____________
```

---

### G2 · `www.india.gov.in`

| | |
|---|---|
| **Proposed public surface** | public service-listing pages only. No login, no form submission |
| **Policy evidence** | **NOT RETRIEVED.** `https://www.india.gov.in/website-policy` returned **HTTP 403**. **The page was not read** |
| **Verbatim** | **none available.** Search-result summaries describe a copyright policy permitting free reproduction *after permission by email*, with accuracy, non-derogatory-use and source-acknowledgement conditions. **That is a search summary, not retrieved policy, and it is not quoted as authoritative** |
| **Robots evidence** | **not retrieved** (403) |
| **Automated collection** | **UNKNOWN** |
| **Known restriction** | **unknown.** The absence of retrieved evidence is not evidence of permission |
| **Permission route** | **indicated by search only** — an email permission request. **Must be confirmed by a human reading the authoritative page** |
| **Proposed conditions** | a human reads `website-policy` and `robots.txt` **in a normal browser** and files what they say; written permission obtained and filed; public paths only |
| **Unresolved legal question** | **everything.** Status stays **UNKNOWN until authoritative policy is obtained.** No interpretation is possible from a 403 |
| **Engineering recommendation** | **DEFER.** G2 cannot move on engineering evidence at all — it needs a human to read one page |

**Owner decision — G2**

```
SOURCE:   G2 · www.india.gov.in
DECISION: [ ] APPROVE   [ ] APPROVE WITH CONDITIONS   [ ] BLOCK   [ ] DEFER
PREREQUISITE (blocking): authoritative website-policy and robots.txt read by a human and filed
CONDITIONS (required verbatim if APPROVE WITH CONDITIONS):
  ______________________________________________________________
  ______________________________________________________________
DECIDED BY: ____________________   DATE: ____________
```

---

### B1 · `sbi.bank.in` — **public product pages only**

| | |
|---|---|
| **Proposed public surface** | **public product and marketing pages only.** **NOT** Internet Banking. No login, no account, no credential, no session, no authenticated view of anything |
| **Policy evidence** | **RETRIEVED.** `https://sbi.bank.in/web/customer-care/disclaimer` — *"Disclaimer - Customer Care"* |
| **Verbatim** | *"The content of this website shall not be displayed or printed in any form in part or whole without the prior written approval of SBI (State Bank of India)."* |
| **Robots evidence** | `Disallow:` **empty** — permits all agents |
| **Automated access** | **not addressed** — the page contains no robots or scraping clause |
| **Known restriction** | an explicit **prior-written-approval** requirement on display or printing of content |
| **Permission route** | **request prior written approval from SBI** before any capture, and file it |
| **Proposed conditions** | written approval obtained and filed; **public product pages only**; **no login under any circumstances**; no form submission; raw frames never committed |
| **Unresolved legal question** | whether a retained screenshot constitutes *"displayed or printed in any form"*. **Not answered here** |
| **Do not confuse** | SBI's `terms_of_service.html` governs the **Internet Banking Service** — the authenticated product — and is **not** the instrument for public-page use. Recorded so the wrong document is never cited |
| **Engineering recommendation** | **DEFER** — APPROVE WITH CONDITIONS only once written approval is filed |

**Owner decision — B1**

```
SOURCE:   B1 · sbi.bank.in (public product pages only)
DECISION: [ ] APPROVE   [ ] APPROVE WITH CONDITIONS   [ ] BLOCK   [ ] DEFER
CONDITIONS (required verbatim if APPROVE WITH CONDITIONS):
  ______________________________________________________________
  ______________________________________________________________
DECIDED BY: ____________________   DATE: ____________
```

---

### W-A baseline conditions — apply to **every** approved source, in addition to its own

Carried unchanged from `artifacts/experiments/WA-item11-real-ui-evaluation/design.md` §3.2 and
§9, and from ADR-0002. **These are not new conditions and are not negotiable by a source
decision.**

1. **Public pages only.**
2. **No login.** No account creation, no credential of any kind.
3. **No authenticated or session capture.**
4. **No personal-data submission.** Fabricated values only, where a form must be shown at all.
5. **No prohibited paths** — whatever the source's own policy and robots exclude.
6. **Stop if policy becomes ambiguous or more restrictive.** Ambiguity halts collection; it does
   not get interpreted in our favour.
7. **PNG capture only**, per ADR-0002.
8. **Raw frames are never committed.** Stored outside Git, named location, access recorded.

Anything the owner adds beyond these eight is a **proposed owner condition** and is labelled as
such, not as a governance requirement derived from evidence.

---

## 2. D2 — numeric gate decision sheet

**No value is proposed in this document.** The framework is
[`D2-acceptance-gate-protocol.md`](D2-acceptance-gate-protocol.md); **Option C is RECOMMENDED
there and has not been adopted.** Adopting the structure and choosing the numbers are two
separate decisions, and the second one cannot legitimately happen yet.

### What each quantity controls, and why it exists

```
Gate 1 — pooled performance
    g ≥ G        AND    r ≥ R        AND    m ≥ M

Gate 2 — environment robustness
    max_e(g_e) − min_e(g_e) ≤ S      AND    min_e(g_e) ≥ G_min

PASS ⇔ Gate 1 ∧ Gate 2
```

| symbol | controls | why it exists | value |
|---|---|---|---|
| `G` | pooled **grounding** floor | grounding is per-prediction precision — the quantity item 11 actually failed on (0.055). Without a floor here, a detector that emits hundreds of boxes per screen can pass on recall alone | **PENDING** |
| `R` | pooled **recall** floor, read against the corpus's **own measured CLIPPED ceiling** | stops `G` being satisfied by a detector that emits almost nothing. Reading it against 1.0 instead of the measured ceiling would make the bar unreachable for arithmetic reasons rather than detector reasons | **PENDING** |
| `M` | pooled **mAP@0.5** floor | the contract's figure. It is nearly threshold-invariant, so it belongs in the report and must **never** be the quantity anything is selected on — that property is what broke the superseded rule | **PENDING** |
| `S` | allowable **across-environment grounding spread** | a detector that scores well pooled but collapses in one browser or at one viewport is not adoptable. `S` is what makes "works everywhere we ship" decidable | **PENDING** |
| `G_min` | **per-environment** grounding floor | a small spread is meaningless if every environment is equally bad. `G_min` stops `S` being satisfied by uniform failure | **PENDING** |

### What evidence calibrates them

- `G`, `R`, `M` — **DEV-only** performance on the real corpus, at the operating point the frozen
  rule selects on **real DEV data**.
- `S`, `G_min` — the **repeatability measurement**: the sealed corpus scored **k ≥ 3 times per
  environment**, with `S` derived from the observed spread. **This measurement does not exist**,
  and it is the binding prerequisite for Gate 2.

### What must be frozen before calibration

The **exact environment list** `e` (without it, `max_e − min_e` is undefined); the corpus and its
splits; the leakage rules; the CLIPPED handling and the measured ceiling; the clean/redacted
reporting shape; and the D2 **structure** itself with values still unset.

### What must remain DEV-only, and when TEST may open

**Everything above is DEV-only.** TEST may be opened **once**, and only after `G/R/M/S/G_min` are
chosen, justified and approved in a dated amendment.

**Why exactly once:** a held-out figure means "the first look". A split read twice produces a
number whose honest provenance is *"the second look at a consumed split"* — and the project
already carries one of those: the historical synthetic test split, read under the superseded
rule, closed forever and never re-scored. That is the mistake this rule exists to not repeat.

**Why the gate cannot be tuned after TEST:** a bar adjusted once the figure is visible is no
longer a test of the detector, it is a description of the choice. If the figure misses an
approved bar, the result is **FAIL** — the remedy is better perception or a new corpus, recorded
as such, **not** a revised bar.

### Calibration order — frozen, and step 6 has not been reached

1. Freeze the evaluation design.
2. Seal the dataset; **TEST stays unopened**.
3. Freeze the D2 structure with `G/R/M/S/G_min` **unset**.
4. Collect **DEV-only** evidence.
5. Estimate achievable performance **and** cross-environment spread (needs the k ≥ 3 repeatability
   measurement).
6. Select `G/R/M/S/G_min` by the documented rule, recorded with justification **before** TEST.
7. Owner approves a **dated amendment**.
8. **Unlock TEST once.**
9. **Never tune the gate on TEST.**

**Current position: step 0.** No real corpus exists, so steps 1–9 are all ahead.

### Owner decision — D2

```
D2 STRUCTURE
DECISION: [ ] ADOPT Option C   [ ] ADOPT Option A   [ ] ADOPT Option B   [ ] DEFER
  (Option C is the engineering recommendation; adopting the structure sets no number)

D2 NUMERIC VALUES
DECISION: [ ] DEFER until calibration step 6   [ ] other: ______________________
  G = ______   R = ______   M = ______   S = ______   G_min = ______
  (these MUST stay blank until step 6; a number entered now is fitted to nothing)

ENVIRONMENT LIST e (required before Gate 2 is decidable):
  ______________________________________________________________

DECIDED BY: ____________________   DATE: ____________
```

---

## 3. Machine variance — what it is, and what it is not

One paired **synthetic** W1/W2 reproduction of W-1 arm A, from `AUDIT-0003`: grounding
**0.5716** vs **0.5701** (difference **−0.0015**), recall difference **−0.0013**, mAP difference
**+0.0001**, associated with a **±2-box** localization false-positive variation over 40 synthetic
screens. Duplicate, classConfusion and spurious counts were **identical** on both machines.

**This is one observation.** It is **not** a standard deviation, **not** a confidence interval,
**not** a universal tolerance, and **not** sufficient to define `S` — and it must never be
reused as one. Three reasons, recorded in the protocol: it is a single paired difference, so any
"±" would describe a spread nobody estimated; it is a **count effect on a fixed denominator**
(2 boxes in ~4,848 predictions), and both change on 300 real screens; and it is **synthetic**,
while the quantity that produced it — box density near the IoU 0.5 gate — is a property of the
box-size distribution, which differs on real UI.

**Repeated DEV evidence under the real protocol is required before any tolerance is selected.**
No additional repeats were manufactured for this document, and none should be manufactured
merely to produce an uncertainty number.

What the observation **does** establish, and it is a real constraint on D2's *form*: absolute
metric values from this pipeline are **not bitwise reproducible across machines**, so a bar
expressed as a bare equality at four decimal places would not be decidable by two honest runs.

---

## 4. Four states that must never be conflated

| state | meaning | current |
|---|---|---|
| **Engineering-ready** | the protocol, harness and evidence requirements are specified | **mostly yes** — W-A design, D2 framework, D5 evidence all exist |
| **Owner-approved** | `ronitsaha11` has recorded a decision | **NO** — every decision on this form is blank |
| **Legally approved** | written permission filed for each named source | **NO** — not requested for any source |
| **Collection-authorised** | the gate's conditions are all satisfied | **NO — the gate is CLOSED** |

**PR #56 moved only the first.** Nothing in this document moves any of the others.
