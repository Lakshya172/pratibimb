---
id: W1-S05-rate
question: >
  What observable rate/behaviour does tabs.captureVisibleTab exhibit under realistic
  PratiBimb usage, and what failure semantics must the production adapter preserve?
unblocks: S-05 (feasibility matrix), the provisional change-detection constants
date: 2026-09-10
verdict: CONDITIONAL
---

# W1-S05-rate — `captureVisibleTab` rate characterization

> **VERDICT: `CONDITIONAL`.**
> The **`<all_urls>` / MV3-service-worker / Windows** cell is characterized well enough to
> state production failure semantics defensibly. The **`activeTab` cell is NOT MEASURED**,
> and the dossier says capture is rate-limited *"particularly under `activeTab`"* — which is
> precisely the cell left open. That is an important limitation, so this is not `ACCEPT`.

## Environment

| | Chromium | Firefox |
|---|---|---|
| Version | `Chrome/151.0.0.0` (Playwright build 1234) | `Firefox/155.0` |
| Context | MV3 **service worker** | MV2 **background script** |
| Permission | `tabs` + `<all_urls>` | `tabs` + `<all_urls>` |
| Loader | Playwright `launchPersistentContext`, `--load-extension` | `web-ext run` |
| Host | Windows 11 10.0.26200, Node 24.19.0 | same |
| Page under capture | the **QG-02 fixture**, reused | same |

Independent runs: **Chromium ×2**, **Firefox ×1**. Each run repeats the frequency ladder
**3 times**, so each rung has 6 Chromium observations and 3 Firefox observations.

## Method

Bounded schedules only — every count is a constant and nothing adapts upward:

