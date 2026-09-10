---
id: W1-S05-rate-decision
experiment: W1-S05rate-capture-limits
date: 2026-09-10
verdict: CONDITIONAL
---

# W1-S05-rate — decision

## Hypothesis

`tabs.captureVisibleTab` is rate-limited in a way that constrains the change gate's capture
cadence, and the limit differs between Chromium and Firefox.

## Expected result

Some observable throttling under sustained or bursty capture, with the onset somewhere
above the dossier's budgeted ~8 captures per ten-step task.

## Actual result

**Chromium 151, MV3 service worker, `<all_urls>`, Windows — a hard, reproducible quota.**

| rung | success | successes/sec |
|---|---|---|
| 1 Hz | 12/12 in all 6 passes | 0.93 – 1.00 |
| 2 Hz | 12/12 in all 6 passes | 1.70 – 1.85 |
| 3 Hz | 8–10 / 12 | 1.75 – 1.93 |
| 10 Hz | 4–5 / 12 | 1.60 – 2.70 |

Sustained 500 ms: 40/40 both runs. Burst: 2/8 both runs. Concurrency ×5: 2/5 both runs.
Recovery: 1151.9 ms and 1147.9 ms.

**Firefox 155 — no throttle observed** anywhere in the tested envelope (100% at every rung
through 10 Hz, burst 8/8, concurrent 5/5). Recorded as an absence of observation, not a
proof of absence.

Safe envelope on Chromium: **500 ms between requests**, ~1.7 successful captures/sec. Onset
between 2 Hz and 3 Hz. Ceiling ~2.6/s regardless of how fast it is asked. Behaviour is
stateful and consistent with a per-second budget of about two — mechanism inferred from
observed behaviour plus the browser's own error text, not from internals.

## Verdict

**`CONDITIONAL`.**

The `<all_urls>` / MV3-service-worker / Windows cell is characterized well enough to state
production failure semantics defensibly. **The `activeTab` cell is NOT MEASURED**, and the
dossier says capture is rate-limited *"particularly under `activeTab`"* — so the cell most
likely to be more restrictive is exactly the one still open. That alone prevents `ACCEPT`.

Also unmeasured: Linux, macOS, and any rate above 10 Hz.

## What changed as a result

- `CAPTURE_THROTTLED` became a distinct typed refusal, separate from `CAPTURE_FAILED`.
- `minCaptureIntervalMs` moved 250 ms → 500 ms — the one change-detection constant this
  measurement bounds. The other three remain policy.
- The adapter still contains **no retry, backoff or queueing**. It reports; the refresh
  scheduler decides.

Full write-up and raw per-attempt records: `README.md` and `results/`.
