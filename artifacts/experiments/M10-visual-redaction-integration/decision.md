# M10 — decision record (closed)

**M10 verdict: CLOSED, with the limitations stated in the closeout at the end of this record.** The
chain this section once named as the condition for closing — raw capture frame → TR-01 → fail-closed
policy → canonical geometry → pixel mask → WebP → test loopback sink — was demonstrated end to end on
the real gesture route (M10.6, M10.7). M10.8 added the verifier.

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

## M10.6 decisions (product perception pass on the gesture route)

> **Forward pointers.** The M10.4 "UI head ordering" row above deferred the sequential rule to the
> perception pass; it is implemented here: the pass awaits the UI head, then TR-01. The M10.5
> "wiring" row above is superseded by this section. Neither earlier row is edited.

| question | decision |
|---|---|
| route | the approved REAL_GESTURE_STREAM only: toolbar click → `activeTab` → `getMediaStreamId` → offscreen `getUserMedia` → `grabFrame`. No `captureVisibleTab` fallback, no polling, no periodic capture, no new permission. The degraded `M3_WORKER_FRAME` route stays a test-only build flag and is never gesture evidence |
| owner | the offscreen document creates the one TR-01 host (lazily) and hands the perception realm a `textRegions.detect`. No other context creates a host or a worker |
| order | capture → UI head (to completion) → TR-01 on the FULL frame → `reportFromFullFrame` (association, `UNREAD_REGION`) → `sanitizeFrame` (fail-closed plan, canonical geometry, fill in place). Sequential, never concurrent. No crop, no other model, no OCR |
| regions | `perceive` REQUIRES the observation's `visualRegions` (compile-time), so no caller can get a frame that looks sanitized without them. Both product callers (the run loop and `PERCEIVE_ONCE`) pass them |
| frame lifetime | the `ImageBitmap` is closed as soon as its RGBA is read, and the track is stopped after one frame. The only frame kept between passes is the last SANITIZED one. Every pass starts with none held. REFUSED, a geometry mismatch and a fusion failure keep none, and the first two overwrite the buffer |
| worker copy | the worker zeroes the pixel copy it was lent after every DETECT, whatever the outcome |
| deadline | TR-01's 2,000 ms gate, enforced by the host. A pass may tighten it, never loosen it |
| verification seams | test builds only (`#tr01-probe`): an instrumented spawn, the pre-fill digest hook (`onMaskPlanned`) and a stage-name hook (`onStage`). The product build resolves them to `null`, and a seam that throws cannot change a pass |
| RE-1 on stream frames | measured, not tuned: TR-01's boxes on gesture-stream frames are not byte-equal to M8.1's (largest coordinate difference 2.71 px, same counts, every RE-1 gate passing, 0 / 306 exposed). The **owner directed** that this be recorded as a finding and that M10.6 proceed. M9 J7 (stream-route re-screening) is **not closed** by six images at one scale |
| output | the sanitized RGBA frame, in the offscreen document. Nothing is encoded or sent; WebP and the test-only loopback sink are the next unit |

## M10.7 decisions (sanitized WebP, verified egress, test-only loopback)

> **Forward pointer.** The M10.6 "output" row above ("Nothing is encoded or sent") is superseded for
> the evidence build by this section. The product build still encodes and sends nothing.

