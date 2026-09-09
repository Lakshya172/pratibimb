---
id: W1-S02a-2a-4
title: "Does a pinned connect-src stop execution-capable WASM from a foreign origin?"
spike: S-02a-2a-4
status: complete
verdict: ACCEPT — connect-src blocks foreign-origin WASM at the network layer, before the wire
date: 2026-09-10
labels: [FACT, INFERENCE]
---

# W1-S02a-2a-4 — connect-src as the provenance boundary

> **Throwaway spike code, permanent evidence.** `harness/` is not product code.
> **No manifest, CSP, or egress policy in this repository was changed.**

---

## Hypothesis

S-02a-2a-1 measured that `'wasm-unsafe-eval'` places **no restriction on WASM provenance** —
network-origin bytes compile as freely as packaged ones. It concluded that the only
manifest-level control over provenance is **`connect-src`**, which is **Invariant E
enforcement mechanism (3)** — and flagged that as *assumed, never measured*.

**H1:** a `connect-src` pinned to one origin prevents execution-capable WASM being
retrieved from any other origin, in all three MV3 contexts, and does so **before the
request reaches the network**.

**H0:** it does not — either the request still leaves the machine, or the block happens
somewhere that does not constitute a provenance boundary.

## Experimental design — and the control that makes it interpretable

| | |
|---|---|
| **ALLOWED origin** | `http://127.0.0.1:8907` — in `connect-src` for both variants |
| **FOREIGN origin** | `http://127.0.0.1:8908` — in `connect-src` for **neither** variant |
| **The bytes** | **Byte-identical** 41-byte WASM served by both. `sha256 f61fd62f…88ba`. **Origin is the only variable.** |

**`host_permissions` lists BOTH origins in EVERY variant.** This is the control that makes
attribution possible: if the foreign origin is blocked, host permissions cannot be the
cause, so the block is attributable to `connect-src`.

| Variant | `extension_pages` CSP |
|---|---|
| `ext-pinned` | `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' http://127.0.0.1:8907` |
| `ext-unpinned` | `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'` |

**`ext-unpinned` is the positive control.** Without it, "zero arrivals at the foreign
server" could equally mean the detector is broken. It proves the foreign log can record
arrivals at all.

### Ground truth — the B-02 discipline

**Each origin keeps its own arrival log, and the foreign server's log is authoritative.**
The probe's self-report is cross-checked against it, and the four possible outcomes are
enumerated in the harness rather than assumed:

| Probe says | Foreign server saw | Verdict |
|---|---|---|
| blocked | 0 arrivals | `CONSISTENT_BLOCKED` — refused before the wire |
| blocked | ≥1 arrival | **`FALSE_GREEN`** — bytes left the machine anyway |
| allowed | ≥1 arrival | `CONSISTENT_ALLOWED` |
| allowed | 0 arrivals | `ANOMALY` |

**`NOT_OBSERVED` is never read as absence.** A 2.5-second grace period runs before the
servers close, so a request that leaves late still counts as an arrival — closing
immediately would manufacture a clean "zero arrivals".

The probe also refuses to conflate *not attempted* with *blocked*: if retrieval never
resolved, compilation and instantiation are recorded as `attempted: false` with a reason,
not as `blocked`.

---

## Environment

Full record: [`environment.json`](environment.json).

| Field | Value |
|---|---|
| Workstation | **1** — `LAPTOP-6E14K34L`, OMEN 16-am0xxx, Win 11 `10.0.26200` |
| Browser A | unbranded **Chromium 151.0.7922.34** |
| Browser B | branded **Edge 152.0.4191.66** |
| Not used | branded Chrome 152 — refuses `--load-extension` |
| Mode | headful |
| Scale | 2 browsers × 2 variants × 3 runs × 3 contexts = **36 context-observations** |

