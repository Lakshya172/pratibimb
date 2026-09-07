# Threat Model Contract — PratiBimb

> **FROZEN.** Source: dossier v4.0 section 4.
> A privacy claim without a named adversary is decoration.

---

## Four adversaries, four answers

### A1 — Compromised or curious server

**What it can do:** Read every byte we transmit; return a malicious plan.

**Mitigation, and where it lives:**
Values never leave — opaque fill on the outgoing bitmap, tokens in the manifest, vault in
client RAM. Returned plans pass the action allowlist and the freshness check before
touching the page.
**Lives in:** egress guard + local validator.

---

### A2 — Malicious webpage

**What it can do:** Inject instructions into text the agent scrapes; overlay or clickjack
a control.

**Mitigation, and where it lives:**
Page text is framed as **data** in the prompt and never as instruction. DOM/vision
disagreement above threshold flags an overlay. Irreversible actions stop for a human.
**Lives in:** content script + prompt construction + confirmation tier.

**Prompt injection, specifically.** Text scraped from a page reaches the server's context,
so a hostile page will attempt to issue instructions. Four layers answer this:

1. Page content is framed as data and never as instruction.
2. The output grammar admits no action capable of arbitrary execution.
3. Every irreversible step stops for a human.
4. The origin policy prevents exfiltration by navigation.

> **The agent can be misled about what to look at. It cannot be talked into doing
> something outside the allowlist.** This is demonstrated rather than asserted — see the
> adversarial demonstration sequence.

---

### A3 — Faulty local detector

**What it can do:** Miss an Aadhaar number, time out, or crash mid-pipeline.

**Mitigation, and where it lives:**
Four-channel union with fail-closed semantics; **a timeout counts as a positive**.
Differential second-pass verifier plus value-aware residual check. Three failures **block
the request rather than degrading it**.
**Lives in:** privacy verifier.

---

### A4 — Incorrect or hostile VLM

**What it can do:** Hallucinate coordinates, invent tokens, emit an unsafe action, echo a
value.

**Mitigation, and where it lives:**
Guided JSON constrains generation; Pydantic validates on egress; the client re-validates
on ingress. Unknown tokens abort. A literal aimed at a redacted field aborts. **A literal
that matches a vault value is treated not as a defect but as a leak:** the session halts
and the run is recorded as failed.
**Lives in:** action schema + validator.

---

## Stated scope limit — prepare this answer

The server sees **layout, field roles, data types and the user's goal**.

> **A determined adversary correlating quasi-identifiers across many sessions is outside
> our threat model, and we say so rather than implying otherwise.**

We reduce the surface where it is cheap: coarse location, employer and institution names
are redacted alongside direct identifiers, because **location plus date of birth is the
classic re-identification pair**.

**We do not claim k-anonymity or differential privacy, and we will not let a slide imply
we do.**

---

## Non-adversarial failure modes also covered

| Mode | Response |
|---|---|
| Screen capture blocked on a protected page | Degrade to structure-only mode — manifest without image — and say so in the interface |
| Verifier blocks three times | Structure-only mode; user is told |
| GPU host unreachable at the venue | Qwen3-VL-4B on a team laptop; SmolVLM offline path; recorded video of the full run |
| Judging machine has no WebGPU | WASM path built and benchmarked from week one; both budgets published; live backend shown in the ledger; **never ship WebGPU-only** |
| Page swaps a control after capture, before click | Action freshness check (pipeline stage 8) |
| Long form extends below the fold | Off-screen elements reported as known-but-uncaptured; scroll planned toward named fields the server has not seen |
