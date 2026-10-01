# M3 — local visual perception, inside the real MV3 extension

> **W1 evidence, 2026-09-22.** `packages/perception` had a full substrate — capture adapter,
> letterbox, tensor contract, head decode, coordinate spaces, DOM/vision fusion — and **zero call
> sites in the extension**. It has them now. Every reading of the page is captured, decoded,
> detected on and fused locally, and the manifest the reasoner receives declares which tiers
> actually fired and which of its elements have pixel evidence behind them.
>
> **The reasoner gained provenance. It gained no pixels.** The outgoing payload carries
> `capability.tiers_fired: ["T0","T1","T2"]`, `scale_to_css: 0.8` derived from a real frame's real
> dimensions, and six of fourteen elements marked `dom+vision` — and the worker's own recording of
> all 113 messages contains no PNG signature, no `data:` image URL, and no base64 run longer than
> zero characters.

- **Workstation:** **W1** (`LAPTOP-6E14K34L`, Intel Core 7 240H, 16 cores, Windows 11 10.0.26200) ·
  **Node** v24.19.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headed, `--load-extension` · GPU not used
- **Runner:** [`tests/browser/extension/run-extension-loop.mjs`](../../../tests/browser/extension/run-extension-loop.mjs) — 52 checks → **68**
- **Log:** [`logs/w1-cft153-extension-loop.json`](../M2-page-value-boundary/logs/w1-cft153-extension-loop.json)
  (the three-act record, now carrying a `perception` block) · **Verdict:** [`decision.md`](decision.md)
- **Predecessors:** [`M2-page-value-boundary`](../M2-page-value-boundary/README.md) put the privacy
  boundary where the values are; [`M2-EXEC`](../M2-EXEC-single-action/README.md) closed the
  execution question. **Neither is changed here.**

## Hypothesis

That the existing perception substrate could be connected to the real extension — not reimplemented
beside it — without a second classifier, a second vault, a second redaction path, or any weakening
of M2's value boundary.

**What would falsify it:** a parallel detector or fusion implementation; a pixel in a reasoner
request, an egress payload, a run record or a log; a frame retained anywhere; a DOM value that
stopped being protected; or a loop that stopped working when the detector could not run.

## Expected result

1. Every reading captures, detects and fuses locally, or refuses with a typed code.
2. The detector runs on the pinned artifact through ADR-0001's pinned runtime.
3. Fusion joins DOM and vision, and the join reaches the manifest as per-element provenance.
4. A client that captured nothing declares the DOM-only floor rather than the tier it wanted.
5. No pixels in the worker's recording, the reasoner's bytes, the egress payload or the run record.
6. SUCCESS / REFUSAL / OUTAGE unchanged, and the M2-EXEC action count unchanged.

## Environment

| | |
|---|---|
| Page | the existing synthetic fixture at `http://127.0.0.1:8975/fixture/`, **unchanged** |
| Capture | `chrome.tabs.captureVisibleTab({format:"png"})`, viewport-only, in the service worker |
| Perception realm | the offscreen document: decode, letterbox, ORT session, head decode, fusion |
| Runtime | ONNX Runtime Web **1.29.0**, `ort.all.min.js`, wasm, `numThreads = 1`, loaded through ADR-0001's `installVerifiedOrtRuntime` → `createPinnedInferenceSession` |
| Runtime pin | `ort-wasm-simd-threaded.jsep.wasm`, 27 797 172 B, sha256 `db816fad…a44dea`, re-hashed before any session exists |
| Detector artifact | `pratibimb-t1-ui-head` rev **`ba6d9e93695b`** — `t1-ui-head.onnx`, **302 960 B**, sha256 `ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0`, input `[1,3,640,640]` f32 NCHW RGB 0..1 pad 114/255, output `[1,12,6400]` |
| Artifact provenance | not committed (`artifacts/models/` is gitignored, `verify-repo.py` bans `.onnx`); the tracked authority is `artifacts/gates/T1-detector-training/qg05-detector-evaluation.json`; feasibility cell **`CONDITIONAL`** per W1-QG03 |
| Reasoner | **Qwen2.5-0.5B** behind a loopback front at the manifest's one pinned `connect-src` origin |
| Not present | no OCR, no VLM, no cloud vision, no second detector, no image persistence, no raw screenshot egress |

