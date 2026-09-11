# Architecture Decision Record Index — PratiBimb

> Every deviation from `docs/dossier/PratiBimb-Engineering-Dossier-v4.0.pdf` becomes an ADR
> **before** it becomes code. Not a comment. Not a commit message. An ADR.
>
> Template: `agentos/templates/decision_record.md`
> Location: `docs/adr/ADR-NNNN-slug.md`

---

## Recorded ADRs

**Count: 2 approved and implemented, 0 proposed.**

| ID | Title | Status | Date | Supersedes |
|---|---|---|---|---|
| [ADR-0001](ADR-0001-wasm-csp-and-connect-src.md) | WebAssembly CSP directive and the `connect-src` provenance pin | **APPROVED 2026-09-10 — implemented, G1–G7 recorded in §12** | 2026-09-10 | — |
| [ADR-0002](ADR-0002-t1-capture-format-policy.md) | QG-03b-2c — T1 Capture Format Policy (explicit PNG only) | **APPROVED 2026-09-11 by ronitsaha11 (merge of PR #41, `27d71e3`); implemented in PR #41** | 2026-09-11 | — |

> **ADR-0001 covers issues #17 and #5 in one decision**, because S-02a-2a-4 measured that
> the CSP directive and the `connect-src` egress pin live in the same manifest and constrain
> each other. It is a decision *package*: evidence, options, consequences, rollback and
> seven verification gates.
>
> **Approved at the architectural decision level and implemented.** Gate results are in
> §12.1; raw evidence in `artifacts/adr/ADR-0001/`. Approval of the decision was explicitly
> **not** approval to weaken any gate: the `privacy-security-engineer` veto stands beyond the
> G6 CSP-diff sign-off, **QG-04 remains UNSIGNED**, **B-02 remains OPEN**, and **Firefox on
> Linux remains UNKNOWN**.

---

## ADR candidates — decisions that should be recorded before implementation proceeds

These are decisions the dossier either makes implicitly, defers, or leaves to us. Each
should become an ADR, and several are **blocking**.

| # | Candidate | Why it needs an ADR | Blocking? |
|---|---|---|---|
| **C-01** | Adopt dossier v4.0 as the frozen implementation baseline, and define the amendment procedure | Establishes that the dossier governs and how it may be changed. Everything else rests on this. | **Yes** |
| **C-02** | Version control and reproducibility policy | The workspace is not a git repository. Pinning, ADR history and release reproducibility all assume one. | **Yes** |
| **C-03** | AgentOS adoption scope — which parts of Raptor's Way are adopted, adapted, or rejected, and the rule that AgentOS never enters the PratiBimb runtime | The framework's own validator is machine-bound and its runtime is a heuristic simulator; adopting it wholesale would be adopting a claim we have disproved | **Yes** |
| **C-04** | WebGPU/WASM backend policy, pending S-01/S-02 | If the adapter is null in extension contexts, the entire performance story changes. The policy must be written before the result arrives, so it is not written to fit the result. | **Yes** |
| **C-05** | `UIElementDetector` fallback ranking and the week-3 trigger for implementation B | B starts in week three *regardless* — that is a scheduling commitment that will be under pressure, and it should be a recorded decision rather than a good intention | **Yes** |
| **C-06** | Model licence verification procedure and the definition of "verified" | The v2.0 AGPL defect happened once already. The procedure that prevents a recurrence should be explicit. | **Yes** |
| **C-07** | Payload pin construction — the exact byte layout of the single immutable artifact, and the hash algorithm | Invariant E rests on this being unambiguous. Two components must agree on the artifact byte-for-byte. | **Yes** |
| **C-08** | Vault lifetime and destruction triggers, precisely defined (what counts as "session end"; what counts as a "tab change") | The dossier states the policy; the edge cases decide whether it holds | Yes |
| **C-09** | Confidentiality entity list — the v1 contents of the GLiNER config, and who may change it | It is configuration by design, which means it can drift without review unless ownership is stated | No |
| **C-10** | Server session store — in-process dictionary, and the explicit non-adoption of Redis in v1 | Recording the *deferral* prevents it being re-litigated in week five under pressure | No |
| **C-11** | Synthetic data generator design and the ground-truth format | It is the foundation of three of the five scored metrics, and it is built in week one | Yes |
| **C-12** | Demonstration script and the origin-crossing rehearsal rule | The rule that no sequence may depend on a value surviving an origin change is easy to violate accidentally during rehearsal | No |

---

## Amendment procedure (proposed in C-01)

1. Anyone may propose a deviation. It is written as a draft ADR.
2. `pratibimb-architect` assesses constitution impact and scope impact.
3. The owning specialist reviewer(s) assess technical impact.
4. `privacy-security-engineer` has a standing veto if the trust boundary is touched.
5. **The human architect approves or rejects.** No agent approves its own ADR.
6. On approval: `docs/architecture/constitution.md` is updated, this index is updated, and the ADR
   is recorded in `docs/adr/`.
