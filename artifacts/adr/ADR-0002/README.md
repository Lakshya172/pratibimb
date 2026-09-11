# ADR-0002 — evidence and verification record

Decision: [`docs/adr/ADR-0002-t1-capture-format-policy.md`](../../../docs/adr/ADR-0002-t1-capture-format-policy.md)
(QG-03b-2c, T1 capture format policy, **PROPOSED**).
Review: [`agentos-review.md`](agentos-review.md).

## What this record is

A policy decision **does not need a new experiment**, and none was run. Every performance,
size and sensitivity figure in ADR-0002 is quoted from merged evidence:

- [`W1-QG03b2-capture-format-conformance`](../../experiments/W1-QG03b2-capture-format-conformance/README.md)
- [`W1-QG03b2a-chromium-jpeg-capture`](../../experiments/W1-QG03b2a-chromium-jpeg-capture/README.md)
- [`W1-S05rate-capture-limits`](../../experiments/W1-S05rate-capture-limits/README.md)

All three were measured on **workstation 1**. This record contains only the verification of
the code change, run on **workstation 2**.

## Environment of the verification

| | |
|---|---|
| Machine | workstation 2, `LAPTOP-SRCINK2B` (ENV-0002), AMD Ryzen AI 7 350 |
| OS | Windows 11 Home Single Language 10.0.26200 |
| Node / npm | 26.4.0 / 11.17.0 (CI uses Node 22) |
| Base | `main` = `0aad4f00973b3ab56ae7c1fd9187e3feaa6f73e7`, fresh clone, `npm ci` |
| Browsers | **none used.** The tests are unit tests against a measured browser model. |

## Targeted policy tests — `packages/perception/test/capturePolicy.test.ts`

```
npx vitest run packages/perception/test/capturePolicy.test.ts packages/perception/test/capture.test.ts \
  packages/perception/test/realCaptureConformance.test.ts packages/perception/test/captureThrottle.test.ts

 ✓ packages/perception/test/capturePolicy.test.ts (10 tests)
 ✓ packages/perception/test/capture.test.ts (12 tests)
 ✓ packages/perception/test/captureThrottle.test.ts (16 tests)
 ✓ packages/perception/test/realCaptureConformance.test.ts (43 tests)
 Test Files  4 passed (4)
      Tests  81 passed (81)
```

## Negative controls — the guards can fail

Each mutation was applied to `packages/perception/src/capture.ts`, run, and reverted. The
file was confirmed byte-identical afterwards: sha256
`12a5b89afc69f6dbb9eee9ba95dde1b0ac2ca2689727050aa22b5e0b95708d28` before and after.

| # | Mutation | Result |
|---|---|---|
| M1 | `if (decoded.format !== T1_CAPTURE_FORMAT)` → `if (false)`, i.e. accept any decoded format | **1 failed / 9 passed.** Caught by "REFUSES a JPEG returned for a PNG request" |
| M2 | `captureVisibleTab({ format: "png" })` → `captureVisibleTab()`, i.e. rely on the default | **6 failed / 4 passed** |
| M3 | MIME/signature agreement check → `if (false)` | **3 failed / 7 passed** |
| M4 | `format: T1CaptureFormat` → `"png" \| "jpeg" \| "webp"` | **`tsc` exit 2**: `capturePolicy.test.ts(218,5)` and `(220,5)`, `error TS2578: Unused '@ts-expect-error' directive` |

## Full repository verification

`npm run verify` runs verify-repo, then the ORT pin check, then the typecheck, then the full
unit suite. Run on workstation 2 against the final tree, exit 0:

```
PratiBimb repository verification
0 failure(s), 0 warning(s)
RESULT: PASS
ORT PIN: OK  ort-wasm-simd-threaded.jsep.wasm  db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea
> tsc -b --force                                   (no errors)
 ✓ packages/perception/test/capturePolicy.test.ts (10 tests)
 Test Files  27 passed (27)
      Tests  542 passed | 15 skipped (557)
```

Against the base `0aad4f0` (532 passed, 15 skipped, 547 total), the difference is **exactly the
10 new policy tests**. No existing test changed status, and the 15 skips are the same
fixture-dependent byte-level preprocessing stages as before.
