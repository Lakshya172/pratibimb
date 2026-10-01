# M1 — observation through the real MV3 extension

> **W1 evidence, 2026-09-22.** The first leg of M1: the core realm reads a real page through the
> real extension, and the graph it receives is the one the orchestrator already consumes.
>
> **This is not the product loop.** No orchestrator, privacy layer, vault, reasoner or egress takes
> part, and nothing is clicked. **EXTENSION E2E remains NOT PROVEN.**

- **Workstation:** **W1** (`LAPTOP-6E14K34L`, Intel Core 7 240H, 16 cores, Windows 11 10.0.26200) ·
  **Node** v24.19.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headed, `--load-extension` · GPU not used
- **Runner:** [`tests/browser/extension/run-extension-observe.mjs`](../../../tests/browser/extension/run-extension-observe.mjs)
- **Log:** [`logs/w1-cft153-extension-observation.json`](logs/w1-cft153-extension-observation.json) ·
  **Verdict:** [`decision.md`](decision.md)

## Hypothesis

The transport's 95 unit tests run against a simulated browser. The question this run answers is
narrower and load-bearing for M1: **does `offscreen → service worker → content script → back` return
an element graph of a real page that the existing orchestrator could consume unchanged?**

If the representation differs — different targets, a different coordinate space, a different way of
identifying an element — then moving the loop into the extension means rewriting the loop, which is
the one thing M1 is not allowed to do.

**What would falsify it:** a graph whose CSS boxes disagree with the live DOM; an element the page
has and the graph does not; a binding that does not attest the document that answered; any page
value appearing anywhere in the observation.

## Environment

| | |
|---|---|
| Built host | `apps/extension/.output/chrome-mv3`, 29.03 MB, manifest v3 |
| Page | the synthetic fixture at `http://127.0.0.1:8975/fixture/` — the only origin the content script matches |
| Path exercised | `observePage` → `chromeRelay` → SW router → content script `createPageAgent(domPageSurface)` → back |
| Control | the same document read directly with `getBoundingClientRect`, mirroring `page-surface-dom.ts`'s `referenceOf` |
| Not present | no orchestrator, no privacy layer, no vault, no reasoner, no egress, no capture, no detector, no click |

The offscreen document gained one control-plane message, `TRANSPORT_OBSERVE`, **service-worker only**
(a content script is refused, and no page can reach it) — the same shape as the existing `E6_ARM`.

## Expected result

1. The service worker records the browser's attestation of the content script (tab, frame, document).
2. The core realm receives an observation whose binding names that same document, on a loopback origin.
3. Every element the page has, the graph has, identified the same way (`selector` plus `nth`).
4. CSS-pixel boxes agree with the live DOM within sub-pixel rounding (INV-24).
5. No fixture value appears anywhere in the observation (TR-10, INV-21).

## Actual result

**PASS — 11 of 11 checks.**

| | |
|---|---|
| Nodes in the graph | **14** |
| DOM elements compared | **14** |
| Worst box disagreement | **0.0 px** on every axis, across all 14 |
| Attested origin | `http://127.0.0.1:8975` |
| Focus | `NONE` (reliably nothing focused, not "unknown") |
| Viewport | 1280 × 720, dpr 1.0 |
| Fixture values in the observation | **0 of 6** |

The geometry is not merely close: the extension's graph and the live DOM produce **identical**
CSS-pixel boxes. The two sides share a coordinate space exactly, which is what INV-24 asks for.

One check failed on the first two attempts, both times because the **harness control** was wrong —
first keying nodes by the wrong field, then collapsing several `<label>` elements onto one bare
selector while the transport correctly disambiguates them with `nth`. Neither was a product defect.
The control now mirrors `referenceOf`, and the runner reports the worst disagreement with a number
rather than a boolean, so the next failure says how far apart the two sides are.

## Conclusion

**EXPERIMENTALLY VERIFIED on W1** — single run, one fixture, one browser cell.

The observation leg of M1 works through the real extension, and the representation needs no change
for the orchestrator to consume it. That removes the largest open question about moving the loop:
the loop will not have to be rewritten to run in the extension.

**Status vocabulary, used strictly.** This is not PROVEN: one run on one synthetic fixture in one
browser cell is not a reliability claim, and a second machine has not reproduced it. The remaining
M1 legs — the orchestrator, the privacy layer and the vault in the offscreen document, the reasoner,
egress from the extension context, the human grant, and the three acts — are **NOT PROVEN** and are
untouched by this run.

## Reproducibility

```bash
npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-extension-observe.mjs
```

The runner refuses rather than guessing if `CHROME_PATH` is unset or the host is not built, and
takes its workstation identity from `tests/browser/support/workstation.mjs`, so a run on another
machine writes its own evidence file and cannot overwrite this one.
