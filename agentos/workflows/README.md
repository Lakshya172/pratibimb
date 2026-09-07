# Workflows — PratiBimb

Four SOPs. Each names its entry condition, its steps, its owning reviewers, and its exit gate.

| Workflow | Use when | Exit gate |
|---|---|---|
| [`spike.md`](spike.md) | Answering an `UNKNOWN`. Throwaway code, permanent evidence. | QG-01 |
| [`implementation.md`](implementation.md) | Building anything that ships | The gate named by the task |
| [`model-adoption.md`](model-adoption.md) | Introducing or replacing a model behind an interface | QG-03 |
| [`release.md`](release.md) | Cutting a build for rehearsal or judging | QG-06 |

---

## The six-week delivery plan, and why the ordering exists

| Week | Work |
|---|---|
| **1** | **Capability spikes** — WebGPU-in-offscreen, the 20-cell model feasibility matrix, DPR/zoom, capture limits. **Thin end-to-end spike**: dumb redact → server → one click. Skeleton, no ML. |
| **2** | **Contracts frozen** — manifest, actions, coordinates. **Privacy pipeline D1 + D2.** **Egress invariant + fail-closed suite.** **Eval harness + synthetic data.** |
| **3** | **Perception** — D3, D4, fusion. **Our own detector head starts here regardless.** Adversarial + false-positive sets. |
| **4** | **Close the loop** — server, freshness, re-hydration. |
| **5** | **Model benchmarks behind interfaces.** |
| **6** | **Harden, optimise, rehearse** — Firefox parity, offline, run it ten times. |

**Why this ordering:**

- **The first server round trip sits in week one.** v2.0 discovered integration failures —
  coordinate spaces, extension messaging, vLLM guided-decoding quirks — in week five, with
  one week of slack. **A throwaway thin thread in week one finds them when they cost a day.**
- **The evaluation harness is built in week two, not week six**, because we measure before
  optimising and because a metric we cannot measure is a metric we cannot claim.
- **D1 and D2 ship first** because they need no machine learning at all and already cover
  most structured Indian PII — so the pipeline can be built and measured before any model
  is integrated.
- **The 20-cell feasibility matrix is week one** because a model that fails in week five
  has already cost four weeks of architecture built around it.
- **Our own detector head starts in week three whether or not OmniParser is working**,
  because it removes the biggest single point of failure in the client and the labelled
  data pipeline already exists.
- **A complete, defensible submission exists by the end of week four. Weeks five and six
  raise the score; they do not rescue the project.**

## Team of six (dossier section 12)

| Role | Owns |
|---|---|
| Client perception (2) | Capture, DOM extractor, detector integration, fusion, coordinate contract, executor, freshness check |
| Privacy engineer (1) | Four channels, manifest, redaction, differential verifier, value-aware check, vault, egress guard and its invariant tests |
| Server and agent (1) | vLLM deployment, prompting, action schema, validators, tripwire, origin policy |
| Evaluation and data (1) | Synthetic generator, adversarial set, false-positive set, labelled ground truth, all six dashboards |
| Integration and demo (1) | Cross-browser builds, Playwright end-to-end, fail-closed suite, ledger UI, rehearsal |
