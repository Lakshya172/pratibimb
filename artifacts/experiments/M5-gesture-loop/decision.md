# Decision — M5 gesture loop

| Field | Value |
|---|---|
| **Verdict** | **PASS** — 29 of 29, `routeCategory: REAL_GESTURE_STREAM` |
| **Status** | **EXPERIMENTALLY VERIFIED (HUMAN-IN-THE-LOOP)** for the three acts on the product route · **NOT YET IMPLEMENTABLE** for local text perception |
| **Date** | 2026-09-24 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Cell** | Chrome for Testing 153.0.8010.12, headed, product build |

## What this authorises

**Calling the product loop verified on the product capture route.** Three real toolbar clicks, three
acts, on a build whose manifest asks for `activeTab` and loopback only and whose bundle contains no
`captureVisibleTab`. The success criterion the brief set — real gesture capture **and** real local
perception **and** the real existing agent loop — is met on all three counts.

**Removing the encode**, on an audit that found zero consumers rather than on the wish to remove a
slow thing.

## What this does not authorise

- **Any accuracy claim.** The detector numbers are unchanged and remain CONDITIONAL.
- **Any claim of visual PII protection.** The canvas identifier is still neither read nor protected.
- **Deleting the degraded route.** It is the only thing an automated harness can run.
- **Treating ADR-0009 as settled.** It is PROPOSED and needs the human architect.

## Open, and stated rather than hidden

### 1. The capture mechanism deviates from a FROZEN entry, and now says so

`constitution.md` §5 names `tabs.captureVisibleTab` as the capture mechanism. The product path has
not used it since M3.1. That is a deviation from a frozen entry made across three milestones
**without an ADR**, which AGENTS.md rule 2 calls a process failure regardless of how good the reason
is — and the reason here is good.

[`ADR-0009`](../../../docs/adr/ADR-0009-gesture-authorised-capture.md) records it, **PROPOSED**. It
is not self-approved and the constitution is not edited, because the amendment procedure says the
constitution is updated *on approval* and *"no agent approves its own ADR."*

**The ADR includes a genuine rejection option**, and it is not a formality: the gesture requirement
means a presenter must click the toolbar before each act. If that is too costly for the
demonstration, the honest alternative is to revert to `captureVisibleTab` and **record that pixels
transit the worker as an accepted limitation** — not to keep the stream route and describe it as
free.

### 2. Three clicks per run is the product's real ergonomics

Chrome revokes `activeTab` on every navigation, so an agent that reloads a page must be
re-authorised. For a demo that is three clicks; for a multi-step task on a real site it is one per
navigation. **That is a product design problem this milestone surfaced and did not solve**, and it
is the most likely reason ADR-0009 gets rejected.

### 3. `frameHash` now refuses, and nothing noticed

The change gate's hash cannot describe a live frame, so it throws. Nothing in the product called it
before and nothing calls it now — which is itself worth recording: **the visual change signal the
constitution §6 describes is not wired up**, and the milestone that needs it will find this.

### 4. One text-region candidate, blocked by one number

`PP-OCRv5_mobile_det` fails WASM at 4.12e-02 against a 2e-02 bound. Re-running that criterion under
realistic input — which the original record names as the missing validation — is the only legitimate
step that could change it. Everything else about the path is already in place: Apache-2.0 verified
at the revision, +7.1 MB marginal, and an interface that cannot carry a string.

### 5. The stream constraint has one configuration behind it

`maxWidth`/`maxHeight` at the CSS viewport size was honoured at 1280×720, now across eight passes.
Other viewport sizes, other device pixel ratios and other displays are unmeasured. The geometry
guard refuses rather than approximating, so the failure mode is safe and the coverage is narrow.

### 6. Everything earlier milestones left open is still open

The refused literal insert, no human-facing grant surface, `apps/extension` outside the typecheck
graph, the undecided lifetimes, `E6_ARM`/`E6_RELEASE` as a value-release stub, the attribution
epsilon, and Chrome's unscheduled capture quota on the degraded route.
