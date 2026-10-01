# The human-confirmation channel

**Status: PROVISIONAL.** An implementation note, not an ADR. It records what was built and why, and
it does not settle ADR-0006 §6's open question (D-ACT-1) about the confirmation tier itself.

## The problem it solves

`authorisationPreflight` places any control whose accessible name matches the action schema's
confirmation patterns — *submit, send, pay, delete, transfer, sign in, confirm* — in a tier the gate
would not authorise, refusing with:

> *"No confirmation channel exists, so no permit can be issued on a human's behalf."*

That was the correct answer while nothing in the system could represent a human's consent. It also
made the demo loop's only action — clicking a button named "Submit application" — impossible.

Two ways out were available. Renaming the fixture's button to something outside the pattern would
have touched no protected code, but ADR-0006 §6 already names that exact dodge as the screen's known
weakness ("a submit control named 'Continue' passes"), and a demo that avoids the tier proves nothing
about it. The owner chose to build the channel the refusal asks for.

## What it is

`packages/agent/src/humanConfirmation.ts`. A `HumanConfirmation` records that a human agreed to one
action on one control:

```
ConfirmationSubject = { nodeId, selector, role, name, frameId, origin }
HumanConfirmation   = { subject, purpose, confirmedAt, expiresAt }
```

Five properties, each with tests in `packages/agent/test/humanConfirmation.test.ts`:

| Property | How |
|---|---|
| **Unforgeable** | Recognised by membership in a module-private `WeakSet`, exactly as `DispatchPermit` is (ADR-0008 §3) and `VerifiedHandoff` is in `@pratibimb/privacy`. A structurally perfect object this module did not create is not a confirmation. |
| **Bound to one control** | `nodeId`, `selector`, `role` and `name` must all match the live node. |
| **Bound to one frame and one origin** | The frame comes from the decision; the origin is **not** carried by a freshness decision, so the caller supplies it — and an unsupplied origin is an unknown, which refuses (`ORIGIN_NOT_SUPPLIED`). |
| **Temporary** | `ttlMs` is required with no default, for the same reason the permit's is. |
| **One-shot** | Spent inside `mintDispatchPermit` as the permit is issued. One "yes", one permit. Spending happens *after* every other gate has passed, so a refusal at the hit test leaves the consent intact for a retry the human already agreed to. |

## The chain, and the absence of a shortcut

```
recordHumanConfirmation  →  mintDispatchPermit  →  act  →  one dispatch
        (the UI asks)          (spends it)      (permit only)
```

A confirmation is an **input to the mint**, never a substitute for a permit:

- `act()` accepts only a `DispatchPermit`, and refuses anything else with `NOT_PERMITTED` — asserted
  by passing a confirmation to it directly.
- `spendConfirmation` is **not exported** from the package. `mintDispatchPermit` is its only caller.
- `issued.add(permit)` occurs in exactly one statement, in `mintDispatchPermit`.
- `act` is called from exactly one place, `guardedAct`.

So there is no `HumanConfirmation → click` path. Every other gate — freshness, hit-test agreement,
the point check, the TTL, the mandatory postcondition — still runs and still refuses.

## What it is additive to

`authorisationPreflight(decision)` and `mintDispatchPermit(decision, hit, { ttlMs })` keep their old
behaviour exactly when no confirmation is supplied: the tier refuses, with the same cause. All 173
agent tests that predate this channel pass unchanged, including the ones that pin the old refusal.

## What it cannot establish

That the human understood, or that the words they were shown described the action honestly.
`purpose` is carried so a ledger can record what was on screen; this module cannot check it against
reality. **The UI that collects the consent is trusted to be truthful about what it asked** — the
same trust boundary `act` has with its bridge, named rather than hidden. A caller that invents a call
to `recordHumanConfirmation` is fabricating consent, and nothing here can detect that.

## Open

- **D-ACT-1 / ADR-0006 §6** is unchanged: whether the name-pattern screen is the right test, and
  whether this shape of confirmation is the right answer to it, are owner decisions. The channel is
  PROVISIONAL until they are made.
- The confirmation lifetime is an instrument value — see
  [`prototype-lifetimes.md`](prototype-lifetimes.md).
