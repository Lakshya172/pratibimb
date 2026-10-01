---
id: ADR-0010
title: "The change policy under explicit capture — narrowing constitution §6 to the structural signal"
version: 2.0
status: APPROVED — Option B (narrow); owner decision recorded in §0; constitution §5, §6 and §7 amended
owner: pratibimb-architect
proposed_by: pratibimb-architect
approved_by: ronitsaha11 (Ronit Saha)
approved_on: 2026-09-24
created: 2026-09-24
modified: 2026-09-24  # rev 2.0: Option B approved by the owner, amendment executed
supersedes: none
amends: "docs/architecture/constitution.md §5 (Change signal row), §6 (signal table + consequence), §7 (T0 row + firing note)"
related_gates: none
related_invariants: none weakened
---

# ADR-0010 — The change policy under explicit capture

> **STATUS: APPROVED 2026-09-24** by the repository owner and architecture decision-maker,
> **Ronit Saha** (`ronitsaha11`), whose decision is recorded verbatim in §0. **Option B — narrow.**
>
> **This does not reopen ADR-0009 and does not dilute it.** ADR-0009 remains APPROVED and unchanged
> in meaning: gesture-authorised stream capture is the product capture path. ADR-0010 sits
> *underneath* it and answers a question ADR-0009 raised but did not settle — what becomes of §6's
> two capture-bearing change signals once a frame is taken only when a person asks for one.
>
> **Approval is not a readiness claim, and it is emphatically not approval for autonomous capture.**
> The three statuses are kept apart wherever this ADR is cited:
>
> | | |
> |---|---|
> | **ARCHITECTURALLY APPROVED** | the narrowing, by the owner, here |
> | **NOT YET VERIFIED** | the structural signal itself — **no observer is wired in the tree** (§2) |
> | **NOT production readiness** | not claimed by this ADR, by ADR-0009, or by the owner |

---

## 0. The owner decision, as given

> I, Ronit Saha, as the repository owner / architecture decision-maker, explicitly APPROVE:
>
> ADR-0010 — OPTION B: NARROW
>
> The owner-approved direction is:
>
> > §6 shall retain the structural change signal as the v1 mechanism in force.
> > Visual polling and full-frame safety-net capture are deferred pending a separately approved ADR
> > naming and validating their capture mechanism.
> > No autonomous capture, periodic polling, retry loop, or safety-net capture is part of the v1
> > product contract unless separately approved.
>
> Do NOT reinterpret this as approval for autonomous capture.
>
> The intended v1 architecture is:
>
> EXPLICIT HUMAN CAPTURE → ACTIVE TAB AUTHORIZATION → OPAQUE STREAM HANDLE → OFFSCREEN PIXEL OWNER
> → LOCAL PERCEPTION → LOCAL PRIVACY → SANITIZED REASONING
>
> Therefore v1 does NOT include: autonomous visual polling · periodic capture · low-rate full-frame
> safety-net capture · autonomous capture retry loops · silent capture fallback · permission
> widening to avoid user invocation.

The owner deliberately did **not** specify wording, status labels or documentation mechanics, and
delegated those to the repository's conventions. §5 records what was chosen and why.

### 0.1 The v1 semantics, in one table

| Mechanism | v1 status | Returns only by |
|---|---|---|
| Structural change signal (MutationObserver / ResizeObserver) | **IN FORCE** | — it is the v1 mechanism |
| Visual dHash polling over enumerated dynamic regions | **DEFERRED** | a separate approved ADR naming and validating its capture mechanism |
| Low-rate full-frame dHash safety net | **WITHDRAWN FROM v1** | a separate approved ADR |
| Autonomous periodic capture | **NOT PART OF v1** | a separate approved ADR |
| Autonomous capture retry | **NOT PART OF v1** | — forbidden by `capture-policy.md`, in force |
| Silent capture fallback | **NOT PART OF v1** | — forbidden by ADR-0009 §0, an owner prohibition |
| Future change-driven capture | **REQUIRES A SEPARATE ADR AND VALIDATION** | that ADR, before implementation |

