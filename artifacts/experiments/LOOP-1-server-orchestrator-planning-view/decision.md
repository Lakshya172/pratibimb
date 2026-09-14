# LOOP-1 — verdict

**Date:** 2026-09-14 · **Workstation:** W2 (`LAPTOP-SRCINK2B`) · **Cell:** Chrome for Testing
153.0.8010.12 · **Verdict: PASS** (31/31 checks)

| Criterion | Result |
|---|---|
| Complete loop OBSERVE → … → VERIFY RESULT against a real page | **yes** |
| Payload crossing the reasoner boundary contained no local value | **yes** |
| Plan written in opaque references, validated before anything happened | **yes** |
| One explicit human grant: one-shot, target-, origin- and session-bound | **yes** |
| Value restored locally, by the client, never by the agent | **yes** |
| Exactly one click, through `guardedAct`, E6 mechanism B, at the permitted point | **yes** |
| VERIFY RESULT read back from the page | **CONFIRMED** |
| Literal-echo run refused before rehydration and before any action | **yes** |
| Literal-echo run executed nothing and quoted nothing | **yes** |
| Unit suites: reasoner / plan / orchestrator / agent confirmation | **16 / 60 / 30 / 24** |

## Status of the layers

| | |
|---|---|
| **IMPLEMENTED · EVIDENCED** | reasoner boundary; deterministic planner; plan schema and validation; orchestrator state machine; human grant; rehydration into a real page; guarded click; VERIFY RESULT; Planning View; human-confirmation channel in the permit gate |
| **IMPLEMENTED · NOT EVIDENCED BEYOND W2** | everything above, on any other machine or browser |
| **PROPOSED** | ADR-0005…0008 remain PROPOSED; the confirmation channel extends ADR-0006 §6's tier and needs an owner decision of its own |
| **NOT RUN** | E1, E9, D-E6-4 |
| **DEFERRED** | model integration, loopback model server, streaming, retries, recovery, multi-step loop, routing, Redis, telemetry |
| **DESCOPED for this section** | screen capture, VLM, Qwen3-VL, OCR, GLiNER, detector adoption, face detection, Firefox, TYPE action, production vault, production egress guard |

## What this licenses

- Describing the loop as **implemented and demonstrated on W2**, over one synthetic fixture.
- Replacing the deterministic planner with a small open-weight text model on loopback as a change of
  one `ReasonerClient`, with no change to anything after the boundary.

## What it does not license

- Any claim of a working general browser agent, production proof, general PII recall, non-inferability,
  production vault security, production egress security, Firefox parity, or visual/VLM capability.
- Any claim that a byte left the machine. `transport: "IN_PROCESS"`; INV-01/INV-02 remain SPEC.

## Status unchanged by this run

B-02 OPEN · QG-04 unsigned · detector UNADOPTED · E1 and E9 not run · W-A gate CLOSED · MV3 host
experimental · `EXECUTABLE_ACTIONS` remains `["click"]` and no TYPE action exists · the permit TTL is
still unresolved (every lifetime in this section is an instrument value stated by the caller).

## Owner decisions still open

- **D-ACT-1 / ADR-0006 §6.** The confirmation tier now has a channel. The owner should decide whether
  an unforgeable, one-shot, target-bound `HumanConfirmation` is the right shape for it, and whether
  the name-pattern screen stays PROPOSED.
- **Permit, confirmation and grant lifetimes.** Three TTLs are now stated by callers with no
  measurement behind any of them.
- **D-C / D-D** (the tier policy) remain as PRIV-0 left them.
- Whether `validatePlan` refusing *all* literals — including ones the three checks allow — is the
  right V1 policy, or whether a literal-insertion contract should exist.
