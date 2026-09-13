# E6-4 — real extension click dispatch, hit test and result verification (D-E6-4)

> **PRE-REGISTRATION. NOT RUN. NO RESULT.** Written before any transport, harness or fixture for this
> experiment exists. Nothing in this file may be cited as a result until the *Actual result* section
> is filled by the run it describes.
>
> **No permit TTL is approved by this experiment in advance.** The experiment produces timing evidence
> for an owner decision. It does not choose, derive or recommend a lifetime.
>
> **Scope of any result.** This experiment is intended to validate the real extension transport path
> and to produce evidence for permit-lifetime selection.
> - It does **not** certify the full browser agent.
> - It does **not** establish any privacy guarantee.
> - It does **not** establish production readiness of the MV3 host, which stays experimental.

- **Date:** 2026-09-14 (drafted 2026-09-13) · **Workstation:** W2 (`LAPTOP-SRCINK2B`, GPU UUID
  `GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a`, driver 592.82; confirmed by live query when this file
  was written)
- **Decision it serves:** **D-E6-4**, recorded in [`E6-mv3-dispatch/decision.md`](../E6-mv3-dispatch/decision.md):
  *"MVP-1 and MVP-2 used trusted CDP input. The extension transport needs its own ACT/HIT-TEST/VERIFY
  run before those results are quoted for the product."*
- **Also serves:** ADR-0008 §5, *permit lifetime (`ttlMs`): UNRESOLVED*, whose stated source of evidence
  is *"measurement on the product transport"*.