"DEFERRED" and "WITHDRAWN FROM v1" both mean *not in the v1 product contract*. The difference is
intent, not permission: deferred says the mechanism is still wanted and needs a mechanism decision;
withdrawn says the mechanism as described cannot exist under the approved capture policy at all.
Neither may be built without a new approved ADR.

---

## 1. Why this decision was needed

### 1.1 What was already approved

**ADR-0009, APPROVED 2026-09-24.** Its derived policy, `docs/architecture/capture-policy.md`, is in
force: *"A frame is taken only when a person has just asked for one, and never otherwise"*, with
*"no periodic polling"*, *"no autonomous repeated capture"*, no retry after a quota refusal, no
silent substitution and no permission widening.

### 1.2 What §6 still required

§6 was FROZEN and is a faithful transcription of the governing dossier. It named three signals, two
of which cost a capture: dHash over enumerated dynamic regions *"at a bounded poll rate"* — *"one
partial capture per poll"* — and a *"full-frame dHash at a low fixed interval"* — *"one capture per
interval, capped"*. §5's *Change signal* row repeated all three as the frozen stack choice.

### 1.3 The contradiction, sentence by sentence

Four collisions of three kinds. Only the first was a flat contradiction.

**C1 — hard contradiction.** A safety net that runs only when a person asks is not a safety net; the
entire purpose of the row is to catch what happens when nobody is asking. **The full-frame safety
net could not exist as described.** No reading held both sentences. *Resolved: WITHDRAWN FROM v1.*

**C2 — definitional collision, wider than capture.** §6 never said *by what mechanism* a dynamic
region is hashed. A content script reading a same-origin `<canvas>` through `getImageData` takes no
tab capture and no `activeTab` grant, yet still trips *"nothing wakes up to look at a page"*. Which
mechanism §6 intended **was not recoverable from the text**. *Resolved: DEFERRED, and the amendment
says in terms that a future ADR must name and validate the mechanism.*

**C3 — pre-existing, and not created by ADR-0009.** §5's Capture row asserted *"the change gate does
not depend on"* capture. That clause is **original frozen text**, present at `a3ff71c` before the
ADR-0009 amendment carried it forward, and it was always inaccurate against §6, where two of three
signals cost a capture each. *Resolved without an edit: see §5.4.*

**C4 — a magnitude, not a rule.** §7's T0 row projected *"~100 evaluations / ~8 captures"* on a
ten-step form task. Under explicit capture the figure is approximately one capture per invocation,
one invocation per document. *Resolved by a note, not by a new number: see §5.3.*

---

## 2. The audit this rests on

Read from the files on 2026-09-24 at `23a41fc`, before any edit. Every *already implemented* cell is
a grep of `apps/`, `packages/*/src` and `tests/`, excluding `dist/`.

| §6 mechanism | Requires autonomous capture? | Compatible with the approved policy? | Already implemented? |
|---|---|---|---|
| **Structural** — MutationObserver + ResizeObserver | **No** | **Yes** | **No.** `ChangeGate.evaluate` accepts and debounces a `STRUCTURAL` signal, but **no `MutationObserver`, `ResizeObserver` or `IntersectionObserver` exists anywhere in `apps/` or `packages/*/src`**, and `ChangeGate` has zero callers outside its own tests |
| **Visual** — bounded dHash over enumerated regions | **Unspecified by §6.** Tab capture → yes; same-origin canvas read → no capture, but still a timer | **No** (C2) | **No.** `registerDynamicRegion`, `dynamicRegionPollMs` and `maxDynamicRegions` exist as scaffolding; **no poller, no region enumeration and no dHash exist anywhere in the repository** |
| **Safety net** — low-rate full-frame dHash | **Yes, necessarily** | **No** (C1) | **No.** `shouldHashFullFrame` and `fullFrameHashIntervalMs` exist; **no caller** |

**No scheduler exists.** The only `setInterval` in the product bundle is WXT framework code —
`ContentScriptContext`'s location-change fallback for browsers without the Navigation API. It is not
ours and it takes no captures.

**Nothing in the product depended on any disputed mechanism.** That is why this could be decided
calmly, and why it was decided before a scheduler exists rather than after.

