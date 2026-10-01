/**
 * M3.1 — LOCAL VISUAL PERCEPTION, IN THE REALM THAT OWNS THE PIXELS.
 *
 * This is the extension-side adapter for `@pratibimb/perception`. It builds nothing that package
 * already builds: the letterbox, the tensor layout, the head decode, the coordinate transforms and
 * the DOM/vision join are all that package's, called from here. What lives in this file is the
 * three things a package that "makes no network calls and compiles no WebAssembly" deliberately
 * cannot do — obtain an image, rasterise it on a canvas, and run an ORT session.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * TWO ROUTES IN, AND THE DIFFERENCE BETWEEN THEM IS THE MILESTONE
 *
 * `GESTURE_STREAM` — the product path. A person invoked the extension on a tab; the worker minted
 * an opaque ~40-character handle with `getMediaStreamId` and passed the STRING here. This document
 * turns it into pixels itself, through `getUserMedia`, which is not a message and does not pass
 * through the worker. **The worker never holds a frame on this path.**
 *
 * `WORKER_FRAME` — the degraded path, off unless a build asks for it by name. `captureVisibleTab`
 * runs in the worker and the worker therefore holds the frame for one hop. It exists because no
 * automated harness can produce the invocation the gesture route requires — measured, including
 * `<all_urls>`, an in-page click in an extension page, and a CDP keyboard command, none of which
 * grant `activeTab`. A run says which route it took and the evidence reports it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ONE DECODE PER PASS
 *
 * M3 decoded every frame twice: once so the capture adapter could MEASURE it (the tier refuses to
 * assume a capture is `viewportCss × dpr`, which is what CAPTURE_DIMENSION_MISMATCH exists to
 * catch) and once so the detector could rasterise it. The decode now happens once and the RGBA is
 * carried forward, because both callers wanted the same pixels and only one of them needed to say
 * so. On the gesture route there is no decode at all: `grabFrame` hands over an `ImageBitmap`.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THE DETECTOR CANNOT LEAK TEXT, BY CONSTRUCTION
 *
 * `UI_CLASSES` is eight interactable classes and no text class; a `Detection` is a box, a label
 * from that fixed list, and a score. There is no OCR in this milestone and no field for one. So the
 * strongest privacy property here is not a check that ran — it is that the detector is structurally
 * incapable of producing the characters on the screen.
 *
 * WHAT THIS DOES NOT CLAIM. The artifact is `CONDITIONAL` in the feasibility matrix and W1-QG03
 * measured why: the preprocessing a browser can actually perform moves 16–34% of its detections.
 * This file runs it, records what it produced, and asserts nothing about whether the boxes are
 * right. M3.1 verifies a pipeline and a boundary, not a detector.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * M10.6 — THE LOCAL REDACTION STAGE, IN THE ORDER M9 FIXED
 *
 *     capture → UI head → TR-01 (FULL frame, dedicated worker) → UNREAD_REGION per visual region
 *       → fail-closed plan → canonical geometry → opaque fill IN PLACE → keep the sanitized frame
 *
 * Sequential, never concurrent: the UI head's inference completes before TR-01 is asked. TR-01 sees
 * the whole captured frame — the input its M8.1 / M8.2 / M8.2a evidence covers — never a crop.
 *
 * THE RAW FRAME DOES NOT OUTLIVE THE PASS. The `ImageBitmap` is closed as soon as it is decoded. The
 * decoded buffer is masked in place, so once the mask is applied the unredacted pixels no longer
 * exist in this realm (the frozen "closed immediately after masking"). A frame the pass cannot
 * sanitize — REFUSED, or a geometry it cannot trust — is overwritten and dropped: `sanitizedFrame()`
 * then answers `null`, and nothing downstream can have it. The TR-01 worker receives a copy for
 * inference and scrubs it when the run ends.
 *
 * Visual-only regions are REQUIRED on every pass. A caller that forgot them must not be able to
 * produce a frame that looks sanitized because there was nothing to plan against.
 */
