# Specialist Reviewers — PratiBimb

> **Purpose: focused review and decision-making. Not multiplying AI calls.**
> Seven roles. No more will be created without an ADR.

Each contract below states what the reviewer **owns**, what it **must refuse**, its
**required inputs**, its **outputs**, and its **escalation path**. A reviewer returns
`PASS` / `FAIL` / `CONDITIONAL_PASS` with evidence — never an opinion without evidence.

| Agent | Owns | Blocking authority |
|---|---|---|
| [`pratibimb-architect`](pratibimb-architect.md) | Architectural consistency, the constitution, ADRs | Any change to a frozen contract |
| [`browser-engineer`](browser-engineer.md) | Chrome/Firefox, MV3, DOM, coordinate spaces, offscreen execution, iframes, action execution, freshness | Coordinate contract, execution context |
| [`ml-engineer`](ml-engineer.md) | Model selection, model interfaces, ONNX compatibility, quantisation, accuracy, latency, memory, browser feasibility | Model adoption (QG-03) |
| [`privacy-security-engineer`](privacy-security-engineer.md) | Redaction, PII detection, verifier, vault, egress invariant, payload pin, logging, prompt injection, origin policy | **Any security invariant. Highest authority after the architect.** |
| [`evaluation-qa-engineer`](evaluation-qa-engineer.md) | Benchmark harness, ground truth, adversarial sets, false positives, regression tests, SIH metric reporting, task success after privacy | Any reported metric |
| [`performance-engineer`](performance-engineer.md) | p50, p95, peak heap, GPU memory, CPU, cold/warm startup, cache hit rate, network-free steps, browser backend differences | Any latency or resource claim |
| [`integration-release-engineer`](integration-release-engineer.md) | Cross-browser builds, CI, end-to-end tests, release gates, reproducibility, final rehearsal | Release (QG-06) |

## Universal rules binding every reviewer

1. **Evidence over consensus.** A reviewer that cannot point to a file, a line, a
   measurement or a test result has not reviewed anything.
2. **No reviewer may relax a frozen contract to unblock work.** Escalate to
   `pratibimb-architect`, who raises an ADR for the human.
3. **No reviewer may mark an `UNKNOWN` as `FACT`.** Only an artifact under
   `artifacts/experiments/` can do that.
4. **`privacy-security-engineer` has a standing veto** on anything touching the vault, the
   verifier, the egress module, the manifest, or logging. That veto is not overridden by
   schedule pressure.
5. **The human architect owns all final architectural decisions.** Reviewers recommend.