**The structural signal is IN FORCE as a contract item and NOT YET IMPLEMENTED as a fact.** This ADR
states both and conflates neither. Nothing was written to make §6 look implemented.

---

## 3. The alternatives, recorded

Recorded rather than deleted, because a future milestone that finds the v1 blind spot intolerable
should reopen this decision with evidence rather than work around it.

### Option A — withdraw both capture-bearing signals from §6 · **REJECTED**

§6 would become a structural-signal policy, the Visual and Safety-net rows deleted. Rejected because
deleting frozen text the dossier argues for is the least reversible option available, and because
the dossier's analysis remains correct whatever the status of its mechanisms — MutationObserver
genuinely cannot see a canvas repaint, and a reader needs to know that.

### Option B — narrow rather than delete · **APPROVED, and executed in §5**

### Option C — keep bounded autonomous capture and narrow the capture policy instead · **NOT ADOPTED**

Recorded because it is genuinely supported and a future reader should not have to rediscover it:

- The owner's SHALL NOT list in ADR-0009 §0 forbids `captureVisibleTab` as the normal path, silent
  fallback, `<all_urls>`, simulated gestures and weakened `activeTab`/`tabCapture` semantics.
  **None of those forbid a second frame from a stream a person already authorised.**
- **FACT (code read, `apps/extension/host-lib/capture-authority.ts:230`):** `ticketFor` may be
  called repeatedly against a live grant; Chrome mints a fresh handle each time, and the `issued`
  set only guards against a duplicate handle coming back. No change to the authority would be
  needed to capture twice.
- **FACT (code read, `apps/extension/host-lib/perception-realm.ts`):** the realm calls
  `track.stop()` after one frame by explicit decision — *"One frame, then the tab stops being
  captured. A live track is an open camera."*
- **UNKNOWN:** whether a tab track survives and `grabFrame()` keeps working across a bounded poll
  under one `activeTab` grant, and at what rate Chrome throttles it. **Never measured.**
  `MEASURED_CAPTURE_ENVELOPE` measured `captureVisibleTab`, a different API.

Not adopted. The owner chose B, and C could not have been approved on today's evidence in any case:
it would have required a spike first, plus a `privacy-security-engineer` assessment under amendment
procedure step 4, because a live track between invocations is not what the side panel's one line
describes to the person using it.

---

## 4. Tradeoffs the decision accepts

| | **A — withdraw** | **B — narrow (chosen)** | **C — bounded autonomous capture** |
|---|---|---|---|
| **Security / privacy** | Strongest | **Identical to A today** — a deferral is a door, not an opening | Materially weaker; engages the privacy-security veto |
| **UX** | Unchanged; stale visual state until a person re-invokes | **Unchanged** | Better within a document |
| **Automation** | Lowest | **Lowest — accepted** | Highest |
| **Resource use** | Lowest | **Lowest** | A poll loop and a live encoder on an unmeasured floor |
| **Consistency with what is built** | High | **Highest — describes the tree exactly, changes no code** | Low today |
| **Distance from the dossier** | Largest | **Small — keeps the text, changes its status** | Zero |
| **Reversibility** | Weakest | **Strongest — a status cell flips back** | n/a |

**What v1 gives up, stated plainly:** PratiBimb's visual state is exactly as fresh as the last
explicit human invocation and no fresher. A canvas that repaints after the frame was taken is not
noticed until a person asks again. That is the same fail-closed trade the owner accepted in
ADR-0009 §0, applied to change detection.

---

## 5. The amendment as executed

Five edits, all in `docs/architecture/constitution.md`: **23 insertions, 7 deletions**, no
line-ending churn. No code was changed by this amendment, no test changed, no capture path appeared
or disappeared, no permission changed and no action type changed. The diff is reviewable line by
line, which was the point.

Vocabulary follows the repository: the constitution already shouts its statuses (`FROZEN`,
`REPLACEABLE`, `NOT DECIDED`, `UNKNOWN`), and `capture-policy.md` already uses a status column whose
in-force value is written *"in force"*. **IN FORCE / DEFERRED / WITHDRAWN FROM v1** extends that
convention rather than inventing a parallel one.

