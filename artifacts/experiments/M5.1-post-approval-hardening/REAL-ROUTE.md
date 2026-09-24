# M5.1 — the real-route regression, after the hardening

> **HUMAN-IN-THE-LOOP.** Three operator clicks, one per act, on the **product build**. Re-run after
> the lifecycle and document-binding changes to confirm they did not close a door that should be
> open. Log: [`logs/w1-cft153-gesture-acts.json`](logs/w1-cft153-gesture-acts.json).

**`routeCategory: REAL_GESTURE_STREAM` · PASS, 29 of 29.**

| Act | State | Verify | Capture | Det | Rel | Write | Click | Authorised after |
|---|---|---|---|---|---|---|---|---|
| **SUCCESS** | `DONE` | **CONFIRMED** | 1280×720 `live-bitmap` | 98 | 1 | 1 | **1** | 5 137 ms |
| **REFUSAL** | `REFUSED` | — | 1280×720 `live-bitmap` | 98 | **0** | **0** | **0** | 16 415 ms |
| **OUTAGE** | `DONE` | **CONFIRMED** | 1280×720 `live-bitmap` | 98 | 1 | 1 | **1** | 46 780 ms |

REFUSAL stopped at `VALIDATE_PLAN` **before a human was asked** and did not fall back. OUTAGE fell
back deterministically after a real transport failure.

```
worker: 103 messages · 83 152 bytes · fixture values 0
        PNG signature false · data:image false · longest base64 run 0
```

Per-pass timings, every capture `live-bitmap` with `encode: 0`:

| act | capture | preprocess | inference | fusion | total |
|---|---|---|---|---|---|
| SUCCESS | 104 ms | 43 ms | 91 ms | 1 ms | **240 ms** |
| REFUSAL | 113 ms | 27 ms | 54 ms | 1 ms | **195 ms** |
| OUTAGE | 61 ms | 75 ms | 52 ms | 0 ms | **188 ms** |

## What this run cost a person

Waits for the click: **5 s, 16 s, 47 s**. An earlier attempt of the same run **timed out at 420 s**
because the window opened before the operator was asked, and had to be relaunched — recorded because
it is the honest shape of this evidence. Every real-route number in this repository costs somebody's
attention, which is why there are three acts of it and not thirty.

## What it is not

One operator, one machine, one browser cell, one synthetic fixture, three clicks. It establishes
that the approved route carries the whole loop and that the worker sees no pixels while it does. It
establishes nothing about reliability, other viewport sizes, other displays, or any page that is not
the fixture. **EXPERIMENTALLY VERIFIED** is the whole of the claim.