| question | decision |
|---|---|
| encoder location | the perception realm (`perception-realm.ts`, `browserWebpCodec`), handed in by the offscreen document as `deps.codec`. Not the service worker, not `@pratibimb/privacy`, not the transport, not the TR-01 worker. Kept in the realm's own file, because only that file may turn bytes into pixels (`visualBoundary.test.ts`) |
| input | `encodeSanitized()` takes no frame. It encodes the realm's kept SANITIZED frame or refuses (`NO_SANITIZED_FRAME`). REFUSED and failed passes keep none, so they produce no WebP and no request |
| encoding | WebP at quality 0.62 (dossier q62), from an opaque canvas. A blob the browser labels as anything but `image/webp` is refused |
| colour profile | Chrome embeds a 456-byte sRGB ICC profile. The realm's encoder drops `ICCP` and clears its `VP8X` flag before the decode-back, so the payload is pixels only and everything after concerns those bytes |
| what is checked | steps 1–2 of the frozen verifier: the bytes are decoded back, and every mask interior, inset by the frozen 4 px dilation, must be within `WEBP_MASK_TOLERANCE` = 8 levels of the fill. **Engineering parameter, set by measurement** (q62 interiors ≤ 2 on W1; unmasked text sits on 255); owner-reviewable. Steps 3–6 (OCR re-read, re-detection, value check, re-dilation) are NOT implemented |
| the attestation | `attestMaskedFrame` (`@pratibimb/privacy`, pixels and digests only) hashes a private copy of the bytes and registers the frame in a module-private `WeakSet`. Its status is **MASK_VERIFIED**, never "verified". The manifest carries ids, rectangles, counts, hashes and status: no text, no pixels |
| egress | `sendMaskVerifiedFrame`, in the single egress module beside `sendVerified`. In order: registry membership → loopback only → bytes copied once → SHA-256 equal to the attested one → a still WebP with no metadata chunk, of the attested size → one `fetch`. Not a general primitive. **No product module calls it**, and the product bundle does not contain it |
| the sink | test-only (`tests/browser/support/frame-sink.mjs`), bound to 127.0.0.1:8995, the existing pinned `connect-src` origin. Accepts one still WebP of the expected size from the extension's origin, whose bytes match the declared digest, and rejects everything else. Never alters a payload; never decodes |
| independent verification | the harness decodes what the sink accepted, in a page that is not the extension, with its own container reader. It checks digests, size, absence of the raw frame and of fixture text, every fixture ink pixel within 8 levels of black, and the controls |
| controls, after lossy WebP | **owner decision after formal runs 1–2:** a control region passes when its decoded MEAN is within 8 levels of the encoded region's mean. The worst single pixel is recorded with its position, not gated. Runs 1 and 2, which failed earlier per-pixel versions of this check, are kept |
| stream finding | unchanged and still open: no detector input, threshold, post-processing, geometry or RE-1 data was touched |

## M10.8 decisions (the final sanitized-artifact verifier)

