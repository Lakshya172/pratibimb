# Changelog

All notable changes to PratiBimb are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions correspond to the milestone tags in `docs/operations/git-workflow.md` §4.

## [Unreleased]

### Added
- Week-1 capability spikes (in progress).

**The first complete product loop** — `OBSERVE → SANITIZE → VERIFY PAYLOAD → SEND → VALIDATE PLAN →
REFRESH → HUMAN GRANT → REHYDRATE → ACT → VERIFY RESULT`, demonstrated on W2 against a synthetic
fixture in Chrome for Testing 153.0.8010.12
([LOOP-1](artifacts/experiments/LOOP-1-server-orchestrator-planning-view/README.md), 31/31 checks).

- `@pratibimb/reasoner` — the untrusted boundary. `propose` returns `unknown`; `sendToReasoner`
  refuses any handoff the privacy verifier did not produce. Behind it, a deterministic planner for
  the one demo goal. **No model, no network client, no egress**; transport is recorded as
  `IN_PROCESS`.
- `@pratibimb/plan` — the plan contract (`insert`, `click`), the parser that is the only way an
  untrusted response becomes a plan, and `validatePlan`. It owns plan **structure**; it calls
  `@pratibimb/privacy` for every value question and reports privacy's own cause. `redactPlan`
  projects a plan into something safe to keep and display.
- `@pratibimb/orchestrator` — a single-shot state machine. Sequences the existing authorities and
  decides nothing they decide. `REFUSED` is terminal.
- `apps/demo` — the Planning View: five panes rendered from the run's own objects, including the
  exact payload that crossed the boundary. Plus the loopback demo server and fixture.
- `@pratibimb/agent`: a **human-confirmation channel** for the action schema's confirmation tier.
  Unforgeable (module-private `WeakSet`, as `DispatchPermit` is), bound to one node, frame and
  origin, expiring, and spent as the permit is minted. Entirely additive — omitted, every
  pre-existing behaviour is unchanged, and all 173 previous agent tests pass untouched.

**A local model, a real network, and the first proof of what leaves** — W2, Chrome for Testing
153.0.8010.12, 17/17 checks
([LOOP-2](artifacts/experiments/LOOP-2-local-reasoner-egress/README.md)).

- `@pratibimb/egress` — **the single module through which bytes leave this machine**, which is what
  `SECURITY.md` §5's stop condition has always been about. `sendVerified` is the only network call in
  the repository: verified handoff → loopback destination → only declared tokens → value-aware
  residual scan → digest → record → send. The bytes are serialized **once**, and that same string is
  scanned, hashed, recorded and sent, closing "a payload can be mutated between verification and
  transmission" by construction.
- `localModelReasoner` — **Qwen2.5-0.5B-Instruct** (Q4_K_M, revision `9217f5db…`, Apache-2.0
  **verified at that revision**) behind llama.cpp `b10956` on `127.0.0.1`. Download approval was
  **explicit**: work stopped at the boundary E9 was blocked at, reported the requirement, and did not
  proceed without it. **No weights are committed.**
- **Deterministic fallback with a policy, not a catch block.** A model that *failed* may be replaced
  by the deterministic planner; a model that *misbehaved* may not — falling back from a refused plan
  would replace a caught leakage event with a success. `HOSTILE` outcomes stop the run.
- Evidence: the actual HTTP request body carried **four reference tokens and none of the five vault
  values**, and the client's digest matched the receiving service's independently computed one
  (`26d7c09f…`). Bodies are on disk under the experiment's `logs/captures/`.

**The demo, rehearsed until it is boring** — W2, Chrome for Testing 153.0.8010.12, 5 rounds, 15 acts,
no unexpected failures ([DEMO-1](artifacts/experiments/DEMO-1-sih-rehearsal/README.md)).

- **`npm run demo`** starts every service, rehearses all three acts and judges itself against
  declared expectations; **`npm run demo:present`** hands a headful browser to a presenter. The acts
  live in `apps/demo/src/demoScript.ts` as data, so the buttons, the runner and the tests read one
  definition — and an act chooses only **which reasoner answers and at what address**. No security
  layer beneath can tell which act is running.
