# Decision — M1 extension loop

| Field | Value |
|---|---|
| **Verdict** | **PASS** — 30 of 30 checks |
| **Status** | **EXPERIMENTALLY VERIFIED** on W1. Not PROVEN. |
| **Date** | 2026-09-22 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Cell** | Chrome for Testing 153.0.8010.12, headed, extension loaded |
| **Evidence** | `logs/w1-cft153-extension-loop.json` |

## What this authorises

Treating the extension as the place the product loop lives. The orchestrator, the privacy layer, the
planner, the reasoner client, the egress guard and the execution gate all run inside it, unmodified,
and the three acts behave there as they behave in the demo — including the one that must refuse.

It also settles the rehydration question the observation leg left open. The approved E6 mechanism is
now the product mechanism: **one authority, one set of refusals, used by both the experiment and the
run.** The value reaches the page as a reply to the page's own request, which is the single direction
MV3 offers that the service worker does not see.

## What this does not authorise

- Any reliability claim. One run of each act, one fixture, one machine, one browser cell.
- Any claim about visual perception. Nothing was captured, detected, OCR'd or pixel-redacted.
- Any claim about a second browser, a remote server, TLS, or a real user's data.
- Any relaxation of the status vocabulary: this is **EXPERIMENTALLY VERIFIED**, and a second
  independent reproduction is what would make it PROVEN.

## The open boundary, stated plainly

**M1's agent does not read the page's field values. It fills in values the client already holds.**

That is a narrower agent than the demo's, and the reason is not a shortcut — it is a property of MV3
that the repository's own code already documents:

> `apps/extension/host/background.ts`
> ```ts
> if (msg?.target === "offscreen") return false; // addressed to the offscreen document, not here
> ```

That line has to exist because `chrome.runtime.sendMessage` is delivered to **every** listening
context in the extension. The service worker receives a content script's message whether or not it
answers it. There is no content-script → offscreen channel it cannot see; the only direction it
cannot see is a **reply**, which is why the release mechanism is built the way it is and why it works.

So a value read from the page cannot reach the offscreen core realm without being present in a
message the service worker receives — and **"the secret is never present in a service-worker
message" is an M1 invariant**. The two are incompatible. Rather than weaken the invariant quietly,
M1 does not collect page values at all: `apps/extension/host-lib/client-held-fields.ts` supplies the
client's own synthetic details, and the page's own field contents are never read, never tokenised
and never transmitted.

**This is the one thing in M1 that a reader could mistake for more than it is**, which is why it is
here and in the runner's `notAClaim`, the README, the module's own header and the commit message.

### The two ways out, neither taken here

1. **Move the privacy layer to the values.** Run `sanitize()` in the content script's isolated world
   and keep the vault there; the offscreen realm receives only the sanitized handoff, and
   rehydration becomes purely local — no capability needed at all. Strictly stronger on secrecy. It
   requires a seam in `packages/orchestrator`, which today builds the vault inside `runTask` from
   `observation.fields`, so it is a change to a package M1 was told not to redesign.
2. **Let the values cross under encryption.** Release a one-time key to the content script through
   the reply channel, have it encrypt the field values, and send ciphertext up through the transport.
   The worker would see only ciphertext. This is a new secret-transport mechanism, which the M1
   brief explicitly forbids inventing, and it puts cryptography into a milestone that has none.

**Option 1 is the recommendation.** It is a smaller architectural claim than it looks — the privacy
layer already runs wherever the client puts it — and it ends the boundary rather than working around
it. It is an owner decision because it changes a package contract, and it is recorded here rather
than made by inference.

## Open, and deliberately so

- **No human-facing grant surface.** The approval is real, one-shot and bound to a value, a field, a
  page and a session — but in M1 it is answered by the operator through the worker's control plane,
  exactly as the demo rehearsal's `auto` mode answers on the page. A side panel that shows a person
  what they are agreeing to is not built, and M1 does not claim one.
- **`apps/extension` is outside the typecheck graph.** The root `tsconfig.json` does not reference
  it, so the host's TypeScript is checked only by what the bundler will accept. Pre-existing, not
  introduced here, and worth closing.
- **The lifetimes are still nobody's decision.** ADR-0008 §5 leaves the permit TTL open; the grant,
  confirmation and release lifetimes in `extension-run.ts` are stated for the same reason — so that
  something has to state them.
