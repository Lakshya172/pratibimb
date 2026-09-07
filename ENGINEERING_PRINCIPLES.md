# Engineering Principles — PratiBimb

> These govern how we work. They are not aspirational; they are enforced by the gates.

---

### 1. Evidence over consensus
A measurement outranks agreement. Three reviewers concurring does not outweigh one
recorded result. A reviewer who cannot point to a file, a line, or a number has not
reviewed anything.

### 2. Measure before optimising
The evaluation harness is built in **week two**, not week six. We do not tune what we have
not measured, and we do not claim what we have not measured.

### 3. Architecture decisions must be explicit
Every deviation from the dossier becomes an ADR before it becomes code. A decision that
exists only in a commit message is not a decision; it is an accident that has not been
noticed yet.

### 4. Models are replaceable components
Every model role sits behind a typed interface. A model change is a config change and a
benchmark run — never an architectural decision. **The interface does not change to
accommodate the model.**

### 5. Security properties must be testable
"The vault is memory-only" is a claim. "This test asserts zero writes to persistent
storage under every code path" is a property. Every invariant in
`docs/security/security-invariants.md` maps to a test.

### 6. No best-effort security behaviour
Validation failure aborts. There is no best-effort parse, no partial verification, no
"good enough" redaction. **A pipeline that cannot refuse to transmit has no way to prove
its redaction worked — it can only assert it.**

### 7. No silent degradation
A detector that times out counts as a positive. A verifier that throws blocks the send.
A failed freshness check discards the plan. Degradation is always visible, always logged,
and always told to the user.

### 8. No invented benchmark numbers
Every figure is labelled `projected` or `measured`. A dossier budget stays labelled a
budget until the harness replaces it. An unbacked number is worse than no number.

### 9. No unsupported compatibility claims
We do not assert cross-browser parity. **We publish it.** A model that has not been run in
a context has not been shown to work in that context, regardless of what its
documentation says.

### 10. No unverified assumptions presented as facts
`FACT` / `INFERENCE` / `UNKNOWN` are labels with rules (`AGENTS.md` section 5). Promotion
from `UNKNOWN` requires an artifact. "ONNX-exportable" is not "runs in a Firefox extension
worker on WASM". "The model card says Apache-2.0" is not "this pinned revision is
Apache-2.0".

### 11. The human owns final architectural decisions
Agents recommend. Reviewers block. The human architect decides. No agent approves its own
ADR.

### 12. A working fallback beats a perfect dependency that may fail at the venue
Implementation C — DOM-only degradation, vision limited to faces and OCR — is the floor,
and it is a floor we can demonstrate. That has more value than a superior detector that
might not load on the judging machine.

### 13. Scope discipline
**The largest risk to this project is building a research programme instead of a
submission.** A complete, defensible submission exists by the end of week four. Weeks five
and six raise the score; they do not rescue the project.

### 14. Honesty is a scoring strategy
Every correction in the dossier's own changelog — the 85% claim, the accessibility tree,
the AGPL licence, the tautological verifier, the WebGPU-only budget, the free-capture
change gate — was a place where an overstated claim would have been caught by a panel.
**We state limits before we are asked about them.**
