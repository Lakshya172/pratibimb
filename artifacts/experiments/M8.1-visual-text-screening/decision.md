# Decision — M8.1 visual-text candidate screening

| Field | Value |
|---|---|
| **TR-01 `PP-OCRv4_mobile_det`** | **ELIGIBLE FOR QG-03 / ADOPTION REVIEW** |
| **TR-02 `PP-OCRv3_mobile_det`** | **ELIGIBLE FOR QG-03 / ADOPTION REVIEW** |
| **Relationship between the two** | **none asserted.** Each verdict is independent; this record does not rank them, pick one, or call either preferable |
| **Status** | screening **COMPLETE** · adoption **not decided** · integration **not started** |
| **Date** | 2026-09-25 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Owner authority** | D1 (candidates), D2 (measurement-only tooling), D3 (artifact policy) — Ronit Saha, 2026-09-25 |

## The owner's acceptance list (Part P), applied mechanically

Applied by `screeningVerdict` (committed in `1d74537`, before any run) to the cross-run records
`results/tr-0N-verdict.json`.

| # | requirement | TR-01 | TR-02 |
|---|---|---|---|
| 1 | provenance and licence verified | ✅ pinned revision, LFS + git-blob hashes, Apache-2.0 at the revision | ✅ same |
| 2 | reproducible artifact | ✅ `18aaccf9…`, identical ×4 | ✅ `322c3e63…`, identical ×4 |
| 3 | realistic-input WASM ≤ 2e-2 (QG-03 text-region cell) | ✅ 6.52e-07 | ✅ 6.87e-07 |
| 4 | every RE-1 gate on the held-out set | ✅ | ✅ |
| 5 | deterministic | ✅ within and across two complete runs | ✅ |
| 6 | no plaintext-capable output | ✅ | ✅ |
| 7 | runtime compatible | ✅ ORT Web 1.29.0 `wasm`, pinned binary, every input | ✅ |
| 8 | no unresolved security boundary conflict | ✅ evaluation infrastructure only; see audit | ✅ |
| — | development screen did not reject | ✅ | ✅ |

## Side-by-side — a technical comparison, not a ranking (Part I)

Each row states a fact about each candidate. The rows are not weighted, summed or scored, and no
row is decisive on its own. "Difference" states what differs, not which side is better.

| dimension | TR-01 `PP-OCRv4_mobile_det` | TR-02 `PP-OCRv3_mobile_det` | difference |
|---|---|---|---|
| provenance | official PaddlePaddle org, `3cc09f3a` | official PaddlePaddle org, `58f4e5b1` | none in kind |
| licence | Apache-2.0, card at revision | Apache-2.0, card at revision | none |
| network definition | **identical to rejected PP-OCRv5_mobile_det's** (`inference.json` `05feef1a…`), different weights | its own (`26c59bd5…`) | TR-01 shares a graph with a model rejected under the old criterion; TR-02 does not |
| artifact size | 4 766 440 B | 2 436 135 B | TR-02 about half |
| conversion complexity | one call, opset 16, 925 nodes | one call, opset 16, 663 nodes | same procedure |
| declared input on a 720×1280 frame | 640×1024 (`resize_long 960`, stride 128) | 736×1312 (upstream defaults, `limit_side_len 736`, stride 32) | TR-02 feeds 1.47× the pixels |
| WASM correctness, QG-03 cell | 6.52e-07 | 6.87e-07 | both about four orders of magnitude inside the bound |
| WASM correctness, worst realistic | 4.08e-06 | 1.10e-05 | both inside |
| synthetic diagnostic | 1.04e-01 (saturated tail) | degenerate (all-zero) | neither decides anything |
| G1 exposed | 0 / 306 | 0 / 306 | none |
| G1 smallest glyph margin (diagnostic) | 4.34 px | 2.47 px | TR-01 boxes sit further out |
| G2 over-mask, worst image | 0.376 | 0.175 | TR-02 boxes are tighter |
| G3 largest box | 0.046 | 0.045 | none of consequence |
| G4 | byte-identical | byte-identical | none |
| G5 | 7 / 7 | 7 / 7 | none |
| G6 | float map, numeric boxes | float map, numeric boxes | none |
| dev screen | 0 / 23, over-mask 0.298 | 0 / 23, over-mask 0.065 | as G1/G2 |
| session load (W1) | 966–1060 ms | 890–958 ms | similar |
| inference p50, dev frame (W1) | 490–506 ms fast mode; **2 084 ms in one run** | 564–582 ms | TR-01 is **bimodal with no cause established**; TR-02 showed no slow mode in 3 runs |
| WASM memory after load / inference | 27.8 / 119.6 MB | 19.3 / 152.2 MB | TR-02 higher after inference (larger input) |
| output semantics | one float32 `[1,1,H,W]` probability map → boxes by geometry | same | none |
| integration complexity | same DB post-processing, same preprocessing family, same `TextFinding` and `OCRProvider` preconditions | same, different resize rule | a resize rule |

