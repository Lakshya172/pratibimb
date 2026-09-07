# Security Invariants Contract — PratiBimb

> **FROZEN.** These are system-level constraints, not suggestions.
> Source: dossier v4.0, sections 5, 7, 9, 11 and the Appendix engineering rules.
> Weakening any invariant to make a test pass is a process failure. Raise an ADR instead.
> Status legend: **SPEC** = specified, not yet implemented · **TESTED** = an automated
> test asserts it · **VERIFIED** = tested and observed passing on a recorded run.

Every invariant below is currently **SPEC**. None is implemented. None is tested.

---

## Invariant E — the egress invariant

This is stated as a security property, not a coding convention, because it is the one
claim the whole submission rests on.

> **No outbound network request originates from the extension unless it was issued by the
> egress module, and the egress module issues no request unless the verifier has returned
> `verified === true` for a byte artifact whose hash equals the hash of the buffer being
> transmitted.**

Enforced four ways, all four required:

1. A **lint rule** that fails the build on `fetch`, `XMLHttpRequest`, `sendBeacon` or
   `WebSocket` outside the egress module.
2. A **Playwright test** that installs a request interceptor and asserts **zero requests**
   under each injected failure.
3. A **manifest content security policy** restricting `connect-src` to the configured
   server origin.
4. The **payload hash pin** (INV-02/INV-03 below).

---

## The invariants

| # | Invariant | Enforcement | Status |
|---|---|---|---|
| INV-01 | No outbound network request may originate from the extension except through the single egress module. | Lint rule + CSP `connect-src` + Playwright interception suite | SPEC |
| INV-02 | The egress module may send a request only when the verifier has approved the **exact byte artifact** being transmitted. | Hash pin | SPEC |
| INV-03 | The verified artifact hash must equal the hash of the artifact actually sent. Nothing is re-encoded, re-serialized or mutated between hashing and sending. A change of a single byte invalidates the pin and the send fails closed. | Hash pin + unit test | SPEC |
| INV-04 | The vault is **memory only**. | Code review + lint | SPEC |
| INV-05 | The vault must never use `localStorage`, `IndexedDB`, `chrome.storage`, logs, analytics, or server-side storage. | Lint rule + test | SPEC |
| INV-06 | Vault data is destroyed at **session end**, **tab change**, and **origin change**. Destruction on origin change is **unconditional** and happens **before the navigation commits**, regardless of whether the user confirmed. | Test | SPEC |
| INV-07 | Secret values cross the boundary only as references/tokens. | Schema + validator | SPEC |
| INV-08 | Unknown tokens abort. The client never guesses which token was meant. | Local validator | SPEC |
| INV-09 | A literal aimed at a redacted field aborts, whatever it contains. A sensitive field is filled by reference or not at all. | Local validator — target check | SPEC |
| INV-10 | A literal matching a vault-held secret (exact or fuzzy) is a **leakage event**: the session halts, the ledger records it, and the run counts as a residual-leakage failure. It is **not** logged as the same event as a PII-shaped literal, which is merely a server defect. | Local validator — vault check | SPEC |
| INV-11 | Server output is schema-validated (Pydantic v2) **before leaving the server**. Failure aborts; there is no best-effort parse. | Server | SPEC |
| INV-12 | Server output is validated **again by the client** before execution. | Local validator | SPEC |
| INV-13 | Actions are checked against an **allowlist**. | Local validator | SPEC |
| INV-14 | Actions must pass **freshness validation** against the live page before execution. | Action executor | SPEC |
| INV-15 | Arbitrary JavaScript execution is forbidden. Not in the grammar. | Action schema | SPEC |
| INV-16 | `eval` is forbidden. | Lint + CSP | SPEC |
| INV-17 | Shell commands are forbidden. Not in the grammar. | Action schema | SPEC |
| INV-18 | Download-and-run behaviour is forbidden. | Action schema | SPEC |
| INV-19 | Model-supplied arbitrary URLs are forbidden. They stay outside the grammar entirely. | Action schema | SPEC |
| INV-20 | New-origin navigation requires the documented confirmation policy: destination shown, human confirms, vault destroyed unconditionally before commit, fresh session at the new origin. Declining ends the task rather than silently continuing. | Origin policy | SPEC |
| INV-21 | No component may log secret plaintext. **Not the tripwire, not the verifier, not the ledger.** | Code review + test | SPEC |
| INV-22 | Verification is **fail-closed**. The verifier can block a send; it is not advisory. | Verifier | SPEC |
| INV-23 | Detector failure must never silently downgrade into unsafe transmission. A detector that errors or times out **counts as a positive**. | Union logic | SPEC |
| INV-24 | All coordinates use **CSS viewport pixels** as the canonical space. Every other space converts at its own edge. | `docs/architecture/coordinate-contract.md` | SPEC |
| INV-25 | A model implementation is not acceptable until it passes the feasibility criteria in `docs/testing/benchmark-contract.md` and has a complete row in `agentos/registry/feasibility-matrix.md`. | Gate QG-03 | SPEC |

