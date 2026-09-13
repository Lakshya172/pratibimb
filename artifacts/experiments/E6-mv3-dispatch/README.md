# E6 — what can a real MV3 extension type and click, without `chrome.debugger`?

> **TYPE: GO.**
> - From the content script, a value reaches a plain input and a **React 18 controlled input**; React's
>   state updates and survives a re-render.
> - The value is released by the offscreen document only to the exact browser-attested document it was
>   armed for.
> - **`execCommand('insertText')` behaves most like a user:** a *trusted* input event, focus moved,
>   `maxlength` honoured.
> - A hostile page's prototype patches never saw the value.
>
> **CLICK: PARTIAL.**
> - Every content-script click is **untrusted**, so a page that checks `isTrusted` ignores it.
> - **Element dispatch (`el.click()`) goes straight through an overlay**, while dispatching at the point
>   lands on the overlay. Only point dispatch keeps the hit test meaningful.
>
> **`chrome.debugger` (mechanism C) was not run.** Its only use case left is `isTrusted`-checking pages,
> and that needs an owner decision.

- **Date:** 2026-09-13 · **Workstation:** W2 (`LAPTOP-SRCINK2B`) · **Cells:** Chrome for Testing
  153.0.8010.12 and branded Edge 153.0.4234.32, headful, the Track G host
- **Pre-registered:** matrix and predictions at `3111459`, before the mechanisms existed; unchanged when run
- **Log:** [`logs/e6.json`](logs/e6.json) · **Verdict:** [`decision.md`](decision.md)

## Hypothesis

A content script can perform TYPE and CLICK well enough for the demo without `chrome.debugger`, and a
value can stay on the trusted side until the moment of insertion.

## Environment

- **Host:** Track G's minimal MV3 extension (`apps/extension`), rebuilt by the harness with
  `host-lib/e6-mechanisms.ts`. That module is **experiment code**, not the production TYPE subsystem.
- **Value path:**
  1. the service worker arms a single-use nonce for the latest `(tabId, frameId, documentId)` it has seen;
  2. the content script redeems it with the offscreen document;
  3. the offscreen document releases the synthetic canary only if the **browser-reported** tab, frame
     and `documentId` match, unexpired, once;
  4. the content script reports **booleans and timings only, never the value**.
- **Fixtures** (served from 127.0.0.1, each with a main-world event logger as independent witness):
  - `F1` plain `tel`
  - `F2` React 18.3.1 controlled input (UMD builds fetched with `npm pack`, not committed; SHA-256 in the log)
  - `F3` `maxlength=5`
  - `F5` a hostile page patching `HTMLInputElement.prototype.value`, `Document.prototype.execCommand` and `setRangeText`
  - `K1` plain button
  - `F4` button counting only trusted clicks
  - `K2` button under a transparent click-counting overlay
- **Design:** 3 TYPE mechanisms × 4 fixtures + 2 CLICK mechanisms × 3 fixtures, × 10 runs × 2 cells =
  360 page loads, plus 6 stale-document release tests.

## Expected result

Pre-registered predictions per combination in `harness/cases.mjs`.

## Actual result

Every combination gave the same result in all 10 runs and in both cells.
**All 36 (mechanism, fixture, cell) groups matched their pre-registered prediction**, checked
programmatically against the log.

### TYPE

| Mechanism | Plain `tel` | React controlled (state · after re-render) | `maxlength=5` | Hostile patches saw a value | Events the page saw | Focus moved |
|---|---|---|---|---|---|---|
| **A** native setter + `input`/`change` | 10/10 | 10/10 · 10/10 | **not truncated** (length 10) | **0/10** | `input change`, untrusted | no |
| **B1** `execCommand('insertText')` | 10/10 | 10/10 · 10/10 | **truncated to 5** | **0/10** | **`input` `isTrusted: true`, `inputType: insertText`** | **yes** |
| **B2** `setRangeText` + `InputEvent` | 10/10 | 10/10 · 10/10 | **not truncated** | **0/10** | `input(insertText)`, untrusted | no |

- **The page reading the field after insertion:** 10/10 on the hostile fixture, for every mechanism.
  That is inherent: a page receives what is typed into it, which is inside the stated scope limit.
- **Timings (p50):** value fetch from the offscreen document 0.5–0.8 ms; insertion 0.2–2.7 ms.
- **Stale-document release:** a nonce armed for one document, redeemed after a reload replaced it, was
  **refused `SENDER_DOCUMENT_MISMATCH` in 6 of 6**, and the field stayed empty.

### CLICK

| Mechanism | Plain button | Button counting only `isTrusted` | Button under a transparent overlay | Trusted click events |
|---|---|---|---|---|
| **A** `el.click()` | effect 10/10 | **no effect 0/10** | **target clicked 10/10, overlay 0**: went *through* the overlay | 0 |
| **B** pointer/mouse sequence at `elementFromPoint(centre)` | effect 10/10 | **no effect 0/10** | **overlay received it 10/10, target 0** | 0 |

## Conclusion

1. **TYPE is feasible in V1 without extra permissions**, including a React-controlled input.
   - **B1 (`execCommand('insertText')`)** is the only mechanism that produces a trusted input event,
     moves focus and honours `maxlength`. That last point matters: a truncated value is visible to a
     `VALUE_MATCHES_REF` check.
   - **A and B2** write values no user could have typed into a `maxlength` field.
   - **Risk to state:** `execCommand` is deprecated. It works in both cells today; that is all this shows.
2. **The value can stay on the trusted side until insertion.** The offscreen document releases it only
   to the browser-attested document it was armed for, a reload invalidates the release, and page
   prototype patches cannot intercept the isolated world's calls.
3. **CLICK is PARTIAL.** Every extension click is untrusted. Pages that ignore untrusted clicks cannot be
   driven without `chrome.debugger`.
4. **The permit's dispatch binding must be point-based, not element-based.** `el.click()` ignored an
   overlay that the point dispatch correctly hit. Element dispatch would make HIT-TEST agreement
   meaningless, because the check would be about the point while the click would not be. This settles
   ADR-0008 §6's deferred question for the extension transport, **on this evidence and in these cells**.
5. **The prior Playwright-based ACT evidence does not transfer unchanged.** MVP-1 (W2) and MVP-2 (W1)
   used trusted CDP input. The extension's clicks are untrusted, and its typing is only partly trusted.

**Not established:** Firefox · branded Chrome loaded by hand (automation cannot load unpacked extensions
there) · frameworks other than React 18 · `contenteditable` fields · IME and composition · file inputs ·
real sites · anything about `chrome.debugger`.

## Reproducibility

```bash
npm ci
# React 18.3.1 UMD, outside the repository:
npm pack react@18.3.1 react-dom@18.3.1   # extract umd/*.production.min.js into <dir>
CHROME_PATH="<chrome for testing>" E6_REACT_DIR="<dir>" \
  node artifacts/experiments/E6-mv3-dispatch/harness/run-e6.mjs
```

The harness rebuilds the host. Headful: two automated browsers open in turn for a few minutes each.
