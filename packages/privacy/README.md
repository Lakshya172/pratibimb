# `@pratibimb/privacy` — the privacy foundation

> **This is a reconstruction, not a recovery.**
>
> An earlier "Phase 0 privacy foundation" was described as existing at commit
> `c68b6a26ffdfbe3c7b50bda6edcaa5986fe48d78` on a branch `feature/privacy-firewall-foundation`. That
> commit is **not present in reachable history**: GitHub answers *"No commit found for SHA"* for the
> canonical repository, the branch exists on no remote, and no ref or working tree on this machine
> contains a `packages/privacy` or the symbols it was said to define. Nothing was recovered.
>
> What is here was written fresh, from the repository's own frozen contracts and from the E2
> class-binding experiment, on **W2** on 2026-09-14. **Every test and artifact in this package is
> reconstruction evidence. None of it is historical Phase 0 evidence**, and none of it should be
> cited as continuity with work nobody can produce.

## What this package is

The client-side boundary a value crosses before anything outside the machine learns it exists.

```
local values ─► classify ─► validate ─► tokenise (or mask) ─► verified handoff ─► ledger
                                    ╰─► memory-only vault ─► bind + human grant ─► rehydrate
```

| Piece | File | What it does |
|---|---|---|
| Classes and tiers | `classes.ts` | The frozen confidentiality classes, narrowed to this scope, and the protection ranking that resolves disagreement upward |
| Validators | `validators.ts` | Verhoeff (Aadhaar), Indian mobile, calendar DOB, a demo-safe name shape |
| Classification | `classify.ts` | D1 over the field, D2 over the value, the more protective wins |
| Tokens | `tokens.ts` | `<PII:CLASS:N>`, per-session ordinals, never derived from the value |
| Hints | `hints.ts` | `{ len, kind, field_role }` — type preserved, content destroyed |
| Vault | `vault.ts` | Memory-only, session- and origin-scoped, no enumeration, single-use references |
| Handoff + verifier | `handoff.ts` | `VerifiedHandoff`, and seven fail-closed checks ending in a value-aware residual scan |
| Ledger | `ledger.ts` | Identity, payload digest, classes — no value, and no claim of network egress |
| Sanitize | `sanitize.ts` | The T2 tier: the ten steps above, refusable at each one |
| Bind / rehydrate | `bind.ts` | The ordered, fail-closed path from a reference back to a value, plus the one-shot human grant |
| Literal check | `literalCheck.ts` | The action schema's three checks; a vault match is a leak, not a defect |

## Where the design comes from

Nothing here is invented where the repository already decided something:

- **Confidentiality classes and the D1/D2 union** — `docs/security/security-invariants.md`.
- **`<PII:CLASS:N>` and `hint { len, kind, field_role }`** — `docs/architecture/manifest-schema.md`.
- **The three checks on a literal, and re-hydration's six steps** — `docs/architecture/action-schema.md`.
- **INV-04…INV-10, INV-21, INV-22** — the vault, the reference rule, the literal rules, no secret in
  any log, fail-closed verification.
- **The field classifier and the binder's ordered checks** — reconstructed rule-for-rule from
  [`artifacts/experiments/E2-class-binding`](../../artifacts/experiments/E2-class-binding/README.md)
  (W2, PASS on its pre-registered table), so this package and that evidence say the same thing.
- **`SanitizedHandoff`** — `@pratibimb/perception`. `perceptionState.ts` is **unchanged**:
  `VerifiedHandoff` widens one field, in this package, exactly as that file's comment anticipated.

## The two properties worth reviewing

1. **A sensitive value does not reach the handoff**, enforced twice: the assembler writes only
   references and hints, and the verifier then scans the finished serialization against the vault's
   own contents and refuses if anything survived — whichever code path put it there.
2. **A returned literal that matches a vault value is refused**, before rehydration and before any
   action, and the refusal never quotes it. INV-10's distinction is kept: that is a leakage event,
   not the same thing as a PII-shaped literal the server invented.

## Limits — read these before quoting anything

- **The vault is a memory-only prototype. It is not production storage.** Values live in a `Map` for
  the life of the session object; there is no encryption, no key management, and no protection
  against anything running inside the same realm.
- **The name detector is a shape test, not name recognition.** Two to four capitalised words. Real
  name detection is the D3 semantic channel, which this prototype does not include. It will miss real
  names and accept things that are not names.
- **No general PII recall is claimed.** Four classes plus OTP, on the values this fixture contains.
- **No non-inferability is claimed.** Hints carry length and kind because the contract asks for them.
- **There is no egress client**, so the ledger records what *would* be sent. An entry is not evidence
  that a byte left the machine, and INV-01/INV-02 are not implemented here.
- **No server, no planner, no orchestrator, no UI, and no rehydration into a real page** — those are
  the next section, deliberately absent from this one.
- **One machine.** Every artifact here is W2 evidence.

## Running it

```bash
npm run typecheck
npx vitest run packages/privacy                       # the unit suite
node tools/mutation/privacy-core.mjs                  # do the guards carry weight?
CHROME_PATH="<chrome for testing>" node tests/browser/privacy/run-privacy-smoke.mjs
```

The smoke run writes
[`artifacts/experiments/PRIV-0-privacy-foundation-reconstruction/`](../../artifacts/experiments/PRIV-0-privacy-foundation-reconstruction/README.md).
