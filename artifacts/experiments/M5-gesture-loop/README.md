# M5 — the whole loop on frames a person authorised

> **W1 evidence, 2026-09-24. HUMAN-IN-THE-LOOP.** M4 verified that a real toolbar click could turn
> into an `ImageBitmap` in the perception realm, and left the product loop running on the degraded
> route. **All three acts now run on the real gesture stream** — 29 of 29 — with
> `routeCategory: REAL_GESTURE_STREAM` in the record.
>
> **And the second of every pass is gone.** M4 re-encoded each stream frame to PNG so a type field
> would be truthful; that cost **1040 ms of a 1252 ms pass** and the bytes were audited and found to
> have no consumer at all. A frame now says where it came from, and one that was never compressed
> is not compressed. **1252 ms → 155–221 ms.**
>
> **No text model was adopted.** The repository contains exactly one text-region candidate and it
> fails this repository's own frozen WASM criterion. See [`text-region-audit.md`](text-region-audit.md).

- **Workstation:** **W1** (`LAPTOP-6E14K34L`, Intel Core 7 240H, 16 cores, Windows 11 10.0.26200) ·
  **Node** v24.19.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headed, `--load-extension` · GPU not used
- **Runner:** [`run-gesture-acts.mjs`](../../../tests/browser/extension/run-gesture-acts.mjs) (new,
  **human-in-the-loop**, 29 checks)
- **Log:** [`logs/w1-cft153-gesture-acts.json`](logs/w1-cft153-gesture-acts.json)
- **Audit:** [`text-region-audit.md`](text-region-audit.md) · **Verdict:** [`decision.md`](decision.md)
- **Process:** [`ADR-0009`](../../../docs/adr/ADR-0009-gesture-authorised-capture.md) — **PROPOSED**,
  recording that the product path no longer uses the frozen stack's capture mechanism

## Hypothesis

That the gesture route could carry the *whole* product loop and not merely a capture; and that the
encode could be removed on evidence rather than on the wish to remove it.

**What would falsify it:** any act silently taking the degraded route; a pixel or a value in the
worker; an encoded frame surviving on the stream path; a consumer of `CaptureFrame.pixels` found
after the fact; a text model adopted past a frozen rule.

## Expected result

1. Every capture on every act reports `GESTURE_STREAM`, authorised by a person.
2. No frame is encoded anywhere: `encode: 0`, `format: "live-bitmap"`.
3. SUCCESS one release, one write, one click; REFUSAL all zero, no fallback; OUTAGE falls back and
   still ends `DONE`/`CONFIRMED` with one of each.
4. The worker's own recording contains no fixture value and no pixels.
5. The text tier reports its absence rather than returning no findings.

## Environment

| | |
|---|---|
| Build | **product**: `activeTab`, `host_permissions: ["http://127.0.0.1/*"]`, **0** `captureVisibleTab` calls. The harness reads the built manifest and worker and refuses to start on any other |
| Invocation | **a person clicked the toolbar action once per act.** Chrome revokes `activeTab` on navigation and each act starts with a fresh document, so each act was authorised separately |
| Page | the demo's `application.html` fixture, **unchanged** |
| Reasoner | Qwen2.5-0.5B behind a loopback front at the manifest's one pinned `connect-src` origin |
| Text tier | **none adopted.** `TEXT_PERCEPTION_UNAVAILABLE` on every pass |

## Actual result

### The three acts, `REAL_GESTURE_STREAM`: **PASS, 29 of 29**

| Act | State | Verify | Capture | Detections | Released | Wrote | Clicked | Authorised after |
|---|---|---|---|---|---|---|---|---|
| **SUCCESS** | `DONE` | **CONFIRMED** | 1280×720 `live-bitmap` | 98 | 1 | 1 | **1** (5 raw events) | 115 003 ms |
| **REFUSAL** | `REFUSED` | — | 1280×720 `live-bitmap` | 98 | **0** | **0** | **0** | 22 598 ms |
| **OUTAGE** | `DONE` | **CONFIRMED** | 1280×720 `live-bitmap` | 98 | 1 | 1 | **1** | 17 968 ms |

REFUSAL stopped at `VALIDATE_PLAN` **before a human was asked**, and did not fall back. OUTAGE fell
back deterministically after a real transport failure and reached the same ending.

