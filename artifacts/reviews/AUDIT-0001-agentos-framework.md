---
id: AUDIT-0001
title: "Raptor's Way / AgentOS framework audit — documented intent vs observed implementation"
status: recorded
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
---

# AUDIT-0001 — Raptor's Way / AgentOS framework audit

## Question

What does the Raptor's Way / AgentOS repository **actually implement**, as opposed to what
its documentation claims, and which parts should PratiBimb adopt?

## Method

Cloned `https://github.com/Rexy-5097/raptors-way` at commit `2cf150f`. Read `AGENTOS.md`,
`README.md`, `PROJECT_CONFIG.yaml`, the runtime source, the agent contracts, the
workflows, the policies and the profiles. **Ran the validator.** Measured source size.

## Observations — FACT

### Repository shape

- 337 files: **202 Markdown, 45 YAML, 43 JSON, 31 Python.**
- Layers present as documented (paths below are **raptors-way's own**, not PratiBimb's):
  `agents/` (10 contracts), `workflows/` (6), `standards/` (9), `checklists/` (8),
  `templates/` (11), `profiles/` (8), `context/` (8),
  `runtime/{kernel,harness,loop,policies}`, `artifacts/decisions/` (**56 ADRs**),
  `validation/scenarios/` (19).
- `VERSION` = `1.0.0`.

### Finding 1 — the validator is hardcoded to the original author's machine

`tools/scripts/validate_agentos.py` line 16:

```python
REPO_ROOT = "/Users/soumyadebtripathy/WorkFlow/agentos-template"
```

Run as documented (`python3 tools/scripts/validate_agentos.py`) from the repository root
on this machine, it reports:

```
Readiness Score : 0/100
Overall Status  : FAIL
AgentOS Version : 0.3.0          <- fallback default; VERSION says 1.0.0
Warning Details:
  - Structural: Missing core root file 'README.md'      <- README.md exists
  - Structural: Missing core root file 'LICENSE'        <- LICENSE exists
  ... 120 more
```

**The validator cannot pass on any machine except the author's.** `AGENTOS.md` section 12
instructs every AI assistant to "Confirm health score = 100/100 before proceeding" and
section 2 says not to begin implementation until that is confirmed. **Followed literally,
the framework's own initialization protocol never completes.**

Re-running the same validator with `REPO_ROOT` corrected to the actual repository root
produces `Readiness Score: 100/100 · Overall Status: PASS` with 76 warnings.

### Finding 2 — the same absolute path leaks into the documentation

All 76 warnings from the corrected run are broken cross-references in
`DOCUMENTATION_INDEX.md` of the form:

```
file:///Users/soumyadebtripathy/WorkFlow/agentos-template/AGENTOS.md
```

Two independent leaks of the author's local filesystem into a distributed template.

### Finding 3 — the "runtime" is a heuristic simulator, not an execution engine

Total runtime source: **~1,330 lines across 23 files**, most of them 14–48 lines.

- `runtime/harness/classifier.py` (55 lines) classifies a task by **substring matching**
  on the task description and file extensions: `if "perf" in task or "optimize" in task
  ... domain = "performance"`.
- `runtime/harness/runtime.py` (86 lines) — the documented "Dispatch → Monitor → Collect →
  Validate" steps are **`print()` statements and state-machine transitions**. It does not
  invoke an agent, run a test, or execute a tool.
- `runtime/loop/quality_evaluator.py` computes `score = 100`, minus 30 if validation
  failed, minus `15 * error_count`; its confidence field is annotated in the source as
  `# Mock confidence formula`.
- `runtime/kernel/*` — five files of 14–21 lines each (event bus, logger, scheduler, state
  manager, policy loader).

`AGENTOS.md` section 7 states "The Harness will: … Route to appropriate specialist
reviewers; Run the Loop Runtime; Produce iteration reports; Exit when quality threshold is
satisfied", and section 13 lists "LOOP → Loop Runtime refines until quality threshold met"
as a step that "never skips". **No mechanism in the repository performs refinement.**

### Finding 4 — the validator validates documentation structure, not engineering quality

Its 18 categories check that named files exist, that directories are present, that
cross-references resolve, and that certain strings appear in certain files. It does not
run tests, lint code, check types, or evaluate any artifact's content.

### Finding 5 — the parts that are genuinely good

- **The agent contract format.** Identity, authority level, lifecycle state machine,
  explicit **Responsibilities and Non-Responsibilities**, typed inputs and outputs,
  escalation paths, failure recovery, token budget. This is a well-designed template for
  scoping a reviewer.
- **WAT separation** — Workflows (SOPs) / Agents (decisions) / Tools (execution) kept in
  separate layers.
- **The artifact discipline** — every significant decision produces an ADR; ADRs are
  indexed; the template is sound.
- **The context layer** — `state.md` as a live heartbeat, read first every session.
- **Explicit token-budget rules** — "never load eagerly", per-agent context targets.
- **The three stated laws:** WAT separation, Architecture First, Vendor Neutrality.

## Assessment — INFERENCE

**AgentOS's value is its conventions, not its code.** The Markdown layer — contracts,
gates, ADR discipline, the state heartbeat, WAT separation — is a genuinely good
engineering operating system, and it is the 202 files that are Markdown. The Python layer
is a demonstration of what such a system *could* automate; it is not that automation, and
one of its two entry-point scripts does not run outside the author's home directory.

Adopting the repository wholesale would mean importing:

- a validator that reports `FAIL` on a correct repository and instructs agents to halt;
- an initialization protocol that cannot complete;
- a quality score computed by a formula its own source labels "mock";
- 56 ADRs about the framework's own development, irrelevant to PratiBimb;
- 19 validation scenarios, 8 profiles, 9 standards and 4 vendor integration folders we
  would not use.

This directly contradicts PratiBimb's own principles: *no unverified assumptions presented
as facts*, *no invented benchmark numbers*, *security properties must be testable*.

## Decision — adopt the principles, not the repository

| Adopted | Adapted | Rejected |
|---|---|---|
| Agent contract format (identity, authority, responsibilities/non-responsibilities, typed I/O, escalation) | Rewritten for PratiBimb's seven domain roles | The 10 generic reviewers |
| WAT separation | `agentos/workflows/` `agentos/agents/` `agentos/gates/` | — |
| ADR discipline + `agentos/templates/decision_record.md` | Adopted as-is | The 56 framework-internal ADRs |
| `agentos/state.md` as a mandatory-first-read heartbeat | Adopted, PratiBimb-specific | — |
| Quality gates as binary checklists | Rewritten as QG-01..QG-06 against PratiBimb's real contracts | The 8 generic gates |
| Token-efficiency / load-on-demand rules | Adopted in `AGENTS.md` | — |
| Experiment-log and risk-register templates | Adopted | — |
| — | — | **`tools/scripts/validate_agentos.py`** — machine-bound, and validates structure not engineering |
| — | — | **`runtime/`** — the harness, loop and kernel simulators |
| — | — | `profiles/`, `standards/`, `validation/scenarios/`, `integrations/`, `production_certification/`, `lessons/`, `metrics/` |

**Net: a PratiBimb AgentOS layer of a few dozen files against 337 in the source repository.**
We care about engineering discipline, not repository bloat.

## Consequence for PratiBimb

If a validator is wanted later, it must be written against **PratiBimb's own contracts** —
asserting that every `UNKNOWN` cell blocks its dependent work, that every model row is
complete before adoption, that every reported figure carries a `measured`/`projected`
label — and it must resolve its root relative to `__file__`. That is a real gate. It is
also **not** something to build before Sprint 1.

This audit is the evidence base for ADR candidate **C-03**.
