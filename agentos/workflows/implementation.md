# Workflow: Implementation

> Use for anything that ships.
> **No implementation stage may silently violate a frozen contract.**

---

## Entry condition

- The task is in scope for v1 (`docs/architecture/constitution.md` section 10).
- Every `UNKNOWN` the task depends on has been resolved by a spike, **or** the task is
  explicitly designed to work without that answer.
- `agentos/state.md` names the task.

## Steps

```
1  READ      the frozen contracts this task touches (docs/architecture/*.md)
2  DECLARE   which invariants (INV-nn) this code is responsible for upholding
3  TEST      write the contract test FIRST where the contract says so
             - the six-configuration DPR/zoom test exists before the executor
             - the fail-closed rows exist before the pipeline they guard
             - the egress interception suite exists before the egress module ships
4  BUILD     the smallest change that satisfies the contract
5  MEASURE   emit the figures docs/testing/benchmark-contract.md requires
6  REVIEW    route to the owning specialist(s) in agentos/agents/
7  GATE      run the gate named in agentos/gates/
8  ARTIFACT  ADR if a frozen decision moved; experiment log if an UNKNOWN resolved
9  UPDATE    agentos/state.md
```

## Routing — which reviewer owns what

| Touching | Owning reviewer(s) |
|---|---|
| Vault, verifier, egress, manifest, redaction, logging, origin policy, prompt construction | **`privacy-security-engineer`** (standing veto) |
| Coordinates, DOM extraction, MV3 contexts, capture, executor, freshness, iframes | `browser-engineer` |
| Any model, ONNX, quantisation, runtime backend, heap | `ml-engineer` |
| Any reported metric, evaluation set, ground truth | `evaluation-qa-engineer` |
| Any latency or resource figure | `performance-engineer` |
| Build, CI, cross-browser, release | `integration-release-engineer` |
| A frozen contract, scope, or a dependency addition | **`pratibimb-architect`** |

Anything touching the trust boundary routes to `privacy-security-engineer` **in addition
to** its domain reviewer, never instead of.

## Hard stops

Stop and escalate — do not work around — if:

- The task cannot be completed without changing a frozen contract.
- The task requires a dependency outside the frozen stack.
- A security invariant would need to be relaxed.
- A number would have to be estimated rather than measured.
- A feasibility row would have to be assumed rather than filled.

## Definition of done

- [ ] The contract test passes, and it tests the contract rather than the implementation.
- [ ] The invariants declared in step 2 are each exercised by a named test.
- [ ] The required measurements exist and are labelled `measured`.
- [ ] The owning reviewer returned `PASS`.
- [ ] The gate passed.
- [ ] `agentos/state.md` is updated.
- [ ] No `UNKNOWN` was promoted without an artifact.