import {
  type Backend,
  type CaptureFrame,
  type CaptureGeometry,
  type DecodedImage,
  type Detector,
  type ElementGraph,
  type FusionResult,
  type HeadOutput,
  type HeadRuntime,
  type HeadTensorContract,
  type LetterboxTransform,
  type SanitizedElement,
  type ViewportMeasurement,
  type VisualDetection,
  createUiElementDetector,
  decodeDataUrl,
  frameId as toFrameId,
  fuse,
  geometryFrom,
  isThrottleSignature,
  preprocessToTensor,
  PROVISIONAL_THRESHOLDS,
  projectElement,
  toVisualDetections,
} from "@pratibimb/perception";

import { TR01 } from "@pratibimb/perception";
import { wipeFrame, type PixelRect, type Rect, type RgbaFrame, type VisualRegion } from "@pratibimb/privacy";

import { type CaptureRoute, type CaptureTicket } from "./capture-authority";
import { perceiveText, textPerceptionAbsent, type TextPerception, type TextPerceptionReport } from "./text-perception";
import type { Tr01Frame, Tr01Outcome } from "./tr01-host";
import type { Tr01Detection } from "./tr01-protocol";
import { reportFromFullFrame, sanitizeFrame } from "./visual-redaction";

/** The ORT surface this file needs, typed structurally so nothing here imports ORT's types. */
interface OrtSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
}
interface OrtGlobal {
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
}

/**
 * What one perception pass produced.
 *
 * EVERY FIELD IS A COUNT, A CODE, A GEOMETRY OR A TIMING. There is no pixel-bearing type here and
 * no string that came from the page's rendering — `SanitizedElement.name` is the DOM's accessible
 * name, which the M2 boundary already classifies, and it is the same string the DOM-only path
 * already carried. This type is what crosses out of the perception realm, so what it cannot hold is
 * the point of it.
 */
export interface PerceptionSummary {
  readonly ran: boolean;
  /** Why not, when `ran` is false. A refusal, never a quiet zero. */
  readonly refusal: { readonly code: string; readonly detail: string } | null;
  /** How the frame was obtained, or would have been. Recorded even on a refusal. */
  readonly route: CaptureRoute | null;
  /** True only when the worker held the frame. The whole point of M3.1 is that this is false. */
  readonly workerSawPixels: boolean;
  readonly capture: {
    readonly w: number;
    readonly h: number;
    readonly format: string;
    /** The encoded frame's length. The bytes themselves never leave this realm. */
    readonly bytes: number;
    readonly dpr: number;
    readonly scaleToCss: number;
  } | null;
  readonly detector: {
    readonly modelId: string;
    readonly revision: string;
    readonly backend: Backend;
    readonly ran: boolean;
    readonly detections: number;
    /** Count per class. Labels come from `UI_CLASSES`, never from the page. */
    readonly byClass: Readonly<Record<string, number>>;
    readonly refusal: { readonly code: string; readonly detail: string } | null;
  };
  readonly fusion: {
    readonly matched: number;
    readonly visionOnly: number;
    readonly domOnly: number;
    readonly overlaySuspected: number;
  } | null;
  /**
   * The local text tier, which is ABSENT and says so on every pass.
   *
   * Reported rather than omitted because "no text findings" and "no text tier" are different
   * facts, and a client that conflated them would look like one that had read the page and found
   * nothing sensitive. See `text-perception.ts` for why there is no model behind this.
   */
  readonly text: TextPerceptionReport;
  /**
   * M10.6 — what the local redaction stage did to this pass's frame. Codes, counts, timings and (on
   * request) geometry. Never a pixel: the sanitized frame stays in this realm (`sanitizedFrame()`).
   */
  readonly redaction: RedactionSummary;
  /** Geometry, role, structural name, provenance. The manifest's own element projection. */
  readonly elements: readonly SanitizedElement[];
  /**
   * Fusion provenance keyed by the SELECTOR, for the realm that assembles the manifest.
   *
   * The two realms identify an element differently and both are right to: perception keys by
   * `NodeId`, which is stable within one frame's graph, and the privacy layer keys by the DOM
   * selector, which is what a plan can actually name. The join belongs here, in the realm that
   * holds the graph and can see both.
   *
   * VISION-ONLY ELEMENTS ARE ABSENT FROM THIS MAP, deliberately. They have a synthetic id and no
   * selector, so there is nothing for the manifest to attach them to — and that is the right
   * answer rather than a gap: an element only pixels assert is not something a plan may target,
   * and it never becomes a value reference. It is counted, and it stays visual evidence.
   */
  readonly sourceBySelector: Readonly<Record<string, SanitizedElement["source"]>>;
  /**
   * EVALUATION ONLY, and absent from every ordinary pass.
   *
   * A detector evaluation needs the boxes themselves and the count at each stage; a run does not,
   * and carrying a hundred boxes in every record would put geometry into the manifest that nothing
   * downstream asked for. So it is an optional field a caller must ask for, and the run loop never
   * does. Boxes and class labels only — the same value-free geometry the manifest already carries.
   */
  readonly detail?: {
    /** Candidate anchors the head emitted, read off the output tensor. */
    readonly anchors: number;
    /**
     * What survived the whole of the package's filtering: score floor, per-class NMS, the
     * detection cap, and the drop of anything lying in the letterbox padding.
     *
     * ONE NUMBER, not four. `Detector.detect` returns only the end of that chain, and reporting
     * the same value under several stage names would look like a measurement of each.
     */
    readonly afterFiltering: number;
    readonly threshold: number;
    readonly detections: readonly { readonly box: { x: number; y: number; w: number; h: number }; readonly label: string; readonly score: number }[];
  };
  readonly ms: {
    /** Obtaining the frame: the stream handshake, or the worker's capture round trip. */
    readonly capture: number;
    /** Turning it into RGBA. Zero on the gesture route, which never has an encoded image. */
    readonly decode: number;
    /**
     * Encoding a frame. **Zero on every path now**, and kept as a field so a regression that
     * reintroduces one is visible in the record rather than only in the total.
     */
    readonly encode: number;
    readonly preprocess: number;
    readonly infer: number;
    readonly fuse: number;
    readonly total: number;
  };
}

