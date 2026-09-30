# M10 — decision record (in progress)

**No M10 verdict is recorded yet.** M10 closes only when the full chain has been demonstrated end to
end: raw capture frame → TR-01 → fail-closed policy → canonical geometry → pixel mask → WebP → test
loopback sink.

## Owner decisions in force

- **D1.** TR-01 (`PP-OCRv4_mobile_det`) is the first integration candidate. TR-02 is not integrated.
- **D2.** An end-to-end masking proof with a test-only loopback sink. No real external image egress.
- **D3.** Engineering gates, each changed only by an owner decision:
  - a 2,000 ms detector deadline per frame, excluding initialization;
  - a 200 MB peak WASM memory budget.
- **REFUSED is approved and terminal.** A visual-only region without a trustworthy rectangle gives
  `REFUSED`, and that frame must not leave the privacy boundary. REFUSED is never an empty mask, zero
  detections, a sanitized success, an encode or an egress. It is distinct from detector failure,
  which masks the whole region and may continue as a sanitized frame.

## M10.3 decisions (region enumeration)

| question | decision |
|---|---|
| element kinds | `canvas` and `img` only. Not enumerated, and recorded as gaps: `video`, inline `svg`, CSS background images, `object`/`embed`, cross-origin iframe content, shadow-DOM content |
| visibility | left out exactly when the element graph's `cssHidden` is true: `display:none`, `visibility:hidden`, zero width or height. Off-screen and partly visible elements keep their **full** CSS rectangle; clipping is the coordinate stage's job |
| unmeasurable rectangle | kept as measured, never dropped; the strict parser then refuses the whole observation |
| id | `<kind>:<n>`, the index among all elements of that tag (hidden ones included), in document order. Positional only: never the page's `id` attribute, a URL or content. The parser refuses any other form |
| document / frame | a region belongs to the browser-attested document of the observation that carried it; the page cannot claim one |
| malformed list | the whole observation is refused (`parsePageReply` → `null`), as for a malformed measurement |

## M10.4 decisions (TR-01 detector worker)

| question | decision |
|---|---|
| realm | a dedicated classic worker (`/tr01-worker.js`), created only by the offscreen document. One per document, created lazily |
| model | `artifacts/models/tr01-ppocrv4-mobile-det/tr01-ppocrv4-mobile-det.onnx`, git-ignored like the UI head. The build refuses a SHA-256 or length mismatch, and the worker re-verifies at runtime (`loadVerifiedModel`) before any session exists |
| runtime | the existing pinned ORT 1.29.0 (`ort.all.min.js` + the `db816fad…` WASM via `bootstrapOrtRealm`), resolved relative to the worker inside the package. No new runtime, CDN or dependency |
| deadline | 2,000 ms per run (D3), timed by the offscreen document from the moment the DETECT is posted, which excludes initialisation. Enforced by `worker.terminate()`. A caller may tighten it for one run, never loosen it |
| init failure | UNAVAILABLE for the document's life. No retry, no alternate model, no OCR. A hung init is ended by a 30 s engineering safeguard, not an owner gate |
| run failure | timeout, crash or malformed reply: terminate, and the next run recreates the worker. Refusal codes are never `[]` |
| stale replies | per-worker generation plus per-run id. A terminated worker's handlers are detached, and anything else is counted and dropped |
| concurrency | at most one run in flight. A second request is refused (`DETECTOR_BUSY`), not queued. The worker enforces the same rule |
| region identity | never sent to the worker. The offscreen document keeps the crop → region mapping (`tr01-findings.ts`) |
| UI head ordering | the two realms are separate threads. The M9 sequential rule becomes the perception pass's job: it will await the UI head, then TR-01. That pass is wired in a later unit, and the host itself allows one TR-01 run at a time |
| measurement code | the probe and the memory/network instrument are build-graph aliases (`#tr01-probe`, `#tr01-instrument`), present only with `TR01_PROBE=1` |

## M10.5 decisions (pixel masking)

> **Forward pointer.** The M10.4 "region identity" row above names a crop → region mapping in
> `tr01-findings.ts`. That module was removed in M10.5 under the owner's architectural correction
> (no crop before TR-01). It is superseded by the full-frame association below, in
> `host-lib/visual-redaction.ts`. Region identity still never reaches the worker.

| question | decision |
|---|---|
| detector input | the FULL captured frame, never a region crop. M8.1/M8.2/M8.2a/RE-1 evidence is for full frames through TR-01's declared resize; cropping would change input scale and distribution |
| association | RE-1's own. Every full-frame detection is offered, as an `UNREAD_REGION`, to every visual region, and the canonical dilate → merge → clip decides. There is no pre-filter, because one would change which boxes merge |
| common space | CSS viewport pixels (INV-24): boxes via `captureToCss`, planning and canonical geometry in CSS, then `cssToCapturePixelRect`, which rounds OUTWARD and clips to the frame, for the fill |
| fill | constant-colour opaque black `(0, 0, 0, 255)`, never blur, pixelation or partial alpha. No semantic label yet (the frozen verifier sequence composites one after the fill; not in this unit) |
| semantics | IN PLACE: the frozen rule "the un-redacted bitmap is closed immediately after masking" means no raw copy remains for a later step |
| REFUSED | invalid region, frame or geometry. The whole buffer is overwritten, and no frame is returned |
| fail-closed | any detector failure or malformed report masks every region's visible area whole; the sanitized frame may continue |
| wiring | not wired into the product perception pass in this unit: the evidence probe drives the real pieces. Wiring it to the gesture route is the next unit |
