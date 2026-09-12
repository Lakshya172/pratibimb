---
id: D5-candidate-source-registry
title: "D5 — candidate source registry and evidence matrix"
status: CANDIDATE — nothing here is approved
date: 2026-09-12
workstation: 1 (LAPTOP-6E14K34L)
owner_decision: PENDING
---

# D5 — candidate source registry

> **This is a CANDIDATE list, not an approved list.** No source here is authorised for capture.
> **No real-world capture occurred.** No page content was downloaded, no screenshot taken, no
> form submitted, no account created, no credential used, nothing crawled or scraped.
>
> **No real capture may begin until the owner has explicitly resolved D5 for the selected
> sources.**

## Why this registry exists

`ADR-0004` recorded that **no source is named anywhere in this repository** — the benchmark
contract gives a *category* (*"300 self-labelled Indian government and banking screens"*) and
nothing more. D5 is therefore unanswerable as posed, because permission is a property of a named
site's terms, not of a category. This registry names candidates so the question becomes
answerable. **Naming a candidate is not proposing to capture it.**

## What was actually done to gather evidence

Public **`robots.txt`** was requested for each candidate, once, on **2026-09-12**, from this
workstation, using the session's ordinary web-read tool. That is the entire extent of contact.
Redirects were followed **only** when the target was itself a `robots.txt`; a redirect pointing
at site content was **not** followed, because that would be reading the site rather than its
policy.

**Terms-of-service evidence was NOT obtained for any candidate.** One ToS URL was attempted and
returned 404 — it had been guessed rather than discovered, and guessing further would manufacture
citations. Every ToS field below is therefore **UNKNOWN**, and that is a statement about this
registry's completeness, not about the sites.

### A finding that matters more than any single row

**Four of eight candidates refused the request outright** — HTTP 403, 403 and 418 — so their
`robots.txt` could not be read at all by ordinary automated tooling.

**That is absence of evidence, not evidence of prohibition, and it is not recorded as a refusal
of permission.** What it does establish is narrower and still useful: these origins operate
bot-mitigation at the edge that rejects non-browser clients. It makes the legal question **more**
pressing rather than less, and it means a human, in a browser, must read those policies.

## The registry

| # | origin (canonical) | organisation | category | intended scenario | why visually relevant |
|---|---|---|---|---|---|
| **G1** | `www.mygov.in` | MyGov (citizen engagement) | government / public service | public information and campaign pages, DOM-present | dense civic UI: nav, cards, forms, tables |
| **G2** | `www.india.gov.in` | National Portal of India | government / public service | directory and service-listing pages | link-dense listings, heavy small-text targets |
| **G3** | `www.incometax.gov.in` | Income Tax Department | government / tax | **public, unauthenticated** informational and downloads pages | form-heavy layout; the scanned/PDF-adjacent case |
| **G4** | `www.rbi.org.in` | Reserve Bank of India | government / regulator | public notifications and circulars | text-dense pages with tabular controls |
| **B1** | `sbi.bank.in` *(from `sbi.co.in`)* | State Bank of India | banking | **public product/marketing pages only** | real banking UI chrome, unauthenticated |
| **B2** | `www.icici.bank.in` *(from `www.icicibank.com`)* | ICICI Bank | banking | **public product pages only** | dense product grids, calculators, small controls |
| **B3** | `www.hdfcbank.com` | HDFC Bank | banking | **public product pages only** | comparable layout family, cross-vendor variety |
| **B4** | `www.npci.org.in` | NPCI (UPI operator) | financial infrastructure | public documentation and circular pages | the UPI surface the dossier's manifest schema references |

> **The `.bank.in` migration.** `sbi.co.in` and `www.icicibank.com` both issue 301s to
> `sbi.bank.in` and `www.icici.bank.in`. Canonical origin is what a source registry must record,
> and it is what a split's origin-separation rule would key on — so this is captured rather than
> normalised away.

## Evidence matrix

`YES` / `NO` / `UNKNOWN` used strictly. **UNKNOWN is never upgraded.**

| # | source | public? | auth required? | ToS evidence | robots evidence (retrieved 2026-09-12) | automation permission | restrictions visible | sensitive-data risk | project status |
|---|---|---|---|---|---|---|---|---|---|
| **G1** | mygov.in | YES | NO (for public pages) | **UNKNOWN** | **RETRIEVED.** `User-agent: *` with `Crawl-delay: 10`; **no blanket disallow**; disallows `/admin/`, `/user/`, `/api/`, `/jsonapi/`, `/service/`, core/module paths | **UNKNOWN — legal review required** | `Crawl-delay: 10`; authenticated areas disallowed | **LOW** — public civic content; no account | **READY FOR OWNER REVIEW** |
| **G2** | india.gov.in | YES | NO | **UNKNOWN** | **NOT RETRIEVED — HTTP 403** | **UNKNOWN — legal review required** | unknown | **LOW** | **UNKNOWN** |
| **G3** | incometax.gov.in | YES | NO (public pages); YES for filing | **UNKNOWN** | **NONE PUBLISHED.** `/robots.txt` 302-redirects to `/iec/foportal`; redirect **not followed** | **UNKNOWN — legal review required** | no robots directives exist to honour | **MEDIUM** — adjacent to taxpayer data; public pages only, authenticated views excluded | **UNKNOWN** |
| **G4** | rbi.org.in | YES | NO | **UNKNOWN** | **NOT RETRIEVED — HTTP 418** (bot mitigation) | **UNKNOWN — legal review required** | unknown | **LOW** — regulator publications | **UNKNOWN** |
| **B1** | sbi.bank.in | YES | NO (public pages) | **UNKNOWN** | **RETRIEVED.** `User-Agent: *` / `Disallow:` *(empty)* — permits all agents, whole site | **UNKNOWN — legal review required** | none in robots | **MEDIUM** — banking origin; public pages only, **no login** | **READY FOR OWNER REVIEW** |
| **B2** | icici.bank.in | YES | NO (public pages) | **UNKNOWN** | **RETRIEVED.** `User-agent: *` with path and file-type disallows (`/lite/*`, `/ajax/*`, `/campaigns/`, PDF/XLS/DOC/JPG); **100+ named scraper/downloader agents blocked** (Wget, Teleport, WebBandit …); no blanket disallow | **UNKNOWN — legal review required** | explicit anti-scraper posture; a headless capture's status under it is **ambiguous** | **MEDIUM** | **UNKNOWN** |
| **B3** | hdfcbank.com | YES | NO (public pages) | **UNKNOWN** | **NOT RETRIEVED — HTTP 403** | **UNKNOWN — legal review required** | unknown | **MEDIUM** | **UNKNOWN** |
| **B4** | npci.org.in | YES | NO | **UNKNOWN** | **RETRIEVED.** Named allowlist (Googlebot, Bingbot, GPTBot, ClaudeBot …); archive bots disallowed; **catch-all `User-agent: *` → `Disallow: /`** | **UNKNOWN — legal review required**, and see note | **the catch-all disallows every unnamed agent, which includes PratiBimb's harness** | **LOW** | **BLOCKED (proposed)** |

