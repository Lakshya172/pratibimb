---
id: ADR-0010
title: "The change policy under explicit capture — reconciling constitution §6 with ADR-0009"
version: 1.0
status: PROPOSED — NOT APPROVED. Owner decision required (§6 of this ADR).
owner: pratibimb-architect
proposed_by: pratibimb-architect
approved_by: none
approved_on: none
created: 2026-09-24
modified: 2026-09-24
supersedes: none
amends: "NOTHING YET. Proposes an amendment to docs/architecture/constitution.md §6 and two clauses in §5."
related_gates: none
related_invariants: none weakened by any option; option C engages the privacy-security veto (amendment procedure step 4)
---

# ADR-0010 — The change policy under explicit capture

> **STATUS: PROPOSED. This ADR changes nothing.** No file outside `docs/adr/` is edited by it, no
> code is touched, and `constitution.md` §6 remains FROZEN and unamended until the owner decides.
>
> **This does not reopen ADR-0009.** The gesture-authorised capture architecture is approved and
> settled. What is unresolved is how the *older* §6 change-policy language should coexist with the
> *newer* explicit/fail-closed capture policy that ADR-0009's approval brought into force.
>
> Per the amendment procedure in `docs/adr/README.md`: step 1 is *"anyone may propose a deviation.
> It is written as a draft ADR."* This is that draft. **Step 5 — the human architect approves or
> rejects — has not happened.**

---

## 1. Current state

### 1.1 What is approved

**ADR-0009, APPROVED 2026-09-24 by the owner (Ronit Saha).** Its derived policy,
`docs/architecture/capture-policy.md`, is in force and states:

> **A frame is taken only when a person has just asked for one, and never otherwise.**

and forbids, in its own words:

- *"**No periodic polling.** Nothing wakes up to look at a page."*
- *"**No autonomous repeated capture.** One authorisation is not a standing licence."*
- *"**No retry after a quota refusal.**"*
- *"No silent substitution of worker capture."*
- *"No widening of host permissions to avoid the gesture."*

Its trigger table records *"a change-driven refresh — **not implemented, and would need its own
approval**."*

### 1.2 What §6 still requires

