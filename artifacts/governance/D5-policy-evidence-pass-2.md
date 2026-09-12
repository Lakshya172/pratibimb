---
id: D5-policy-evidence-pass-2
title: "D5 — second policy-evidence pass, and the reduced candidate set"
status: EVIDENCE — no source is approved
date: 2026-09-12
workstation: 1 (LAPTOP-6E14K34L)
owner_decision: PENDING
supersedes_classification_in: D5-candidate-source-registry.md
---

# D5 — policy evidence, pass 2

> **No real capture occurred.** No page was collected for a dataset, no screenshot taken, no
> form submitted, no login, no account, no credential, nothing crawled or scraped, no bot
> protection bypassed. Only official policy pages were read.
>
> **No source is approved. The reduced set below contains no APPROVE recommendation.**

## Method, and why pass 1 was not enough

Pass 1 read `robots.txt` and stopped, because a ToS URL had been **guessed** and 404'd. Guessing
policy URLs is how fabricated citations get made, so this pass uses **search to locate the
authoritative page, then retrieves that exact URL** and quotes it. Every URL below is one that
was actually returned and actually fetched, or is explicitly marked as not retrieved.

**Retrieval date for everything here: 2026-09-12.**

## The finding that changes the D5 picture

**Pass 1 classified G1 (`mygov.in`) and B1 (`sbi.bank.in`) as READY FOR OWNER REVIEW on the
strength of permissive `robots.txt`. Both turn out to be restricted by their own terms.** That is
the whole reason robots.txt is not the legal instrument, demonstrated on this project's own
candidates.

**Not one of the eight candidates has evidence permitting automated capture.** Three carry
affirmative restrictions; five remain UNKNOWN.

## Evidence

### G1 — `www.mygov.in` · **RESTRICTIVE (explicit)**

- **Policy URL retrieved:** `https://www.mygov.in/simple-page/terms-conditions`
- **Title:** *Terms & Conditions | MyGov*
- **Verbatim:**
  > "You will not use any robot, spider, other automatic software or device, or manual process
  > to monitor or copy MyGov without Provider's prior written permission."

  > "The use of any software (e.g. bots, scraper tools) or other automatic devices to access,
  > monitor or copy the website pages is prohibited unless expressly authorized by the MyGov in
  > writing."

  > "You will not copy, modify, reproduce, republish, distribute, display, or transmit for
  > commercial, non-profit or public purposes all or any portion of MyGov, except to the extent
  > permitted by the copyright policy of this terms of use."

  > "You may not decompile, reverse engineer, disassemble, rent, lease, loan, sell, sublicense,
  > or create derivative works from MyGov."
- **Automated collection explicitly permitted?** **NO.**
- **Explicitly prohibited?** **YES — unless expressly authorised in writing.**
- **Browser-rendered visual capture addressed?** Not by name; *"other automatic devices to
  access… the website pages"* is broad enough that reading it as excluding a headless browser
  would be an interpretation this document does not make.
- **Derived annotations addressed?** *"create derivative works"* is prohibited. Whether
  annotations over a capture are derivative works is **a legal question, not answered here.**
- **Status:** **UNKNOWN — legal confirmation required**, on a base of an explicit written-permission
  requirement. Permission is **requestable**, which is why G1 survives the reduction.

### G2 — `www.india.gov.in` · **NOT RETRIEVED**

- **Policy URL located by search:** `https://www.india.gov.in/website-policy` — **fetch returned
  HTTP 403. The page was not read.**
- Search result summaries describe a copyright policy under which material *"may be reproduced
  free of charge after taking proper permission by sending a mail"*, with accuracy,
  non-derogatory-use and source-acknowledgement conditions. **This is a search summary, not
  retrieved evidence, and it is not quoted as though it were.**
- **Status:** **UNKNOWN — policy not retrieved.** Retained in the reduced set only because the
  summary indicates a **permission-request route exists**; that must be verified by a human
  reading the page.

### G3 — `www.incometax.gov.in` · **NO POLICY LOCATED**

- `robots.txt` 302-redirects to portal content (pass 1); redirect not followed.
- No authoritative site-wide terms/copyright page was located for the **public informational**
  surface. **Status: UNKNOWN.**

### G4 — `www.rbi.org.in` · **NO COMPREHENSIVE POLICY LOCATED**

- `robots.txt` returned HTTP 418 (pass 1).
- Search located a disclaimer page (`/commonman/english/scripts/Disclaimer.aspx`) concerning
  accuracy and liability; **no comprehensive terms-of-use or reproduction policy was located**,
  and the disclaimer was not retrieved for this pass.
- **Status: UNKNOWN.**

### B1 — `sbi.bank.in` · **RESTRICTIVE (reproduction)**

- **Policy URL retrieved:** `https://sbi.bank.in/web/customer-care/disclaimer`
- **Title:** *Disclaimer - Customer Care*
- **Verbatim:**
  > "The content of this website shall not be displayed or printed in any form in part or whole
  > without the prior written approval of SBI (State Bank of India)."
- **Automated access addressed?** **NO** — the page contains no robots/scraping clause.
- **Reproduction addressed?** **YES**, broadly. Whether a retained screenshot is a *"display…in
  any form"* is **a legal question, not answered here.**