### Classification

- **A — READY FOR OWNER REVIEW (2):** **G1 mygov.in**, **B1 sbi.bank.in**. Robots evidence was
  retrieved and is permissive for public paths. **ToS is still UNKNOWN for both**, so "ready for
  review" means the owner has something concrete to review — **not** that capture is permitted.
- **B — BLOCKED, proposed (1):** **B4 npci.org.in**. Its robots.txt ends `User-agent: *` /
  `Disallow: /`, and PratiBimb's harness is not among the named agents. Recommending BLOCKED is
  an engineering reading of a published directive; **the owner decides.** Note honestly that
  robots.txt is a crawling convention, not a legal instrument, and that W-A's capture is a
  browser page-load rather than a crawl — but the project's own §3.2 excludes anything behind a
  clause forbidding automated capture, and a blanket disallow is the clearest such signal here.
- **C — UNKNOWN (5):** **G2, G3, G4, B2, B3.** Either the policy could not be retrieved
  (403/418), none is published (G3), or the published posture is ambiguous for our access mode
  (B2).

**No candidate is APPROVED. None can be, from this evidence.**

## What is still missing for every candidate

1. **Terms of service / acceptable-use**, read by a human in a browser, recorded with URL and
   date, quoting any clause on automated access, reproduction or content copyright. **Missing for
   all eight.**
2. **A legal determination.** The W-A design says it plainly: *"whether a given site's terms
   permit capture is a legal question this design does not answer."* Neither does this registry.
3. **Robots policy for G2, G3, G4, B3** — unreadable or unpublished by automated means.
4. **Copyright position on page content**, since a screenshot reproduces the page's visual
   expression and the corpus would be retained and annotated.

## Data-minimisation constraints that apply if any source is approved

Carried unchanged from W-A §3.2 / §9 and INV-04/05/21 — **nothing new is invented here**:
public unauthenticated pages only; **no real person's data, including the collector's own**; no
authenticated view of a real account; fabricated values in any form filled; capture via
`captureVisibleTab({format:"png"})` per ADR-0002; **raw frames never committed** — manifest and
annotations may be committed with no pixels at all; retention only outside Git in a named
location with access recorded; hash at ingest, `sealDataset` over the manifest.

## Owner decision form — PENDING

> **SUPERSEDED 2026-09-12 — do not sign this table.** The eight-row form below was written in
> pass 1. [`D5-policy-evidence-pass-2.md`](D5-policy-evidence-pass-2.md) then **reduced the
> candidate set to three** (G1, G2, B1) and dropped G3, G4, B2, B3 and B4 for insufficient or
> catch-all-restricted policy evidence. Signing a row for a dropped candidate would authorise a
> source the evidence does not support.
>
> **The signable form is [`D5-D2-OWNER-DECISION-PACKAGE.md`](D5-D2-OWNER-DECISION-PACKAGE.md)
> §1**, which carries one decision block per retained source. The table below is kept as the
> pass-1 record, unchanged.


| # | source | APPROVE | APPROVE WITH CONDITIONS | BLOCK | DEFER | conditions the owner may wish to impose |
|---|---|---|---|---|---|---|
| G1 | mygov.in | ☐ | ☐ | ☐ | ☐ | honour `Crawl-delay: 10`; public paths only; never `/user/` |
| G2 | india.gov.in | ☐ | ☐ | ☐ | ☐ | robots + ToS must be read in a browser first |
| G3 | incometax.gov.in | ☐ | ☐ | ☐ | ☐ | no robots published; public informational pages only; never the filing portal |
| G4 | rbi.org.in | ☐ | ☐ | ☐ | ☐ | robots + ToS must be read in a browser first |
| B1 | sbi.bank.in | ☐ | ☐ | ☐ | ☐ | public product pages only; **no login**; ToS still required |
| B2 | icici.bank.in | ☐ | ☐ | ☐ | ☐ | resolve whether a headless capture falls under the anti-scraper list |
| B3 | hdfcbank.com | ☐ | ☐ | ☐ | ☐ | robots + ToS must be read in a browser first |
| B4 | npci.org.in | ☐ | ☐ | ☐ | ☐ | catch-all `Disallow: /` applies to unnamed agents |

**All boxes are deliberately unticked. D5 remains PENDING.**
