# Glossary — PratiBimb

> Shared vocabulary. Source: dossier v4.0 appendix. Use these terms exactly; imprecision
> here becomes an unforced credibility loss in the viva.

| Term | Meaning |
|---|---|
| **Redaction manifest** | The versioned contract describing every mask applied, so the server can reason about what it cannot see |
| **Re-hydration** | Substituting a real value back into a placeholder at execution time, on the client, from memory |
| **Fail closed** | When detection is uncertain, mask anyway — the union of all detector outputs wins |
| **Residual leakage** | The fraction of transmitted payloads in which any sensitive value survived redaction |
| **Egress guard** | The single module permitted to make a network call, which refuses unverified payloads |
| **Egress invariant** | The formal, tested property that no request leaves without `verified === true` |
| **Differential verification** | A second detection pass that differs from the first in scope and threshold, so it *can* disagree with it |
| **Value-aware check** | Searching the outgoing payload for the specific secrets the vault holds, rather than for whatever a detector believes is secret |
| **Payload pin** | The hash taken over the single assembled byte artifact, which verification signs and egress refuses to send without |
| **Changed frame** | A frame in which the change policy reports an observable-state change, from the structural signal or the visual one — **not every rendered frame** |
| **Cleared literal** | A non-sensitive plain value proposed by the server that has passed the target, shape and vault checks on the client |
| **Action freshness** | Re-confirming that a plan's target still exists, matches, and has not moved, before executing it |
| **Derived element graph** | Our reconstruction of page structure from roles, ARIA, accessible names and geometry — **not** the browser's native accessibility tree, which extensions cannot read |

## Terms this project does NOT use, and why

| Do not say | Say instead | Why |
|---|---|---|
| "We read the accessibility tree" | "We build a derived element graph" | `chrome.automation` is ChromeOS-only for extensions; no content-script API exposes the native AX tree. A panel that knows the extension APIs will catch this. |
| "Firefox doesn't support WebGPU" | "Firefox on Linux has it disabled by default; it shipped on Windows in 141" | A panel that has read the release notes will catch this, on a point where our engineering was right |
| "We blur the sensitive regions" | "We apply a constant-colour opaque fill" | Blur and pixelation are recoverable in distribution |
| "85% of the score is decided client-side" | "Roughly 60% client-side, 40% shared, and the client dominates the shared portion" | Visual-context accuracy is measured end-to-end and depends on the server reasoning over a redacted frame |
| "Zero residual leakage" (before measurement) | "Zero residual leakage is the objective; here is the measured figure" | An unbacked 0.00% invites the panel to spend the question period dismantling it |
| "MutationObserver detects every change" | "MutationObserver is the structural signal; dHash polling covers what it cannot reach" | A page can change on screen with no mutation record at all |
| "It's a 1.1 s pipeline" | "Projected 965 ms on WebGPU, 1,385 ms on WASM — budgets, not measurements" | Both budgets are published, and neither is measured yet |
