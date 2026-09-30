# M9 — `TextFinding` fail-closed semantics (Part C)

## The hazard, measured in the source

`apps/extension/host-lib/text-perception.ts` defines:

```ts
export interface TextFinding {
  readonly box: { x; y; w; h };
  readonly length: number;             // "How many characters were recognised"
  readonly piiClass: TextClass | null; // "…or null for 'not sensitive by its rules'"
  readonly ref: string | null;
}
```

A detector-only producer knows **neither** field's truth. `length` counts recognised characters, and
it recognises none. For `piiClass`, there are two "neutral-looking" values, and **both are unsafe**:

| value a detector might be tempted to report | what the existing system already takes it to mean | source |
|---|---|---|
| `piiClass: null` | "read, and not sensitive by its rules" | `text-perception.ts` |
| `piiClass: "UNKNOWN"` | tier **`PUBLIC`**, *"Transmitted unchanged"* | `packages/privacy/src/classes.ts` (`UNKNOWN: "PUBLIC"`) · `security-invariants.md`, confidentiality classes |

So *detector region → null or UNKNOWN → safe* is reachable through **two** existing values. The
design must make **both** unrepresentable for a detector-only finding. Guarding only against `null`
would leave the second path open.

## The minimum fail-closed representation

A discriminated union on `kind`. The reader shape is preserved exactly, and a new unread shape
carries **no class at all**:

```ts
type TextFinding =
  | {                               // detector-only: the ONLY shape TR-01 / TR-02 may produce
      readonly kind: "UNREAD_REGION";
      readonly box: CssBox;         // CSS viewport px (INV-24)
      readonly score: number;       // the detector's own score; gates nothing (RE-1 §3)
      readonly regionId: string;    // the visual-only region it lies in
      readonly treatment: "REDACT_UNREAD";   // constant; not a variable a producer can choose
    }
  | {                               // a reading producer — the existing shape, unchanged; none is adopted
      readonly kind: "READ_TEXT";
      readonly box: CssBox;
      readonly length: number;
      readonly piiClass: TextClass | null;
      readonly ref: string | null;
    };
```

What each of the owner's three required cases maps to:

| required distinction | representation |
|---|---|
| 1. known non-sensitive text, *if the system genuinely knows it* | `READ_TEXT` with `piiClass: null` or a PUBLIC class. **Only a reading producer can create it.** No reading producer is adopted, so in v1 this case **never occurs** |
| 2. known sensitive text, from a trusted local recogniser | `READ_TEXT` with a non-PUBLIC `piiClass`. Also **never occurs in v1** |
| 3. unread / detector-only region | `UNREAD_REGION` — **protective by construction**: no field exists in which it could be declared safe |

## Behaviour

| concern | rule |
|---|---|
| **policy evaluation** | `mustRedact(UNREAD_REGION) = true`, **always**, whatever the score. `mustRedact(READ_TEXT) = piiClass ≠ null ∧ tier(piiClass) ≠ PUBLIC` (the existing reader semantics, untouched). `mustRedact(anything else) = true` |
| **redaction** | per visual-only region: `redactionMask(boxes of its UNREAD_REGIONs, region.rect)`, then opaque fill (the frozen method; never blur). The canonical geometry is unchanged |
| **serialization** | JSON with `kind` required. A parser **refuses** a missing or unknown `kind`, any key outside the variant's allowlist (so `text`, `transcript`, `piiClass` on an unread region, and `label` are all refused), non-finite or non-positive geometry, a treatment other than `REDACT_UNREAD`, and a `regionId` not in the frame |
| **failure** | one refused finding makes the **whole** report unusable, so **every** visual-only region is masked whole with `failClosedMask`. The same happens on tier `ERROR`, `TIMEOUT` or `UNAVAILABLE` (INV-23). A malformed report never degrades to "use the findings that parsed" |
| **what crosses the realm boundary** | only geometry and codes (box, score, region id, kind, treatment). This is the same class of value `PerceptionSummary` already carries. No string, and no pixel |
| **the limitation, unchanged** | an `OK` report with **no** finding in a region masks nothing there. A detector that runs cleanly and **misses** text is not caught by this mechanism. That is the stated v1 limitation (`visual-only-text-policy.md`), and no recall claim is made |

## Tests — executed against the reference model (14 passing)

`tests/browser/support/m9-text-region-contract.test.mjs` against
`contract/text-region-contract.mjs`:

- UNREAD_REGION's key set excludes `text`, `chars`, `value`, `transcript`, `length`, `piiClass` and
  `ref`, and it is always redacted, even at score 0.01.
- `piiClass: null` **and** `piiClass: "UNKNOWN"` on an unread region are both refused. A smuggled
  string under four different names is refused.
- Non-finite or zero-size boxes, an empty region id and a non-`REDACT_UNREAD` treatment are refused.
- READ_TEXT keeps the reader semantics, and the test pins that `classes.ts` really maps
  `UNKNOWN → PUBLIC`, so the hazard it guards against stays true to the source.
- A missing or unknown kind is protective.
- `planRedaction` uses `redactionMask` exactly; masks every region whole on `ERROR`, `TIMEOUT`,
  `UNAVAILABLE`, no report, one malformed finding, or an unknown region; and **does not** mask on a
  clean miss (the documented limitation, tested so it is never mistaken for a guarantee).

**The integration milestone must port these cases onto the product type**, and add compile-time
checks the reference model cannot make: `@ts-expect-error` on constructing `UNREAD_REGION` with
`piiClass`, and exhaustive `switch` on `kind`. **Weakening any case is not permitted.**
