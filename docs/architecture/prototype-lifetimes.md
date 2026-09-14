# Lifetimes and deadlines in the prototype loop

> **Prototype TTL; not performance/security-policy proof.**
>
> Every value on this page is an **instrument value** — a number something had to state so the code
> could run. None is derived from measurement, none is approved policy, and none should be quoted as
> a recommendation. ADR-0008 §5 leaves the dispatch permit's lifetime an open owner decision, and the
> two lifetimes added by the product loop inherit that status.

## Why there is no default anywhere

The execution gate refuses `ttlMs` that is absent, zero, negative or non-finite, and has no fallback.
That is deliberate: a default would be a policy nobody decided, silently applied. The same rule now
holds for the confirmation and the grant. **Every lifetime in the loop is stated by its caller**, so
the set of places that decide is small and greppable.

## The inventory

| # | Lifetime | Where it is defined | Where the value comes from | Status |
|---|---|---|---|---|
| 1 | **Dispatch permit** `ttlMs` | `packages/agent/src/permit.ts` — `MintOptions.ttlMs`, required | `RunOptions.permitTtlMs` → `apps/demo/src/main.ts` (**5 000 ms**) | PROVISIONAL · ADR-0008 §5 open |
| 2 | **Human confirmation** `ttlMs` | `packages/agent/src/humanConfirmation.ts` — `ConfirmationOptions.ttlMs`, required | `RunOptions.confirmationTtlMs` → `apps/demo/src/main.ts` (**60 000 ms**) | PROVISIONAL |
| 3 | **Privacy use-grant** `expiresAt` | `packages/privacy/src/bind.ts` — `UseGrant.expiresAt`, an absolute time | `RunOptions.grantTtlMs` → `apps/demo/src/main.ts` (**60 000 ms**) | PROVISIONAL |

### Deadlines, which are a different thing

A deadline bounds how long the client waits for something to answer. It is not an authorisation
lifetime and does not gate anything.

| Deadline | Default | Where |
|---|---|---|
| Dispatch bridge | `DEFAULT_DISPATCH_TIMEOUT_MS` = 5 000 ms | `packages/agent/src/act.ts` |
| Hit-test bridge | `DEFAULT_HIT_TEST_TIMEOUT_MS` = 2 000 ms | `packages/agent/src/hitTest.ts` |
| Reasoner | `DEFAULT_REASONER_TIMEOUT_MS` = 10 000 ms | `packages/reasoner/src/contract.ts` |
| Egress (network) | `DEFAULT_EGRESS_TIMEOUT_MS` = 30 000 ms | `packages/egress/src/guard.ts` |

A dispatch deadline that expires is reported as `BRIDGE_TIMEOUT` and the outcome is **UNKNOWN**,
never "did not happen" — the click may well have landed.

The egress deadline is the one that now bounds a **real network request**. Measured against it: the
local model's cold request took 2 020 ms and warm requests 579–623 ms on W2 (LOOP-2), so 30 000 ms is
loose by a factor of roughly fifty. It is still an instrument value — nobody has decided what a
reasonable ceiling is for a model that is allowed to think.

## What is deliberately not time-based

**Action freshness is structural, not temporal.** `validateActionFreshness` has no TTL and no clock:
it compares the proposed target against a freshly observed graph — role, accessible name, enabled,
visibility, frame identity, and geometry within `PROPOSED_FRESHNESS_TOLERANCE` (a distance and an
IoU, not a duration). A plan does not become stale by ageing; it becomes stale when the page stops
matching it. Nothing in the loop should introduce a freshness TTL without changing that design
deliberately.

`DEFAULT_FRAME_TTL_MS` (2 000 ms, `packages/perception/src/capture.ts`) bounds the staleness of a
**captured frame**. The product loop captures no frames — perception is structural here — so it takes
no part in this chain.

## Single source of truth

There are exactly three authorisation lifetimes and they meet in one place: `RunOptions` in
`packages/orchestrator/src/machine.ts`, supplied by `apps/demo/src/main.ts`. The orchestrator holds
no defaults and the packages below it hold none, so a value cannot be set in two places and disagree.
Test suites state their own values, clearly labelled as test lifetimes.

## What would have to happen to make any of these policy

Measured hit-test→dispatch intervals under load for the permit (ADR-0008 §5 says exactly this), and
an owner decision about how long a human's consent should remain spendable for the other two. Neither
has been done. **No benchmark study is in scope, and none of these numbers is evidence of anything.**
