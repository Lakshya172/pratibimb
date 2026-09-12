# ADR-0005 — VALIDATE + REFRESH: the action-freshness boundary

- **Status: PROPOSED.** The implementation lands with it; the **two numeric tolerances are
  proposals and require owner approval** (§6).
- **Date:** 2026-09-12
- **Decision owner:** `ronitsaha11`
- **Prepared by:** implementation engineer, workstation 2, at main `bd4755c`
- **Implements:** `docs/architecture/action-schema.md` §*Action freshness — pipeline stage 8*
- **Related:** `docs/security/security-invariants.md` INV-13, INV-14 · `AUDIT-0005`
  (nine loop stages unbuilt) · `packages/perception/src/{elementGraph,observation,fusion}.ts`

> This is the **first** implemented stage of the execution loop after perception. It is
> deliberately the smallest one: pure functions, no network, no model, no secrets, no browser.
> It does **not** implement ACT, REASON, SANITIZE, VERIFY or RE-HYDRATE, and it does not
> pretend to.

## 1. Why this stage, and why first

The action grammar is frozen and the freshness requirement is written down — *"the target
element still exists; its role and accessible name still match what was reported to the server;
it is visible and enabled; its bounding box has not moved beyond a tolerance"* — with the rule
that *"a failed freshness check does not guess"*. **Nothing implemented it.**

It comes first because it is the only stage whose absence makes every later stage unsafe to
build. An executor without a validator is a machine that clicks wherever a model said to click,
on a page that may have changed since the screenshot. That is the exact window the contract
exists to close: *"a page can swap a benign control for a harmful one after the screenshot but
before the click."*

## 2. Inputs

Reusing existing contracts. **No new coordinate space, no second element model, no duplicate
visibility framework.**

| input | type | source |
|---|---|---|
| current observation | `ElementGraph` | `packages/perception/src/elementGraph.ts` — carries `frameId`, `nodes`, `byId` |
| per-node visibility | `VisualEvidence` | `observation.ts`, already on every `ElementNode` as `evidence` |
| geometry | `CssBox`, `CssPoint` | `space.ts` — the canonical CSS viewport space (INV-24) |
| the plan's claim | **`TargetClaim`** (new, minimal) | what was reported to the server: `nodeId`, `role`, `name`, `frameId`, `viewportBox` |
| the proposed action | **`ProposedAction`** (new, minimal) | an allowlisted `kind`, an optional `target`, an optional `point` |

**Two new types, and only two.** `TargetClaim` and `ProposedAction` exist because the action
grammar is **documentation only** — there is no TypeScript action type in the repository. They
are the minimum the check needs and are deliberately *not* a full action schema: no value, no
`value_ref`, no literal, no vault token. Those belong to SANITIZE and RE-HYDRATE, which do not
exist, and putting them here would invent a second privacy surface.

## 3. The checks, in order, all fail-closed

| # | check | rejection reason |
|---|---|---|
| 0 | the action's `kind` is on the frozen allowlist | `ACTION_NOT_ALLOWLISTED` |
| 1 | a targeted action carries a target; a target-free action (`wait`, `done`) does not | `MALFORMED_CLAIM` |
| 2 | every number in the claim is finite; the claimed box has positive extent; role and name are present | `MALFORMED_CLAIM` |
| 3 | the claim's frame **is** the graph's frame | `FRAME_MISMATCH` |
| 4 | the node still exists in the graph | `TARGET_MISSING` |
| 5 | the node's `role` still matches | `ROLE_CHANGED` |
| 6 | the node's accessible `name` still matches | `NAME_CHANGED` |
| 7 | the node is `enabled` | `NOT_ENABLED` |
| 8 | the node's evidence admits a visual claim (`OBSERVED` or `CLIPPED`) | `NOT_VISIBLE` |
| 9 | the evidence's own `frameId` matches the graph's | `FRAME_MISMATCH` |
| 10 | the centre has not moved beyond the movement tolerance | `MOVED_BEYOND_TOLERANCE` |
| 11 | the box still overlaps the claim at the geometry floor | `GEOMETRY_MISMATCH` |
| 12 | a supplied point lies inside the **current** box — and inside `visiblePart` when `CLIPPED` | `POINT_OUTSIDE_TARGET` |

**Order matters.** Identity is checked before geometry, so *"a visually identical replacement
appeared in the old location"* is rejected as `ROLE_CHANGED` / `NAME_CHANGED` rather than passing
a box comparison. Frame is checked before everything about the node, because a stale frame makes
every other answer meaningless.

**Why both a movement check and a geometry check.** Movement alone misses a resize: a control
that keeps its centre and doubles in width has moved 0 px and is no longer the thing that was
planned against. IoU alone misses a small shift on a large element. Two cheap checks, two
distinct failure modes.

**Why exact string equality on role and name.** A fuzzy match is a policy decision about how
much a control may change and still be "the same control", and that policy does not exist. Exact
equality fails closed; fuzzy matching fails open, in the direction of clicking something that
changed. If it proves too strict in practice, loosening it is an owner decision with evidence —
not a default.