The G1 margin and G2 over-mask rows describe **one trade-off seen from two sides**. Looser boxes
leave more room around glyphs and hide more background. Tighter boxes do the opposite. RE-1 has
already judged both within its limits; this record does not re-judge them.

## What this authorises

- Recording both candidates as **`ELIGIBLE FOR QG-03 / ADOPTION REVIEW`** in the model registry
  and experiment record.
- Citing, **for W1 and this set only**, the measured WASM agreement, RE-1 results, determinism and
  cost above.

## What this does not authorise

- Adoption, a registry status of `ADOPTED`, or any product integration. Nothing enters the build
  before QG-03 is completed and the owner decides (model-adoption steps 4–9).
- Treating a passed WASM cell as QG-03 passed. QG-03 still needs all four feasibility cells (Chrome
  WebGPU, Chrome WASM, Firefox WebGPU, Firefox WASM on Linux), coexistence with the resident
  sessions, teardown, and a benchmark artifact under `artifacts/benchmarks/`.
- Any change to `TextFinding`, `OCRProvider`, the extension, the manifest, permissions, capture,
  egress, actions or the privacy boundary.
- Loading any recognition model, now or as a consequence of this result.
- Any statement about PP-OCRv5_mobile_det. TR-01 shares its graph, and that fact is recorded. PP-OCRv5
  was not run, scored or used as a control, and its `REJECTED FOR V1` stands.

## Security audit

| check | result |
|---|---|
| product source (`apps/`, `packages/*/src`) | **unchanged** |
| `package.json`, lockfile, dependencies | **unchanged** |
| extension bundle | **unchanged** (built; no model, no new entry) |
| permissions, capture, egress, actions | **unchanged** |
| weights or ONNX in Git | **none** — `models/` is git-ignored |
| recognition model downloaded or loaded | **none** |
| plaintext in evidence | **none** — every sensitive held-out string and the dev fixture's strings were searched for; the only numeric hit was a digit run inside a float coordinate |
| raw images in evidence | **none** — screenshots live in git-ignored `models/`; only their hashes are recorded |

Realm split, unchanged: service worker = control plane · perception = pixel owner · content privacy
= secret owner · reasoner = untrusted · egress = single authority.

## Remaining preconditions before integration

1. **QG-03 in full**, per candidate taken forward. Its benchmark must control for TR-01's bimodal
   timing (for example, repeated sessions and a recorded power and scheduling state) before any
   latency figure is quoted.
2. **The `TextFinding` seam — PRECONDITION FOR CANDIDATE INTEGRATION.** It needs a region-only,
   "unread, therefore sensitive" state that cannot be read as safe. It changes only after a
   candidate is selected.
3. **An ADR** for `OCRProvider`: the frozen interface is *"text + boxes out"* and its pinned
   default is PP-OCRv5-mobile. A detector-only producer and a new default both need one.
4. **Post-processing in product code**, as screened. The component-based DB variant is part of what
   was measured, and integration must use it or be re-screened.
5. **Mask application to pixels** — no product path applies the canonical mask yet.
6. **Generality:** the held-out set is synthetic Latin-script canvas text on one machine's fonts,
   at DPR 1. Other scripts, rotations, photographs and DPRs are untested.

## Next owner decision

**Which of TR-01 and TR-02, one or both, to take into QG-03 in full.** Each is eligible on its own
evidence, and this record does not choose. Owner inputs that bear on it:

- TR-01 shares its graph with the rejected PP-OCRv5;
- TR-01's timing on W1 is bimodal with no known cause;
- TR-02 feeds 1.47× the pixels and ends with the higher WASM memory;
- the two sit at different points on one geometry trade-off (margin against over-mask).

QG-03 needs a Firefox/Linux WASM cell and WebGPU cells, which in turn need a Firefox environment
this workstation may not provide. That is part of the next decision too.

## Next milestone

**M8.2 — QG-03 feasibility for the owner-selected text-region candidate(s).** It covers the four
feasibility cells, coexistence with the UI head and YuNet, teardown, and a benchmark artifact with
controlled timing. It excludes integration, the `TextFinding` change and the ADR, which follow only
if QG-03 passes and the owner decides on adoption.
