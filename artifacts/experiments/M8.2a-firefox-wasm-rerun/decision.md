# Decision — M8.2a Firefox WASM (Linux) re-run

| Field | Value |
|---|---|
| **TR-01 `PP-OCRv4_mobile_det` — Firefox WASM (Linux)** | **ACCEPT** (6/6) — unchanged from M8.2 |
| **TR-02 `PP-OCRv3_mobile_det` — Firefox WASM (Linux)** | **ACCEPT** (6/6) — M8.2 recorded CONDITIONAL (5/6) |
| **QG-03, re-interpreted with only that cell replaced** | **TR-01 PASS · TR-02 PASS** (M8.2: PASS · FAIL) |
| **Status** | both **ELIGIBLE FOR ADOPTION REVIEW**, independently. No ranking, no selection, no adoption |
| **Protocol** | [`protocol.md`](protocol.md), committed in `1cc058f` before any M8.2a launch |
| **Date / workstation** | 2026-09-30 · W1 only |

## How the verdict was reached — mechanically

- The cell uses M8.2's `modeVerdict` and `cellVerdict` on 3 headful + 3 headless amended launches
  per candidate.
- QG-03 uses `qg03Verdict` with **every other input taken from M8.2's recorded verdict**: the other
  three cells, coexistence, teardown, benchmark artifact, pin and licence. Only the Firefox WASM
  (Linux) cell is replaced.
- No threshold, statistic, gate, RE-1 criterion or held-out file was touched.

## Why TR-02's change is not a rescue

1. **The confound is established, not assumed.** In M8.2's A/B, over-30 s probes reported 0/4 at
   defaults and 4/4 with the idle limit raised, for both candidates.
2. **The amendment is exactly that variable.** The running profiles differ by one pref and nothing
   else (V2b). The web-ext args differ by one `--pref`. Model, fixture, runtime, probe, bound and
   launch count are unchanged.
3. **It was applied to both candidates**, and TR-01's ACCEPT was allowed to change.
4. **It changed no computation.** Every amended output and box equals M8.1's and M8.2's, byte for
   byte.
5. **The confound shows up inside the formal re-run.** One TR-02 launch ran 36.3 s. At the default
   limit, that launch could not have reported.

So M8.2's single silent TR-02 launch was the harness, not the model. **For adoption review, the
clean M8.2a cell supersedes it.** M8.2's record is not edited.

## What this authorises

- Recording, in the registry and the feasibility matrix, a pointer from M8.2's Firefox WASM (Linux)
  cell to this result. It changes TR-02's standing for adoption review from QG-03 FAIL to QG-03
  PASS; TR-01's is unchanged.
- Treating both candidates as **eligible for adoption review**.

## What this does not authorise

- Adoption of either candidate, or an adoption-log entry.
- Any product change: `OCRProvider`, `TextFinding`, mask application, the extension, permissions,
  capture, egress, actions, the vault or the privacy boundary.
- Any claim of product visual-only PII protection, full recall or zero leakage.
- Re-opening any other M8.2 cell. The Windows Firefox 156.0.1 deviation still stands as M8.2
  recorded it.

## Remaining limitations

- **Linux is WSL2 on W1**, not a separate Linux machine.
- **Firefox WebGPU stays CONDITIONAL** for both candidates (no GPU adapter headless at defaults);
  the gate requires that cell to be filled, not passed.
- **Timing here characterises 6 launches per candidate only**; M8.2's controlled benchmark remains
  the timing of record, and the cause of M8.1's TR-01 slow mode is still unknown.
- **The held-out set** is synthetic Latin-script canvas text on one machine's fonts.
- **Product relevance of the idle limit:** a Firefox build of the product runs perception in an
  event page. One ~0.6 s inference per request is far from the limit, but whether any product path
  could approach it is **not yet verified**.
- **Visual-only PII protection in the product: NOT YET VERIFIED.**

## Next owner decision

**Adoption review: which of TR-01 and TR-02 (one, both, or neither) to take into M9.** M9 is the
`OCRProvider` ADR (a detector-only producer and a new pinned default), before any integration.
Both candidates are eligible on their own evidence, and this record does not choose between them.
The facts already recorded that bear on it:

- TR-01 shares its network definition with the rejected PP-OCRv5;
- TR-02 feeds 1.47× the pixels and ends with the higher WASM arena (152.4 MB against 131.1 MB);
- the two sit at different points on the margin-against-over-mask trade-off;
- TR-02's probes run nearer Firefox's event-page limit.

**Nothing further is started until that decision.**
