---
id: AUDIT-0005
title: "MVP readiness — which stages of the agent loop have implementations"
status: recorded
date: 2026-09-12
label: FACT (repository contents) / INFERENCE (assessment)
---

# AUDIT-0005 — can the PratiBimb loop be demonstrated end to end today?

## Question

The product loop is **OBSERVE → PERCEIVE → SANITIZE → VERIFY → REASON → PLAN → VALIDATE →
REFRESH → RE-HYDRATE → ACT → VERIFY RESULT**. An MVP demonstration requires all eleven.
**Which of them exist as code?**

## Answer

**Two.** The loop cannot be demonstrated end to end, and the gap is not a wiring problem.

| # | stage | implementation | evidence |
|---|---|---|---|
| 1 | **OBSERVE** | **PARTIAL** | `packages/perception/src/capture.ts` is an adapter over `tabs.captureVisibleTab` — but **there is no extension to host it**: no `manifest.json` exists anywhere in the repository, and `apps/extension/` contains a `package.json` and one file, `entrypoints/ortRuntime.ts`. A local harness can screenshot through Playwright instead, which is what MVP-0 does |
| 2 | **PERCEIVE** | **YES** | `elementGraph.ts` (DOM), `uiDetectorHead.ts` + `detector.ts` + `preprocess.ts` + `coordinates.ts` (vision), `fusion.ts` (IoU 0.5 join), `changeDetection.ts`, `observation.ts`, `perceptionState.ts` |
| 3 | **SANITIZE** | **NO** | no D1/D2/D3/D4 detector, no redaction engine, no opaque fill. `grep -ril pii packages/*/src` → **1** file, and it is a comment |
| 4 | **VERIFY** | **NO** | the frozen verifier sequence (apply masks → encode WebP q62 → decode → re-read by OCR → compare) has **no implementation**; `grep -ril verifier` → 1 file, a comment |
| 5 | **REASON** | **NO** | no server, no client. Blocked independently by **B-03 — no vLLM host** |
| 6 | **PLAN** | **NO** | `docs/architecture/action-schema.md` specifies the grammar; nothing implements it |
| 7 | **VALIDATE** | **NO** | no allowlist check, no target check, no vault check, no schema validator (INV-08…INV-13, INV-15…INV-19 are all **SPEC**) |
| 8 | **REFRESH** | **NO** | freshness validation (INV-14) is **SPEC**. `fusion.ts` has `assertSameFrame`, which refuses a cross-frame fuse — related, but not freshness against a live page |
| 9 | **RE-HYDRATE** | **NO** | **no vault.** `grep -ril vault packages/*/src` → **0**. INV-04/05/06/07 are **SPEC** |
| 10 | **ACT** | **NO** | no executor, no action dispatch |
| 11 | **VERIFY RESULT** | **NO** | nothing to verify against |

Supporting facts: all **25 security invariants** in `docs/security/security-invariants.md` carry
status **SPEC**, not IMPLEMENTED. **QG-04 is unsigned. B-02 is open.** There are three packages —
`perception`, `evaluation`, `security` — and `security` contains the CSP constants, the ORT
runtime pin and the WASM capability check, not the privacy firewall.

## What this means for an MVP demonstration

**INFERENCE.** The instruction to *"reuse existing contracts"* and *"not invent a second privacy
system"* cannot be satisfied for stages 3–11, because for those stages there is **no first
system to reuse** — only specifications. Building them to demonstrate the loop would mean
writing, in one unreviewed pass: a vault, four PII detectors, a redaction engine, the
differential verifier, an egress module, an action validator, an executor and a server.

That is not a minimal demonstration; it is the product. And it is the **worst** candidate for a
fast unreviewed pass, because it is exactly the part the submission's entire claim rests on. A
hand-rolled vault and egress path, written in a session and labelled "MVP privacy firewall",
would be indistinguishable to a judge from the real thing and would not be the real thing. The
honest position is that the privacy firewall is **unbuilt**, not **undemonstrated**.

## What can be demonstrated honestly today

Stages 1–2, on a locally hosted page, plus whether perceived coordinates are good enough to act
on. That is `artifacts/experiments/MVP-0-dom-sufficiency/`, and it is labelled as perception
evidence rather than task evidence throughout.

## Recommended build order, smallest first

Each step is independently reviewable and none of them needs real data or a server.

| order | stage | why here |
|---|---|---|
| 1 | **VALIDATE + REFRESH** | pure functions over an element graph and an action object. No network, no model, no secrets. Makes every later stage safe to test, and it is where the "re-observe rather than guess" rule lives |
| 2 | **ACT** | a small executor behind the frozen action grammar. Needs 1 to be safe |
| 3 | **RE-HYDRATE (vault)** | memory-only, INV-04/05/06. Small, and it is a hard prerequisite for any privacy claim |
| 4 | **SANITIZE (D1 + D2 only)** | D1 (DOM semantics) and D2 (pattern + checksum) need **no model at all** — the dossier says so explicitly — so the first real privacy demonstration does not wait on T2 |
| 5 | **VERIFY** | the differential verifier; needs 4 |
| 6 | **REASON** | last, and blocked on B-03 anyway. A **recorded stub plan** can stand in for the server in a demo without faking a reasoning capability, provided it is labelled a stub |

**Step 1 is the smallest thing that moves the product**, and it is the only one whose absence
currently makes every other stage untestable.

## What this audit does not do

It implements nothing, changes no production code, and does not lower any invariant. It makes no
claim about detector adoption (**UNADOPTED**), V1 (**experimental**), or the W-A collection gate
(**CLOSED**).