### 5.1 §6 — the signal table gains a `v1 status` column

A fifth column, rather than prose after the table, because the table is already where a reader
decides what the change policy is, and a status that lives anywhere else will be missed.

| Row | New cell |
|---|---|
| Structural | **IN FORCE.** *It takes no capture, which is why it survives ADR-0009 unchanged* |
| Visual | **DEFERRED.** *Needs a timer and, by a mechanism this row never names, possibly a capture. Restoring it requires a separate approved ADR that names and validates that mechanism* |
| Safety net | **WITHDRAWN FROM v1.** *It is by definition a capture with nobody behind it, which the capture policy approved in ADR-0009 forbids. Restoring it requires a separate approved ADR* |

### 5.2 §6 — one paragraph, because the existing closing paragraph became untrue

§6 ended *"On a page that is one full-screen canvas animation this degrades to the poll rate."* In
v1 there is no poll rate. The original sentence is kept — it is correct about the design — and one
paragraph follows it stating that v1 degrades further and deliberately, that **no autonomous
capture, periodic polling, capture retry loop or safety-net capture is part of the v1 product
contract**, and that any future change-driven capture requires a separate approved ADR before it is
implemented.

### 5.3 §5 and §7 — the two rows that named a deferred mechanism as present

- **§5's *Change signal* row** named all three signals as the frozen stack choice. It now names
  MutationObserver as the v1 mechanism *"because it takes no capture"*, and records the other two as
  DEFERRED and WITHDRAWN FROM v1.
- **§7's T0 row** described T0 as *"structural signal plus bounded visual polling"*. It now reads
  *"the structural signal alone in v1"* and points at §6. **§7's firing figures were not changed** —
  a note after the table records that the firing column is a dossier projection predating ADR-0009,
  that under explicit capture T0's capture count and T1's multiplier are both lower, and that **no
  replacement figure is given because none has been measured** (`AGENTS.md` §5 forbids inventing
  one). That is the whole of §7's amendment; the tiers, weights and the fusion section are untouched.

### 5.4 What was proposed and then *not* done

The PROPOSED revision of this ADR listed a fourth constitution edit: correcting §5's Capture row
clause *"The change gate still does not depend on capture."* **That edit was dropped, because
Option B makes the clause true.** With the visual signal deferred and the safety net withdrawn, the
v1 change gate is structural-only and genuinely takes no capture. C3 is resolved by the decision
rather than by an edit, and one fewer frozen line is touched.

Also deliberately not done, as unnecessary constitutional edits: §6's opening definition
(*"from either signal"*) still describes the policy's full design, whose v1 scope the status column
now carries; §8's *"poll rates"* entry in the replaceable list is harmless while nothing polls; and
§10's scope table is untouched, because DEFERRED and WITHDRAWN FROM v1 are ADR states, not the
ships/waits/refuses states §10 tracks.

---

## 6. The decision record

| Field | Value |
|---|---|
| **Decision** | **Option B — narrow** |
| **Approved by** | **ronitsaha11 (Ronit Saha)**, repository owner / architecture decision-maker |
| **Date** | 2026-09-24 |
| **Conditions** | Wording, status labels and documentation mechanics delegated to the repository's conventions; explicitly **not** approval for autonomous capture |
| **Procedure** | `docs/adr/README.md` amendment procedure — step 5 satisfied by the owner; step 6 (constitution updated, index updated, ADR recorded) executed here |

---

## 7. `frameHash` / `ChangeGate` — final disposition

Audited again after the amendment. The brief's three categories, answered one component at a time.
**No scheduler was wired, no polling was created, no safety-net capture was created, and no new
capture call was added.** Nothing here was deleted either: DEFERRED is not obsolete, and deleting a
mechanism the owner may restore by ADR would only mean re-deriving it later.

