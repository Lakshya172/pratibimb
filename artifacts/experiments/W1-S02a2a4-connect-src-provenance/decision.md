---
id: W1-S02a-2a-4-decision
spike: S-02a-2a-4
verdict: ACCEPT
date: 2026-09-10
decided_by: browser-engineer + privacy-security-engineer (see reviews below)
---

# S-02a-2a-4 decision — ACCEPT

## Verdict

**ACCEPT.** A pinned `connect-src` blocks execution-capable WASM from a foreign origin at
the **network retrieval layer, before the request reaches the wire**. 36/36
context-observations, two browsers, three MV3 contexts, confirmed by an independent arrival
log and validated by a positive control.

| Layer | Pinned | Unpinned (control) |
|---|---|---|
| 1 · network retrieval | **BLOCKED** — `TypeError: Failed to fetch`, **0 arrivals** | resolved, **6 arrivals** |
| 2 · WASM compilation | never attempted | allowed |
| 3 · instantiation | never attempted | `add(2,3)=5` |

## The finding that changes the ADR

**In the unpinned control, the SHA-256 pin ACCEPTED the foreign-origin bytes** — they were
byte-identical, so it had to. A content hash cannot express provenance.

| Control | Enforces | Layer | Blind to |
|---|---|---|---|
| `connect-src` | **where** bytes may come from | network, pre-wire | what they contain |
| SHA-256 pin | **what** the bytes are | application, post-retrieval | where they came from |

**Neither substitutes for the other. Both are required.**

## What this unblocks

**S-02a-2a-1's inference is now measured.** Invariant E mechanism (3) demonstrably carries
the WASM provenance boundary. ADR-0001 can rest on measurement rather than assumption.

## What this does NOT do

- **No manifest, CSP or egress policy was changed.** Adopting a directive is ADR-0001.
- Does not resolve **B-02**, which is about mechanism **(2)** — the Playwright interception
  gap over the offscreen document. Untouched.
- Does not sign **QG-04**.
- Says nothing about Firefox `connect-src` (**S-02a-2a-4b**), cross-host/https origins
  (**S-02a-2a-4a**), or redirects (**S-02a-2a-4c**).

## AgentOS specialist review

### browser-engineer — PASS

Contexts are the ones the constitution names, including the dedicated worker inside the
offscreen document. `host_permissions` includes both origins in every variant, so the block
is attributable to `connect-src` and not to host permissions — the attribution is sound.
Streaming and buffer APIs were measured separately rather than assumed equivalent. Extension
load was confirmed via `serviceWorkers()` before falling back to `waitForEvent`, so an
unloaded extension cannot masquerade as a blocked one. **No architecture change implied.**

### privacy-security-engineer — PASS, with the ADR held open

The ground-truth discipline required by B-02 is met: the foreign origin's arrival log is
authoritative, the four probe/observer outcomes are enumerated including the `FALSE_GREEN`
case, a positive control proves the observer works, and a grace period prevents a
manufactured "zero arrivals". `NOT_OBSERVED` is nowhere treated as absence. *Not attempted*
is never reported as *blocked*.

**No invariant weakened; nothing relaxed to make a result pass.** The `connect-src`/hash-pin
orthogonality is the substantive security finding and it **must** appear in ADR-0001: a
reviewer who believes hash-pinning bounds provenance would be wrong, and this experiment
shows exactly why.

**Standing veto not exercised — and not waived.** ADR-0001 requires human architect
approval before any manifest change.