- Note: SBI's `terms_of_service.html` governs the **Internet Banking Service** — the
  authenticated product — and is **not** the instrument for public-page use. It is recorded so
  nobody later cites the wrong document.
- **Status:** **UNKNOWN — legal confirmation required**, on a base of an explicit
  written-approval requirement. Permission is **requestable**.

### B2 — `www.icici.bank.in` · **AMBIGUOUS**

- `robots.txt` (pass 1): path and file-type disallows, **100+ named scraper/downloader agents
  blocked**, no blanket disallow. No terms page located in this pass.
- **Status: UNKNOWN**, and the anti-scraper posture makes a headless capture's position
  ambiguous rather than merely unaddressed.

### B3 — `www.hdfcbank.com` · **NO EVIDENCE**

- `robots.txt` HTTP 403 (pass 1); no policy located in this pass. **Status: UNKNOWN.**

### B4 — `www.npci.org.in` · **RESTRICTIVE (robots catch-all)**

- `robots.txt` (pass 1) ends `User-agent: *` → `Disallow: /`; PratiBimb's harness is not a named
  agent. No terms page located.
- **Status: proposed BLOCK.** Stated as an engineering reading of a published directive — robots
  is a crawling convention, not a legal instrument — but combined with no located terms, there is
  nothing here to build an approval on.

## Reduced candidate set

**Retained — 3, all as DEFER pending written permission. None recommended for APPROVE.**

| # | source | why retained |
|---|---|---|
| **G1** | `www.mygov.in` | the **only** candidate with a clear, retrieved, authoritative policy. It prohibits automated access **without written permission**, which means there is a defined permission route and an identifiable counterparty |
| **G2** | `www.india.gov.in` | a permission-request route is indicated; government content, low sensitivity. **Requires a human to read the policy**, which this tooling cannot |
| **B1** | `sbi.bank.in` | the only banking candidate with a retrieved site-level policy. Restriction is **permission-gated**, so a request is possible. Public product pages only |

**Excluded — 5:**

| # | source | reason (not legal advice) |
|---|---|---|
| G3 | incometax.gov.in | **insufficient policy evidence** — no robots published, no site-wide terms located. Also the highest sensitivity of the government set |
| G4 | rbi.org.in | **insufficient policy evidence** — robots unreadable (418), no comprehensive policy located |
| B2 | icici.bank.in | **ambiguous automation status** — explicit anti-scraper agent list with no terms page to resolve it |
| B3 | hdfcbank.com | **insufficient policy evidence** — robots unreadable (403), no policy located |
| B4 | npci.org.in | **explicit restriction** — catch-all `Disallow: /` for unnamed agents |

Exclusion here means **"cannot be reviewed on present evidence"**, not "unlawful". None of this
is legal advice.

## D5 decision matrix — reduced set

| field | **G1 mygov.in** | **G2 india.gov.in** | **B1 sbi.bank.in** |
|---|---|---|---|
| **SCOPE** | public information/campaign pages | public service-listing pages | public product/marketing pages |
| **PERMITTED SURFACE** *(if ever approved)* | public paths only; never `/user/`, `/admin/`, `/api/` | public paths only | public product pages only |
| **AUTHENTICATION** | **NONE** — excluded | **NONE** — excluded | **NONE** — excluded; never the banking portal |
| **POLICY EVIDENCE** | **RETRIEVED** — explicit written-permission requirement | **NOT RETRIEVED** (403); permission route indicated by search only | **RETRIEVED** — prior written approval for display/printing |
| **ROBOTS EVIDENCE** | `Crawl-delay: 10`, no blanket disallow | **not retrieved** (403) | `Disallow:` empty — permits all agents |
| **LEGAL STATUS** | **UNKNOWN — legal confirmation required** | **UNKNOWN — legal confirmation required** | **UNKNOWN — legal confirmation required** |
| **OWNER DECISION** | ☐ APPROVE ☐ APPROVE WITH CONDITIONS ☐ BLOCK ☐ DEFER — **PENDING** | ☐ APPROVE ☐ APPROVE WITH CONDITIONS ☐ BLOCK ☐ DEFER — **PENDING** | ☐ APPROVE ☐ APPROVE WITH CONDITIONS ☐ BLOCK ☐ DEFER — **PENDING** |
| **CONDITIONS** | written permission obtained and filed; honour `Crawl-delay: 10` | policy read by a human; written permission obtained and filed | written approval obtained and filed; public pages only |

**Default conditions on any approval** — carried from W-A §3.2/§9 and INV-04/05/21, nothing new
invented: public pages only · no login or authenticated state · no personal data submitted · no
account or session captured · no prohibited paths · **stop immediately if a source's policy is
ambiguous or restrictive** · `captureVisibleTab({format:"png"})` per ADR-0002 · raw frames never
committed.

**All decision fields are deliberately unticked. D5 remains PENDING. No approval is recorded.**

## What this pass did not establish

It did not establish that any source **permits** capture — no candidate produced such evidence.
It did not read the policies of G2, G3, G4, B2 or B3. It made **no legal determination** about
any clause, including whether a screenshot is a *"display"*, whether annotations are *"derivative
works"*, or whether a headless browser is an *"automatic device"*. Those are the questions the
owner's legal review has to answer, and three of them are now concrete enough to ask.