`docs/architecture/constitution.md` §6 is **FROZEN** and is a faithful transcription of the
governing dossier (v4.0, the passage beginning *"The honest answer to 'how do you know a frame
changed without capturing continuously?'"*). It names three signals:

| Signal | Mechanism (verbatim) | Cost (verbatim) |
|---|---|---|
| Structural | `MutationObserver` on the document; `ResizeObserver` on tracked elements | Free, event-driven, names the dirty node |
| Visual | dHash over **enumerated** dynamic regions, at a bounded poll rate, only while they intersect the viewport | **One partial capture per poll**, not per rendered frame |
| Safety net | Full-frame dHash at a low fixed interval | **One capture per interval, capped** |

§5's *Change signal* row repeats this as the frozen stack choice: *"MutationObserver (structural) +
bounded dHash polling (visual) + low-rate full-frame dHash (safety net)"*.

### 1.3 The contradiction, sentence by sentence

Four distinct collisions, of three different kinds. Only the first is a flat contradiction.

**C1 — hard contradiction.** §6: *"Safety net | Full-frame dHash at a low fixed interval | … One
capture per interval, capped."* Against the capture policy: *"A frame is taken only when a person
has just asked for one, and never otherwise."* A safety net that runs only when a person asks is
not a safety net — the entire purpose of the row is to catch what happens when nobody is asking.
**The full-frame safety net cannot exist as described.** There is no reading under which both
sentences hold.

**C2 — definitional collision, wider than capture.** §6: *"at a bounded poll rate."* Against the
capture policy: *"No periodic polling. Nothing wakes up to look at a page."* §6 does **not say by
what mechanism** a dynamic region is hashed. If it is a tab capture, C2 is as hard as C1. If it is
a content script reading a same-origin `<canvas>` through `getImageData` — which takes no tab
capture and no `activeTab` grant — then it collides only with the *"nothing wakes up to look at a
page"* clause, which is broader than that policy's own subject. **Which mechanism §6 intends is not
recoverable from the text**, and this ADR does not guess (AGENTS.md §5: UNKNOWN).

**C3 — pre-existing, and not created by ADR-0009.** §5's Capture row asserts *"the change gate does
not depend on"* capture. That clause is **original frozen text**, present at `a3ff71c` before the
ADR-0009 amendment (*"Rate-limited, particularly under `activeTab` — which is why the change gate
does not depend on it"*), and the M5.1 amendment carried it forward. ADR-0009 §4 repeats it. It was
always inaccurate against §6, where two of three signals cost a capture each. ADR-0009 did not
create this collision; it made it operative, by turning loose prose into an enforceable policy
document.

**C4 — a magnitude, not a rule.** §7's T0 row projects *"~100 evaluations / ~8 captures"* on a
ten-step form task, and T1 *"runs on every changed frame"*. Under explicit capture the figure is
approximately **one capture per invocation, one invocation per document**. No sentence forbids the
other, but the projection describes a system that is not the approved one. Note that §7's T0 row
names only *"structural signal plus bounded visual polling"* — **it does not name the safety net** —
which is why the minimum amendment below does not need to touch §7.

## 2. Audit — what §6 requires against what exists

Read from the files on 2026-09-24 at `23a41fc`. Every *already implemented* cell is a grep of
`apps/`, `packages/*/src` and `tests/`, excluding `dist/`.

| §6 mechanism | Requires autonomous capture? | Compatible with approved policy? | Already implemented? | Product requirement? |
|---|---|---|---|---|
| **Structural** — MutationObserver + ResizeObserver | **No** | **Yes** | **No.** `ChangeGate.evaluate` accepts and debounces a `STRUCTURAL` signal, but **no `MutationObserver`, `ResizeObserver` or `IntersectionObserver` exists anywhere in `apps/` or `packages/*/src`**, and `ChangeGate` has zero callers outside its own tests | **Yes** — §6 and §7 both |
| **Visual** — bounded dHash over enumerated dynamic regions | **Unspecified by §6.** Tab capture → yes; same-origin canvas read → no capture, but still a timer | **No, as the policy is written.** See C2 | **No.** `registerDynamicRegion`, `dynamicRegionPollMs` and `maxDynamicRegions` exist as scaffolding; **no poller, no region enumeration and no dHash exist anywhere in the repository** | **Yes** — §6 and §7 both |
| **Safety net** — low-rate full-frame dHash | **Yes, necessarily** | **No.** See C1 | **No.** `shouldHashFullFrame` and `fullFrameHashIntervalMs` exist; **no caller** | **§6 yes; §7 does not name it** |

Supporting artifacts audited at the same time:

| Artifact | State |
|---|---|
| `frameHash` | **Obsolete on the product path.** Hashes encoded bytes; a live frame has none, so it throws `CAPTURE_FAILED`. Exported from the package index, **0 product callers**, 3 test callers |
| `DEFAULT_CHANGE_POLICY.minCaptureIntervalMs` = 500 ms | Measured floor for `captureVisibleTab` on Chromium 151. Compatible, but **inert** — nothing debounces anything today |
| `MEASURED_CAPTURE_ENVELOPE` | `CONDITIONAL`; its own `notMeasured` list contains *"activeTab permission path"*. **Its subject — `captureVisibleTab` — is not on the product path at all**, so it now bounds only the degraded test route |
| `ChangeSignal` union | Referenced as a type by `perceptionState.ts` (`trigger`). No value of kind `VISUAL` or `DYNAMIC_REGION` is ever constructed outside tests |
| Any scheduler | **None.** The only `setInterval` in the product bundle is WXT framework code — `ContentScriptContext`'s location-change fallback for browsers without the Navigation API. It is not ours and takes no captures |

**Nothing in the product depends on the disputed §6 mechanisms.** That is why this can be decided
calmly, and why it should be decided before a scheduler exists rather than after.

## 3. Options

Presented for the owner. **This ADR does not choose among them.**

### Option A — withdraw the capture-bearing signals from §6

§6 becomes a structural-signal policy. The Visual and Safety-net rows are removed, and the blind
spot they covered is stated as a limitation.

### Option B — narrow §6 rather than delete it

The three rows stay. Each gains a status: Structural **in force**, Visual **deferred pending an ADR
that names its mechanism**, Safety net **withdrawn as a v1 product requirement**. The dossier's
analysis stays visible and correct; only its standing as a build requirement changes.

### Option C — keep bounded autonomous capture, and narrow the capture policy instead

**This option is genuinely supported, and the owner should know that before choosing.**

- The owner's SHALL NOT list in ADR-0009 §0 forbids `captureVisibleTab` as the normal path, silent
  fallback, `<all_urls>`, simulated gestures, and weakened `activeTab`/`tabCapture` semantics.
  **None of those forbid taking more than one frame from a stream a person already authorised.**
- `capture-policy.md` is where *"no periodic polling"* and *"no autonomous repeat"* live. That
  document was written during M5.1 as a derivation of the approval; the owner approved ADR-0009,
  **not this document sentence by sentence**. Narrowing it is therefore not reopening ADR-0009.
- **FACT (code read, `apps/extension/host-lib/capture-authority.ts:230`):** `ticketFor` may be
  called repeatedly against a live grant. Chrome mints a fresh handle each time; the `issued` set
  only guards against a duplicate handle coming back. **No change to the authority is needed to
  capture twice.**
- **FACT (code read, `apps/extension/host-lib/perception-realm.ts`):** the realm calls
  `track.stop()` after one frame, by an explicit decision — *"One frame, then the tab stops being
  captured. A live track is an open camera."* Option C reverses that decision.
- **UNKNOWN:** whether a tab track survives and `grabFrame()` keeps working across a bounded poll
  under one `activeTab` grant, and at what rate Chrome throttles it. **Never measured.**
  `MEASURED_CAPTURE_ENVELOPE` measured `captureVisibleTab`, a different API. Option C therefore
  **cannot be approved on the evidence that exists**; it would need a spike first.

## 4. Tradeoffs

| | **A — withdraw** | **B — narrow** | **C — bounded autonomous capture** |
|---|---|---|---|
| **Security / privacy** | Strongest. The capture surface is exactly one frame per human invocation | Identical to A today; a deferral is a door, not an opening | **Materially weaker.** A live track between invocations is not what the side panel's one line describes. Engages the privacy-security veto, step 4 |
| **UX** | Unchanged. Stale visual state until a person re-invokes | Unchanged | Better within a document: a canvas repaint is noticed without being asked for |
| **Automation** | Lowest. The agent is as visually fresh as the last click | Same as A | Highest, and the only option that recovers the dossier's ~8-captures-per-task shape |
| **Resource use** | Lowest | Lowest | A poll loop and a live encoder, bounded by a floor that has not been measured for this API |
| **Consistency with what is built** | High — nothing is wired, so nothing is orphaned; `frameHash` and `MEASURED_CAPTURE_ENVELOPE` become deletable | **Highest** — describes the tree exactly as it stands, changes no code, orphans nothing | Low today; needs a spike, a scheduler, a policy amendment, and the reversal of an explicit implementation decision |
| **Distance from the dossier** | Largest — deletes text the dossier argues for | Small — keeps the text, changes its status | **Zero** — it is what the dossier describes |
| **Reversibility** | Weakest — restoring deleted frozen text needs a third ADR | **Strongest** — a status column flips back | n/a |
| **Approvable on today's evidence?** | Yes | Yes | **No.** Needs a measurement that does not exist |

## 5. Recommended minimum change

**Option B**, on four grounds: it is the smallest edit that removes the contradiction; it describes
the repository exactly as it stands today; it preserves the dossier's reasoning, which remains
correct whatever the status of its mechanisms — MutationObserver genuinely cannot see a canvas
repaint; and it forecloses nothing, so Option C stays reachable if a future spike earns it.

Four text-level edits. Nothing else in the constitution is touched, and **§7 is not touched**.

### Edit 1 — `constitution.md` §6, add a status column to the signal table

```diff
-| Signal | Mechanism | Covers | Cost |
-|---|---|---|---|
-| Structural | MutationObserver on the document; ResizeObserver on tracked elements | Subtree edits, attribute and text changes, geometry, insertion and removal | Free, event-driven, names the dirty node |
-| Visual | dHash over **enumerated** dynamic regions, at a bounded poll rate, only while they intersect the viewport | canvas, video, WebGL, elements with running animations | One partial capture per poll, not per rendered frame |
-| Safety net | Full-frame dHash at a low fixed interval | Anything both signals miss | One capture per interval, capped |
+| Signal | Mechanism | Covers | Cost | Status under ADR-0009 |
+|---|---|---|---|---|
+| Structural | MutationObserver on the document; ResizeObserver on tracked elements | Subtree edits, attribute and text changes, geometry, insertion and removal | Free, event-driven, names the dirty node | **In force.** Takes no capture |
+| Visual | dHash over **enumerated** dynamic regions, at a bounded poll rate, only while they intersect the viewport | canvas, video, WebGL, elements with running animations | One partial capture per poll, not per rendered frame | **Deferred.** Needs a timer and — depending on a mechanism this row never names — possibly a capture. `capture-policy.md` forbids both. Implementing it requires an ADR stating which mechanism and what authorises it |
+| Safety net | Full-frame dHash at a low fixed interval | Anything both signals miss | One capture per interval, capped | **Withdrawn as a v1 product requirement.** It is by definition a capture with nobody behind it, which the capture policy approved in ADR-0009 forbids |
```

### Edit 2 — `constitution.md` §6, one paragraph after the enumeration paragraph

```
**What the deferral costs, stated rather than hidden.** With both capture-bearing signals deferred,
PratiBimb's visual state is exactly as fresh as the last explicit invocation and no fresher. A
canvas that repaints after the frame was taken is not noticed until a person asks again. The
reasoning above is unchanged and still correct — MutationObserver cannot see that repaint — but
under gesture-authorised capture the answer is re-authorisation, not a background hash. This is the
same fail-closed trade the owner accepted in ADR-0009 §0, applied to change detection.
```

### Edit 3 — `constitution.md` §5, the *Change signal* row

```diff
-| Change signal | **MutationObserver (structural) + bounded dHash polling (visual) + low-rate full-frame dHash (safety net)** | See section 6 |
+| Change signal | **MutationObserver (structural).** Bounded dHash polling is **deferred** and the low-rate full-frame safety net is **withdrawn as a v1 requirement** — ADR-0010, on the capture policy approved in ADR-0009 | See section 6 |
```

### Edit 4 — `constitution.md` §5, one clause in the *Capture* row

```diff
-The change gate still does not depend on capture.
+The change gate's structural signal takes no capture; its two capture-bearing signals are deferred
+or withdrawn — see section 6 and ADR-0010.
```

**Consequential, non-constitutional, and covered by the same approval if it is given:** the same
clause in ADR-0009 §4 is corrected by footnote rather than by editing an approved decision, and
`capture-policy.md` gains one line recording that §6's deferred signals are the reason its trigger
table says a change-driven refresh *"would need its own approval"*.

### What changes in behaviour if this is approved

**Nothing.** No code is edited, no test changes, no capture path appears or disappears, no
permission changes, no action type changes. Options A and B are both documentation-only, because
the disputed mechanisms were never built. Only Option C would change behaviour.

### What stays frozen either way

§1 pipeline · §2 trust boundary · §3 interfaces · §4 engineering contracts · §5 apart from the two
clauses above · §7 perception tiers · §8–§10 · every invariant INV-01…INV-25 · ADR-0002's format
policy · ADR-0009 in full · `EXECUTABLE_ACTIONS = ["click"]` · the detector pin and the ORT pin.

## 6. OWNER DECISION REQUIRED

**Nothing below is filled in, and no agent may fill it in** — `docs/adr/README.md`, amendment
procedure step 5: *"The human architect approves or rejects. No agent approves its own ADR."*

| Field | Value |
|---|---|
| **Decision** | ☐ Option A ☐ Option B (recommended) ☐ Option C ☐ Reject — leave §6 as-is and record the contradiction as standing debt |
| **Approved by** | _pending_ |
| **Date** | _pending_ |
| **Conditions, or edits to the proposed text** | _pending_ |

**If Option C is chosen**, it cannot be implemented on approval alone: it needs a spike measuring
whether a tab track survives a bounded poll under one `activeTab` grant and at what rate Chrome
throttles it, plus a `privacy-security-engineer` assessment under step 4. The decision would
authorise that spike, not the mechanism.

**If this ADR is rejected**, §6 stands unamended and the contradiction in §1.3 remains on the record
as standing debt. That is a legitimate outcome — nothing depends on it today — but it should be a
decision rather than a silence, because the first person to build a scheduler will implement
whichever document they read first.

## 7. Audit findings recorded in passing

Two things this audit found that are not part of the decision, recorded because they were found.

**7.1 — "product bundle count 0" was stated imprecisely.** M5.1 and ADR-0009 §0.1 record
`captureVisibleTab` as **0** in the product bundle. The string measured was `tabs.captureVisibleTab`,
which is genuinely **0**. The **bare token appears 6 times**: once in `background.js` as the
optional-adapter property check whose absence *is* the fail-closed refusal, and five times in the
offscreen chunk — four in `decodeDataUrl`'s error strings, and **one live call site** inside the
`REALM_PROBE` diagnostic handler, guarded by a runtime `typeof tabs?.captureVisibleTab === "function"`
check. In the offscreen realm `chrome.tabs` is absent (measured in M3.1), so the branch cannot be
taken, and the handler requires an extension-internal message. **It is not a capture path.** But
ADR-0009 §0.1 says the degraded branch is *"absent from the bundle, not merely unreached"*, and for
that one probe call site the accurate description is *merely unreached*. Recommended as a small
separate cleanup — delete the probe's capture attempt, keep its surface report — and **not done
here**, because this milestone is a document decision and the brief forbids a product refactor.

**7.2 — `frameHash` and `MEASURED_CAPTURE_ENVELOPE` become deletable under A or B.** Neither has a
product caller; the first is obsolete on the product path and the second measures an API the product
no longer calls. They are left in place until §6 is resolved, because the shape a future scheduler
would need is not yet known.