/** The redaction stage's record. `NOT_RUN` when the pass never had a frame to redact. */
export interface RedactionSummary {
  readonly outcome: "SANITIZED" | "REFUSED" | "NOT_RUN";
  /** True when the detector gave no trustworthy report and every visual region was masked whole. */
  readonly failClosed: boolean | null;
  readonly reason: string | null;
  readonly refusal: { readonly code: string; readonly detail: string } | null;
  readonly detector: { readonly modelId: string; readonly ran: boolean; readonly code: string | null; readonly detections: number };
  readonly regions: number;
  readonly maskRects: number;
  readonly pixelWrites: number;
  /** The capture's ImageBitmap was closed before the pass returned. `null` when there was none. */
  readonly rawBitmapClosed: boolean | null;
  /** A sanitized frame is held in this realm for the next stage. Never true after REFUSED. */
  readonly frameKept: boolean;
  readonly ms: { readonly detector: number; readonly mapping: number; readonly plan: number; readonly pixelMapping: number; readonly fill: number };
  /** Only when the caller asked to collect: the geometry the stage worked on. */
  readonly detail?: {
    readonly visualRegions: readonly VisualRegion[];
    /** TR-01 boxes in CAPTURE pixels, as the detector saw the full frame. */
    readonly detections: readonly Tr01Detection[];
    readonly masks: readonly { readonly regionId: string; readonly cssMask: readonly Rect[]; readonly pixelRects: readonly PixelRect[] }[];
  };
}

const redactionNotRun = (): RedactionSummary => ({
  outcome: "NOT_RUN",
  failClosed: null,
  reason: null,
  refusal: null,
  detector: { modelId: TR01.modelId, ran: false, code: null, detections: 0 },
  regions: 0,
  maskRects: 0,
  pixelWrites: 0,
  rawBitmapClosed: null,
  frameKept: false,
  ms: { detector: 0, mapping: 0, plan: 0, pixelMapping: 0, fill: 0 },
});

