# Decision — M1 observation leg

| Field | Value |
|---|---|
| **Verdict** | **PASS** — 11 of 11 checks |
| **Status** | **EXPERIMENTALLY VERIFIED** on W1. Not PROVEN. |
| **Date** | 2026-09-22 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Cell** | Chrome for Testing 153.0.8010.12, headed, extension loaded |
| **Evidence** | `logs/w1-cft153-extension-observation.json` |

## What this authorises

Proceeding with the remaining M1 legs **on the existing transport and the existing element graph**,
rather than designing a new representation for the extension. The graph the core realm receives is
the graph the orchestrator already consumes, with identical CSS-pixel geometry.

## What this does not authorise

- Any claim that the product loop runs in the extension. It does not.
- Any claim about reliability, latency or a second browser. One run, one fixture, one cell.
- Any relaxation of the remaining M1 exit criteria.

## Open, and deliberately so

The three legs that carry authority — the orchestrator and the privacy layer in the offscreen
document, the human grant, and egress from the extension context — are untouched. The architectural
question they raise is recorded rather than answered here: **the rehydrated value has to reach the
page, and the transport contract has no field for a value by design.** E6 already measured the
mechanism that answers it (a single-use nonce armed for one attested tab, frame and document, with
the value pulled by the content script and never routed through the service worker), but adopting it
for the product is a decision for the M1 implementation, not an inference from this run.
