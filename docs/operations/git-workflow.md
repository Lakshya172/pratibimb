# Git and GitHub Engineering Workflow — PratiBimb

> **The repository is part of the engineering product.** From day one to final
> submission, every meaningful change must leave behind: clean history, reproducible
> evidence, a clear checkpoint, traceable reasoning, and a safe rollback path.
>
> Day-to-day rules: [`CONTRIBUTING.md`](../../CONTRIBUTING.md). This document is the
> *why*, plus the parts an external reviewer needs in order to audit us.

---

## 1. Why this level of rigour on a hackathon project

Three reasons, all concrete:

1. **The dossier's own changelog is a list of claims that would have failed under
   questioning** — an 85% figure, an "accessibility tree" we cannot read, an AGPL model
   believed to be MIT, a verifier that could only confirm itself. Each was caught by
   review. A repository that records *when* and *why* each was caught is evidence that
   the review process is real.
2. **Six weeks with a hard deadline is exactly when shortcuts get taken.** The value of
   `git revert` and an annotated checkpoint is highest in week five, and you cannot
   retrofit them then.
3. **An ISRO evaluator, a security reviewer and a FAANG engineer read repositories the
   same way**: they look for whether the history tells the truth. Squashed "final fix v2"
   commits and force-pushed branches say the team did not know what it was doing.

## 2. Branch model

```
main ──●──────●──────────●─────────────●────────► protected, release-quality
        \    /            \           /
         spike/…          feature/…
```

**`main` is never committed to directly.** Short-lived branches only; merge via PR.

Prefixes and their meaning are in `CONTRIBUTING.md` §2. The rule behind them: **a branch
name should let a reviewer predict the diff.**

### Why short-lived

A branch that lives a week accumulates unrelated work, and the PR becomes unreviewable.
One coherent change, then merge. If a change is genuinely large, split it into a stack of
PRs rather than one that nobody can audit.

## 3. Commit granularity — and what it buys

Atomic, conventional commits are not stylistic. They are what make these possible:

| Capability | Requires |
|---|---|
| `git bisect` a regression to one change | Every commit builds |
| `git revert` a feature without collateral damage | No unrelated changes ride along |
| Answer "when did INV-04 change, and why?" | Security changes are their own commits with `security:` type |
| Compare two experimental implementations | Each lives on its own branch, both merged |
| Return to the last known-good state | Annotated tags at every milestone |

**A commit that mixes a refactor, a bug fix and a doc update destroys all five.**

## 4. Checkpoint and rollback strategy

### Layers of recoverability, cheapest first

| Layer | Mechanism | Use when |
|---|---|---|
| 1 | `git revert <sha>` | Undo a merged change. **Default choice.** Leaves the record. |
| 2 | `git checkout <tag>` | Return to a milestone to compare or demo |
| 3 | `git switch -c rescue <tag>` | Continue from a milestone down a different path |
| 4 | Branch is never deleted | Re-examine a rejected experiment |
| 5 | `git reflog` | Local mistake recovery |

**Reverting is preferred over resetting, always.** `revert` is additive: it records that
the change existed and was withdrawn. `reset --hard` destroys the fact that a decision was
ever made — which is precisely the information a reviewer wants.

### Milestone tags

Annotated (`git tag -a`), never lightweight, so the tag carries a message, an author and a
date.

| Tag | Milestone | Recoverable state |
|---|---|---|
| `v0.1.0-foundation` | Repository foundation | Governance, contracts, CI — before any experiment |
| `v0.2.0-spikes` | Week 1 capability spikes resolved | Every UNKNOWN answered or explicitly still open |
| `v0.3.0-contracts` | Contracts frozen in code; egress invariant + fail-closed suite | The first security boundary |
| `v0.4.0-perception` | Perception tier: D3, D4, fusion | Week 3 |
| `v0.5.0-e2e` | Loop closed: server, freshness, re-hydration | **Week 4 — the defensible submission** |
| `v0.6.0-benchmarked` | Model benchmarks behind interfaces | Week 5 |
| `v1.0.0-rehearsal` | Final SIH rehearsal build | Frozen for judging |

Version numbers are indicative. The invariant is: **every major milestone is recoverable
by name**, and `v0.5.0-e2e` in particular exists because the dossier states that a
complete, defensible submission exists by end of week four — so that state must be
checkout-able even if weeks five and six go badly.

## 5. Forbidden operations

```
git reset --hard          git push --force[-with-lease]
git rebase -i             git commit --amend (after push)
git filter-branch         git filter-repo
```

