# Repository Structure — and why each directory exists

> Rule: **no directory exists without a current engineering purpose.** Empty scaffolding
> that imitates a "real" project is noise, and it lies to a reviewer about maturity.

## Present today

| Path | Purpose | Why now |
|---|---|---|
| `docs/dossier/` | The governing artifact, hash-pinned | It is the implementation baseline |
| `docs/architecture/` | Constitution, vision, coordinate/manifest/action contracts, glossary | Frozen before code, by design |
| `docs/security/` | Security invariants, threat model | The trust boundary is specified before it is built |
| `docs/testing/` | Benchmark and measurement contract | Defines what every implementation must emit |
| `docs/operations/` | Git workflow, this file | Repository governance is itself engineering |
| `docs/adr/` | Architecture decision records and index | Decisions precede code |
| `agentos/` | Development-time engineering OS: agents, workflows, gates, registries, state | Governs how we build. **Never part of the product.** |
| `artifacts/experiments/` | Reproducible spike evidence | Week-1 output; promotes UNKNOWN to FACT |
| `artifacts/environment/` | **Per-workstation environment audits**, one file per machine | More than one workstation is now in use, and no capability result transfers between them |
| `artifacts/reviews/` | Audits | AUDIT-0001 (framework audit) |
| `.github/` | PR template, issue forms, CODEOWNERS, labels, CI | Review process is enforced, not suggested |
| `scripts/` | Repository tooling that CI and humans both run | One implementation, two callers |

## Deliberately absent

| Path | Created when |
|---|---|
| `apps/extension/` | The first extension code is written — Sprint 2, after S-01..S-07 resolve |
| `apps/server/` | The first FastAPI code is written |
| `packages/contracts/` | The Pydantic models exist and TypeScript types are generated from them |
| `packages/{security,perception,capture,verification,shared}/` | Each, when it has a real module to hold |
| `tests/` | Cross-package tests exist; per-package tests live with their package |
| `artifacts/benchmarks/` | The first harness run produces output |
| `.github/dependabot.yml` | There is a dependency manifest to update. Today there is none. |

A CI step actively asserts `apps/` and `packages/` do **not** exist while the project is in
the spike phase, so the transition into implementation is an explicit, reviewable diff
rather than a drift.

## Where spike code lives

Spike code is **throwaway, and quarantined inside its own experiment directory**:

```
artifacts/experiments/W1-S01-chrome-webgpu-context/
├── README.md          hypothesis, environment, method, actual result, conclusion
├── decision.md        ACCEPT / REJECT / CONDITIONAL / INCONCLUSIVE
├── environment.json   machine, OS, browser build, versions
├── commands.md        exact commands to reproduce
├── results.json       raw output, verbatim
├── metrics.json       extracted measurements
├── harness/           the throwaway code, clearly marked as such
└── logs/
```

It never enters `apps/` or `packages/`. It is not reviewed for production quality. It is
kept forever, because the evidence is the deliverable — including when the verdict is
REJECT.

## Where environment audits live

`artifacts/environment/ENV-000N-<machine-slug>.md` — **one file per physical workstation**,
never edited to describe a different machine.

The first environment audit was written as
`artifacts/experiments/ENV-0001-workspace-environment.md`, before a second workstation
existed. **`ENV-0001` stays where it is**: moving it would break every reference already
recorded against that path, for a cosmetic gain. New environment audits go under
`artifacts/environment/`, and the two conventions are reconciled by this note rather than by
rewriting history.

The separation from `artifacts/experiments/` is deliberate. An experiment answers a
*question* and has a verdict; an environment audit describes a *machine* and has none. They
are cited differently: an experiment is cited to justify a decision, an environment audit is
cited to **scope** one.

Every experiment artifact must name the machine it ran on, and **no result is generalised
across machines**. `W1-S01` measured WebGPU on a workstation with Intel integrated graphics;
`ENV-0002` describes a workstation with AMD integrated graphics. Those are different cells,
and neither answers the other.