/** The frame this realm keeps after a pass: sanitized, and only sanitized. */
export interface SanitizedFrame {
  readonly frameId: CaptureFrame["id"];
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

/** A pass that could not start. Still a summary, so callers have one shape to read. */
export const perceptionRefused = (code: string, detail: string, route: CaptureRoute | null = null): PerceptionSummary => ({
  ran: false,
  refusal: { code, detail },
  route,
  workerSawPixels: false,
  capture: null,
  detector: { modelId: "none", revision: "none", backend: "wasm", ran: false, detections: 0, byClass: {}, refusal: null },
  fusion: null,
  text: textPerceptionAbsent(),
  redaction: redactionNotRun(),
  elements: [],
  sourceBySelector: {},
  ms: { capture: 0, decode: 0, encode: 0, preprocess: 0, infer: 0, fuse: 0, total: 0 },
});

type RawImage = DecodedImage & { readonly rgba: Uint8ClampedArray };

/**
 * A bitmap turned into the RGBA the perception package's preprocessor wants. The bitmap is closed on
 * every path, and whether the close took effect (a closed ImageBitmap reports zero size) is returned
 * so the pass can say so rather than assume it.
 */
function rgbaFrom(bitmap: ImageBitmap): { readonly image: RawImage; readonly closed: boolean } {
  let image: RawImage;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context in this realm");
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    image = { width: bitmap.width, height: bitmap.height, rgba: data.data };
  } finally {
    bitmap.close();
  }
  return { image, closed: bitmap.width === 0 && bitmap.height === 0 };
}

export interface PerceptionRealmDeps {
  /**
   * Ask the capture authority for one frame's worth of access.
   *
   * On the product path what comes back is an opaque handle the worker could not read anything out
   * of. On the degraded path it is a data URL the worker held.
   */
  readonly requestCapture: (documentId: string | null) => Promise<CaptureTicket>;
  /** The pinned ORT session over the pinned artifact, created by this document at boot. */
  readonly session: OrtSession | null;
  readonly ort: OrtGlobal | null;
  readonly modelId: string;
  readonly revision: string;
  /**
   * Backends this weight file is MEASURED correct on.
   *
   * Passed in rather than hardcoded because it is an evidence claim, not a configuration: the
   * detector refuses a backend that is not on this list, and the list is empty until something
   * measured it. W1-QG03 measured `wasm` for this artifact and found it CONDITIONAL — it runs
   * correctly and deterministically, and its detections are not robust to browser preprocessing.
   */
  readonly acceptedBackends: readonly Backend[];
  /**
   * The local text tier, or `null`, which is the shipped configuration.
   *
   * Handed in rather than constructed here for the same reason the detector's runtime is: adopting
   * a model is a registry decision with a gate attached, not something a realm does for itself.
   */
  readonly text?: TextPerception | null;
  /**
   * M10.6 — the TR-01 detector host (`tr01-host.ts`), owned by this document. `null` or absent means
   * no text-region detector: every visual region is then masked whole, never left unmasked.
   */
  readonly textRegions?: {
    detect(frame: Tr01Frame, options?: { readonly deadlineMs?: number }): Promise<Tr01Outcome>;
  } | null;
  /** VERIFICATION SEAM (test builds only): see `SanitizeInput.beforeFill`. */
  readonly onMaskPlanned?: (frame: RgbaFrame, pixelRects: readonly PixelRect[]) => void;
  /**
   * VERIFICATION SEAM (test builds only): told the NAME of each stage as the pass reaches it, so a
   * real-capture run can record the order it actually ran in. A name, never a pixel or a box.
   */
  readonly onStage?: (stage: PassStage) => void;
  readonly now?: () => number;
}

/** The pass's stages, in the order it runs them. */
export type PassStage = "frame" | "uihead:start" | "uihead:end" | "tr01:start" | "tr01:end" | "findings" | "mask:end";

export interface PerceptionOptions {
  readonly collect?: boolean;
  readonly documentId?: string | null;
  /** May only TIGHTEN TR-01's 2,000 ms deadline for this pass (the host clamps it). */
  readonly detectorDeadlineMs?: number;
}