## Where the pixels are, and why — measured, not assumed

A `REALM_PROBE` was added to the offscreen document and run on W1 before any architecture was
chosen:

| realm | `chrome.tabs` | `captureVisibleTab` | `OffscreenCanvas` | ORT / WASM |
|---|---|---|---|---|
| content script | absent | — | yes | — |
| **offscreen document** | **absent entirely** | — | **yes** | **yes, already running** |
| service worker | present | **yes**, with `activeTab` or `<all_urls>` | yes | yes, no `document` |

So on Chrome MV3 **the service worker is the only realm that can obtain page pixels without a user
gesture.** The route that would have avoided it — `chrome.tabCapture.getMediaStreamId`, where the
worker holds an opaque id and the pixels flow to the offscreen document through the media pipeline —
was tested and **refuses without an `activeTab` invocation no harness can produce**, `<all_urls>` or
not:

```
"Extension has not been invoked for the current page (see activeTab permission)."
```

**That is a real weakening relative to M2, and it is stated rather than dressed up.** A page's DOM
values never enter a worker message. A page's *pixels* do, on exactly one hop. What the architecture
can do — and does — is make that hop the only one:

- the worker hands the frame straight to the sender and keeps no reference;
- its traffic recorder notes `{kind, dataUrlLength}` and **never the payload**, because a diagnostic
  that stored every frame would be the leak it exists to detect;
- only the offscreen document may ask, and only for the active tab.

## The architecture

```
page  ──captureVisibleTab──▶  SERVICE WORKER  ──one hop, nothing retained──▶  OFFSCREEN REALM
                                                                               decode (OffscreenCanvas)
                                                                               letterbox + tensor  (packages/perception)
                                                                               ORT session on the pinned artifact
                                                                               head decode → Detection[]
                                                                               fuse(graph, detections)
                                                                                      │
        counts · geometry · class labels · provenance · timings ◀────────────────────┘
                                                                               pixels dropped here
```

`apps/extension/host-lib/perception-realm.ts` is the whole adapter: decode an image, rasterise it,
run a session. Every arithmetic decision — resize, pad, channel order, normalisation, the head
decode, the coordinate transforms, the IoU join — belongs to `packages/perception` and is called,
not reimplemented.

### Why a detection cannot leak text, by construction

`UI_CLASSES` is eight interactable classes with **no text class**, and a `Detection` is a box, a
label from that list, and a score. There is no OCR in this milestone and no field for one. The
strongest privacy property here is not a check that passed — it is a shape that cannot be built.

## Actual result

**PASS — 68 of 68 checks.**

### What perception did, per reading

| act | pass | capture | detections | fused | ms (capture / decode / pre / infer / fuse) | total |
|---|---|---|---|---|---|---|
| SUCCESS | 0 | 1600×900, 40 703 B | 100 | 6 matched, 94 vision-only, 8 dom-only | 49 / 17 / 71 / 86 / 1 | **225 ms** |
| SUCCESS | 1 | 1600×900, 41 770 B | 99 | 6 / 93 / 8 | 37 / 11 / 42 / 42 / 1 | 133 ms |
| SUCCESS | 2 | 1600×900, 41 770 B | 99 | 6 / 93 / 8 | 37 / 10 / 46 / 47 / 1 | 141 ms |
| REFUSAL | 0 | — | — | — | **`CAPTURE_THROTTLED`** | — |
| OUTAGE | 0 | 1600×900, 40 703 B | 100 | 6 / 94 / 8 | 38 / 12 / 65 / 47 / 0 | 162 ms |
| OUTAGE | 1 | 1600×900, 41 770 B | 99 | 6 / 93 / 8 | 41 / 11 / 48 / 45 / 0 | 145 ms |
| OUTAGE | 2 | — | — | — | **`CAPTURE_THROTTLED`** | — |

