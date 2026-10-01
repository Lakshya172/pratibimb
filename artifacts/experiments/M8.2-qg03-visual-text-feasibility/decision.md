# Decision — M8.2 QG-03 feasibility for TR-01 and TR-02

| Field | Value |
|---|---|
| **TR-01 `PP-OCRv4_mobile_det`** | **QG-03 PASS → ELIGIBLE FOR ADOPTION REVIEW** |
| **TR-02 `PP-OCRv3_mobile_det`** | **QG-03 FAIL** — Firefox WASM (Linux) is CONDITIONAL: one of six launches never reported |
| **Outcome (owner's brief, Part R)** | **B — one passes.** Recorded as the frozen rules produced it. Neither candidate is selected, integrated or ranked |
| **Protocol** | [`protocol.md`](protocol.md), committed in `b15ebe4` before any recorded measurement; rules in `tests/browser/support/qg03-feasibility.mjs` |
| **Date** | 2026-09-26 (runs 2026-09-25 18:47–19:52Z) |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) only |

## The QG-03 checklist, per candidate

| # | item | TR-01 | TR-02 |
|---|---|---|---|
| 1 | revision pinned in the registry | ✅ `3cc09f3a` | ✅ `58f4e5b1` |
| 2 | licence read at the pinned revision | ✅ Apache-2.0 (M8.1) | ✅ Apache-2.0 (M8.1) |
| 3 | all four cells filled | ✅ | ✅ |
| 4 | each cell records all four values | ✅ | ✅ |
| 5 | **the WASM columns pass** | ✅ Chrome WASM ACCEPT · Firefox WASM (Linux) ACCEPT | ❌ Chrome WASM ACCEPT · **Firefox WASM (Linux) CONDITIONAL** |
| 6a | coexistence verified | ✅ 5/5 | ✅ 5/5 |
| 6b | teardown reclaims memory (S-04 meaning) | ✅ 4/4 | ✅ 4/4 |
| 7 | benchmark artifact under `artifacts/benchmarks/` | ✅ `M8.2-text-region-qg03.json` | ✅ |
| 8 | ADR if a pinned default changed | not triggered by feasibility; **required at adoption** | not triggered |
| | **verdict** | **PASS** | **FAIL** |

| cell | TR-01 | TR-02 |
|---|---|---|
| Chrome WASM | ACCEPT | ACCEPT |
| Chrome WebGPU | ACCEPT | ACCEPT |
| Firefox WebGPU | CONDITIONAL (headless: no GPU adapter at defaults, as the UI head) | CONDITIONAL (same) |
| **Firefox WASM (Linux)** | **ACCEPT** | **CONDITIONAL** (headless 2/3) |
| Firefox WASM (Windows) — supplementary | CONDITIONAL (headful 2/3, same symptom) | ACCEPT |

WebGPU cells must be filled, not passed. QG-03: *"A model that fails them [the WASM columns] is not
shipped whatever it does on WebGPU."*

## The failure, stated precisely — and why the verdict is not changed

TR-02's failing launch showed liveness and never reported. The protocol fixed in advance that *"a
launch that never reports is a failed launch, never a smaller denominator"*. Changing that now,
after seeing whom it affects, would be the retrospective fitting the owner prohibited.

What was learned about it, recorded and deciding nothing:

1. **The symptom is not candidate-specific.** TR-01 hit it in the supplementary Windows cell.
2. **The mechanism is established experimentally.** In Firefox 155.0.1 at release defaults, the
   MV3 event page does not let a probe running past the background idle timeout report. The same
   probe at warm=40 failed **4/4** at defaults and succeeded **4/4** with only
   `extensions.background.idle.timeout` raised, for both candidates
   (`logs/diagnostic-firefox-event-page-lifetime.json`). No completed recorded Firefox probe ran
   longer than 28.0 s.
3. **The harness design exposed it.** One launch ran ~26–28 s of continuous computation with no
   extension event, close to that limit. TR-02's probes take longer than TR-01's, because of a
   larger declared input and ~560 ms against ~470 ms per inference. So its launches sat nearer the
   limit, and they were **not** protected from it.
4. **The failing launch's own cause was not directly observed.** It is consistent with, and
   reproduced by, the mechanism above.

**The same weakness applies to TR-01's PASS.** Its Linux launches ran up to 27.6 s and happened
to complete. Its PASS is valid under the protocol as frozen, but it rests on a harness that was
not robust to this Firefox behaviour. The owner should weigh that as much as TR-02's FAIL.

## A second deviation — Firefox on Windows updated itself

The protocol froze Firefox 155.0.1. **Windows Firefox updated itself to 156.0.1** at
18:50:27Z. The recorded Firefox-Windows launches began at 18:50:05Z, and every one reports
`rv:156.0`. The **Firefox WebGPU** cell, the supplementary Firefox WASM (Windows) cell, and the
Firefox-Windows teardown and coexistence runs are therefore **156.0.1** measurements. The
**Firefox WASM (Linux)** cell ran **155.0.1** as frozen. Nothing was re-run or recomputed because
of it. It is disclosed in `README.md` and `logs/environment.json`.

## What this authorises

- Recording **TR-01** as **`ELIGIBLE FOR ADOPTION REVIEW`** in the registry and the feasibility
  matrix, with the two deviations attached.
- Recording **TR-02** as **QG-03 FAIL** on this run, with its exact reason, in the same places.
- Citing W1's figures for either candidate **as W1 figures**.

## What this does not authorise

- Adoption, `ADOPTED` in the registry, or any product integration. Adoption review is a separate
  owner decision.
- Changes to `TextFinding`, `OCRProvider`, the extension, the manifest, permissions, capture,
  egress, actions, the vault or the privacy boundary.
- Any claim of product visual-only PII protection, full recall or zero leakage.
- Re-running a failed cell, or changing the harness to rescue a verdict, without the owner.

## Owner decisions required next

1. **TR-02's FAIL.** Accept it as recorded, **or** authorise a protocol amendment. An amendment
   would change the harness so no launch approaches the event-page idle limit, for example by
   splitting a launch's work into shorter units. That is harness mechanics, not a threshold. Under
   it, the **Firefox WASM (Linux) cell would be re-run for BOTH candidates** under the same
   amendment. Re-running TR-02 alone would be a rescue.
2. **The Firefox version.** Accept the Windows cells as 156.0.1 evidence, or require a re-run on a
   pinned build with updates disabled. That needs an owner-approved system/browser policy change on
   W1 (Firefox's `DisableAppUpdate` policy), which I have not made.
3. **TR-01 adoption review.** TR-01 is eligible. Adoption would require:
   - the `OCRProvider` ADR (a detector-only producer and a new pinned default);
   - the `TextFinding` fail-closed "unread, therefore sensitive" state;
   - the product post-processing matching the screened DB variant;
   - mask application to pixels;
   - end-to-end revalidation.

   **None has been started.** Knowing TR-01 shares its network with the rejected PP-OCRv5 remains
   part of that review.

## Next milestone

Depends on decision 1:

- **If the amendment is authorised:** **M8.2a**. Re-run the Firefox WASM (Linux) cell for both
  candidates under an amended, pre-registered harness. Every other cell and result stands.
- **If not:** **M9 — adoption review for TR-01.** This is the ADR, not integration.
