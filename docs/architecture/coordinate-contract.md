# Coordinate Contract — PratiBimb

> **FROZEN.** Source: dossier v4.0 section 7.
> 25% of the score is grounding accuracy, and the commonest way to lose it is silently:
> everything works at DPR 1.0 on the development laptop and falls apart on a HiDPI
> judging machine at 125% zoom.

---

## The rule

**One canonical space is defined and every component converts at its edge.**

**Canonical space: CSS viewport pixels.** Origin at viewport top-left.

---

## The four spaces

| Space | Used by | Conversion rule |
|---|---|---|
| **CSS viewport pixels — canonical** | Manifest, action plans, ledger | Origin at viewport top-left. **All manifest boxes and all returned action coordinates are in this space, always.** |
| **Device pixels** | `tabs.captureVisibleTab` output | Divide by `devicePixelRatio` on capture. Recorded in the manifest `capture` block. |
| **Capture pixels** | The downscaled frame sent to the server | Uniform scale factor recorded in the manifest. The server may reply in either capture or CSS space; **the field is explicit and the client converts**. |
| **Document pixels** | Off-screen elements known from the DOM | Offset by scroll position. **Never sent as an action target without a preceding scroll.** |

---

## The CI test that must exist before the executor is written

> A CI test renders a fixture at **DPR 1.0, 1.5 and 2.0** and at **100% and 125% zoom**,
> and asserts that the same logical element resolves to the **same CSS-pixel box in all
> six configurations**.

**This test exists before the executor is written.** It is gate QG-02.

---

## Content below the fold

Capture is **viewport-only**, so on a long form the agent cannot see most of the fields.

The DOM extractor therefore reports off-screen elements as **known but uncaptured**:
role, accessible name and document-space geometry, with **no pixel evidence and no vision
cross-check**. The manifest marks them `visible: false, offscreen: true`.

The server can plan a `scroll` toward a named field it has never seen, and the next
observation confirms it.

> Without this, a multi-field form silently caps the agent at whatever fits on one screen
> — which is exactly the demo the panel will ask us to run.

---

## Fusion threshold

The fused element graph matches DOM elements to vision-detected boxes at **IoU > 0.5**.

- **DOM-matched:** actioned by selector, robust to reflow.
- **Vision-only:** actioned by coordinate, synthetic id.
- **Disagreement above threshold:** flags an overlay — see `docs/security/threat-model.md` A2.
