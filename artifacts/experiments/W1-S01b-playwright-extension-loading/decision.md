---
id: W1-S01b-decision
spike: S-01b
verdict: CONDITIONAL
date: 2026-09-07
decided_by: browser-engineer + evaluation-qa-engineer (privacy-security-engineer and human architect review REQUIRED)
---

# S-01b decision — CONDITIONAL

## Verdict

**CONDITIONAL.**

The extension can be loaded by a Playwright-driven browser, but **only on branded Edge**,
and the interception mechanism the Invariant E egress suite depends on **does not cover the
MV3 offscreen document** — the context PratiBimb actually sends from.

| Sub-question | Answer |
|---|---|
| Does a Playwright-driven browser load the unpacked MV3 extension? | **Edge 152: YES. Chrome 152: NO.** |
| Does Playwright's *own bundled* Chromium load it? | **`UNKNOWN`** — the binary could not be executed on this machine |
| Can Playwright observe extension egress from the service worker? | **YES** |
| Can Playwright observe extension egress from the offscreen document? | **NO** — 3/3 runs |
| Can Playwright block offscreen-document egress? | **NO** — the request reached the wire under an abort-everything route, 3/3 runs |

## Why this is CONDITIONAL and not ACCEPT

The original S-01b question was "does the extension load?". Answering only that would have
produced an ACCEPT and a false sense of safety. The capability the suite actually requires
is interception, and interception is where it fails — over precisely the context
`docs/architecture/constitution.md` §5 assigns the payload to.

A suite built on `context.route()` would assert *zero outbound requests*, go green, and
observe nothing from the offscreen document. **A security test that cannot fail is worse
than no security test**, because it is quoted as evidence.

## Security impact

**Invariant E is NOT weakened, and no change to it is proposed here.**

Of its four required enforcement mechanisms:

| # | Mechanism | Status after S-01b |
|---|---|---|
| 1 | Lint rule — no `fetch`/`XHR`/`sendBeacon`/`WebSocket` outside the egress module | **Unaffected** |
| 2 | **Playwright interception asserting zero requests** | **Measured coverage gap — offscreen document not covered** |
| 3 | Manifest CSP `connect-src` pinned to the server origin | **Unaffected** |
| 4 | Payload hash pin (INV-02 / INV-03) | **Unaffected** |

`docs/security/security-invariants.md` is untouched by this PR. **QG-04 cannot be signed
off on the current enforcement plan**, and that is the correct outcome: the gate is doing
its job by refusing to pass.

## What this does NOT decide

Deliberately, and this is the point of the spike stopping here:

- **It does not choose a replacement enforcement vehicle.** CDP-level `Fetch.enable` on the
  offscreen target and an independent loopback arrival assertion are both plausible, and
  both change *how a frozen security invariant is enforced*. That is a
  `privacy-security-engineer` review plus a human architectural decision, and it should
  land as an **ADR**, not as a spike conclusion.
- **It does not propose moving the egress module out of the offscreen document.** Relocating
  the send path to make a test framework happy would be weakening the architecture to fit
  the tooling. Explicitly rejected as a direction.
- **It does not relax any assertion in the fail-closed test matrix.**
- **It says nothing about Linux**, which is where CI runs.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-01b-1 | Re-run this matrix on **`ubuntu-latest` with Playwright's own Chromium** — the actual CI cell | **p1** | QG-04 enforcement plan |
| S-01b-2 | Decide the Invariant E mechanism-(2) vehicle. **Requires an ADR and human approval.** | **p1** | QG-04 sign-off |
| S-01b-3 | Playwright browser download endpoint returns HTTP 400 on this network; CfT 153 will not start (side-by-side). Operational. | p2 | Local egress-suite runs on this workstation |
| S-01b-4 | Confirm whether the offscreen-document interception gap is a Playwright limitation or Edge-specific | p2 | Scope of S-01b-2 |

## Registry effect

- **`agentos/registry/feasibility-matrix.md` is deliberately NOT edited by this PR.** PR #1
  rewrites the prerequisite-spike table in that same file and is still unmerged; editing it
  here would hand the maintainer an avoidable textual conflict between two spike PRs. The
  row lands in a follow-up once PR #1 is merged, and that follow-up is tracked as an issue.
  **This means QG-01 is not yet fully signed off for S-01b** — the registry-update checkbox
  is outstanding by design, not by oversight.
- **S-01b remains `UNKNOWN` for its literal question** (Playwright's *bundled* Chromium).
  What this PR promotes to `FACT` is the interception-coverage result, scoped to the cell
  measured: Playwright 1.63.0 + branded Edge 152 + Windows 11 + this machine.
- No model cell is affected. No model was downloaded.
- `docs/security/security-invariants.md`: **unchanged**.
