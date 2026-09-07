# Redaction Manifest Contract — v1.1

> **FROZEN.** Source: dossier v4.0 section 9.
> The brief requires the server to be aware of the redaction scheme, so the scheme is a
> **versioned contract**, not an implementation detail.

---

## Governing rules

1. The manifest **legend is injected into the server system prompt**.
2. The **TypeScript types are generated from the same Pydantic models the server
   validates against**. There is exactly one source of truth, and it lives on the server.
3. Bumping `manifest_version` is an ADR-level change.
4. All `bbox` values are **CSS viewport pixels** (`docs/architecture/coordinate-contract.md`).

---

## Schema v1.1 — client to server

```json
{
  "manifest_version": "1.1",
  "capture": {
    "w": 1024, "h": 640, "format": "webp", "q": 62,
    "dpr": 2.0, "zoom": 1.0, "scale_to_css": 0.5,
    "scroll": { "x": 0, "y": 480 },
    "origin": "https://seva.gov.in"
  },
  "capability": { "backend": "webgpu", "tiers_fired": ["T0","T1","T2"] },
  "redactions": [
    { "token": "<PII:PHONE:1>", "class": "PHONE", "tier": "PERSONAL",
      "bbox": [412, 308, 196, 22], "method": "opaque_fill+label",
      "confidence": 0.99, "detectors": ["D1","D2"],
      "hint": { "len": 10, "kind": "numeric", "field_role": "tel" } }
  ],
  "elements": [
    { "id": "e12", "role": "textbox", "name": "Phone",
      "bbox": [400, 260, 300, 32], "source": "dom+vision",
      "visible": true, "enabled": true },
    { "id": "e31", "role": "button", "name": "Submit",
      "bbox": [400, 1180, 120, 40], "source": "dom",
      "visible": false, "offscreen": true }
  ],
  "verified": true,
  "goal": "Complete the application form"
}
```

---

## Field obligations

| Block | Obligation |
|---|---|
| `capture` | Carries the **entire coordinate contract**: `dpr`, `zoom`, `scale_to_css`, `scroll`, `origin`. Never omit a field because it happens to be 1.0 on the dev machine. |
| `capability` | Carries the **live backend** and the tiers that fired. This is what the ledger displays and what the panel is invited to read. |
| `redactions[]` | Each span carries **class, token, box, method, confidence, length and representation hint**, and the field role where useful. `detectors` records provenance — which channels fired. |
| `redactions[].hint` | **This is the mechanism that makes the design work.** It preserves the *type* while destroying the *content*: ten characters, numeric, field role `tel`. The server can still reason about field validation and layout. |
| `elements[]` | `source` is one of `dom`, `vision`, `dom+vision`. Off-screen elements are included with `visible: false, offscreen: true` and **no pixel evidence**. |
| `verified` | Set by the privacy verifier. **The egress guard refuses to transmit unless this is `true`** and the payload hash matches the pin. |
| `goal` | The **user's** stated goal. Never page-derived text. |

---

## Token format

```
<PII:CLASS:N>
```

- `CLASS` is the detected class (PHONE, AADHAAR, PAN, EMAIL, NAME, ADDRESS, DOB, ...).
- `N` is a per-session, per-class ordinal.
- The same token string appears **in the manifest and rendered in small type over the
  opaque fill in the pixels**, which measurably helps the VLM associate a field with its
  type and label.
- **CRITICAL-class values are masked but never tokenised for server reference.**

Faces use the form `FACE:N`.

---

## Indian identifier validators (D2)

Format matching alone flags every twelve-digit order number as an Aadhaar. **The checksum
is what makes precision defensible, and precision is a fifth of the score.**

| Identifier | Pattern | Validation that earns the precision |
|---|---|---|
| Aadhaar | `\d{4}\s?\d{4}\s?\d{4}` | **Verhoeff checksum** over all twelve digits |
| PAN | `[A-Z]{5}\d{4}[A-Z]` | Fourth character must be a valid holder-type code. **Note: PAN's final character is a check digit whose algorithm is not public, so this is format plus structure, not a checksum — do not oversell it.** |
| IFSC | `[A-Z]{4}0[A-Z0-9]{6}` | Fifth character is always zero; bank-code table lookup |
| UPI VPA | `[\w.\-]{2,}@[a-z]{2,}` | Handle allowlist — okaxis, ybl, paytm, upi |
| Mobile | `(\+91[-\s]?)?[6-9]\d{9}` | Leading digit constrained to 6–9 |
| Payment card | 13–19 digits | **Luhn checksum** plus issuer range |
| GSTIN | `\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]` | State-code table, embedded PAN check, and the **mod-36 check digit** over the first fourteen characters |
| Vehicle registration | `[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}` | State and RTO code tables |