| Component | Disposition | Why |
|---|---|---|
| `ChangeGate` (the class) | **Future infrastructure.** Zero production callers | Its `STRUCTURAL` path is the right home for the one signal IN FORCE, on the day an observer is wired. Keep |
| `ChangeGate.evaluate`, `STRUCTURAL` branch | **Future infrastructure for a v1 mechanism** | Matches the signal in force; still uncalled |
| `evaluate`, `VISUAL` branch · `noteHash` · `currentHash` · `shouldHashFullFrame` · `fullFrameHashIntervalMs` | **Future infrastructure for a WITHDRAWN mechanism** | Serves the full-frame safety net. Kept, unwired, and now labelled in the source |
| `registerDynamicRegion` · `dynamicRegionPollMs` · `maxDynamicRegions` | **Future infrastructure for a DEFERRED mechanism** | Serves bounded visual polling. Kept, unwired, and now labelled |
| `frameHash` | **Partly obsolete under the live-stream architecture** | It hashes encoded bytes. A live frame has none, so it throws `CAPTURE_FAILED` rather than hashing an absent buffer — which would give every live frame the same hash and make a change gate report "unchanged" forever. It remains correct for an *encoded* frame, and the only route that produces one is `DEGRADED_TEST_ROUTE`. **0 production callers, 3 test callers** |
| `DEFAULT_CHANGE_POLICY.minCaptureIntervalMs` = 500 ms | **Inert, and its evidence is now off-path** | A measured floor for `captureVisibleTab` on Chromium 151. Nothing debounces anything today, and the API it bounds is not on the product path |
| `MEASURED_CAPTURE_ENVELOPE` | **Bounds the degraded route only** | Its subject is `captureVisibleTab`. Its own `notMeasured` list still contains *"activeTab permission path"* — which is exactly the measurement Option C would have needed |

The source file's header comment described the full-frame hash as *"the other"* of two inputs. That
description is now wrong at the contract level, so **the comment was corrected** —
`packages/perception/src/changeDetection.ts`, comments only, no code, no behaviour, no test change.

---

## 8. What this approval covers, and what it does not

**Covers:** narrowing §6 to the structural signal for v1; the DEFERRED and WITHDRAWN FROM v1 states
of the two capture-bearing signals; the consequential §5 and §7 edits; and the requirement that any
future change-driven capture arrive as its own approved ADR.

**Does not cover, and is not implied by, this approval:**

- **autonomous capture of any kind** — the owner ruled this out in the decision itself;
- implementing the structural signal. No observer exists, and approving a contract is not building
  one. It stays **NOT YET VERIFIED**;
- reopening, reversing or diluting **ADR-0009**, which remains APPROVED and unchanged in meaning;
- changing `capture-policy.md`'s prohibitions, which are unchanged and still in force;
- any detector, OCR, text or model decision — none was touched;
- **production readiness**, which neither ADR claims.

---

## 9. Recorded in passing

**9.1 — "product bundle count 0" was stated imprecisely, and is corrected here.** M5.1 and
ADR-0009 §0.1 record `captureVisibleTab` as **0** in the product bundle. The string measured was
`tabs.captureVisibleTab`, which is genuinely **0**. The **bare token appears 6 times**: once in
`background.js` as the optional-adapter property check whose absence *is* the fail-closed refusal,
and five times in the offscreen chunk — four in `decodeDataUrl`'s error strings, and **one live call
site** inside the `REALM_PROBE` diagnostic handler, guarded by
`typeof tabs?.captureVisibleTab === "function"`. In the offscreen realm `chrome.tabs` is absent
(measured in M3.1), so the branch cannot be taken, and the handler requires an extension-internal
message. **It is not a capture path.** But ADR-0009 §0.1 says the degraded branch is *"absent from
the bundle, not merely unreached"*, and for that one probe call site the accurate description is
*merely unreached*. Recommended as a small separate cleanup — delete the probe's capture attempt,
keep its surface report — and not done here, because this milestone is a contract decision.

**9.2 — one residual ADR-0009 inconsistency, left alone deliberately.** §9 (`NOT DECIDED`) still
lists *"Real-world `tabs.captureVisibleTab` rate limits under `activeTab`"* as an open unknown. It
is still genuinely unknown, and it still matters to the degraded test route, but it is no longer a
product question. Editing it is ADR-0009's business rather than this decision's, and touching a
frozen section beyond what the approved decision requires is exactly what this ADR was asked not to
do.
