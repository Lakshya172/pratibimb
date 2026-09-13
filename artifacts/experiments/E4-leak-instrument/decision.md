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
