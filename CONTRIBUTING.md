# Contributing — PratiBimb

> **The repository is part of the engineering product.** It should be inspectable by an
> ISRO evaluator, a senior engineer, or a security reviewer who has never seen this project,
> and it should tell them the truth about what was decided, when, why, and on what evidence.

Full rationale: [`docs/operations/git-workflow.md`](docs/operations/git-workflow.md).

---

## 1. Before your first commit

1. Read [`AGENTS.md`](AGENTS.md) — especially §5, the FACT / INFERENCE / UNKNOWN policy.
2. Read [`SECURITY.md`](SECURITY.md) — what must never enter this repository.
3. Read [`docs/architecture/constitution.md`](docs/architecture/constitution.md) — what is
   frozen and what is replaceable.
4. Check [`agentos/state.md`](agentos/state.md) — what is actually happening right now.

## 2. Branching

**`main` is protected and release-quality. Never implement directly on `main`.**

Branch from the latest `main`, one coherent change per branch:

| Prefix | Use for | Example |
|---|---|---|
| `spike/` | Answering an UNKNOWN. Throwaway code, permanent evidence. | `spike/chrome-webgpu-context` |
| `feature/` | New product capability | `feature/egress-verifier` |
| `fix/` | Defect repair | `fix/verifier-payload-mutation` |
| `security/` | Trust-boundary hardening | `security/egress-hardening` |
| `perf/` | Measured optimisation | `perf/screen-state-cache` |
| `refactor/` | Behaviour-preserving restructure | `refactor/perception-tiers` |
| `docs/` | Documentation and ADRs | `docs/adr-004-webgpu-policy` |
| `ci/` | Build and automation | `ci/playwright-egress-suite` |

Branch names communicate intent. `feature/stuff` is not a branch name.

## 3. Commits — conventional, atomic, coherent

```
<type>(<scope>): <imperative summary>

<body: why, not what — the diff already says what>

<footer: Refs ADR-000N, Closes #N>
```

**Types:** `feat` `fix` `security` `test` `perf` `refactor` `docs` `build` `ci` `chore` `spike`

**Scopes** (use where useful): `capture` `dom` `perception` `egress` `verifier` `vault`
`manifest` `action` `coordinate` `server` `agentos` `repo` `webgpu` `ort`

```
feat(capture): establish visible-tab capture abstraction
security(egress): add outbound egress guard with payload hash pin
test(coordinate): validate DPR and zoom conversion contract
spike(webgpu): measure Chrome MV3 offscreen adapter feasibility
docs(adr): record browser inference context decision
fix(verifier): reject mutated payload after verification
```

**Atomic means:** one coherent change; builds and tests pass where applicable; no unrelated
edits ride along; the commit can be checked out on its own and make sense; it can be
reverted without collateral damage.

**A giant commit containing unrelated changes is a defect**, because it destroys `git
bisect`, makes `git revert` unusable, and hides when a security invariant changed.

## 4. Pull requests

One coherent change per PR. Never bundle unrelated work.

```
1  Branch from latest main
2  Implement ONE coherent change
3  Add tests / evidence
4  Run the required quality gate (agentos/gates/README.md)
5  Commit atomically
6  Push the branch
7  Open the PR, filling in every template section
8  Review — including the owning specialist reviewer
9  Merge only after validation
10 Return to main
11 Tag if the milestone is significant
```

The PR template ([`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)) is
not decoration. **Security Impact**, **Privacy Impact** and **Rollback Plan** are answered
on every PR, including documentation-only ones — "none, documentation only" is a valid
answer, an empty section is not.

### Spike PRs

A `spike/` PR must end with an explicit verdict:

| Verdict | Meaning |
|---|---|
| **ACCEPT** | The capability works in the exact target context. Evidence recorded. Dependent work unblocked. |
| **REJECT** | It does not work. **The evidence is preserved and the branch is merged anyway.** |
| **CONDITIONAL** | Works only under stated constraints. The constraints become architecture inputs. |
| **INCONCLUSIVE** | The experiment did not answer the question. Say why, and what would. |

> **A rejected experiment is valuable if the evidence survives.** Failed spikes are merged,
> not deleted. We do not rewrite history to hide a null result — a null result found in
> week one is the entire point of week one.

## 5. Checkpoints and tags

Every significant milestone gets an **annotated tag**, so any state is recoverable:

```bash
git tag -a v0.1.0-foundation -m "Repository foundation: governance, contracts, CI"
git push origin v0.1.0-foundation
```

Planned checkpoints: repository foundation → contracts frozen → first security boundary →
first end-to-end path → week 2 / 3 / 4 completion → final rehearsal.

## 6. Forbidden without explicit written authorization from the project architect

```
git reset --hard
git push --force        (and --force-with-lease)
git rebase -i
git commit --amend      (on anything already pushed)
git filter-branch / git filter-repo
```

**Prefer additive, reversible history.** To undo a merged change, use `git revert` — it
leaves a record that the change existed and was withdrawn, which is exactly what we want.

The one situation that may require history rewriting is a committed secret. In that case,
**report first** (`SECURITY.md` §6), then rewrite under authorization.

## 7. Traceability

Every important architectural decision is traceable end to end:

```
ADR  →  issue  →  branch  →  commit  →  PR  →  merge  →  tag
```

Reference the ADR in the branch name, the commit footer and the PR body. If an ADR does
not exist yet for a decision you are making, **write the ADR first** — that is the point.

## 8. Never fabricate

Do not invent measurements, benchmark figures, PR numbers, issue numbers, usernames,
licence statuses, or compatibility claims. Every number is labelled `measured` or
`projected` (`docs/testing/benchmark-contract.md`). Every capability is `FACT`,
`INFERENCE` or `UNKNOWN` (`AGENTS.md` §5). An honest `UNKNOWN` is worth more than a
confident guess, and it is the difference between a submission that survives a question
period and one that does not.
