# Decision — M2 page-value boundary

| Field | Value |
|---|---|
| **Verdict** | **PASS** — 42 of 42 checks |
| **Status** | **EXPERIMENTALLY VERIFIED** on W1. Not PROVEN. |
| **Date** | 2026-09-22 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Cell** | Chrome for Testing 153.0.8010.12, headed, extension loaded |
| **Evidence** | `logs/w1-cft153-extension-loop.json` |

## The three claims, separated

**Architectural invariant** — true by construction, checkable by reading:

- There is **one** vault implementation, **one** classifier, **one** redaction path and **one**
  egress authority. The page realm and the core realm run different halves of the same
  `packages/privacy` functions; neither reimplements the other.
- `packages/privacy`'s `BindContext`, `LiteralContext`, `PlanValidationContext` and the egress
  guard now ask for `VaultReader` / `LiteralOracle` rather than `Vault`. **`rehydrate` still requires
  the `Vault` itself**, so a realm holding only descriptors cannot call it — it has nothing to pass.
  That is the enforcement, not a convention.
- `boundary-protocol.ts` has no `value` field in any member, in either direction, and is the only
  file that defines what may cross.
- A `VaultView` asked about a literal nobody established an answer for **throws**. A leak check that
  answered "no" because it could not ask would be decoration.

**Experimentally verified** — observed, once, on W1:

- 42 of 42 checks, including the three acts, six capability refusals, and the worker's own recording
  of 101 messages containing none of the fixture's five values.
- The outgoing payload is byte-identical to the demo's and M1's: `2679 bytes`, `26d7c09f78e318eb…`.

**Not proven, and not claimed:**

- Any reliability claim. One run of each act, one fixture, one machine, one browser cell.
- **Perfect PII recall.** Detection is the repository's deterministic D1/D2 channels on one synthetic
  fixture. A value they do not classify is a value that is not protected, and nothing here changes
  that.
- **Zero leakage in general.** What was checked is this fixture's values against this run's traffic.
- **Production readiness.** Memory-only vault, one pinned loopback origin, no TLS, no auth, no real
  user data, no second browser.

## What this authorises

Treating the content script's isolated world as the privacy boundary, and the offscreen document as a
realm that holds references rather than values. The M1 arrangement — details compiled into the
extension — is superseded and its module is deleted.

## Open, and stated rather than hidden

### 1. An unexplained double dispatch, seen once in five runs

On the first of five runs of this harness, the SUCCESS act's fixture recorded **ten** raw events at
`#submit` — two complete pointer/mouse sequences — where one was expected. Four subsequent runs,
including one immediately after a rebuild, recorded five.

What the same run also recorded, which is why this is confusing rather than simply alarming:

- the transport cycle logged **one** dispatch, one delivery id, and **zero** refusals;
- the page agent marks a cycle dispatched *before* firing and refuses `CYCLE_ALREADY_DISPATCHED`;
- exactly one release and one write happened, and the orchestrator ran once.

So the second sequence did not come from the transport's dispatch path, and three independent
mechanisms make two dispatches in one cycle impossible. The most likely explanation is a measurement
artefact in the harness's page snapshot rather than a second click — but **that is a hypothesis, not
a finding, and this is not resolved.** The check remains a hard failure in the harness so the next
occurrence cannot pass unnoticed. It should be reproduced and explained before anything in this area
is called PROVEN.

### 2. A reasoner's literal cannot be written to the page

`ClientPorts.insert` refuses in the extension. It is the port for writing text a reasoner supplied —
text that has already passed all three checks on a literal and is provably not a value this client
holds — and there is no way to carry it to the page that the service worker would not read. So this
client does not carry one. A legitimate non-sensitive literal (*"search for Chandrayaan-3"*) is
therefore unsupported in the extension path. That is a capability reduction, chosen over widening
what crosses, and it is the reason the agent gains no arbitrary write primitive.

### 3. Still no human-facing grant surface

The approval is real, one-shot, and bound to a value, a field, a page and a session — but the
operator answers it through the worker's control plane, exactly as the demo rehearsal's `auto` mode
does. A side panel that shows a person what they are agreeing to is not built, and M2 does not claim
one.

### 4. `apps/extension` is outside the typecheck graph

The root `tsconfig.json` does not reference it, so the host's TypeScript is checked only by what the
bundler accepts and by the unit tests that import it. Pre-existing, not introduced here, and worth
closing before the surface grows further.

### 5. The lifetimes are still nobody's decision

ADR-0008 §5 leaves the permit TTL open; the grant, confirmation and capability lifetimes in
`extension-run.ts` are stated for the same reason — so that something has to state them.