Contexts: MV3 service worker · `chrome.offscreen` document · **dedicated worker inside the
offscreen document** (PratiBimb's real inference context).

## Expected result

| | Expectation |
|---|---|
| Allowed origin | retrieves, compiles, instantiates, `add(2,3)=5`, digest matches pin |
| Foreign origin, pinned | **uncertain** — blocked, but at which layer, and does the request still leave? |
| Foreign origin, unpinned | retrieves and runs (this is the control) |

## Actual result

**36/36 unanimous. Chromium and Edge identical on every cell.**

### A · Control — the allowed origin

| | Result |
|---|---|
| Network retrieval | **resolved**, 41 bytes, 3/3 all contexts both browsers |
| Digest | `f61fd62f…88ba` — **matches the pin** |
| `WebAssembly.compile` | **allowed** |
| Instantiate → `add(2,3)` | **`5`** |

### B · Foreign origin, `ext-pinned`

| Layer | Result |
|---|---|
| **1. Network retrieval** | **BLOCKED** — `TypeError: Failed to fetch` |
| **Foreign server arrival log** | **0 arrivals**, every run, both browsers |
| **2. WASM compilation** | *never attempted* — retrieval did not resolve |
| **3. Instantiation** | *never attempted* |
| `instantiateStreaming` (separate API) | **BLOCKED**, `Failed to fetch`, 0 arrivals |
| Cross-check verdict | **`CONSISTENT_BLOCKED` — refused before the wire** |

### B · Foreign origin, `ext-unpinned` — positive control

| Layer | Result |
|---|---|
| Network retrieval | **resolved** |
| **Foreign server arrival log** | **6 arrivals per run** (3 contexts × 2 request paths) |
| WASM compilation | **allowed** |
| Instantiation → `add(2,3)` | **`5`** |
| Cross-check verdict | `CONSISTENT_ALLOWED` |

**The detector works.** Zero arrivals under `ext-pinned` is a measured absence, not a
broken observer.

### C · Pin interaction — the finding that matters most for the ADR

In the **unpinned** run the foreign bytes were retrieved, and:

```
bytesIdenticalAcrossOrigins: true
foreign digest = f61fd62f…88ba = PINNED_SHA256   ->  digestMatchesPin: true
```

> **The hash pin ACCEPTED bytes from the foreign origin.**

It had to — the bytes were identical. A content hash answers *"are these the bytes I
expect?"*. It cannot answer *"did these bytes come from somewhere I trust?"*.

**The two controls are orthogonal, and neither substitutes for the other:**

| Control | Enforces | Layer | Blind to |
|---|---|---|---|
| `connect-src` | **where** bytes may come from | network, **pre-wire** | what the bytes contain |
| SHA-256 pin | **what** the bytes are | application, **post-retrieval** | where they came from |

Changing only the origin while keeping the bytes equivalent **did not bypass the
provenance boundary** — because `connect-src` stopped the retrieval before the hash was
ever computed. Equally, had `connect-src` been absent, the hash would have waved the
foreign bytes straight through.

---

## Conclusion

**H1 is supported. Verdict: ACCEPT.**

A pinned `connect-src` blocks execution-capable WASM from a foreign origin **at the network
retrieval layer, before any request reaches the wire**, in all three MV3 contexts, on both
Chromium-family browsers, 36/36 — confirmed by an independent arrival log and validated by
a positive control.

**S-02a-2a-1's inference is now measured:** `connect-src` really is the provenance control,
and Invariant E mechanism (3) really is what carries it.

**INFERENCE for the ADR, not a decision here:** `connect-src` and hash-pinning are
complementary and **both are required**. `connect-src` alone permits any bytes from the
pinned origin; the hash pin alone permits the right bytes from any origin.

## Reproducibility

See [`commands.md`](commands.md). 36/36 unanimous across two independent browsers.

**Limits:** one machine, one OS, Chromium-family only. The two origins differ by **port**;
a cross-host or `https` origin was not tested. Neither browser is the CI binary. Firefox is
a separate cell — see W1-S02a-2a-2.

## New UNKNOWNs raised

| # | Question | Blocks |
|---|---|---|
| S-02a-2a-4a | Does the same hold for a **cross-host / https** origin rather than a second loopback port? | Confidence in the general claim |
| S-02a-2a-4b | Does `connect-src` bound WASM provenance in **Firefox** MV3 the same way? | Cross-browser parity of mechanism (3) |
| S-02a-2a-4c | Can a **redirect** from the allowed origin to a foreign one reach WASM bytes past the pin? | Completeness of mechanism (3) |