---

## Supporting rules from the dossier appendix

- The un-redacted bitmap is **closed immediately after masking** and never referenced again.
- Every transmitted mask is a **constant-colour opaque fill** composited on an
  `OffscreenCanvas` inside the worker. **Never blur or pixelation on the outgoing buffer** —
  both are recoverable in distribution. Blur remains available as a display-side courtesy
  only. Applying a CSS filter and then screenshotting is worse still: a compositing race
  in which raw pixels ship if the frame has not flushed.
- The **semantic label is composited strictly after the fill, never instead of it**. The
  verifier is aware of its own labels and does not flag them as residual text.
- Verification runs against the **encoded WebP bytes that will actually be transmitted**,
  decoded back — not the pre-encode canvas.
- The second verification pass **differs from the first in scope and threshold**.
  Re-running the same detectors at the same settings on the same image finds the same
  nothing. See "the tautology v2.0 shipped with".
- Every model has a **WebAssembly fallback**, tested in CI. A model that fails the WASM
  columns is not shipped whatever it does on WebGPU.
- Every version is pinned — library, model revision, quantisation, runtime assets — and
  every model carries its licence in `agentos/registry/model-registry.md`.

---

## Redaction union semantics — FROZEN

Four detection channels, one union, no exceptions. **Recall is prioritised over
precision, because over-masking is free and under-masking is fatal.**

| Channel | Method | Covers |
|---|---|---|
| **D1** | DOM semantics: `type=password`, autocomplete tokens, `aria-label`, field names. Zero cost, near-perfect precision. | passwords, OTP, card, email |
| **D2** | Deterministic: pattern plus checksum. Verhoeff and Luhn kill the false positives regex alone creates. | Aadhaar, PAN, IFSC, UPI, GSTIN |
| **D3** | Semantic NER: GLiNER, zero-shot — the entity list is supplied at inference time. | names, addresses, employers, location |
| **D4** | Visual: YuNet faces, plus a small fine-tuned detector head on our own synthetic set. | faces, signatures, ID cards, QR |

**Union — fail closed.** Boxes dilated **4 px** and merged at **IoU > 0.3**.
**A detector that errors or times out counts as a positive.**

D1 and D2 need no machine learning at all and already cover most structured Indian PII —
which is why they ship first and the pipeline can be built and measured before any model
is integrated.

### Confidentiality classes (configuration, not a policy engine)

| Class | Examples | Treatment |
|---|---|---|
| **CRITICAL** | passwords, OTP, card numbers, private keys | Masked; **never tokenised for server reference**; never re-hydrated without explicit per-use confirmation |
| **SENSITIVE** | Aadhaar, PAN, GSTIN, account numbers, medical text | Masked and tokenised; re-hydrated at execution |
| **PERSONAL** | name, phone, email, address, DOB, photograph, employer, city | Masked and tokenised; re-hydrated at execution |
| **CONFIDENTIAL** | balances, internal document titles, source code, salary figures | Masked and tokenised. Entity list is a JSON config passed to GLiNER at inference time. |
| **PUBLIC** | navigation, headings, button labels, generic body copy | Transmitted unchanged. This is what lets the server reason at all. |

---

## The verifier — FROZEN sequence

```
1 Apply masks     opaque fill, then semantic label
2 Encode          WebP q62, then decode the bytes back
3 Re-read         full-frame OCR, LOW threshold, HIGHER resolution
4 Re-detect       D2 and D3 over recovered text
5 Value check     exact + fuzzy match against vault contents
                  (normalised n-grams, whitespace-insensitive,
                   tolerant of OCR confusions such as 0/O and 1/l)
6 Decide          Clean      -> verified = true
                  Survivor   -> dilate offending region by 12 px, repeat
                  3 failures -> BLOCK
```

Blocked requests fall back to **structure-only mode** — manifest without image — and the
user is told.

The **value-aware residual check** starts from the known secret rather than from a
model's opinion, which is why it catches a survival even when the detector that should
have found it is broken. It runs in the worker and **never logs the value**.

Projected cost of the full verification path: **~40 ms WebGPU, ~95 ms WASM**. Projected,
not measured.

---

## Fail-closed test matrix — every row is an automated test

**The assertion in every case is identical: zero outbound requests.**

### Detector failures
- OCR worker crash
- detector timeout at 200 ms
- GLiNER returns malformed spans
- face detector out of memory
- two detectors disagree on a span

### Pipeline failures
- malformed manifest
- unknown PII class in config
- verifier itself throws
- three consecutive verify failures
- canvas composite fails
- WebP encode returns empty

### Boundary failures
- vault empty at re-hydration
- server returns unknown token
- literal aimed at a redacted field
- literal matching a vault value
- payload hash does not match the pin
- plan fails schema validation
- plan fails freshness check
- action outside allowlist