- **Base:** canonical `main` at `cb309d0` (PR #74 merge).

## 1. Question

The experiment answers six questions:
1. Can a real extension transport perform an authorised click using the **existing** permit
   authority, with no second authority?
2. Does HIT-TEST remain authoritative immediately before dispatch on that transport?
3. Does the transport refuse stale or invalid targets, documents, frames, points and deliveries?
4. Does VERIFY RESULT still distinguish CONFIRMED, NOT_CONFIRMED and UNKNOWN on that transport? And
   does it avoid counting landing or navigation as the requested effect (E8)?
5. What is the observed timing from final validation, through hit test and dispatch, to post-action
   verification?
6. Which intervals are the right evidence for the owner's permit-lifetime decision?

The model is irrelevant: no model is loaded, no plan is generated, and every action is fixed below.

## 2. Evidence this builds on, and its labels

**The D-E6-4 run must not inherit Playwright's trust assumptions.** None of the rows below counts as
extension-path evidence.

| Evidence | Machine | Input path | What it established | What it is **not** |
|---|---|---|---|---|
| MVP-1 `25327e4` (PR #60) | **W2** | Playwright, **trusted CDP** `page.mouse.click` | validated click reaches a page; refusals touch nothing | extension-path evidence |
| MVP-2 `e98d807` (PR #61) | **W1** (`LAPTOP-6E14K34L`), Chromium 151 | Playwright, **trusted CDP** | HIT-TEST MATCH/MISMATCH/UNKNOWN; VERIFY CONFIRMED/NOT_CONFIRMED/UNKNOWN; **no timing fields** | W2 evidence; extension-path evidence; timing |
| E8 `0c35ad2` (PR #68) | **W2**, CfT 153 headless | Playwright, **trusted CDP** | **landing is not necessarily the requested UI effect**: `FOCUS_ON_TARGET` confirmed a cancelled checkbox 10/10 | extension-path evidence |
| E6 `9ed71c9` (PR #70) | **W2**, CfT 153 + Edge 153 | **real extension content script** | extension clicks are **untrusted**; element dispatch (`el.click()`) goes through an overlay, point dispatch does not → D-E6-2 point-based | a click **through the permit, hit test and verify** |
| Track G `46550bf` (PR #69) | **W2**, CfT 153 + Edge 153 | real extension, no dispatch | host loads; `documentId` attested; offscreen survives a forced SW restart; content→SW→offscreen round trip p50 0.8 / 1.0 ms | dispatch or TOCTOU timing |
| Permit core, ADR-0008 | CI + mutation (`tools/mutation/permit-core.mjs`: 16 mutations, 14 killed, 2 layered survivors) | none (unit) | single use, expiry with no default, MATCH bound to its decision | any browser behaviour |

## 3. Prerequisites — assumed, and out of scope here

This experiment **assumes** the items below and does not build them. The transport implementation is
**out of scope for this pre-registration.** If a prerequisite does not exist or does not meet the stated
property, the run is `ABORTED`, never re-scoped at run time.

### 3.1 Existing core, unchanged

| Component | Source | Git blob at `cb309d0` |
|---|---|---|
| VALIDATE | `packages/agent/src/actionFreshness.ts` | `f995acf663f79c20b119987a1db2090c334633ec` |
| HIT-TEST | `packages/agent/src/hitTest.ts` | `a278b2e5dfc5be4e3008d40045c740def1a4dcab` |
| DispatchPermit (mint, redeem) | `packages/agent/src/permit.ts` | `eee4f3ef6d7e8732f24b8a8cc58b738be9e268f8` |
| ACT | `packages/agent/src/act.ts` | `4b9350341d79f12269f3d11f0391d421349cc1a1` |
| VERIFY RESULT | `packages/agent/src/verifyResult.ts` | `086526b7c32e1e55d577d0975f2a79a681f636b0` |
| Composition | `packages/agent/src/guardedAct.ts` | `eac6e354471f6e0247aff65a0a1026c580cd7c02` |

**Rule.** The harness refuses to run unless each of these blobs is unchanged. If any of them changes
before the run (for example an owner decision on D-E8-1), this file receives a dated amendment
**before** the first run, never after it.

**Tolerances used as they stand. All are PROPOSED, none is approved by this experiment:**
- `PROPOSED_FRESHNESS_TOLERANCE`: 2.0 px / IoU 0.8;
- `PROPOSED_HIT_TEST_TOLERANCE.minBoxIou`: 0.8;
- `DEFAULT_HIT_TEST_TIMEOUT_MS`: 2000;
- `DEFAULT_DISPATCH_TIMEOUT_MS`: 5000.

### 3.2 Existing MV3 experimental host

Track G's host (`apps/extension`, WXT 0.21.4).

| Host file | Git blob at `cb309d0` |
|---|---|
| `host/background.ts` | `5cdacc39a5d99a805b1132e2db46241a8664dc48` |
| `host/content.ts` | `b9fc3a23756d8990114e4a441a741e20f1e188fe` |
| `host/offscreen/main.ts` | `fdab27fd80da5c826bfa5e4e549eacb346407d38` |
| `host-lib/messages.ts` | `6ebeb3b05a310a76af77041390dd48c8d1f38afc` |
| `host-lib/e6-mechanisms.ts` | `a848b28f1b6585f7be5e1a2e1a15a92487678d5f` |

**The permission set must stay Track G's:**
- `offscreen`, `sidePanel`;
- host and content-script match `http://127.0.0.1/*`;
- CSP `connect-src 'self' http://127.0.0.1:8995`;
- no `debugger`, no `externally_connectable`, no web-accessible resources.

Any addition needs a dated amendment here before the run.

### 3.3 A valid extension transport — the properties it must have

These properties define "valid transport" for this experiment. They are **refusal-only**: each can
stop a dispatch, and none can authorise, choose, re-aim or retry one. The permit stays the only
authority.

> **TR-2, TR-5, TR-6 and TR-7 are PROPOSED transport properties — OWNER DECISION REQUIRED.** If the
> implementation lacks one, the case that tests it is recorded as a **fail-closed violation**, not
> re-scoped.

| # | Property |
|---|---|
| **TR-1 Two bridges** | A `HitTestBridge` (one read-only method) and a `PageActionBridge` (one method, `clickAtCssPoint`). **Implemented against the existing interfaces.** No other method, no selector parameter, no element parameter |
| **TR-2 Document binding** | Both bridges are bound, at construction, to the observation `FrameId` that produced the graph **and** to the browser-attested `(tabId, frameId, documentId)` of the document that observation came from. Every request is delivered only to that document, and every reply is accepted only from it. A mismatch **throws**; it never resolves `null` (a `null` would be a definite MISMATCH, per `hitTest.ts`) |
| **TR-3 Point dispatch only** | The content script dispatches E6 mechanism B's pointer/mouse event sequence to `document.elementFromPoint(permit.point)` at dispatch time, at exactly `permit.point`. **No selector fallback, no nearest-element fallback, no `el.click()`, no `focus()`, no scroll, no retry.** |
| **TR-4 Hit-test answer** | The content script answers from `document.elementFromPoint(point)`. The selector is derived by the **same function** the observation adapter uses to build `domRef`, or a MATCH would compare two different naming schemes |
| **TR-5 Point consistency** | The content script refuses (→ throw) a dispatch whose point differs from the point it answered the hit test for in the same cycle |
| **TR-6 Single delivery** | Each dispatch message carries a one-time delivery id, and a repeated id is refused |
| **TR-7 Restart binding** | A delivery is bound to the service-worker boot that relayed its hit test. A delivery relayed by a different boot is refused |
| **TR-8 Observation adapter** | The content script produces `DomMeasurement[]` (selector, role, name, rect, enabled, cssHidden, parentIndex) and a three-valued focus reading: a selector; `null` when `document.activeElement` is `body` or absent; the property omitted when focus cannot be established. The unchanged `buildElementGraph` consumes it, with a **new observation `FrameId` per observation** |
| **TR-9 Core realm** | `guardedAct` and its stages run unmodified in **one** extension realm: **the offscreen document** (Track G: it survives SW restarts; the SW holds no state). Routing through the SW is stateless |
| **TR-10 No page content** | Transport and instrumentation report selectors, roles and names of the synthetic fixture, causes, counts and timestamps only. Error messages are dropped and the class name is kept (INV-21, as `hitTest.ts` and `act.ts` do) |

## 4. Hypothesis

**H-PATH.** The unchanged core can drive the real extension transport end to end:
VALIDATE → AUTHORISE → HIT-TEST (content script) → MINT → redeem → point dispatch (content script) →
fresh content-script observation → VERIFY RESULT.
- *Falsified if* any condition in §9.1 fails in a run.

**H-FAILCLOSED.** Every case that must not dispatch produces **zero** click events in the page, observed
by the page's own witness.
- *Falsified by* one witnessed click, or one core `EXECUTED`, in any such run.

**H-VERIFY.** VERIFY RESULT's three values keep their meaning on the extension transport, and landing or
navigation is never counted as the requested effect.
- *Falsified if* any rule in §9.3 is broken.

**Q-TIME.** This is not a hypothesis, and no threshold is attached. The run measures §7 and publishes
every observation.

## 5. Environment

### 5.1 Cells

| | Cell 1 | Cell 2 |
|---|---|---|
| Machine | **W2** `LAPTOP-SRCINK2B`, AMD Ryzen AI 7 350, Windows 11 10.0.26200 | same |
| Browser | **Chrome for Testing 153.0.8010.12**, `C:\Users\OMEN\cft\chrome.exe`, headful | **Microsoft Edge 153.0.4234.32**, headful |
| Extension load | Playwright 1.63.0 `launchPersistentContext --load-extension`, fresh temporary profile per cell (the Track G / E6 pattern) | same |
| Node | v26.4.0 | same |
| Viewport | 1024 × 768 CSS px; actual `devicePixelRatio` and zoom recorded, not assumed | same |
| Fixture server | loopback `127.0.0.1`, on a port recorded in `logs/environment.json`, **never 8995** | same |

**Rules for cells:**
- **Never pooled.** Every count and statistic is reported per cell.
- A cell that cannot load the host is `ABORTED`; the other cell still runs and reports.
- **Not covered:** Firefox, branded Chrome, Linux, CI, **W1**. This is W2 evidence only, and nothing in
  it converts MVP-2's W1 evidence.

### 5.2 What Playwright may and may not do in the extension phase

Playwright is the **launcher and the observer's courier, never an actor.**

| Allowed | Forbidden |
|---|---|
| launch the browser; open and navigate tabs; start and stop the fixture server | `page.mouse`, `page.keyboard`, `page.touchscreen`, `click`, `dblclick`, `tap`, `check`, `fill`, `press`, any locator action, `dispatchEvent`, and any CDP `Input.*` command |
| call the fixture's own mutation function for a case (main world) | performing, or supplying the answer to, a hit test or an observation used by the core |
| receive the page witness's events through `exposeBinding` (survives navigation) | |
| send CDP `ServiceWorker.stopAllWorkers` in C13 (the Track G method) | |

**Enforcement:**
- **Static.** Before the first run, the harness scans itself and every module it imports for the
  forbidden APIs, and refuses if any is present.
- **Runtime.** §9.1 V3: every witnessed click must be `isTrusted === false`.

### 5.3 Fixture `F-E6-4` (committed with the harness, after this file)

- One fresh document per run, at `…/f-e6-4.html?run=<ordinal>`.
- **No element checks `isTrusted`.** Pages that honour only trusted clicks are D-E6-3 and out of scope.
- **No icon-only controls.** Every target is text- or `aria-label`-named, so D-E7-2 (exact element vs
  descendant) cannot confound the hit test.

**Geometry.** The harness checks it against the first observation of every run, and any difference is
`ABORTED`. All centres are integers.

| Selector | Role | Name | Box (x, y, w, h) | Centre | Behaviour on click |
|---|---|---|---|---|---|
| `#panel` | region | "Panel" | 0, 0, 1024, 768 | — | container; what is topmost when a target is gone |
| `#save` | button | "Save" | 400, 300, 120, 40 | **(460, 320)** | renames itself to "Saved" |
| `#save-inert` | button | "Save" | 400, 380, 120, 40 | (460, 400) | handler runs and changes nothing |
| `#lock` | button | "Lock" | 560, 300, 120, 40 | (620, 320) | sets `disabled` |
| `#next` | button | "Next step" | 560, 380, 120, 40 | (620, 400) | `history.pushState` to `#step2`, removes step 1 (including `#next`), shows step 2 |
| `#sms` | checkbox | "SMS updates" | 400, 460, 20, 20 | (410, 470) | the page cancels the toggle (`preventDefault`) |
| `#same-address` | checkbox | "Same as permanent address" | 560, 460, 20, 20 | (570, 470) | toggles normally |

**Page witness** (main world, installed before any content script runs). It records, with timestamps:
- every `pointerdown`, `mousedown`, `pointerup`, `mouseup` and `click`, with target selector, `clientX`,
  `clientY` and `isTrusted`;
- every fixture state change (T5);
- a heartbeat before and after each cycle.

It also exposes the **effect oracle**: whether `#save` is named "Saved", whether `#lock` is disabled,
checkbox `checked` states, the URL hash, and whether step 2 is visible.

**The oracle is harness knowledge of its own fixture and is never available to the product** (as in E8).

**Postconditions are fixture-declared by the harness**, using only the three kinds on `main`. Whether the
product may derive them locally is D-E8-1 / D-E8-2 and is not tested.

## 6. Test matrix

**Legend:**
- `O1`, `O2` — observation `FrameId`s.
- `D` — the run's document `(tabId, frameId 0, documentId)`.
- `D′` — a replacement document with **identical layout**, so only document binding can tell it apart.
- `E` — the document in a second tab with identical layout.
- **Hooks** are stage-boundary pauses in experiment code: they can only delay and signal, never
  authorise.
  - `B0`: after the observation, before `guardedAct` is called.
  - `B1`: inside the `HitTestBridge` wrapper, after VALIDATE and AUTHORISE, before the query leaves the
    core realm.
  - `B2`: inside the `PageActionBridge` wrapper, after redemption, before the dispatch leaves the core
    realm.
  - Each hook has a **1,000 ms budget**. An overrun makes that run `INVALID` (§9.4).
- **Fault** means a declared fault injected into the transport to prove a refusal exists. Faults are
  used only in the rows that name one.
- **Instrument TTL:** `permitTtlMs = 60 000` in every row except C10. See §7.4.

### 6.1 Setup

| ID | Case | Setup | Authorised target | Frame / document | Coordinate | Permit state |
|---|---|---|---|---|---|---|
| **C01** | valid click | fresh `D`, observe `O1`, `guardedAct` | `#save` | `O1` / `D` | (460, 320) | minted, LIVE at redemption |
| **C02** | overlay before dispatch | at **B1**, fixture inserts opaque `#overlay` fully covering `#save` | `#save` | `O1` / `D` | (460, 320) | never minted |
| **C03** | stale document | at **B0**, reload → `D′` (identical); wait for the `D′` content-script hello | `#save` | `O1` / bridges bound to `D`, page is `D′` | (460, 320) | never minted |
| **C04a** | stale observation frame | observe `O1`, then `O2`; claim built from `O1`, graph is `O2` | `#save` | claim `O1`, graph `O2` / `D` | (460, 320) | never minted |
| **C04b** | wrong browser frame / document | second tab with `E`. **Fault:** the hit-test query is routed to `E` | `#save` | `O1` / bound `D`, routed to `E` | (460, 320) | never minted |
| **C05** | removed target | at **B1**, fixture removes `#save` | `#save` | `O1` / `D` | (460, 320) | never minted |
| **C06a** | target moved outside authorised geometry | at **B1**, `#save` moves +200 px in x (box 600–720; point no longer on it) | `#save` | `O1` / `D` | (460, 320) | never minted |
| **C06b** | target moved, still under the point, geometry disagrees | at **B1**, `#save` moves +40 px in x. Box 440–560 still contains 460, IoU with the validated box = 3200 / 6400 = **0.50** | `#save` | `O1` / `D` | (460, 320) | never minted |
| **C07** | target identity changed | at **B1**, `#save` renamed "Discard" (same selector, same role) | `#save` | `O1` / `D` | (460, 320) | never minted |
| **C08a** | wrong point (proposed) | proposed `point` (380, 320), outside `#save`'s box | `#save` | `O1` / `D` | (380, 320) | never minted |
| **C08b** | wrong point (coordinate frame drift) | at **B1**, fixture sets `documentElement.style.zoom = 1.25`; `#save` becomes 500, 375, 150 × 50 | `#save` | `O1` / `D` | (460, 320) | never minted |
| **C08c** | wrong point (in transit) | **Fault:** the dispatch message's point becomes (490, 320), still inside `#save` | `#save` | `O1` / `D` | answered (460, 320), delivered (490, 320) | minted, CONSUMED at redemption |
| **C09** | HIT-TEST UNKNOWN | **Fault:** the content script delays its hit-test reply by 2,500 ms (> 2,000 ms default deadline) | `#save` | `O1` / `D` | (460, 320) | never minted |
| **C10** | expired permit | `guardedAct` with an injected `now`: clock call 1 (mint) returns the real time `t`; clock call 2 (redemption) returns `t + ttlMs` | `#save` | `O1` / `D` | (460, 320) | EXPIRED at redemption |
| **C11a** | replayed permit | exported stages in `guardedAct`'s order, no `await` between MINT and ACT. `act(permit)` once, then **`act(permit)` again**. `guardedAct` never exposes a permit, so replay cannot be expressed through it | `#save` | `O1` / `D` | (460, 320) | CONSUMED at the second redemption |
| **C11b** | replayed delivery | C01, plus **fault:** the identical dispatch message (same delivery id) is delivered a second time after the first completes | `#save` | `O1` / `D` | (460, 320) | CONSUMED once |
| **C12a** | navigation between validation and hit test | at **B1**, navigate to `?run=<n>&nav=1` → `D′` (identical); wait for its hello | `#save` | `O1` / bound `D`, page `D′` | (460, 320) | never minted |
| **C12b** | navigation between redemption and delivery | at **B2**, same navigation → `D′`; wait for its hello | `#save` | `O1` / bound `D`, page `D′` | (460, 320) | CONSUMED at redemption, delivery pending |
| **C13** | service-worker restart | at **B2**, CDP `ServiceWorker.stopAllWorkers`; wait for the worker to stop. Then, in the same run, a **fresh** cycle (new observation `O2`) on the same document | `#save` | `O1` / `D`; recovery `O2` / `D` | (460, 320) | CONSUMED at redemption; recovery permit LIVE |
| **C14** | dispatch succeeds, intended effect does not occur | click `#save-inert`; declared `TARGET_NAME "Saved"` | `#save-inert` | `O1` / `D` | (460, 400) | LIVE at redemption |
| **C15a** | landing and navigation occur, requested effect not confirmed | click `#next`; declared `FOCUS_ON_TARGET` (E8's local rule) | `#next` | `O1` / `D` | (620, 400) | LIVE at redemption |
| **C15b** | landing occurs, effect absent (E8 A5 on this transport) | click `#sms`; declared `FOCUS_ON_TARGET` | `#sms` | `O1` / `D` | (410, 470) | LIVE at redemption |
| **C15c** | landing occurs, effect present, landing-kind postcondition | click `#same-address`; declared `FOCUS_ON_TARGET` | `#same-address` | `O1` / `D` | (570, 470) | LIVE at redemption |
| **C16** | successful effect confirmation | click `#lock`; declared `TARGET_ENABLED false` | `#lock` | `O1` / `D` | (620, 320) | LIVE at redemption |
| **R1** | residual window (overlay **after** MATCH) | at **B2**, fixture inserts `#overlay` over `#save`; declared `TARGET_NAME "Saved"` | `#save` | `O1` / `D` | (460, 320) | CONSUMED at redemption, delivery pending |

C01 declares `TARGET_NAME "Saved"`. Refusing rows declare the same, because a plan must be usable or AUTHORISE refuses first.

**Postcondition class** (fixed now, used by §8):
- **EFFECT:** C01, C14, C16, R1.
- **LANDING:** C15a, C15b, C15c. Per E8, `FOCUS_ON_TARGET` on a checkbox or navigation control tests
  landing at most.
- **n/a:** rows that must not dispatch.

### 6.2 Expected results

**Violation classes** are defined in §9. In short:
- **FC:** a row that must not dispatch did dispatch.
- **VR:** VERIFY RESULT semantics broken.
- **Prediction miss:** the result was not the one pre-registered, but no safety rule was broken.

| ID | Expected HIT-TEST | Expected dispatch behaviour | Expected VERIFY RESULT | Expected final outcome (§8) | Dispatch expected? | A different result is |
|---|---|---|---|---|---|---|
| **C01** | MATCH | 1 click at (460, 320) on `#save`, `isTrusted: false` | CONFIRMED | DISPATCHED · **EFFECT_CONFIRMED** · oracle effect present | **yes** | prediction miss; a CONFIRMED with the oracle effect absent is **VR** |
| **C02** | MISMATCH `DIFFERENT_ELEMENT` (`#overlay`) | none; MINT/ACT not reached; action bridge 0 calls | not run (`null`) | NOT_DISPATCHED | no | any click → **FC-10**; UNKNOWN instead of MISMATCH is a prediction miss |
| **C03** | UNKNOWN `BRIDGE_THREW` (TR-2 refuses `D′`) | none on `D` or `D′` | not run | NOT_DISPATCHED | no | any click → **FC-3** (**MATCH** is also FC-3, because it means document binding is absent) |
| **C04a** | not reached (VALIDATE `RE_OBSERVE FRAME_MISMATCH`) | none; hit-test bridge 0 calls | not run | NOT_DISPATCHED | no | any click or bridge call → **FC-2** |
| **C04b** | UNKNOWN `BRIDGE_THREW` (TR-2 refuses `E`) | none in either tab | not run | NOT_DISPATCHED | no | any click, or a MATCH → **FC-2** |
| **C05** | MISMATCH `DIFFERENT_ELEMENT` (`#panel`) | none | not run | NOT_DISPATCHED | no | any click → **FC-5**; `NOTHING_AT_POINT` is a prediction miss |
| **C06a** | MISMATCH `DIFFERENT_ELEMENT` (`#panel`) | none | not run | NOT_DISPATCHED | no | any click → **FC-6** |
| **C06b** | MISMATCH `GEOMETRY_DISAGREES` (IoU 0.50 < 0.8) | none | not run | NOT_DISPATCHED | no | any click, or a MATCH → **FC-6** |
| **C07** | MISMATCH `NAME_DISAGREES` | none | not run | NOT_DISPATCHED | no | any click → **FC-10** |
| **C08a** | not reached (VALIDATE `RE_OBSERVE POINT_OUTSIDE_TARGET`) | none; hit-test bridge 0 calls | not run | NOT_DISPATCHED | no | any click → **FC-4** |
| **C08b** | MISMATCH `DIFFERENT_ELEMENT` (`#panel`); any MISMATCH or UNKNOWN is fail-closed | none | not run | NOT_DISPATCHED | no | MATCH or any click → **FC-4**; another MISMATCH cause is a prediction miss |
| **C08c** | MATCH | TR-5 refuses → action bridge throws; 0 clicks | UNKNOWN `DISPATCH_OUTCOME_UNKNOWN` (core sees `EXECUTION_ERROR BRIDGE_THREW`) | NOT_DISPATCHED by the witness · core dispatch axis UNKNOWN · effect UNKNOWN | no | any click → **FC-4** |
| **C09** | UNKNOWN `BRIDGE_TIMEOUT` | none, including in a 3,000 ms window after T2 (the late reply) | not run | NOT_DISPATCHED | no | any click → **FC-9** |
| **C10** | MATCH | ACT `REJECTED PERMIT_EXPIRED`; action bridge 0 calls; 0 clicks | not run (`guardedAct` returns `reached: ACT`, `verification: null`) | NOT_DISPATCHED | no | any click or bridge call → **FC-8** |
| **C11a** | MATCH | first `act` EXECUTED (1 click); second `REJECTED PERMIT_CONSUMED`, action bridge still 1 call; witness exactly 1 click | first dispatch CONFIRMED | first: DISPATCHED · EFFECT_CONFIRMED; replay: NOT_DISPATCHED | first yes, **replay no** | a second click or bridge call → **FC-7** |
| **C11b** | MATCH | first delivery 1 click; duplicate refused by TR-6; witness exactly 1 click | CONFIRMED | DISPATCHED once · EFFECT_CONFIRMED; duplicate: NOT_DISPATCHED | first yes, **duplicate no** | a second click → **FC-7** |
| **C12a** | UNKNOWN `BRIDGE_THREW` (TR-2 refuses `D′`) | none on `D` or `D′` | not run | NOT_DISPATCHED | no | any click, or a MATCH → **FC-3** |
| **C12b** | MATCH (before the navigation) | TR-2 refuses `D′` → action bridge throws; 0 clicks on `D` or `D′` | UNKNOWN `DISPATCH_OUTCOME_UNKNOWN` | NOT_DISPATCHED by the witness · core dispatch axis UNKNOWN · effect UNKNOWN | no | any click → **FC-3**; CONFIRMED → **VR-3** |
| **C13** | MATCH (before the restart) | TR-7 refuses the relay from the new boot → action bridge throws; **0 clicks from the pre-restart cycle**. Recovery cycle: MATCH, 1 click | pre-restart: UNKNOWN `DISPATCH_OUTCOME_UNKNOWN`; recovery: CONFIRMED | pre-restart NOT_DISPATCHED · effect UNKNOWN; recovery DISPATCHED · EFFECT_CONFIRMED | pre-restart **no**; recovery yes | a pre-restart click → **FC-11**; recovery not CONFIRMED is a **liveness** finding, reported separately and never counted as a pass |
| **C14** | MATCH | 1 click on `#save-inert` at (460, 400) | NOT_CONFIRMED `STATE_DIFFERS` | DISPATCHED · **EFFECT_NOT_CONFIRMED** · oracle effect absent | **yes** | CONFIRMED → **VR-2** |
| **C15a** | MATCH | 1 click on `#next`; hash becomes `#step2`; `#next` removed | UNKNOWN `TARGET_ABSENT_AFTER_ACTION` | DISPATCHED · **UNKNOWN** · oracle: navigation yes, effect yes | **yes** | CONFIRMED → **VR-4**; NOT_CONFIRMED is a prediction miss |
| **C15b** | MATCH | 1 click on `#sms`; toggle cancelled | **predicted** NOT_CONFIRMED `FOCUS_ABSENT`: synthetic events do not move focus (not measured by E6, so a prediction) | DISPATCHED · **EFFECT_NOT_CONFIRMED** · landing yes, effect absent | **yes** | CONFIRMED is allowed by the core but recorded as a **landing-only false effect** (E8 A5), and never counted as EFFECT_CONFIRMED |
| **C15c** | MATCH | 1 click on `#same-address`; checkbox becomes checked | **predicted** NOT_CONFIRMED `FOCUS_ABSENT` | DISPATCHED · **EFFECT_NOT_CONFIRMED** (LANDING class) · oracle effect present | **yes** | prediction miss; CONFIRMED is recorded as LANDING_ONLY and never counted as EFFECT_CONFIRMED |
| **C16** | MATCH | 1 click on `#lock` at (620, 320) | CONFIRMED | DISPATCHED · **EFFECT_CONFIRMED** · oracle `disabled` | **yes** | CONFIRMED with the oracle effect absent → **VR-2** |
| **R1** | MATCH (before the overlay) | 1 click lands on **`#overlay`**, **0 on `#save`** (TR-3 point binding) | NOT_CONFIRMED `STATE_DIFFERS` (name still "Save") | DISPATCHED to a non-target · EFFECT_NOT_CONFIRMED · flagged **RESIDUAL_WINDOW_HIT** | yes (to whatever is topmost) | a click on `#save` → **FC-12** (element dispatch through an overlay); CONFIRMED → **VR-2** |

**R1 is not a fail-closed case, and it is reported prominently.** The hit test was correct at its
instant. R1 measures what happens when the page changes after the sample and before delivery, which
is exactly the interval §7 times. It also proves point binding: under `el.click()` the click would go
through the overlay (E6 K2).

### 6.3 Repetitions — PROPOSED, OWNER DECISION REQUIRED before the run

| Block | Runs per row, per cell | Why this number |
|---|---|---|
| Matrix rows (all 25) | **30** | The fixture is deterministic: E6, E7 and E8 were identical across 10 runs. Repeats exist to catch intermittent races (routing, navigation, restart timing), not to estimate a mean. **One violation is decisive at any N.** Zero violations in 30 bound the per-run violation probability below about 10% at 95% (rule of three, 3/30), and is reported with that bound, never as "never". The same N for every row keeps rows comparable |
| **TS — timing series** | **100** | C01's exact protocol, hook-free, fault-free. Nearest-rank p95 of 100 is the 95th ordered value, so five observations lie above it: neither the median nor p95 is set by one outlier, and the maximum is reported separately. A larger N would not change what the owner decides with |

**Totals:** extension phase (25 × 30) + 100 = **850 runs per cell**. Playwright baseline (§10)
(15 × 30) + 100 = **550 runs per cell**.

**Order:**
- Per cell, all extension-phase runs (matrix + TS) run in one seeded permutation: Fisher–Yates with
  Mulberry32, **seed `20261004`**.
- The permutation is written to the log before the first run.
- Every run is a fresh document.
- **No warm-up is discarded.** Each observation records its ordinal and whether it was the first run after
  launch or after C13's restart.

**No run is retried.** A failed or invalid run is recorded as such, and the next run in the permutation
proceeds.

## 7. Timing

### 7.1 Timestamps

**Clock.** Each timestamp is `performance.timeOrigin + performance.now()`, taken in the realm where the
event happens. Realms:
- `CORE`: the offscreen document running `guardedAct`;
- `CS`: the content script's isolated world;
- `MW`: the page's main world;
- `HARNESS`: Node.

**Instrumentation is outside the core.** Every core-realm timestamp comes from an injection point that
already exists: the options object, the two bridge wrappers, or the injected `now` clock. **No
production source is instrumented.**

**Required:**

| | Definition | Realm | How it is taken without changing the core |
|---|---|---|---|
| **T0** | final validation accepted | CORE | first read of `options.verify`. `guardedAct` reads it only after `validateActionFreshness` returned ALLOW (`guardedAct.ts` blob `eac6e354`, the `planIsUsable(options?.verify)` line); a getter on the options object stamps it |
| **T1** | HIT-TEST request begins | CORE | `HitTestBridge` wrapper entered (before any hook) |
| **T2** | HIT-TEST decision available | CORE | the wrapper's answer returned to the core. `establishHitAgreement` computes agreement synchronously after this and before T3m, so the two cannot be separated without instrumenting `hitTest.ts`, which is not done |
| **T3** | permit consumed / dispatch authorised | CORE | **injected-clock call 2** = `redeemPermit`'s single `now()`. Call 1 is `mintDispatchPermit`'s, recorded as **T3m**. The harness asserts exactly 2 clock calls in every dispatching cycle |
| **T4** | dispatch submitted | CORE | `PageActionBridge.clickAtCssPoint` wrapper entered (before any hook) |
| **T5** | page reports the observable change | MW | fixture handler completes its state change (rename, `disabled`, `pushState` + removal, checkbox `change`). **`null` when the page makes no change** (C14, C15b); never imputed |
| **T6** | VERIFY RESULT completed | CORE | the `guardedAct` promise settles in experiment code |

**Supplementary** (recorded in every run; not required intervals):

| | Definition | Realm |
|---|---|---|
| T1cs | hit-test query received | CS |
| **T2s** | `elementFromPoint` sampled for the hit test: **the instant the page state was read** | CS |
| T4cs | dispatch message received | CS |
| **T4d** | first `dispatchEvent(pointerdown)` call | CS |
| T4w | witness receives `pointerdown` | MW |
| T5o, T5o′ | `verify.observe()` called, returned | CORE |
| hook start/end | B0, B1, B2 | CORE / HARNESS |

### 7.2 Intervals reported

| Interval | Meaning | Same realm? |
|---|---|---|
| T1 − T0 | validation → hit-test request | yes (CORE) |
| T2 − T1 | hit-test round trip | yes |
| T3 − T2 | decision → permit consumed (includes mint) | yes |
| T4 − T3 | redemption → dispatch submitted | yes |
| T5 − T4 | submitted → page change | **cross-realm** (CORE → MW) |
| T6 − T5 | page change → verification complete | **cross-realm** (MW → CORE) |
| **T6 − T0** | total | yes |
| T3 − T3m | mint → redemption: **the only interval `ttlMs` bounds today** (`permit.ts`, `redeemPermit`) | yes |
| **T4d − T2s** | page sample → page dispatch: **the physical TOCTOU window** | yes (CS) |
| T4d − T3 | redemption → page dispatch: **not bounded by any permit check today** | cross-realm |
| T4w − T4d | content-script dispatch → main-world receipt | same document; timeOrigin equality checked |

**Cross-realm intervals** are reported **uncorrected**, with a per-run offset bound:
- the core sends a probe to the content script, which returns its timestamp;
- the offset lies in `[CS_recv − CORE_recv, CS_recv − CORE_send]`, and that interval's width is recorded;
- a negative interval is kept and flagged `CLOCK_ORDER_VIOLATION`, never clipped or dropped.

### 7.3 Statistics — deterministic, no significance tests

For each interval, per cell and per row, and for TS:
- **n** and the **null count**;
- **median** = nearest-rank value at `ceil(0.5 · n)`;
- **p95** = nearest-rank value at `ceil(0.95 · n)`;
- **maximum**;
- and **every observation**, in `logs/timings.jsonl`.

**Timing sets:**
- **Primary:** TS.
- **Secondary:** every hook-free, fault-free dispatching run composed by `guardedAct` (C01, C14, C15a,
  C15b, C15c, C16).
- **Excluded from both, reported per row:** every other row. Those rows have a hook, a fault, an
  injected clock or a non-`guardedAct` composition (C11a), or they never dispatch. Hook time is not
  transport time.
- Refusing rows also report T1 → refusal and T0 → refusal.

**No interpolation, no outlier removal, no averaging across cells or rows.**

### 7.4 Permit lifetime — what the run does and does not do

**No permit TTL is approved by this experiment in advance.**

`ttlMs` is a required argument, so the run must pass one. It passes an **instrument setting,
`permitTtlMs = 60 000` ms, that is not a TTL proposal** and may not be cited as one. It is chosen only to
be **non-binding**:
- far above any interval the run can produce, so the measured distributions are not truncated by the
  very value they will inform;
- **non-circularity check:** any `PERMIT_EXPIRED` outside C10 marks that run `CENSORED`, and the cell
  cannot be `COMPLETED`.

**The run derives no TTL:**
- no multiplier on p95, no margin and no recommendation;
- it publishes the intervals in §7.2 and stops.

**Two facts the owner needs are measured rather than assumed:**
1. **Today `ttlMs` bounds only mint → redemption (T3 − T3m).** Reading `guardedAct.ts` and `act.ts`,
   nothing is awaited between them, so that interval is **expected** to be well under a millisecond. The
   run will show whether it is.
2. **The intervals a page can change in are T2s → T4d and T3 → T4d.** No permit check bounds them on
   this transport. Whether the lifetime should govern a different interval is an owner decision (§12),
   not a finding of this run.

## 8. Outcome model — never one boolean

Every run records these axes separately:

| Axis | Values | Source |
|---|---|---|
| **A/B — Dispatch (witness)** | **DISPATCHED** (≥ 1 witnessed click in the cycle) · **NOT_DISPATCHED** (0 clicks, witness heartbeat alive before and after) · **NOT_OBSERVABLE** (heartbeat missing) | page witness |
| Dispatch (core) | DISPATCHED (`EXECUTED`) · NOT_DISPATCHED (refused at VALIDATE / AUTHORISE / HIT_TEST / PERMIT / redemption) · **UNKNOWN** (`EXECUTION_ERROR`) | `GuardedOutcome` |
| **C/D/E — Effect** | **EFFECT_CONFIRMED** only if VERIFY RESULT is CONFIRMED **and** the row's postcondition class is EFFECT · **EFFECT_NOT_CONFIRMED** if NOT_CONFIRMED, or CONFIRMED on a LANDING-class postcondition (sub-label `LANDING_ONLY`) · **UNKNOWN** if UNKNOWN · `n/a` if nothing was dispatched | VERIFY RESULT + §6.1 class |
| Effect oracle | present · absent · not observable | fixture, harness only |
| Stage and cause | `reached`, the refusal or verification cause, bridge call counts, clock call count | `GuardedOutcome`, wrappers |

**Decoding rules:**
- **NOT_OBSERVABLE is never NOT_DISPATCHED.** An observer that saw nothing is not evidence that nothing
  happened (the E4 rule).
- **UNKNOWN is never folded into success or failure.** No count adds UNKNOWN to either side.
- **Landing is not effect.** A CONFIRMED on a LANDING-class postcondition is recorded and counted
  separately, and is never an EFFECT_CONFIRMED. This is the E8 finding, carried as a rule.
- **Core and witness disagreements are reported, not reconciled.** C08c and C12b are *expected* to show
  core UNKNOWN with witness NOT_DISPATCHED. `PageActionBridge` cannot tell "refused before dispatch" from
  "threw after dispatching", so the core stays UNKNOWN, which is the safe direction.

**Categorical reporting:** a count of every value on every axis, per row, per cell. **No failure is
averaged away**, and no rate is reported without its count.

## 9. Decision criteria — no GO/NO-GO for a TTL

### 9.1 A valid execution path

A run is on the valid extension path only if **all** of these hold. **Any failure makes the run
`INVALID_PATH`.**

| # | Condition |
|---|---|
| **V1** | the six core blobs in §3.1 are unchanged; harness, transport, fixture and extension build hashes are recorded |
| **V2** | the built manifest's permissions, host permissions and CSP equal §3.2 |
| **V3** | **every witnessed click event in the run is `isTrusted === false`.** A trusted click means a non-extension input path acted |
| **V4** | the static scan (§5.2) found no forbidden Playwright or CDP input API |
| **V5** | every witnessed click has `clientX, clientY` exactly equal to the permit's point, or, for R1, the point the permit fixed |
| **V6** | one offscreen `instanceId` across the cell (C13 restarts the SW, not the offscreen document) |
| **V7** | exactly 2 injected-clock calls per dispatching cycle; 0 when refused before MINT |
| **V8** | the post-action observation carries a new observation `FrameId` |
| **V9** | the witness heartbeat is present before and after the cycle; otherwise the run is `NOT_OBSERVABLE` |

### 9.2 Fail-closed behaviour

A **violation** is any witnessed click in the cycle, or any core `EXECUTED`, where the rule says no
dispatch.

| Rule | Never dispatches | Rows |
|---|---|---|
| **FC-1** | UNKNOWN never becomes success (see VR-1) | all |
| **FC-2** | wrong frame, including a stale observation frame or a wrong browser frame or document | C04a, C04b |
| **FC-3** | wrong document: stale document, or navigation before delivery | C03, C12a, C12b |
| **FC-4** | wrong point: proposed, coordinate drift or in transit | C08a, C08b, C08c |
| **FC-5** | removed target | C05 |
| **FC-6** | target moved outside authorised geometry | C06a, C06b |
| **FC-7** | replayed permit or replayed delivery | C11a (replay), C11b (duplicate) |
| **FC-8** | expired permit | C10 |
| **FC-9** | HIT-TEST UNKNOWN, including a late answer after the deadline | C09 |
| **FC-10** | HIT-TEST MISMATCH | C02, C07 (and every MISMATCH anywhere) |
| **FC-11** | a cycle whose relay did not survive a service-worker restart | C13 (pre-restart) |
| **FC-12** | no selector, element, nearest-element or `el.click()` dispatch | R1 (`#save` must receive 0 clicks), plus a static review of the transport's dispatch path |

**FC-11 and FC-12 are additions** beyond the rules D-E6-4 was asked to cover. Like E4-offscreen's
additions, they can only make the result stricter.

### 9.3 Correct VERIFY RESULT behaviour

| Rule | Statement |
|---|---|
| **VR-1** | a core UNKNOWN is never counted as EFFECT_CONFIRMED, and `guardedActionConfirmed` is `false` for it |
| **VR-2** | CONFIRMED on an EFFECT-class postcondition with the oracle effect **absent** is a violation |
| **VR-3** | `EXECUTION_ERROR` always yields UNKNOWN, never CONFIRMED or NOT_CONFIRMED |
| **VR-4** | a target absent after the action yields UNKNOWN, never CONFIRMED |
| **VR-5** | a refusal before dispatch yields `verification: null` from `guardedAct`, never CONFIRMED |
| **VR-6** | CONFIRMED on a LANDING-class postcondition with the effect absent is **not** a violation of the core, which behaves as designed. It is counted as `LANDING_ONLY_FALSE_EFFECT` and reported against D-E8-2 |

### 9.4 Verdicts, per cell

| Verdict | Condition |
|---|---|
| `ABORTED` | identity, build, host-load or fixture-geometry check failed before the first run. No verdict |
| `INVALID_PATH` | any §9.1 condition V1–V8 failed in any run. No fail-closed or VERIFY verdict can be drawn from a path that was not shown to be the extension path |
| `FAIL_CLOSED_VIOLATED` | ≥ 1 FC violation. Reported with row, run ordinal and every axis. **Dominates** everything below |
| `VERIFY_VIOLATED` | ≥ 1 VR-1…VR-5 violation |
| `INCOMPLETE` | any run `NOT_OBSERVABLE`, `CENSORED` or `INVALID` (hook overrun) in any row |
| `COMPLETED` | none of the above: path valid in every run, 0 FC, 0 VR, every run observable. **Timing evidence produced.** Prediction misses, liveness findings and `RESIDUAL_WINDOW_HIT` / `LANDING_ONLY_FALSE_EFFECT` counts are listed, never hidden, and do not change this verdict |

`COMPLETED` says the extension path ran through the existing authority and failed closed on this
matrix, in this cell. **It sets no TTL, adopts no transport property, and changes no status in §13.**

### 9.5 What must be measured for the later permit-lifetime decision

1. For TS and the secondary set, per cell: every observation, and the median, p95 and maximum of every
   §7.2 interval.
2. Specifically T3 − T3m, T4d − T2s, T4d − T3 and T6 − T0.
3. The cross-realm offset bound for every run that contributes to 1–2.
4. The first-run-after-launch and first-run-after-restart values, identified.
5. R1's `RESIDUAL_WINDOW_HIT` count, and the same intervals for R1 runs, reported separately.
6. The Playwright baseline's intervals (§10), side by side and **never pooled**.

## 10. Control / baseline — comparison only, never authority

**Phase BL — Playwright trusted-CDP baseline.** It runs in each cell **after** the extension phase, in
a **separate browser launch without the extension**, from a **separate harness file** (so the §5.2
static scan of the extension harness stays meaningful).

| | Extension phase | Baseline BL |
|---|---|---|
| Core | same blobs | same blobs |
| Fixture and geometry | F-E6-4 | F-E6-4 |
| Hit-test bridge | content script (TR-4) | E8's raw `elementFromPoint` probe template (`run-e8.mjs` blob `ccfceeae4355cdfceb2ff6c7a2004966a4fb2aed`), via `page.evaluate` |
| Action bridge | content-script point dispatch (TR-3) | `page.mouse.click` (trusted CDP, the MVP-1/MVP-2/E8 mechanism) |
| Rows | all 25 + TS | C01, C02, C05, C06a, C06b, C07, C08a, C08b, C10, C11a, C14, C15a, C15b, C15c, C16 (15 rows) + TS. Transport faults and document-binding rows have no Playwright analogue and are not run |
| Predictions that **differ** | C15b, C15c: NOT_CONFIRMED `FOCUS_ABSENT` (no focus from synthetic events) | C15b: **CONFIRMED** with the effect absent (E8 A5); C15c: **CONFIRMED** (E8 A4). V3 inverted: every click `isTrusted === true` |
| Timing | §7 | the same labels where they exist; T4 is `page.mouse.click` called in HARNESS, and every CORE↔page interval is cross-process |

**Baseline rules:**
- **No criterion in §9 reads a baseline result.** A baseline failure never blocks the extension verdict,
  and a baseline pass never substitutes for one.
- Baseline logs are separate files, baseline counts are never added to extension counts, and every
  table that shows both labels each column.

## 11. Evidence to be generated

Every path is under `artifacts/experiments/E6-extension-dispatch-revalidation/`.

| Artifact | Path | Contents |
|---|---|---|
| Experiment README | `README.md` | this file. Only *Actual result* and *Conclusion* may be filled after the run. Every other section must be byte-identical to this pre-registration commit, and that is checked at result time |
| Raw event log | `logs/events.jsonl` | one line per run: cell, row, ordinal, permutation index, hooks, faults, `GuardedOutcome` projection (stage, decision reason, hit agreement and cause, act status and cause, verification and cause), bridge call counts, clock call count, every witness event, oracle, TR refusals, validity flags V1–V9 |
| Timing log | `logs/timings.jsonl` | one line per run: every T and supplementary timestamp with its realm, the offset bound, and flags |
| Baseline logs | `logs/baseline-events.jsonl`, `logs/baseline-timings.jsonl` | the same schema, labelled `BASELINE_PLAYWRIGHT_TRUSTED_CDP` |
| Summary | `logs/summary.json` | counts per axis, row and cell; statistics from §7.3; verdicts from §9.4. Derived from the two raw logs only |
| Environment manifest | `logs/environment.json` | browser versions as reported by the running browsers, executable paths, Playwright and Node versions, OS build, viewport, actual DPR and zoom, fixture port, permutation seed and order |
| Build / hash manifest | `logs/build-manifest.json` | extension id; SHA-256 of every file in the built `chrome-mv3` output, including `manifest.json`; git blob ids of the six core files, the transport, harness and fixture files; `git HEAD` and clean-tree state |
| Machine provenance | `logs/provenance.json` | hostname, CPU, GPU UUID and driver, from live queries at run time. **Must read `LAPTOP-SRCINK2B` / `GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a`, or the run is not W2 evidence and is labelled with what it is** |
| Final decision record | `decision.md` | the verdict per cell. Until the run it states that no verdict exists |

**Rules for the logs:**
- The harness refuses to overwrite any existing log file. A re-run is a new, dated attempt directory,
  and earlier attempts are kept.
- **No hash or result is written into this README before it exists.** The blob ids in §3.1, §3.2 and §10
  were read with `git ls-tree cb309d0` when this file was written.
- Logs hold only synthetic fixture metadata, causes, counts and timestamps (TR-10, INV-21).

## 12. Unresolved owner decisions this pre-registration does not take

| # | Decision | Where it is recorded |
|---|---|---|
| 1 | **The permit lifetime value** | ADR-0008 §5 — unresolved; this run only supplies evidence |
| 2 | **Which interval the lifetime should bound.** Today: mint → redemption only. The page-exposed windows (T2s → T4d, T3 → T4d) are unbounded by any permit check. Binding expiry at delivery would change permit semantics | new; ADR-0008 amendment if taken |
| 3 | Adopt TR-2, TR-5, TR-6, TR-7 as transport properties | this file §3.3 (PROPOSED) |
| 4 | Whether document binding belongs in the permit itself (ADR-0008) or stays a transport refusal (TR-2) | new |
| 5 | Whether `PageActionBridge` should distinguish "refused before dispatch" from "threw" (today both are `EXECUTION_ERROR` → UNKNOWN) | ADR-0006 / ADR-0007 |
| 6 | Whether to close R1's residual window with a same-task page-side re-check at dispatch. That would be an ADR-0007 change, and **is not assumed here** | ADR-0007 §8 neighbourhood |
| 7 | Product placement of the core realm (the offscreen document is assumed here, TR-9) | architecture |
| 8 | Repetition counts, cells, seed, the 1,000 ms hook budget and the instrument TTL setting, before the run | this file §5, §6.3, §7.4 |
| 9 | Unchanged and still open: D-E6-1, D-E6-2 (point binding, which this run exercises), D-E6-3 (`isTrusted` pages), D-E7-1..4, D-E8-1..3, D-ACT-1, D-ACT-2, the ADR-0005 / ADR-0007 tolerances | their own records |

## 13. Status — unchanged by this pre-registration, and by any result of it

- B-02 **OPEN**; QG-04 **unsigned**.
- Detector **UNADOPTED**.
- E1 and E9 **not run**.
- W-A gate **CLOSED**.
- MV3 host **experimental**.
- ADR-0005, ADR-0006, ADR-0007 and ADR-0008 **PROPOSED**; permit TTL **unresolved**.
- MVP-1 and MVP-2 stay **trusted-CDP evidence**. A future `COMPLETED` would license quoting *this
  experiment's* extension-path results for the click path, in its cells; it would not relabel MVP-1 or
  MVP-2.
- No privacy claim of any kind.

## Expected result

§6.2 (per row), §9 (validity, fail-closed, VERIFY rules and verdicts), §7 (what is measured). Fixed
before any code for this experiment exists.

## Actual result

**NOT RUN.** This section is empty by design and may be filled only by the run described above.

## Conclusion

**NONE.** No conclusion may be drawn from a pre-registration.

## Reproducibility

The run will be reproducible from committed artifacts **once they exist**:
- the transport (§3.3);
- `harness/` (extension phase and baseline, separate files);
- `harness/fixture/f-e6-4.html`.

Each lands in its own commit **after** this file. The exact command, the refusal conditions and the
`CHROME_PATH` / `EDGE_PATH` inputs will be added to this section at result time, as E4-offscreen did.
None of it exists at this commit.