ORT bootstrap + pinned session: **602 ms**, once per document, not once per reading. Detector
classes seen: `textbox` 47, `button` 29–30, `link` 12, `tab` 5–7, `select` 5.

### Chrome's capture quota fires in a real run, and the degradation is the point

Two of seven passes refused with the browser's own message —
`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` — which is S-05's open question arriving unprompted. The
adapter **classifies** it rather than retrying into it, and the loop carried on: all three acts
reached their expected ending with the same action counts.

And the client said so. REFUSAL's manifest declares the **structural floor**:

| act | `tiers_fired` | `scale_to_css` | element sources |
|---|---|---|---|
| SUCCESS | `["T0","T1","T2"]` | **0.8** | 8 `dom`, **6 `dom+vision`** |
| **REFUSAL** | **`["T0","T2"]`** | **1** | 14 `dom` |
| OUTAGE | `["T0","T1","T2"]` | 0.8 | 8 `dom`, 6 `dom+vision` |

The tier list is a claim to the one party that cannot check it. A client that saw nothing says so.

The six `dom+vision` elements are `#name`, `#mobile`, `#aadhaar`, `#dob`, `#otp` and
`#mobile_confirm` — the form controls the detector confirmed with pixel evidence. `#submit`,
`#status` and the labels remain `dom`.

`scale_to_css: 0.8` is **derived, not assumed**: the capture is 1600×900 where the CSS viewport is
1280×720 at `dpr` 1.0, so the scale is measured from the frame's own dimensions. Assuming
`viewportCss × dpr` would have been wrong here by 25%, which is exactly what
`CAPTURE_DIMENSION_MISMATCH` exists to catch and cannot catch if the value it checks came from the
assumption.

### What the worker saw

```
113 messages · 83 399 bytes · fixture values found: 0
PNG signature: false · data:image URL: false · longest base64 run: 0 characters
in:CAPTURE_FRAME 7   to-tab:CAPTURE_FRAME_REPLY 5   (shape only: kind and length)
```

### What left the device

```
payload  4304 bytes   sha256 a631d83a63b5e07a2764afa95c23d2c5f5059318392e91092abf38c375bb4f66
leakCheck CLEAN   ·   14 elements   ·   no pixels, by scan and by type
```

**The digest changed from M2's `26d7c09f…`, and that is the milestone.** The manifest now carries a
capability block naming the visual tier, a real capture scale, and provenance per element. What it
does not carry is a single pixel.

## Conclusion

**EXPERIMENTALLY VERIFIED on W1** — one run of each act, one fixture, one browser cell.

**Architectural invariants** (true by construction, checkable by reading): one detector, one fusion,
one vault, one classifier, one redaction path, one egress authority; `EXECUTABLE_ACTIONS` still
`["click"]`; zero new `fetch(` sites; no storage anywhere; one file in the extension decodes an
image and a test names it; no message type has a pixel-bearing field.

**Not verified, and not claimed:**

- **Nothing about detection quality.** The artifact is `CONDITIONAL` in the feasibility matrix and
  W1-QG03 measured why — the preprocessing a browser can actually perform moves 16–34% of its
  detections. 94 vision-only boxes on a simple form is noise, and it is recorded as what the
  detector produced rather than as what is on the page. **M3 verifies a pipeline and a boundary, not
  a detector.**
- **No claim of perfect PII recall**, visual or otherwise.
- **No claim of zero leakage in general** — what was checked is this fixture's values and this run's
  traffic.
- **No claim of production readiness.** Memory-only vault, one loopback origin, no TLS, no real user
  data, and a capture permission that substitutes a build flag for a user gesture.

## Reproducibility

```bash
M3_CAPTURE_WITHOUT_GESTURE=1 npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-extension-loop.mjs
```

The flag substitutes `<all_urls>` for the `activeTab` grant a user gesture would provide, and
changes nothing else. A default build declares `activeTab` and loopback only, and a test asserts it.
