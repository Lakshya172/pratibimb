# ADR-0008 — The execution gate: single-use dispatch permits

- **Status: PROPOSED.** Implemented on `feature/act-permit-core`. **Two values are open owner
  decisions (§5): the permit lifetime, and whether the gate's confirmation tier stays as ADR-0006
  §6 proposes.** The owner may renumber this ADR.
- **Date:** 2026-09-13
- **Decision owner:** `ronitsaha11`
- **Prepared by:** implementation engineer, workstation 2 (`LAPTOP-SRCINK2B`), from `main` `eb4604b`
- **Amends:** [ADR-0006](ADR-0006-act-browser-action-executor.md) (ACT's input and preconditions) ·
  [ADR-0007](ADR-0007-hit-test-agreement-and-verify-result.md) §8 (closes the stated residual)
- **Enforces:** INV-13 and INV-14, which name the action executor as their enforcement point

## 1. The residual this closes

ADR-0007 §8 recorded it: *"`act()` remains exported and callable without a hit test."* An audit
added a second route: `validateAndAct()` also reached ACT with no hit-test agreement. And
`guardedAct` dispatched with `verification: null` whenever a caller supplied no readback. The safe
composition existed, but the lowest boundary did not enforce it.

## 2. Decision

Authority is **minted once, by the execution gate, and ACT only redeems it.**

```
VALIDATE ─► AUTHORISE (kind · target · tier) ─► HIT-TEST MATCH ─► MINT ─► ACT(permit) ─► VERIFY RESULT
```

- `act(permit, bridge, options?)`. The only authority-bearing parameter is a `DispatchPermit`. A
  freshness decision, a hit-test result, a point or `undefined` **does not type-check** (pinned by
  four `@ts-expect-error` lines that make `tsc -b` fail if any of them starts compiling).
- `mintDispatchPermit(decision, hit, { ttlMs, now? })` is the only way a permit comes into
  existence. It requires:
  1. an attested ALLOW
  2. static authorisation: an allowlisted, executable kind; a node, box and frame; not in the
     confirmation tier
  3. an attested MATCH
  4. **that MATCH established for this exact decision object**, checked through a module-private
     `WeakMap` in `hitTest.ts`
  5. the agreed point equals the dispatch point, inside the validated box
  6. the observed frame equals the decision frame
  7. a finite, positive `ttlMs`
- A permit is frozen and fixes `kind`, `frameId`, `point` and `target` (node id, stable selector,
  role, name, box). ACT has no parameter for any of them.
- **Single use, consumed before dispatch.** Every redemption attempt that identifies a genuine permit
  consumes it, including an expired permit and one presented to a bridge on the wrong frame. A
  bridge that throws or times out has spent it. There is never a retry of old authority.
- **`validateAndAct` is removed.**
- **`guardedAct` requires `verify` and `permitTtlMs`.** A call without a usable postcondition is
  refused at `AUTHORISE`, before the page is queried.
- **New stage names:** `VALIDATE | AUTHORISE | HIT_TEST | PERMIT | ACT | VERIFY_RESULT`.

## 3. Attestation, and its limit

A permit is recognised by **membership in a module-private `WeakSet` of issued objects**, not by a
hidden symbol. ADR-0005 and ADR-0007 attest with a symbol; the first implementation here used both.
The mutation check showed the symbol added nothing, and membership is strictly stronger: it also
refuses a reflective clone that re-applies every own property *and* symbol descriptor, which a
symbol check alone accepts. So the symbol was removed, and a test pins the reflective case.

**Limit, unchanged:** this is a same-realm integrity check, not a capability. It makes accidental
bypass impossible (copies, spreads, `JSON.parse` revivals, literals and reflective clones are all
refused), and deliberate in-process bypass unwritable by mistake. The adversaries PratiBimb names
cannot reach it: page script runs in a different JavaScript world, and a server can send only JSON.

## 4. Deliberate behaviour changes

| Before (ADR-0006/0007) | After | Why |
|---|---|---|
| Confirmation-tier refusal happened inside ACT, **after** the hit test | Refused at `AUTHORISE`, **before** the hit test; the page is not queried | The tier is static authorisation; querying the page for an action that cannot be authorised is pointless |
| No readback → dispatched, `verification: null` | Refused at `AUTHORISE` with `POSTCONDITION_REQUIRED` | A dispatch nothing will read back is not authorised |
| `act(decision)` re-checked allowlist, kind, target, tier and point | ACT only redeems; the gate checks all of it | Authority in one place |

Two tests in `guardedActOnMvpFixture.test.ts` (workstation-1 authored, merged) encoded the old
behaviour. They were **changed to assert the new behaviour**, not deleted, and each carries a
comment saying so.

## 5. Open values — owner decisions

| Value | Status | Why it is not set here |
|---|---|---|
| **Permit lifetime (`ttlMs`)** | **UNRESOLVED. No default exists in code.** Tests use explicitly labelled test values | The repository holds no hit-test→dispatch timing: `MVP-2…/logs/mvp2.json` (workstation 1) has no timing fields. The value must come from measurement on the product transport, which experiment E6 provides |
| Confirmation-tier patterns | PROPOSED in ADR-0006 §6 (D-ACT-1), unchanged; moved into the gate | Owner policy |

## 6. Not decided here, on purpose

- **Computed-style visibility at mint.** Which deterministic checks close the opacity, clip and decoy
  cases is experiment E7's question. The gate gains a mandatory visibility input once E7 has chosen
  them.
- **The browser dispatch mechanism.** Point-based versus element-based dispatch is E6's question. A
  permit carries both the point and the stable target reference, so either binding can be enforced
  without widening what a permit authorises.
- **BIND / HUMAN GRANT / TYPE.** No vault, no grant path. Confirmation-tier targets are always refused.

## 7. Evidence

- **Tests:**
  - `permit.test.ts` (22), covering: forged, copied, reflectively cloned and JSON-revived permits; wrong frame, point and target; consumed; expired; UNKNOWN and MISMATCH cannot mint; a MATCH for another decision cannot mint; missing or invalid TTL; tier and unsupported kinds cannot mint even with a MATCH; single execution; an execution error consumes the permit; `validateAndAct` absent; type-level impossibility
  - `act.test.ts` (23), rewritten to reach ACT only through the gate
  - existing suites ported
- **Mutation check:** `node tools/mutation/permit-core.mjs` — **16 mutations, 14 killed, 2 survived,
  0 unexpected.**
  - Both survivors, M17 (point equality in mint) and M18 (observed-frame equality in mint), are
    **unreachable while hit results are bound to their decision**. They are kept as cheap insurance
    should that binding ever change.

## 8. Recorded discrepancy — historical harnesses

`artifacts/experiments/MVP-1-act-executor/harness/run-mvp1.mjs` (workstation 2) calls
`validateAndAct`. `…/MVP-2-hit-test-verify-result/harness/run-mvp2.mjs` (workstation 1) calls
`guardedAct` without the options that are now required.

**They are not edited.** They are evidence, and they reproduce at their recorded commits:
- MVP-1: `25327e4`, merged via PR #60
- MVP-2: the PR #61 merge, `94d92c4`

Re-running either against this API requires checking out that commit.

## 9. Consequences

**Gained:**
- The lowest executor boundary enforces agreement, single use and expiry.
- Authority lives in one module.
- A postcondition is mandatory.

**Cost:**
- Callers must supply a lifetime nobody has measured yet.
- Two merged tests changed meaning.
- Historical harnesses no longer run on `main`.

**Risk accepted:** until E6, the permit is designed against point-based dispatch evidence that came
from Playwright's trusted input, not from an extension.