- **The compromised and honest reasoners listen at the same time** on different ports, so a presenter
  can run success → reset → refusal → reset → outage without restarting anything. The outage act
  addresses a port with nothing behind it, so the connection is genuinely refused; the resulting
  `ERR_CONNECTION_REFUSED` is **asserted as evidence**, because a clean console there would mean the
  act had become a simulation.
- **The digest comparison is now visible during the demo.** The receiving service reports what it got
  in a response header and `sendVerified` records the claim beside its own digest. **This is not a
  security control**: it is read after the send, gates nothing, and a hostile peer could put any
  string in it. The guarantee is unchanged — the bytes that were scanned are the bytes that were sent.
- Presenter material: [`presenter-runbook.md`](docs/demo/presenter-runbook.md) and
  [`judge-cheat-sheet.md`](docs/demo/judge-cheat-sheet.md), whose answers use demonstrated facts only
  and say "NOT PROVEN" where that is the honest answer.

### Fixed in the demo surface
- **The LOOP-1 runner had been failing since the DEMO-1 view change**, on two copy assertions ("no egress
  client", "REFUSED") that the view had rightly stopped printing. They now assert the current, truthful
  wording; every security assertion in that runner is unchanged.
- **The LOOP-2 runner's refusal run had silently become an outage.** The reasoner service started defaulting
  hostile mode to a second port, so LOOP-2 — which addresses the first — hit a dead address, fell back and
  "succeeded". Every mode defaults to the original port again; the SIH runner passes its second port
  explicitly.
- **Entrance animations started from opacity 0**, so a browser that paused them — an occluded window, some
  screen-capture paths — left the boundary rows and the outcome invisible. They now move but never fade.
- **The `local model` checkbox was dead UI** — nothing read it, so ticking it silently ran the
  deterministic planner. A control that implied a path which was not exercised.
- **The footer and pane 5 still claimed "no model, no network client" and "no egress client exists in
  this phase"**, both untrue since LOOP-2.
- **`sweep` threw on a cyclic object**, which mid-demo would have taken out the evidence pane — and a
  caller catching that throw would have been one line from reporting a leak check as clean because it
  could not run. It now prunes cycles and reports that it did.

**The demo, redesigned for the room** — the same three acts and the same pipeline, presented as a story a
judge can follow from across a room.

- The Planning View now leads with the privacy boundary — *On your device* (trusted, the real values) against
  *What the reasoner sees* (untrusted, references only) — then *Model proposes → Client decides → Human
  approval → Restore & act* and one outcome banner. The detailed panes remain underneath as technical evidence.
- Every status on screen comes from `apps/demo/src/story.ts`: pure functions over the run record, tested
  against real runs, including that nothing but the device side ever carries a value.
- Read-only taps let the screen fill in *during* the run; the approval moment used to show empty panes. They
  pass every call through unchanged and catch their own errors, because a throw inside `propose` would be
  read as `REASONER_THREW` and trigger a fallback.

### Notes on the model
- **`MODEL_PATH = EXPERIMENTAL`, `FALLBACK_PATH = VERIFIED`.** A 0.5B model given the bare schema
  produced schema-valid nonsense; it needed enum-constrained decoding and a worked example before it
  planned correctly. Nothing in the security pipeline was weakened to accommodate it.
- Registry status is **`PINNED`**, not `ADOPTED` — adoption still needs QG-03 and a benchmark.
- Latency (6 warm runs, one machine, **not a benchmark**): p50 609 ms, p95 623 ms end to end; the
  reasoner is 2 020 ms cold and every enforcement stage together is under 20 ms.

### Fixed
A hardening review against the frozen contracts, run before any reasoner work, corrected two places
where a layer had become more opinionated than the contract allows (both in `216ed7c`, which also
carries the documentation below):

- **`validatePlan` refused every literal.** `action-schema.md` calls a schema that cannot express a
  non-sensitive literal *"a functional defect"* and answers it with three checks, not a prohibition.
  A literal passing all three is now accepted as a `source: "literal"` step needing no vault
  reference, no rehydration and no human grant. The three refusals — vault echo, PII-shaped literal,
  literal at a redacted field — are unchanged.
- **The orchestrator had a second field classifier**, whose answer fed `bind()`'s class check. It now
  calls `classifyField`, privacy's own D1 channel. `packages/orchestrator/test/boundaries.test.ts`
  scans the source so neither defect can return.

### Documentation
- `docs/architecture/human-confirmation.md` — a PROVISIONAL implementation note for the confirmation
  channel: what it is, where each property is tested, the `HumanConfirmation → DispatchPermit →
  guardedAct` chain and the four structural facts that leave no way round it, and what it cannot
  establish.
- `docs/architecture/prototype-lifetimes.md` — every lifetime and deadline in one table, headed
  **"Prototype TTL; not performance/security-policy proof."**

### Notes
- `EXECUTABLE_ACTIONS` remains `["click"]`; there is no TYPE action. `insert` is a request to the
  **trusted client**, not an agent action: the value never enters a plan, a permit, or the reasoner.
- `packages/privacy` is unchanged and remains the sole privacy authority.
- Three lifetimes (permit, confirmation, grant) are stated by callers with **no measurement behind
  any of them**; ADR-0008 §5 remains open.
- **Extension end-to-end integration of the loop is still NOT PROVEN**, unchanged by LOOP-2. `apps/demo` drives a same-origin
  frame directly; no content script, service worker, offscreen document or side panel took part, and
  the browser evidence ran headless with no extension loaded. A separate headed CfT 153 smoke
  confirms only that the built MV3 host still loads and its service worker boots.

---

## [v0.1.0-foundation] — 2026-09-07

Repository foundation. **No product code.** Governance, frozen contracts and CI
established before the first experiment, so that every subsequent change is reviewable
against a fixed baseline.

### Added

**Governance**
- `AGENTS.md` — assistant entrypoint; FACT / INFERENCE / UNKNOWN policy.
- `CONTRIBUTING.md` — branch, commit, PR, checkpoint and rollback rules.
- `SECURITY.md` — what must never enter the repository; stop conditions.
- `ENGINEERING_PRINCIPLES.md` — 14 principles enforced by the gates.
- `LICENSE` (MIT), `.gitignore`, `.env.example`, `.editorconfig`.

**Governing artifact**
- PratiBimb Engineering Dossier v4.0 (PDF + verified text extraction), SHA-256 pinned
  and checked in CI.

**Frozen contracts**
- Architecture constitution: frozen / replaceable / not-yet-known.
- Security invariants INV-01..INV-25 and Invariant E.
- Threat model — four adversaries and the stated scope limit.
- Coordinate contract, redaction manifest v1.1, action schema and origin policy.
- Benchmark and measurement contract.

**AgentOS engineering layer**
- Seven specialist reviewer contracts; four workflows; quality gates QG-01..QG-06;
  model registry and the 20-cell feasibility matrix (all cells `UNKNOWN`).

**GitHub configuration**
- Pull request template with mandatory security, privacy, evidence and rollback sections.
- Four issue forms (spike, bug, feature, security) and a 28-label taxonomy.
- `CODEOWNERS` with verified ownership only; role mapping deferred, not invented.
- CI: governance verification, secret and PII shape scanning, dossier integrity,
  link and YAML validation, conventional-commit and branch-name enforcement,
  oversized-binary rejection, and a spike-phase guard on `apps/`/`packages/`.

**Tooling**
- `scripts/verify-repo.py` — repository verifier that resolves its own root.
- `scripts/check-secrets.sh` — advisory staged-diff scanner.
- `scripts/sync-labels.sh` — idempotent label sync.

### Notes
- No product implementation started. No model downloaded. No measurement taken.
- Every model in the registry is `PINNED-UNVERIFIED`; every feasibility cell is `UNKNOWN`.
