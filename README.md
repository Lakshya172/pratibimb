# PratiBimb

**प्रतिबिम्ब — a reflection that reveals the structure, never the identity.**

> Smart India Hackathon 2026 · Problem Statement **26171** · ISRO / Department of Space
> *On-device Visual Perception for Light-weight Browser Agents*

---

## What it is

A browser agent that can see your screen and act on it, **without your screen ever reaching
the server**.

Local models read the page. Every sensitive span is replaced by a typed placeholder that
carries the *shape* of the data without its *content*. The server plans in placeholders.
The client substitutes the real value at the instant of execution.

```
On the device                      On the wire
Applicant  Rajesh Kumar     -->    Applicant  <PII:NAME:1>
Aadhaar    XXXX XXXX XXXX   -->    Aadhaar    <PII:AADHAAR:1>
Mobile     +91 XXXXXXXXXX   -->    Mobile     <PII:PHONE:1>
Photograph present          -->    Photograph FACE:1
```

Layout, field roles and data types survive. **Not one identifying character does.**
The server still knows there is a twelve-digit numeric field labelled Aadhaar at those
coordinates, and can plan around it.

**The product thesis: a privacy firewall that happens to power an agent.**

---

## Status

**Phase 0 — initialization complete. No product code has been written.**

The repository currently contains the engineering environment: the governing dossier, the
frozen contracts, the architecture constitution, specialist reviewer contracts, workflows,
quality gates, and the model registry and feasibility matrix (structures only — every cell
is `UNKNOWN`).

See `agentos/state.md`.

---

## Start here

| If you are | Read |
|---|---|
| An AI assistant opening this repository | **`AGENTS.md`** — first, and completely |
| A new engineer | `AGENTS.md` → `docs/architecture/vision.md` → `docs/architecture/constitution.md` |
| Reviewing the architecture | `docs/architecture/constitution.md` — the constitution |
| Touching anything security-related | `docs/security/security-invariants.md` |
| Adding or changing a model | `agentos/workflows/model-adoption.md` |
| Wondering what is actually proven | `agentos/registry/feasibility-matrix.md` — the answer is currently "nothing" |

---

## Repository map

```
AGENTS.md                      entrypoint for AI assistants - read first
ENGINEERING_PRINCIPLES.md      how we work
CONTRIBUTING.md                branch / commit / PR / checkpoint rules
SECURITY.md                    what must never enter this repository

docs/
  dossier/                     THE GOVERNING ARTIFACT (PDF + text + section map)
  architecture/
    constitution.md            frozen vs replaceable vs not-yet-known
    vision.md                  the problem, the thesis, the rubric
    coordinate-contract.md     CSS viewport pixels, canonical
    manifest-schema.md         redaction manifest v1.1
    action-schema.md           allowlist, dual-mode type, origin policy
    glossary.md                shared vocabulary; terms we refuse to use
  security/
    security-invariants.md     Invariant E + INV-01..INV-25
    threat-model.md            four adversaries, stated scope limit
  testing/
    benchmark-contract.md      what every implementation must measure
  operations/                  git workflow, repository structure
  adr/                         architecture decision records + index

agentos/                       the engineering OS - development only, NEVER the product
  state.md                     live project state
  agents/                      seven specialist reviewer contracts
  workflows/                   spike / implementation / model-adoption / release
  gates/                       QG-01 .. QG-06
  registry/                    model registry + 20-cell feasibility matrix
  templates/                   ADR, experiment log, risk register

artifacts/
  experiments/                 reproducible spike evidence
  reviews/                     audits

.github/                       PR template, issue forms, CI, CODEOWNERS
scripts/                       repository tooling
```

> `apps/` and `packages/` do not exist yet, and deliberately so — there is no product code.
> They are created when the first product code is written, not before. See
> `docs/operations/repository-structure.md`.

---

## The non-negotiables

1. No outbound request except through the **single egress module**, and only for a byte
   artifact whose **hash the verifier signed**.
2. The **vault is memory-only** and is destroyed on session end, tab change, and
   unconditionally before an origin change commits.
3. **Secrets cross as references.** Unknown tokens abort. A literal aimed at a redacted
   field aborts. **A literal matching a vault value is a leak, and halts the session.**
4. **Verification is fail-closed.** The verifier can block a send; it is not advisory.
5. **All coordinates are CSS viewport pixels.**
6. **No model is accepted because its documentation says it should work.**

Full list: `docs/security/security-invariants.md`.