| question | decision |
|---|---|
| step 3, re-read | **owner decision:** no admissible `OCRProvider` exists (ADR-0011), so the re-read is a TEXT-REGION re-read. TR-01 runs full-frame over the DECODED artifact, in a test-only verifier that shares no code with the masking path (`tests/browser/support/artifact-verifier.mjs`, `verifier-runtime.mjs`). No recognition model is added anywhere |
| re-read configuration | **owner decision:** the frozen verifier's "LOW threshold, HIGHER resolution" governs, verifier-only — long side 1920 (2 × 960) and box threshold 0.3 (the existing DB pixel threshold). The product's TR-01 configuration is unchanged. (Correction during M10.8: the first proposal, a 2× upscale before TR-01's resize to 960, would have raised nothing; the resize target is what changes) |
| step 4 | "D2/D3 over recovered text" has no input without OCR. It is replaced by SURVIVORS: any re-detected text region that intersects a visual-only region. The visual-only text policy masks every text region there, so after masking none should remain. No ground truth is used |
| step 5 | the vault value check is **NOT RUN** (no recovered text), and every verdict carries that reason |
| step 6 | survivors → 12 px re-dilation on a verifier COPY, re-encoded at q62 and re-read, at most 3 rounds. The ORIGINAL artifact is BLOCKED whether or not 12 px clears it: the product has no path to adopt verifier geometry, and must not. The 4 px production dilation, the IoU > 0.3 merge and the canonical geometry are untouched |
| identity | the verifier checks the received bytes against the attestation before anything else: a mutated artifact, or one paired with another artifact's attestation, is BLOCKED (`IDENTITY_MISMATCH`) |
| verdicts | **PASS** (status `DETECTOR_VERIFIED`, never "verified") or **BLOCK** with a reason. A verifier that cannot run BLOCKS. `mayHandOff` is true for PASS only; there is no warning state |
| product code | **none changed** in M10.8. The verifier is test-only; a boundary test keeps `apps/` and `packages/` from reaching it |

## Production frame egress — recommendation (M10.8, Part O)

**Recommendation: NOT READY to become a production handoff primitive. Do not enable it.** The test-only
mechanism is sound on its evidence, but it is not a production primitive. Each item below is a
decision or a piece of work, not a defect found.

**What the evidence supports:**

- the attestation is a module-private registry, not a flag;
- the hash pin catches a byte changed after attestation;
- the choke point admits loopback only and an attested still WebP only;
- REFUSED yields nothing to send;
- an independent verifier agrees on what arrived, at four scales, on the real gesture route.

**What stands in the way:**

1. **The verifier is not the frozen verifier.** Without an admissible `OCRProvider`, steps 4–5 cannot
   run, so the strongest status is `DETECTOR_VERIFIED`. Whether that is enough for a remote handoff is
   an owner/ADR decision, as is any OCR adoption.
2. **The verifier does not fit the product budget as configured.** It needs 362 MiB of WASM at 1920,
   against the 200 MB engineering gate. The product realm already uses 157.5 MiB. It also takes about
   1.7 s per frame. Running it in the handoff path needs a budget decision or a different verifier
   configuration, measured anew.
3. **BLOCK is not wired to anything in the product**, and the frozen fallback is not built: "Blocked
   requests fall back to structure-only mode — manifest without image".
4. **QG-04 is not complete for frames.**
   - The payload is the WebP alone, not the single immutable multipart artifact (frame + manifest +
     goal) the gate describes.
   - The destination is loopback, not a configured server origin.
   - The fail-closed matrix's zero-outbound assertion has not been run for every row against frame
     egress.
5. **M9 J7 is open:** stream-versus-screenshot detector geometry (M10.6 finding).
6. **Scope:** one synthetic fixture, one workstation (W1), Chrome for Testing only.

## M10 closeout

**VERIFIED** (W1, Chrome for Testing, synthetic fixtures, owner-performed toolbar clicks):

| claim | evidence |
|---|---|
| real user gesture → tab stream → local perception, at DPR 1, 1.25, 1.5, 2 | M10.6 `w1-cft-gesture-redaction.json`; M10.7 `-run3`; M10.8 |
| local text-region detection: TR-01 in a dedicated worker, full frame, pinned, 2,000 ms deadline, combined WASM ≤ 200 MB | M10.4, M10.6 |
| fail-closed decisions: detector failure masks regions whole; invalid region → REFUSED, no frame | M10.2, M10.5, M10.6, M10.7, M10.8 |
| local pixel masking with the canonical geometry, in place | M10.5, M10.6 |
| sanitized WebP q62, mask checked on the decoded bytes (MASK_VERIFIED) | M10.7 |
| artifact identity: raw ≠ sanitized ≠ WebP; attested = sent = received | M10.7, M10.8 |
| test-only egress through the single choke point, loopback only, refusing unverified, raw, tampered and non-loopback payloads | M10.7 |
| an independent verifier (detector re-read, survivors, 12 px loop, PASS/BLOCK) that passes the real artifacts and blocks unmasked, mutated and stale ones (DETECTOR_VERIFIED) | M10.8 |
| RE-1 through the product path on frozen frames equals M8.1 | M10.6 `w1-cft-re1-product.json` |

**NOT VERIFIED, and not claimed:**

- visual-only PII recall on arbitrary sites: RE-1 bounds exposure on six synthetic frames only;
- production remote egress of frames, and any remote service;
- real-world PII distributions: every fixture is synthetic;
- the frozen verifier's OCR re-read, D2/D3 re-detection and vault value check (no admissible
  `OCRProvider`);
- coverage of `video`, inline `svg`, CSS background images, `object`/`embed`, cross-origin iframes and
  shadow DOM (M10.3 gaps);
- stream-versus-screenshot pixel/geometry equivalence (M9 J7; M10.6 finding, open);
- other workstations, Firefox, other browsers.

**Next milestone (proposed, not started):** an owner/ADR decision on production frame handoff, which
needs to settle:

- whether DETECTOR_VERIFIED suffices, or an `OCRProvider` must be adopted for the verifier;
- the verifier's memory and latency budget;
- BLOCK → structure-only fallback;
- the QG-04 multipart payload and server origin;
- J7.