Authorized only in writing by the project architect. The single realistic exception is a
committed secret — and even then, **report before rewriting** (`SECURITY.md` §6), because
the rewrite destroys the evidence of what leaked and for how long.

## 6. Traceability chain

```
ADR-000N  →  issue #N  →  branch  →  commit SHA  →  PR #N  →  merge  →  tag
```

Each link is recorded in the next: the branch name references the ADR, the commit footer
carries `Refs ADR-000N` / `Closes #N`, the PR body cites both, and the merge commit
preserves the PR number. Given any line of code, `git log -S` plus `git blame` should lead
a reviewer to the decision that authorised it.

**If an ADR does not exist for a decision being made, write the ADR first.**

## 7. CI limitations — stated, not hidden

| What CI checks | What CI cannot check |
|---|---|
| Governance structure, required files | Whether WebGPU works in a Chrome MV3 offscreen document |
| Dossier integrity (SHA-256) | ONNX Runtime Web backend behaviour on real hardware |
| Secret and PII shapes in the diff | Whether a model's output is correct on a GPU |
| Broken relative links, YAML validity | Peak GPU memory, real p50 latency |
| Conventional commits, branch names | Firefox-on-Linux parity |
| No oversized binaries, no product code before Sprint 2 | Anything requiring a real display or a real adapter |

GitHub-hosted runners have **no GPU**, and their software rasteriser answers a different
question from the one the spikes ask. **Browser-context experiments are therefore run
locally, and their evidence is committed** under `artifacts/experiments/`. CI verifies the
artifact is well-formed and that its claims are backed by files; it does not reproduce the
measurement.

This is a real limitation and it is written down rather than papered over. A CI badge that
implied we had verified WebGPU on a runner would be exactly the kind of unsupported
compatibility claim `ENGINEERING_PRINCIPLES.md` §9 forbids.

CI becomes a **required** merge gate for security-critical and product branches once
product code lands and the suite includes the egress interception tests.

## 8. Repository topology — direct push or fork

Two contribution topologies are in use, because not every contributor has push access to
the canonical repository. **Both end in a pull request; neither permits committing to
`main`.**

### 8.1 Direct topology — contributors with push access

```
origin = https://github.com/ronitsaha11/pratibimb
```

Branch from `origin/main`, push the branch to `origin`, open the PR. Sections 2–7 above
describe this case.

### 8.2 Fork topology — contributors with read access

A contributor without push access forks the canonical repository and works from the fork.
This is the standard open-source model and it changes nothing about branch naming, commit
discipline, the PR template or the gates.

```
origin   = https://github.com/<contributor>/pratibimb   your fork      (push here)
upstream = https://github.com/ronitsaha11/pratibimb     canonical      (never push here)
```

Setup, once:

```bash
gh repo fork ronitsaha11/pratibimb --clone=false
git clone https://github.com/<contributor>/pratibimb.git
cd pratibimb
git remote add upstream https://github.com/ronitsaha11/pratibimb.git
git remote set-url --push upstream DISABLED_no_push_to_upstream   # fail loudly, not silently
git fetch upstream --tags
```

Per change:

```bash
git fetch upstream
git switch -c <type>/<description> upstream/main    # branch from upstream, not from your fork
# ... commits ...
git push -u origin <type>/<description>
gh pr create -R ronitsaha11/pratibimb --base main --head <contributor>:<type>/<description>
```

**Branch from `upstream/main`, not from your fork's `main`.** A fork's `main` goes stale
the moment anything merges upstream, and branching from a stale base produces a PR whose
diff contains other people's reverted work.

**Do not detect the default branch by assumption.** `git remote show upstream | grep 'HEAD
branch'` reports it. It is currently `main`.

### 8.3 Who can merge

**A contributor on the fork topology cannot merge their own PR**, because merging requires
write access to the canonical repository. `gh pr merge` returns:

```
GraphQL: <user> does not have the correct permissions to execute `MergePullRequest`
```

This is a property of the permission model, not a workflow choice, and it is not something
a contributor can or should work around. A fork-topology PR is **prepared, evidenced and
reviewed by its author, and merged by a maintainer.** See `agentos/blockers.md`.

### 8.4 Working-tree location

A working tree on a **cloud-synced path** (OneDrive, Dropbox, Google Drive) can race with
Git on `.git/` internals during a sync, producing lock errors or, rarely, index
corruption. **This is a property of an individual workstation, not of the project**, and
it applies only to contributors whose checkout is under such a path. The mitigation is to
move the working tree outside the synced root. The remote is the durable copy either way.

Each workstation records its own layout under `artifacts/environment/`.