```
worker: 103 messages · 82 848 bytes · fixture values 0
        PNG signature false · data:image false · longest base64 run 0
```

### The encode, removed on an audit rather than a hunch

**Exactly one place in the package reads `CaptureFrame.pixels`** outside the adapter that writes
them — `frameHash` — and `ChangeGate`/`frameHash` are exported and called by **nothing** in the
product. In the extension the detector preprocesses the decoded RGBA the realm already holds.

So `CaptureFrame` now carries `source: "encoded" | "live"`, and a frame that was never compressed is
not compressed to populate a field.

| stage | M4 gesture | **M5 gesture** |
|---|---|---|
| capture | 133 ms | 98–128 ms |
| decode | 0 | 0 |
| **encode** | **1 040 ms** | **0** |
| preprocess | 24 ms | 21–80 ms |
| inference | 54 ms | 33–63 ms |
| fusion | — | 0–1 ms |
| **total** | **1 252 ms** | **155–221 ms** |

Seven passes across three acts, every one `encode: 0`. `encode` is kept as a field, always zero, so
a regression that reintroduces one is visible in the record rather than only in a total.

**This is not a weakening of ADR-0002.** That ADR governs the format `captureVisibleTab` requests
and accepts, because the browser's default is JPEG. A stream frame is never compressed, so there is
no default to fall into and no format to declare. Where an encoded frame still arrives — the
degraded route — PNG-explicit is unchanged.

### A grant belongs to a document, not a tab number

Chrome revokes `activeTab` on navigation. The authority now mirrors that, so a reload produces
`NO_ACTIVE_TAB_GRANT` — the true reason — instead of minting and collecting a `MINT_FAILED` from
Chrome three layers from it. Three tests.

### The text-region audit: **NOT YET IMPLEMENTABLE WITH APPROVED LOCAL ARTIFACTS**

Full reasoning in [`text-region-audit.md`](text-region-audit.md). The tree was searched for every
name the capability could hide under — EAST, DBNet, CRAFT, scene text, text localisation, character
boxes, existing pinned artifacts — and **every hit was prose**. One candidate exists:
`PP-OCRv5_mobile_det @0d63e78e`, Apache-2.0 verified at the revision, which locates text without
reading it and would therefore need no vault and produce no string.

It **fails the S-04a-1 correctness criterion on WASM** (4.12e-02 against a 2e-02 bound fixed before
that run), and `model-adoption.md` blocking rule 2 is FROZEN: *a model that fails the WASM columns
is not shipped, whatever it does on WebGPU.* Nothing was downloaded, nothing was selected, no
threshold was moved, and no provenance type was added for a producer that does not exist.

**The architecture is right and the model is the only missing piece.** M4's seam — `TextFinding`: a
box, a count, a class, and no field for characters — is the interface it would plug into unchanged.

### The two bodies of evidence stay apart

| | route | verdict |
|---|---|---|
| Automated regression | `DEGRADED_TEST_ROUTE` | 72/72, unchanged, its own record |
| **Product cell** | **`REAL_GESTURE_STREAM`** | **29/29, this record** |

They are not combined into one number and each names its route in its own verdict line.

## Conclusion

| | |
|---|---|
| **ARCHITECTURAL INVARIANT** | no `captureVisibleTab` in a product bundle; no grant means refusal, not a quieter frame; a live frame is never encoded; `TextFinding` cannot carry a string |
| **EXPERIMENTALLY VERIFIED (HUMAN-IN-THE-LOOP)** | the complete three-act loop on the real gesture stream, 29/29, product build, three real clicks |
| **EXPERIMENTALLY VERIFIED** | the encode removal, audited to zero consumers and measured across seven passes |
| **CONDITIONAL / EXPERIMENTAL** | every detector number |
| **NOT YET VERIFIED** | any local text perception; the visual-only canvas identifier remains unread and unprotected |

**Not claimed:** perfect PII detection, perfect OCR, zero leakage in general, broad visual
understanding, production readiness.

## Reproducibility

```bash
npm run build -w @pratibimb/extension    # product build — the harness refuses any other
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-gesture-acts.mjs
#   … then click the extension's toolbar button once per act, when prompted.
```