export interface PerceptionRealm {
  /**
   * Capture, detect, redact and fuse against a DOM graph this realm already has. Never throws.
   *
   * `visualRegions` are the OBSERVATION's regions for the same document, in CSS pixels. Required.
   */
  perceive(
    graph: ElementGraph,
    measurement: ViewportMeasurement,
    visualRegions: readonly VisualRegion[],
    options?: PerceptionOptions
  ): Promise<PerceptionSummary>;
  /** The last pass's sanitized frame, or `null` — after a REFUSED or failed pass, always `null`. */
  sanitizedFrame(): SanitizedFrame | null;
  readonly modelId: string;
  readonly revision: string;
}

export function createPerceptionRealm(deps: PerceptionRealmDeps): PerceptionRealm {
  const now = deps.now ?? (() => Date.now());
  const backend: Backend = "wasm";
  let sequence = 0;

  /**
   * The pass's decoded pixels, decoded ONCE.
   *
   * The capture tier must measure a frame's real dimensions rather than assume them, and the
   * detector must rasterise the same frame. In M3 those were two decodes of identical bytes. This
   * is the same pixels, handed to both.
   */
  let current: DecodedImage | null = null;
  /** The only frame this realm keeps between passes: the last SANITIZED one. */
  let sanitized: SanitizedFrame | null = null;
  /** Rasterise-and-normalise time, accumulated inside the pass so it is reported, not inferred. */
  let preprocessMs = 0;
  /** The head's anchor count, read off the output tensor rather than assumed from the contract. */
  let anchors = 0;

  const runtime: HeadRuntime | null =
    deps.session === null || deps.ort === null
      ? null
      : {
          modelId: deps.modelId,
          revision: deps.revision,
          acceptedBackends: deps.acceptedBackends,
          preprocess: (_frame: CaptureFrame, _transform: LetterboxTransform, contract: HeadTensorContract) => {
            if (current === null) throw new Error("no decoded frame for this pass");
            const t0 = now();
            // The package owns every arithmetic decision here: resize, pad, channel order,
            // normalisation. This file supplies pixels and nothing else.
            const tensor = preprocessToTensor(current, contract).tensor;
            preprocessMs += now() - t0;
            return Promise.resolve(tensor);
          },
          infer: async (input: Float32Array, size: number): Promise<HeadOutput> => {
            const session = deps.session as OrtSession;
            const ort = deps.ort as OrtGlobal;
            const feeds = { [session.inputNames[0] as string]: new ort.Tensor("float32", input, [1, 3, size, size]) };
            const out = await session.run(feeds);
            const first = out[session.outputNames[0] as string];
            if (!first) throw new Error("the session produced no output tensor");
            anchors = first.dims[2] ?? 0;
            return { data: first.data, dims: first.dims };
          },
        };

  const detector: Detector = createUiElementDetector(runtime);
  /** A seam that throws must not change the pass it is watching. */
  const stage = (s: PassStage): void => {
    try {
      deps.onStage?.(s);
    } catch {
      /* the observer's failure is its own */
    }
  };

  return {
    modelId: detector.modelId,
    revision: detector.revision,
    sanitizedFrame: () => sanitized,

    async perceive(
      graph: ElementGraph,
      measurement: ViewportMeasurement,
      visualRegions: readonly VisualRegion[],
      options: PerceptionOptions = {}
    ): Promise<PerceptionSummary> {
      const started = now();
      anchors = 0;
      current = null;
      // A new pass starts with NO frame held: an older frame must never stand in for this one.
      sanitized = null;
      preprocessMs = 0;
      let decodeMs = 0;
      let encodeMs = 0;

      const tCapture = now();
      let ticket: CaptureTicket;
      try {
        // The document this frame is wanted FOR. A grant belongs to a page, not a tab number.
        ticket = await deps.requestCapture(options.documentId ?? null);
      } catch (cause) {
        return perceptionRefused("CAPTURE_FAILED", String((cause as Error)?.message ?? cause));
      }
      if (!ticket.ok) {
        // The browser's own quota message is classified rather than retried into: the adapter
        // reports, the caller decides. An unrecognised message stays CAPTURE_FAILED, which
        // promises nothing.
        const code = isThrottleSignature(ticket.detail) ? "CAPTURE_THROTTLED" : ticket.refused;
        return perceptionRefused(code, ticket.detail);
      }

      const route: CaptureRoute = ticket.route;
      let image: RawImage;
      let rawBitmapClosed = false;
      /** Present only when the frame arrived encoded. A live frame is never encoded to fill it. */
      let encoded: Uint8Array | undefined;
      try {
        if (ticket.route === "GESTURE_STREAM") {
          /**
           * THE PIXELS ARRIVE HERE AND NOWHERE ELSE. `getUserMedia` resolves in this document
           * against a handle the worker carried; the media never passes through a message.
           */
          /**
           * ASK FOR A FRAME SHAPED LIKE THE TAB, THEN MEASURE WHAT ARRIVED ANYWAY.
           *
           * MEASURED on W1, on the first real gesture run: an unconstrained tab stream came back
           * **1920x1200** for a **1280x720** viewport — 16:10 against 16:9 — so the two axis scales
           * were 0.667 and 0.600, ten percent apart, and `assertGeometryConsistent` refused the
           * frame with CAPTURE_DIMENSION_MISMATCH. It was right to: a single `scale_to_css` cannot
           * describe both axes, and every coordinate derived from that frame would have been wrong
           * on one of them.
           *
           * `captureVisibleTab` never showed this because it returns the tab's own pixels. A media
           * stream has its own frame size and fits the tab into it.
           *
           * So the constraint asks for the CSS viewport's exact dimensions. `max` rather than
           * `min`+`max`, because an unsatisfiable constraint throws and a smaller frame is still a
           * usable one — and because the size is then a REQUEST, not an assumption. What the
           * geometry is built from is still the bitmap that actually arrived.
           */
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              mandatory: {
                chromeMediaSource: "tab",
                chromeMediaSourceId: ticket.handle,
                maxWidth: Math.round(measurement.viewportCssWidth),
                maxHeight: Math.round(measurement.viewportCssHeight),
              },
            },
          } as unknown as MediaStreamConstraints);
          const track = stream.getVideoTracks()[0];
          if (!track) throw new Error("the tab stream carried no video track");
          try {
            const capturer = new (globalThis as unknown as {
              ImageCapture: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> };
            }).ImageCapture(track);
            ({ image, closed: rawBitmapClosed } = rgbaFrom(await capturer.grabFrame()));
          } finally {
            // One frame, then the tab stops being captured. A live track is an open camera.
            track.stop();
          }
          /**
           * NOTHING IS ENCODED HERE, AND THAT IS THE POINT.
           *
           * M4 re-encoded this bitmap to PNG so `CaptureFrame.pixels` would be a truthful PNG
           * rather than a claim. It cost **1040 ms of a 1252 ms pass** on W1 and produced bytes
           * that no code read: the detector preprocesses the decoded RGBA this realm already
           * holds, and the only other reader of `pixels` in the package — `frameHash` — is not
           * called anywhere in the product.
           *
           * `CaptureFrame` now says where a frame came from, so a frame that was never compressed
           * does not get compressed to satisfy a field.
           */
          encoded = undefined;
        } else {
          const tDecode = now();
          const decoded = decodeDataUrl(ticket.dataUrl);
          if (decoded.format !== "png") throw new Error(`the worker returned image/${decoded.format}`);
          ({ image, closed: rawBitmapClosed } = rgbaFrom(await createImageBitmap(new Blob([decoded.bytes as unknown as BlobPart], { type: "image/png" }))));
          decodeMs = now() - tDecode;
          encoded = decoded.bytes;
        }
      } catch (cause) {
        return perceptionRefused("CAPTURE_FAILED", String((cause as Error)?.message ?? cause), route);
      }
      const captureMs = now() - tCapture - decodeMs - encodeMs;
      current = image;
      stage("frame");

      let geometry: CaptureGeometry;
      try {
        // Measured from the frame's own dimensions. Assuming `viewportCss × dpr` is exactly what
        // CAPTURE_DIMENSION_MISMATCH exists to catch, and it catches nothing if the value it
        // checks came from the assumption.
        geometry = geometryFrom(measurement, image.width, image.height);
      } catch (cause) {
        // A frame whose geometry cannot be trusted cannot be masked: it is overwritten, not kept.
        wipeFrame(image);
        return perceptionRefused("CAPTURE_DIMENSION_MISMATCH", String((cause as Error)?.message ?? cause), route);
      }

      sequence += 1;
      // The frame the detector is given must be the frame the graph belongs to, or fusion would
      // join two different moments. The transport mints a frame id per reading; this adopts it.
      const framed: CaptureFrame = {
        id: graph.frameId ?? toFrameId(`perception-${sequence}`),
        capturedAt: now(),
        // A stream frame is `live` and carries no bytes; a worker frame arrived encoded and does.
        ...(encoded === undefined
          ? { source: "live" as const }
          : { source: "encoded" as const, pixels: encoded, format: "png" as const }),
        geometry,
      };
      const captureBlock = {
        w: geometry.captureSize.w,
        h: geometry.captureSize.h,
        /** What the frame actually is, rather than what a field once had to say it was. */
        format: encoded === undefined ? "live-bitmap" : "png",
        /** Encoded length, or the decoded RGBA's length when nothing was encoded. */
        bytes: encoded === undefined ? image.rgba.length : encoded.length,
        dpr: geometry.dpr,
        scaleToCss: geometry.viewportCss.w / geometry.captureSize.w,
      };

      const tInfer = now();
      stage("uihead:start");
      const detected = await detector.detect(framed, backend);
      stage("uihead:end");
      const inferMs = now() - tInfer - preprocessMs;

      let visual: readonly VisualDetection[] = [];
      let detectorRefusal: { code: string; detail: string } | null = null;
      if (detected.ok) visual = toVisualDetections(detected.value, framed, detector);
      else detectorRefusal = { code: detected.code, detail: detected.detail };

      const byClass: Record<string, number> = {};
      for (const d of visual) byClass[d.label] = (byClass[d.label] ?? 0) + 1;

      /**
       * The text tier runs on the SAME decoded pixels, in this realm, and returns findings that
       * structurally cannot carry a string. Today it reports its own absence; the call is here so
       * that absence is recorded on every pass rather than inferred from a missing field.
       */
      /**
       * M10.6 — TR-01, AFTER the UI head has finished (M9: sequential, never concurrent), on the
       * FULL frame. The host copies the pixels for its worker; this realm keeps its own.
       */
      const tText = now();
      stage("tr01:start");
      const textOutcome: Tr01Outcome = deps.textRegions
        ? await deps.textRegions.detect(
            { width: image.width, height: image.height, rgba: image.rgba },
            options.detectorDeadlineMs === undefined ? {} : { deadlineMs: options.detectorDeadlineMs }
          )
        : { ok: false, runId: null, code: "DETECTOR_UNAVAILABLE", detail: "no text-region detector in this realm" };
      stage("tr01:end");
      const detectorMs = now() - tText;

      const text = await perceiveText(deps.text ?? null, image, now);

      /**
       * THE REDACTION STAGE: full-frame boxes → UNREAD_REGION per visual region → fail-closed plan
       * → canonical geometry → opaque fill, IN PLACE. After this, `image` IS the sanitized frame.
       */
      const tMap = now();
      const report = reportFromFullFrame(textOutcome, geometry, visualRegions);
      const mappingMs = now() - tMap;
      stage("findings");
      const redacted = sanitizeFrame({
        frame: image,
        geometry,
        regions: visualRegions,
        report,
        now,
        ...(deps.onMaskPlanned ? { beforeFill: deps.onMaskPlanned } : {}),
      });
      stage("mask:end");
      sanitized = redacted.outcome === "SANITIZED" ? { frameId: framed.id, width: image.width, height: image.height, rgba: image.rgba } : null;
      const sane = redacted.outcome === "SANITIZED" ? redacted : null;
      const redaction: RedactionSummary = {
        outcome: redacted.outcome,
        failClosed: sane ? sane.failClosed : null,
        reason: sane ? sane.reason : null,
        refusal: redacted.outcome === "REFUSED" ? { code: redacted.code, detail: redacted.detail } : null,
        detector: {
          modelId: TR01.modelId,
          ran: textOutcome.ok,
          code: textOutcome.ok ? null : textOutcome.code,
          detections: textOutcome.ok ? textOutcome.detections.length : 0,
        },
        regions: visualRegions.length,
        maskRects: sane ? sane.regions.reduce((n, r) => n + r.pixelRects.length, 0) : 0,
        pixelWrites: sane ? sane.pixelWrites : 0,
        rawBitmapClosed,
        frameKept: sanitized !== null,
        ms: {
          detector: detectorMs,
          mapping: mappingMs,
          plan: sane ? sane.ms.plan : 0,
          pixelMapping: sane ? sane.ms.pixelMapping : 0,
          fill: sane ? sane.ms.fill : 0,
        },
        ...(options.collect
          ? {
              detail: {
                visualRegions: visualRegions.map((r) => ({ id: r.id, rect: { x: r.rect.x, y: r.rect.y, w: r.rect.w, h: r.rect.h } })),
                detections: textOutcome.ok ? textOutcome.detections : [],
                masks: sane ? sane.regions.map((r) => ({ regionId: r.regionId, cssMask: r.cssMask, pixelRects: r.pixelRects })) : [],
              },
            }
          : {}),
      };

      const tFuse = now();
      const sourceBySelector: Record<string, SanitizedElement["source"]> = {};
      let fusion: FusionResult;
      let elements: readonly SanitizedElement[];
      try {
        fusion = fuse(graph, visual, detected.ok, geometry);
        elements = fusion.elements.map(projectElement);
        for (const element of fusion.elements) {
          // Only elements the DOM also knows have a selector to key on. A vision-only element has
          // a synthetic id and stays out of this map by construction.
          const node = graph.byId.get(element.id);
          if (node) sourceBySelector[node.domRef.selector] = projectElement(element).source;
        }
      } catch (cause) {
        // A pass that failed does not hand a frame on, even a sanitized one.
        sanitized = null;
        return {
          ...perceptionRefused("FUSION_FAILED", String((cause as Error)?.message ?? cause), route),
          capture: captureBlock,
          text: textPerceptionAbsent(),
          redaction: { ...redaction, frameKept: false },
          workerSawPixels: route === "WORKER_FRAME",
          ms: { capture: captureMs, decode: decodeMs, encode: encodeMs, preprocess: preprocessMs, infer: inferMs, fuse: 0, total: now() - started },
        };
      } finally {
        // The pass is over. The largest thing this file touched does not outlive it.
        current = null;
      }
      const fuseMs = now() - tFuse;

      return {
        ran: true,
        refusal: null,
        route,
        workerSawPixels: route === "WORKER_FRAME",
        capture: captureBlock,
        detector: {
          modelId: detector.modelId,
          revision: detector.revision,
          backend,
          ran: detected.ok,
          detections: visual.length,
          byClass,
          refusal: detectorRefusal,
        },
        fusion: {
          matched: fusion.matchedCount,
          visionOnly: fusion.visionOnlyCount,
          domOnly: fusion.domOnlyCount,
          overlaySuspected: fusion.overlaySuspectCount,
        },
        text,
        redaction,
        elements,
        sourceBySelector,
        ...(options.collect
          ? {
              detail: {
                anchors,
                afterFiltering: visual.length,
                threshold: PROVISIONAL_THRESHOLDS.score,
                detections: visual.map((d) => ({
                  box: { x: d.box.x, y: d.box.y, w: d.box.w, h: d.box.h },
                  label: d.label,
                  score: d.score,
                })),
              },
            }
          : {}),
        ms: { capture: captureMs, decode: decodeMs, encode: encodeMs, preprocess: preprocessMs, infer: inferMs, fuse: fuseMs, total: now() - started },
      };
    },
  };
}
