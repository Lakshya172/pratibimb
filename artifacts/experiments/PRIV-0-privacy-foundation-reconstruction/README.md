# PRIV-0 — the reconstructed privacy foundation, and its first real-browser smoke

> **Reconstruction evidence, produced on W2 on 2026-09-14. Not historical Phase 0 evidence.**
>
> The Phase 0 commit `c68b6a26ffdfbe3c7b50bda6edcaa5986fe48d78` and the branch
> `feature/privacy-firewall-foundation` are **not present in reachable history** — not on the
> canonical remote (GitHub: *"No commit found for SHA"*), not on the fork, not in any local ref, and
> not in either clone on this machine. Nothing was recovered. `packages/privacy` was written fresh
> from the repository's frozen contracts and from E2, and everything recorded here is evidence about
> that new code.

- **Date:** 2026-09-14 · **Workstation:** **W2** (`LAPTOP-SRCINK2B`, AMD Ryzen AI 7 350, Windows 11
  10.0.26200) · **Node** v26.4.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headless, `C:\Users\OMEN\cft\chrome.exe`, launched
  by Playwright with `chromium.launch({ headless: true, executablePath })`. **No extension is loaded.**
- **GPU:** not used by this run, and therefore not recorded as evidence.
- **Log:** [`logs/w2-cft153-smoke.json`](logs/w2-cft153-smoke.json) · **Verdict:** [`decision.md`](decision.md)

## Hypothesis

The reconstructed privacy layer can take a real observation of a real page — one served from
loopback, read through a browser, containing a name, a mobile number, an Aadhaar number, a date of
birth and an OTP — and produce a verified representation that contains **none of those values**,
while keeping them locally so a later stage could still use them.

**What would falsify it:** any of the five values, exactly or normalised, appearing in the serialized
handoff or the ledger entry; the OTP receiving a reference; or the sanitizer failing to verify.

## Environment

| | |
|---|---|
| Fixture | [`tests/browser/privacy/fixture/application.html`](../../../tests/browser/privacy/fixture/application.html), served from `http://127.0.0.1:8971` by the runner |
| Runner | [`tests/browser/privacy/run-privacy-smoke.mjs`](../../../tests/browser/privacy/run-privacy-smoke.mjs) |
| Code under test | the **built** packages (`packages/*/dist`), so the run exercises what would ship |
| Values | synthetic (SECURITY.md §2), and named here by class rather than written out: a two-word person name, a ten-digit Indian mobile number, a Verhoeff-valid Aadhaar number, an ISO date of birth, a six-digit OTP. They live in the fixture and the test support module; this record does not restate them |
| Not present | no extension, no planner, no orchestrator, no click, no rehydration, no network client |

## Expected result

1. The fixture loads and carries the seven elements the demo needs.
2. The Aadhaar value on the page passes the Verhoeff checksum, and the checksum-invalid variant does
   not appear anywhere in the fixture file.
3. `sanitize()` returns a verified handoff.
4. NAME, PHONE, AADHAAR and DOB are tokenised; the OTP is masked and receives **no** reference.
5. The vault holds four values locally.
6. Neither the serialized handoff nor the ledger entry contains any of the values, checked exactly
   and under normalisation.

## Actual result

**PASS**, recorded 2026-09-14T09:49:28Z. Every check above returned true. (First recorded
2026-09-14T06:36:10Z; re-run unchanged after the security review, which touched only tests and
documentation. The payload digest differs between runs because the handoff carries the run's own
timestamp and session id — the log is the current run's.)

| Check | Result |
|---|---|
| Fixture loads, status reads "Not submitted" | **yes** |
| Seven required elements present | **yes** |
| Aadhaar on the page is checksum-valid | **yes** |
| Checksum-invalid variant absent from the fixture file | **yes** |
| Verified handoff produced (and recognised by `isVerifiedHandoff`) | **yes** |
| Classes tokenised | **AADHAAR, DOB, NAME, PHONE** |
| OTP masked with no reference | **yes** |
| Values held locally in the vault | **4** |
| Secret in handoff or ledger, exact or normalised | **none** |
| `sanitize()` duration | ~1 ms (single sample, not a benchmark) |

**One thing the run caught in its own fixture.** The first attempt failed on
`checksumInvalidVectorAbsentFromFixture`: an HTML comment explained the negative vector by quoting
it, which is exactly the kind of accidental appearance the check exists for. The comment was rewritten
to describe it without writing it; the check was not weakened.

### Mutation check — do the guards carry weight?

`node tools/mutation/privacy-core.mjs` disables one enforcement at a time and runs the suite:
**12 mutations, 12 killed, 0 survivors.**

| | |
|---|---|
| Killed | literal-echo check, protection ranking, verifier provenance, forged `verified` flag, value-aware residual scan, OTP tokenisation refused at issuance, session check, origin check, consumed-reference check, per-use human grant, element-name scrubbing, class match |

**P09 was reported as a layered survivor on 2026-09-14 and that was wrong.** The first campaign
recorded it as equivalent defence in depth, on the grounds that removing the binder's `CONSUMED`
check still leaves `rehydrate` refusing when the vault's own `consume()` returns `false`. The
security review revisited it and found the binder's guard to be independently meaningful, for three
reasons:

1. **`bind()` is a question, not a spend.** It is exported so a caller can ask "may this reference go
   into this field?" without consuming anything, and the next section's plan validation and Planning
   View are precisely such callers. The vault's guard only fires on the way to a value, so it cannot
   answer for the binder.
2. **The cause stops being evidence.** Without the check, a spent SENSITIVE reference falls through to
   `NEEDS_HUMAN_GRANT` — the system would raise a consent panel for a value it could never release.
3. **A replay could burn a human grant.** `rehydrate` marks the grant used before calling `consume()`,
   so a mutated binder lets a replayed reference spend a one-shot human decision and return a refusal.

The fix was three focused tests that exercise the binder's own consumed-state invariant directly
(`packages/privacy/test/bind.test.ts`, "a spent reference is refused by the binder itself"). **No
source behaviour changed** — the guard was already correct; nothing had been asking it the question.
P09's `layered` annotation has been removed from the mutation script, so any future survival of it
counts as an unexpected survivor and fails the run.

## Conclusion

On W2, in Chrome for Testing 153.0.8010.12, the reconstructed privacy layer sanitized a real page's
real values into a verified representation that contained none of them, kept them locally, and refused
the OTP a reference. The guards are not decorative: every one of the twelve mutations was caught.

**What this does not establish:** anything about a complete agent loop (there is no planner,
orchestrator, grant UI or click here); anything about network egress (there is no client, so the
ledger records intent); general PII recall or non-inferability; production vault security; any other
browser, machine or page. It is W2 evidence about one synthetic fixture.

## Reproducibility

```bash
npm run typecheck
CHROME_PATH="C:\Users\OMEN\cft\chrome.exe" node tests/browser/privacy/run-privacy-smoke.mjs
```

Deterministic: fixed fixture, fixed port, fixed viewport, no network beyond loopback, no model, no
detector. The runner refuses rather than guessing if `CHROME_PATH` is unset, and records the browser
version it actually used.
