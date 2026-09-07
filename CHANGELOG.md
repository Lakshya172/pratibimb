# Changelog

All notable changes to PratiBimb are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions correspond to the milestone tags in `docs/operations/git-workflow.md` §4.

## [Unreleased]

### Added
- Week-1 capability spikes (in progress).

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
