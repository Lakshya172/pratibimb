# M10 — visual redaction integration (in progress)

> **Status: IN PROGRESS.** M10 is being delivered as separately committed units. Product visual-only
> PII protection remains **NOT VERIFIED**: no frame is captured, masked, encoded or sent by anything
> recorded here, and TR-01 is not called by the extension.

| unit | commit | what it established |
|---|---|---|
| M10.1 | `9af71b7` | TR-01 detector contract (`packages/perception/src/textRegion.ts`), golden-equal to M8.1 |
| M10.2 | `6386abd` | fail-closed `TextFinding` and `planVisualRedaction` (`packages/privacy/src/textFinding.ts`) |
| M10.3 | this unit | visual-only region enumeration in OBSERVE (`visualRegions`) |

## Hypothesis (M10.3)

The content script can enumerate every rendered `<canvas>` and `<img>` as a positional id and a CSS
rectangle, deliver it through the existing strict OBSERVE path, and hand it to the privacy planner
unchanged. The ordinary element graph is unaffected, and no pixel, URL or text crosses.

## Environment

W1 (`LAPTOP-6E14K34L`), Windows 11, Chrome for Testing (Playwright `chromium-1243`), headed, built
MV3 host from this commit's tree, loopback fixture `tests/browser/extension/fixture/visual-regions.html`
at 1280×720 CSS px, `deviceScaleFactor` 1, 1.25, 1.5 and 2. Full provenance is in the log.

## Expected result

- Regions `canvas:0`, `canvas:3`, `img:0` and `img:2` are present.
- `canvas:1` (display:none), `canvas:2` (visibility:hidden) and `img:1` (zero size) are absent.
- Each rectangle equals the live DOM's `getBoundingClientRect`, and `img:2` keeps its full, partly
  off-screen rectangle.
- Rectangles are identical at every DPR.
- The element graph still contains `#name` and `#submit`.
- None of the fixture's synthetic strings, and no image data, appears in the observation.

## Actual result

PASS at all four DPRs, with rectangles identical across DPRs:
`logs/w1-cft-visual-regions.json`.

One harness correction was made after the first run and before the recorded one. The first run
failed only its own DPR check at 1, 1.5 and 2. Under emulation, Chrome reports `devicePixelRatio`
with float32 noise (for example `1.5000000596046448`), and the observation carries that value
verbatim. The check now requires:

- the observation's `dpr` to equal the page's own value exactly;
- the page's value to be within 1e-6 of the requested factor.

No product code changed between the two runs.

## Conclusion

Region enumeration works through the real extension on this fixture. That supplies the regions the
privacy planner needs. It says nothing yet about capture, masking or egress, which are later M10
units.

## Reproducibility

```
npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-extension-visual-regions.mjs
```

Unit tests: `packages/extension-transport/test/visualRegions.test.ts` and
`apps/extension/test/visualRegionPlanning.test.ts`.