## 4. Outputs

The public decision is **two-valued**, as required:

```
ALLOW       — every check passed; carries the CURRENT node and box, not the claimed ones
RE_OBSERVE  — something failed; carries a machine-readable reason and a human detail string
```

**There is no third outcome.** No "closest candidate", no "best effort", no "allow with
warning". `ALLOW` deliberately returns the **current** geometry so a caller cannot act on the
stale box it asked about — the value that passed validation is the value it must use.

The rejection reason is internal richness over a two-valued public decision: a caller that
switches on `decision` sees two cases, and a ledger that wants to say *why* has the reason.

## 5. REFRESH — what it is, and what it is not

`RE_OBSERVE` **is** the refresh decision. This layer does not observe, capture, re-plan or
orchestrate, because the observation loop does not exist yet (`AUDIT-0005`). Inventing one here
would be a second control flow that the real loop would then have to fight.

**The contract on the caller, stated so the future loop can be held to it:**

1. **Do not execute the action.** Not a modified version of it, not a nearby target.
2. **Discard the whole plan**, not just the failed step — the contract says *"it discards the
   plan, re-observes, and issues a new request"*.
3. **Obtain a fresh observation** — a new frame and a new `ElementGraph` with a new `frameId`.
4. **Re-plan** from that observation.
5. **Never** re-submit the same `TargetClaim` against a new graph hoping it passes: the claim is
   a statement about a frame that is gone.

A helper, `mustReObserve`, exposes this as a boolean so a caller cannot accidentally treat an
unknown decision as permission.

## 6. The two tolerances — PROPOSED, not adopted

The contract requires *"a tolerance"* and **names no number**. A grep of `packages/*/src` finds
no movement tolerance; the only existing tolerance, `ASPECT_TOLERANCE = 0.01`, governs coordinate
transforms and is unrelated. So values are required, and inventing them silently is exactly what
this project's rules forbid.

| constant | value | basis |
|---|---|---|
| `maxCentreShiftCssPx` | **2.0** | **borrowed, with a precedent.** 2.0 CSS px is the displacement bound the owner **already approved** in QG-03a-B1/B4 as the detector-equivalence criterion. It is the project's only *measured* statement about what displacement is negligible in CSS space. **Borrowing it across purposes is a proposal, not an adoption** — B1/B4 approved it for detector equivalence, not action freshness |
| `minBoxIou` | **0.8** | **proposed, no precedent.** Nothing in the repository provides a box-similarity floor for this purpose. It sits well above the frozen fusion threshold of 0.5 — a box may legitimately be *fused* at 0.5, but acting on a target that changed that much is a different risk — and below 1.0, which would reject sub-pixel layout noise |

Both are **configuration, not constants**: `validateActionFreshness` takes an optional tolerance
object, so a future owner decision changes a call site rather than a source edit. **Neither value
is claimed as approved**, and the ADR stays `PROPOSED` until the owner rules.

**What would settle them:** a measurement of real per-frame layout jitter on a controlled page
across repeated observations. That does not exist, and this ADR does not manufacture it.

## 6a. One design defect the tests caught, before the implementation was trusted

The first implementation used **one** box per element: whatever the evidence permitted acting
inside. For a `CLIPPED` element that is the **visible part**, so the movement check compared a
claim's **full** box against a visible **fragment** and reported a 75 CSS px move and an IoU of
0.5 on a target that had not moved at all. A legitimately clipped control was refused.

The fix is two boxes with different jobs, and it is worth stating as a rule rather than a patch:

- **`comparisonBox`** — the element's full `viewportBox`. The claim holds that quantity, so it is
  the only thing movement and IoU may be measured against.
- **`actableBox`** — where a caller may actually click: the visible part for `CLIPPED`, the full
  box otherwise. It is also what `ALLOW` hands back, so a caller cannot click the centre of a
  half-scrolled element.

It was found by a test written for the clipped case, not by review.

## 7. What this ADR explicitly does NOT do

No ACT, no executor, no click, no typing. No REASON, no server, no planner. No SANITIZE, no PII
detector, no redaction. No RE-HYDRATE, no vault — `ProposedAction` carries **no value and no
token**, so there is nothing here a secret could pass through. No network request, no storage, no
logging of values. No detector, model, threshold, NMS or preprocessing change. No change to any
security invariant, and no weakening of Invariant E: this package imports nothing that can reach
the network, and the action kinds it admits are exactly the frozen allowlist.

## 8. Consequences

**Gained:** the first real boundary between perception and action; a composable, deterministic,
unit-testable refusal; and a place for the future loop to call before anything touches a page.

**Cost:** a new package, `@pratibimb/agent`. Action safety is not perception, and putting it in
`packages/perception` would make the perception package the home of everything.

**Risk accepted:** exact name/role equality may prove too strict on dynamic pages. That is the
correct direction to be wrong in, and it is measurable later.