| Schedule | Shape |
|---|---|
| `baseline` | 1 capture, nothing else in flight |
| `low-rate` | 10 captures at 2000 ms (the dossier's realistic-usage cell) |
| `ladder` | rungs at 1, 2, 3, 4, 5, 10 Hz × 12 attempts, 3 s quiet gap between rungs, whole ladder ×3 |
| `burst` | 8 sequential captures, zero delay |
| `recovery` | poll at 250 ms after the burst until first success, ceiling 24 attempts |
| `concurrent` | 5 captures in flight simultaneously |
| `sustained-2hz` | 40 captures at 500 ms (~20 s) |

Every attempt carries a unique id, request/response timestamps, planned **and actual**
interval, elapsed time, and the returned payload is validated as a real PNG with its
dimensions read from the IHDR chunk — so "the call resolved" is never counted as "the
browser produced a usable frame".

## THE FIRST RUN WAS INVALID, AND THE RULE IS WHY

The first Chromium run reported **0% success in every schedule, at every frequency,
including a single isolated capture.** Read as a rate measurement it said *"captureVisibleTab
does not work at any rate"*.

It was wrong. The per-attempt error strings separated it immediately:

```
212 x  "Either the '<all_urls>' or 'activeTab' permission is required."
 92 x  "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota."
```

The harness had scoped `host_permissions` to the fixture origin. **Chrome requires
`<all_urls>` or `activeTab` for `captureVisibleTab`; an origin-scoped host permission is not
enough.** That is **cause E, a permission issue** — not cause A, a browser rate limit.

Had the run been reduced to a success rate, this would have been published as a browser
limit that does not exist. The A–F discrimination is not ceremony; it caught a wrong
conclusion on the first execution.

A side-observation, recorded but not built upon: the quota error appeared **even while the
extension lacked permission to capture**, so the quota is evaluated before authorization.
Observed behaviour; no claim about internals.

## Results — Chromium

Requested rate vs **observed successful captures per second**, per ladder pass:

| Rung | Success rate | Successes/sec (6 passes, 2 runs) |
|---|---|---|
| 1 Hz | **12/12 in all 6 passes** | 0.93 – 1.00 |
| 2 Hz | **12/12 in all 6 passes** | 1.70 – 1.85 |
| 3 Hz | 8–10 / 12 | 1.75 – 1.93 |
| 4 Hz | 6–8 / 12 | 1.77 – 2.12 |
| 5 Hz | 6–7 / 12 | 2.05 – 2.18 |
| 10 Hz | 4–5 / 12 | 1.60 – 2.70 |

`sustained-2hz`: **40/40 successes, both runs**, over ~23 s → ~1.7/s.
`burst` (zero delay): **2/8, both runs.**
`concurrent` (5 at once): **2/5, both runs.**
`recovery`: first success after **1151.9 ms** (run 1) and **1147.9 ms** (run 2).

Only one error string appeared once the permission was correct:

```
Error: This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.
```

## Results — Firefox

**No failure of any kind, in any schedule.** 100% success at 1, 2, 3, 4, 5 and 10 Hz;
`burst` 8/8; `concurrent` 5/5; `sustained-2hz` 40/40; `recovery` succeeded on its first
attempt (19 ms). Throughput scaled with the requested rate — 4.5/s at 5 Hz, up to 8.4/s at
10 Hz — showing no saturation anywhere in the tested envelope.

**This is not "Firefox has no limit".** It is *"no limit was observed at or below 10 Hz with
8-deep bursts and 5-way concurrency"*. A limit above that envelope would not have been seen.

## Characterization

**Safe observed operating envelope (Chromium):** **≤ 2 Hz requested (≥ 500 ms between
requests)**, which yielded 100% success in 6/6 ladder passes and 80/80 sustained captures
across two runs. Effective throughput there is ~1.7 successful captures/sec, because each
capture itself takes ~70–80 ms.

**Onset region:** between **2 Hz (500 ms spacing)** and **3 Hz (333 ms spacing)**. 2 Hz never
failed; 3 Hz failed in every pass of both runs.

**Ceiling:** requesting more does not deliver more. At 10 Hz Chromium still delivered only
~2.6 successes/sec while failing two thirds of calls.

**Burst-based / sustained / stateful?** **Stateful, and consistent with a per-second budget
of about 2.** The evidence: a zero-delay burst yields exactly 2 successes before failing
(twice); 5-way concurrency also yields exactly 2, so concurrency does not bypass it;
recovery takes ~1.15 s, near a one-second window; and a 500 ms cadence sustains
indefinitely (80/80). Previous successful calls therefore **do** affect later calls.

The mechanism is inferred from **observed behaviour plus the browser's own error text**. No
claim is made about Chromium internals, which were not measured.

**Chromium vs Firefox: they differ, materially.** Chromium enforces a hard, reproducible,
self-identifying quota. Firefox showed none within the tested envelope. **Any capture
cadence tuned on Firefox alone would be throttled on Chromium**, and the reverse tuning
merely leaves Firefox headroom unused.

## Cause discrimination — how each was excluded

| Cause | Status |
|---|---|
| **A** API/browser throttling | **CONFIRMED, Chromium only.** The browser names the quota in its own error text. |
| **B** extension/runtime failure | Excluded. The worker kept running and later schedules succeeded. |
| **C** harness timing failure | Excluded. Actual intervals track planned within ~10% at every rung, recorded per attempt. |
| **D** invalid tab/window state | Excluded. The tab was re-read at 4 checkpoints per run: `valid, active, status:"complete", discarded:false` every time, both browsers. |
| **E** permission issue | **Occurred, was identified, was fixed.** See above. Absent from the final runs. |
| **F** unrelated resource pressure | No evidence. Median elapsed stayed ~70–80 ms on successes; failures returned in ~1–2 ms, which is a rejection rather than a stalled operation. |

## Limitations

1. **`activeTab` is NOT MEASURED.** It grants capture only after a user gesture on the
   extension action, which this harness cannot drive. The dossier states capture is
   rate-limited *"particularly under `activeTab`"* — so the cell most likely to be *more*
   restrictive is exactly the one still open. **This alone keeps the verdict `CONDITIONAL`.**
2. **Windows only.** No Linux or macOS cell. Consistent with Firefox-on-Linux remaining
   `UNKNOWN` elsewhere in the project.
3. **Firefox: one run**, versus two for Chromium.
4. **Upper envelope not probed above 10 Hz**, deliberately — the instruction was a bounded
   schedule, not an unbounded stress test.
5. **Not reproducible in CI.** Loading an extension needs a headed browser and the timing is
   machine-sensitive. Recorded as a limitation rather than manufactured as a flaky CI job.

## Reproducing

```bash
node artifacts/experiments/W1-S05rate-capture-limits/harness/run-s05rate.mjs
node artifacts/experiments/W1-S05rate-capture-limits/harness/run-s05rate.mjs --browser=firefox
```

Raw per-attempt records: `results/s05rate-{chromium,firefox}.json`,
plus `results/s05rate-chromium-run1.json` for the second independent Chromium run.
