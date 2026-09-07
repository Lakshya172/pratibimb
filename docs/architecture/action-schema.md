# Action Schema and Safety Contract — PratiBimb

> **FROZEN.** Source: dossier v4.0 sections 8 and 9.
> The server returns a **plan, not code**. Its output is constrained at generation time by
> guided decoding, validated by Pydantic before it leaves the server, and validated again
> by the client before it touches the page.
> **The client never trusts the server**, because page content reaches the server's
> context and a compromised plan must not become a compromised browser.

---

## Permitted actions — the allowlist

```
click
type          (value_ref, or a cleared literal)
scroll
select
wait
zoom_request
confirm
done
```

## Never in the schema

```
execute_javascript, eval
shell commands
download-and-run
navigation to model-supplied URLs
a literal aimed at a redacted field
a literal matching a vault value
```

## Requires human confirmation

```
submit, purchase, delete
send a message
anything touching authentication
navigation to a new origin
re-hydrating a CRITICAL-class value
```

### `zoom_request`

Rather than always transmitting a large image, the server may ask for a
higher-resolution crop of a specific region. **Progressive disclosure lowers latency and
reduces the sanitized surface area at the same time.** Worth defending in the viva.

---

## The `type` action — dual mode

> **A functional defect in v3.0.** v3.0 permitted `type` to carry a `value_ref` and
> nothing else. That is airtight and unusable. *Search for Chandrayaan-3. Select Punjab.
> Enter 2026.* Most of what a browser agent types is not secret, and a schema that cannot
> express a non-sensitive literal cannot drive a browser.

The action carries **exactly one of two fields**, and the client decides which was
legitimate.

| Field | When the server must use it | What the client checks before typing |
|---|---|---|
| `value_ref` | Whenever the target element carries a redaction token in the manifest | **Token is known to the vault.** Unknown tokens abort — a 4B model under guided decoding will occasionally emit `<PII:PHONE:2>` when only `:1` exists, and **the client never guesses which was meant**. |
| `value_literal` | For any field with **no** redaction token: search boxes, dropdowns, dates, free text | **Three checks, below. All three must pass.** |

### The three checks on a literal

1. **Target check.** If the target element's manifest record carries a redaction token, a
   literal is **rejected outright, whatever it contains**. A sensitive field is filled by
   reference or not at all.
2. **Shape check.** The literal is run through D1, D2 and D3. Anything PII-shaped is
   rejected and **logged as a server defect** — the server should have used a reference,
   and the fact that it did not is worth measuring.
3. **Vault check.** The literal is compared, **exactly and fuzzily**, against every value
   the vault holds. **A match is not a defect. It is a leak.** The server has reproduced a
   secret it was never sent, which means something upstream failed. The session halts, the
   ledger records it, and the run counts as a **residual-leakage failure**.

> The distinction in check three matters more than it looks. A PII-shaped literal the
> server invented is a bug in the plan. A literal that matches the vault is evidence that
> redaction failed somewhere earlier in the pipeline, and **the two must never be logged
> as the same event**.

### One consequence, for the viva

**Permitting literals does not open an exfiltration path. Typing is not sending.**
Submission, purchase and messaging remain behind the human confirmation tier, and
navigation remains behind the origin policy — so a hostile page that persuades the agent
to type something still cannot get that text off the machine.

---

## Re-hydration — the signature mechanism

```
1  Detected on screen
   +91 98765 43210 - found by D1 (autocomplete=tel) and D2 (pattern) independently

2  Stored and tokenised in the vault
   <PII:PHONE:1> -> "9876543210"
   RAM only, worker scope, destroyed on tab change

3  The token crosses; the value does not
   manifest: class PHONE, bbox, hint { len 10, kind numeric }, field role "tel"

4  The server plans in placeholders
   { action: "type", target: "e12", value_ref: "<PII:PHONE:1>" }   -- never a literal

5  Client validates
   allowlist ok  ·  token known to vault ok  ·  no literal in value field ok
   ·  target still fresh ok

6  Restored locally, then typed
   9876543210 enters the field. The server never saw a digit.
```

**Obfuscate the value; preserve the type.** That distinction is what separates a redaction
that breaks the task from one that does not.

---

## Origin and navigation policy

The client tracks the current origin and records it in the manifest. **Arbitrary
model-supplied URLs stay outside the grammar entirely.**

A navigation that would change origin — **including one triggered by clicking a link the
model chose** — pauses for human confirmation showing the destination.

```
1  Crossing proposed     by a plan, or by the page itself
2  Destination shown     full target origin and the reason, in the side panel
3  Human confirms        declining ends the task rather than silently continuing
4  Vault destroyed       unconditionally, before the navigation commits
5  Fresh session         the new origin is observed from scratch; any value it needs
                         must be present and detected there
```

Real workflows do cross origins — a services portal handing off to a payments host is
ordinary, not suspicious — so **the policy permits the crossing and refuses only the
carry-over**.

> **Rehearsal rule:** no demonstration sequence may depend on a value surviving an origin
> change. A run that quietly relies on carry-over will work in practice until the policy
> fires in front of the panel, which is the worst possible moment to discover it.

---

## Action freshness — pipeline stage 8

Before executing, the client re-checks:

- the target element **still exists**;
- its **role and accessible name still match** what was reported to the server;
- it is **visible and enabled**;
- its **bounding box has not moved beyond a tolerance**.

A failed freshness check **does not guess** — it discards the plan, re-observes, and
issues a new request. This is cheap (single-digit milliseconds) and it closes the window
in which a page can swap a benign control for a harmful one after the screenshot but
before the click.
