# E4 — verdict

**Date:** 2026-09-13 · **Workstation:** W2 · **Verdict: PASS on attempt 2** (attempt 1 FAILED; both kept)

| Criterion | Attempt 1 (`e4-scanner-1`) | Attempt 2 (`e4-scanner-2`) |
|---|---|---|
| In-scope positives detected, own class only | 1,700 / 1,800 — **FAIL** | **1,800 / 1,800** |
| False positives | 0 / 480 | **0 / 480** |
| Empty-canary detections | 0 | **0** |
| Arrival and SHA-256 integrity | 2,520 / 2,520 | **2,520 / 2,520** |
| Blind spots confirmed undetected | 240 / 240 | **240 / 240** |

## What the PASS licenses

The instrument may measure product egress, **only**:
- byte-identical, checked by SHA-256
- with its blind spots stated
- with a live sentinel leak in every run
- after re-validation in the cell of use (the MV3 offscreen document)

## What it does not license

- Any statement about PratiBimb's privacy. No product component was involved.
- Any statement about browser-originated egress. This cell is Node → loopback.

## Standing rule

A scanner change needs a new `SCANNER_VERSION`, a fresh seed block and a full E4 re-run. No earlier
PASS carries over to changed code.

## Instrument identity — correction recorded 2026-09-13

The attempt-2 log records `scannerSha256 = feeb1be894ae91c8da9071920609ee6379a3b5a94b5df432a8abe55084c3d606`.
That is the SHA-256 of the scanner **as it sat in the working tree with CRLF line endings** at run
time. The committed file is stored with LF endings, and its SHA-256 is
`96979ebde6774f734fa14e4ae94dcabc33c962358874e850148cdccb0f0b6fab`.

**Verified:** the run-time scanner, LF-normalised, is byte-identical to the committed blob. So the
code that passed is the code that is committed; only the line endings differ. The collector's logged
hash (`1ff60ed52539d6be…`) was already over LF bytes and equals the committed blob.

**The instrument's identity is therefore `96979ebde6774f73…` (LF-normalised)**, and the runner now
computes identity that way. The log is not rewritten.

**Correction to commit `c497aee`:** its message states that the PASS log's scanner hash "was computed
on an LF file and equals the LF-normalised hash of the committed scanner, verified". **That is
false.** The check run at the time printed `False`, and the commit went in regardless. The facts are
as above. History is not rewritten; this record supersedes that sentence.

Reproduce the check:

```bash
python -c "import hashlib,subprocess;b=subprocess.run(['git','show','HEAD:artifacts/experiments/E4-leak-instrument/harness/scanner.mjs'],capture_output=True).stdout;print(hashlib.sha256(b).hexdigest())"
```

## Runner defect — recorded 2026-09-13

**`harness/run-e4.mjs` did not parse from `c497aee` until this repair.** `c497aee` meant to add the
LF-normalised identity helper described above. It wrote the helper with **literal line breaks inside
the regular expression** (`replace(/⏎/g, "⏎")`), which is a syntax error. So the sentence above,
*"the runner now computes identity that way"*, was never true of an executable runner: from `c497aee`
onward the runner could not run at all, on any machine. Found on W2 during the W1 → W2 bootstrap
(`docs/handoff/w2-bootstrap/2026-09-13-bootstrap.md`, D-1).

| | |
|---|---|
| Revision that produced the attempt-2 PASS log | `b027fc54fad51511153689b347bb77bc053a3691`. It hashes raw working-tree bytes, which is why the log records the CRLF scanner hash `feeb1be8…` |
| Defective revision | `c497aee22b7f50eac1317d0a3d7f9fb68eaf5eee` |
| Repair | the one helper line restored to its documented intent, `replace(/\r\n/g, "\n")`. Runner blob SHA-256 `9d065bd7faf628004212ce50e5c3bb5fd145a99c86a5fd5aa255f6cb7630af68` |
| What differs from `b027fc5` | only the identity helper: two raw-byte hash lines become `lf(...)` over LF-normalised text |
| What is byte-identical to `b027fc5` | canary generation, variants, controls, blind-spot probes, transports, request construction, matching, scanning, totals and the pass criterion |
| Scanner / collector | unchanged: `96979ebd…` / `1ff60ed5…` (LF-normalised) |
| Verification on W2 (`LAPTOP-SRCINK2B`), outside the repository | the repaired runner was executed from a copy, so the committed log is not overwritten. It reproduced `totals`, `blindSpotSummary`, `design`, `passCriterion` and all 10 per-run records **exactly** (JSON equality), and logged `scannerSha256 = 96979ebd…`, the LF identity this record states |
| Regression guard | `packages/security/test/e4Runner.test.ts` |

**The attempt-2 PASS stands, as what it was:** a result produced by `b027fc5`'s runner over the
committed scanner and collector. The log is not rewritten and no new PASS is recorded. Re-running
the repaired runner writes a log whose `scannerSha256` is the LF identity rather than the raw hash;
that is the expected and only difference.

The E4-offscreen re-validation (`artifacts/experiments/E4-offscreen-revalidation/`) loaded `b027fc5`'s
code from the git blob and is unaffected by this repair.
