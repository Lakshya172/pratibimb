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

import { type CaptureRoute, type CaptureTicket } from "./capture-authority";

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
    /** Encoding a PNG so the frame record is truthful. Gesture route only. */
    readonly encode: number;
    readonly preprocess: number;
    readonly infer: number;
    readonly fuse: number;
    readonly total: number;
  };
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
  elements: [],
  sourceBySelector: {},
  ms: { capture: 0, decode: 0, encode: 0, preprocess: 0, infer: 0, fuse: 0, total: 0 },
});

/** A bitmap turned into the RGBA the perception package's preprocessor wants. Closed on every path. */
function rgbaFrom(bitmap: ImageBitmap): DecodedImage {
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context in this realm");
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, rgba: data.data };
  } finally {
    bitmap.close();
  }
}

/** Encode RGBA back to PNG, so `CaptureFrame.pixels` is a truthful PNG rather than a claim. */
async function encodePng(image: DecodedImage): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in this realm");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

export interface PerceptionRealmDeps {
  /**
   * Ask the capture authority for one frame's worth of access.
   *
   * On the product path what comes back is an opaque handle the worker could not read anything out
   * of. On the degraded path it is a data URL the worker held.
   */
  readonly requestCapture: () => Promise<CaptureTicket>;
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
  readonly now?: () => number;
}

export interface PerceptionRealm {
  /** Capture, detect and fuse against a DOM graph this realm already has. Never throws. */
  perceive(graph: ElementGraph, measurement: ViewportMeasurement, options?: { readonly collect?: boolean }): Promise<PerceptionSummary>;
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

  return {
    modelId: detector.modelId,
    revision: detector.revision,

    async perceive(
      graph: ElementGraph,
      measurement: ViewportMeasurement,
      options: { readonly collect?: boolean } = {}
    ): Promise<PerceptionSummary> {
      const started = now();
      anchors = 0;
      current = null;
      preprocessMs = 0;
      let decodeMs = 0;
      let encodeMs = 0;

      const tCapture = now();
      let ticket: CaptureTicket;
      try {
        ticket = await deps.requestCapture();
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
      let image: DecodedImage;
      let encoded: Uint8Array;
      let format: "png";
      try {
        if (ticket.route === "GESTURE_STREAM") {
          /**
           * THE PIXELS ARRIVE HERE AND NOWHERE ELSE. `getUserMedia` resolves in this document
           * against a handle the worker carried; the media never passes through a message.
           */
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: ticket.handle } },
          } as unknown as MediaStreamConstraints);
          const track = stream.getVideoTracks()[0];
          if (!track) throw new Error("the tab stream carried no video track");
          try {
            const capturer = new (globalThis as unknown as {
              ImageCapture: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> };
            }).ImageCapture(track);
            image = rgbaFrom(await capturer.grabFrame());
          } finally {
            // One frame, then the tab stops being captured. A live track is an open camera.
            track.stop();
          }
          const tEncode = now();
          encoded = await encodePng(image);
          encodeMs = now() - tEncode;
          format = "png";
        } else {
          const tDecode = now();
          const decoded = decodeDataUrl(ticket.dataUrl);
          if (decoded.format !== "png") throw new Error(`the worker returned image/${decoded.format}`);
          image = rgbaFrom(await createImageBitmap(new Blob([decoded.bytes as unknown as BlobPart], { type: "image/png" })));
          decodeMs = now() - tDecode;
          encoded = decoded.bytes;
          format = "png";
        }
      } catch (cause) {
        return perceptionRefused("CAPTURE_FAILED", String((cause as Error)?.message ?? cause), route);
      }
      const captureMs = now() - tCapture - decodeMs - encodeMs;
      current = image;

      let geometry: CaptureGeometry;
      try {
        // Measured from the frame's own dimensions. Assuming `viewportCss × dpr` is exactly what
        // CAPTURE_DIMENSION_MISMATCH exists to catch, and it catches nothing if the value it
        // checks came from the assumption.
        geometry = geometryFrom(measurement, image.width, image.height);
      } catch (cause) {
        return perceptionRefused("CAPTURE_DIMENSION_MISMATCH", String((cause as Error)?.message ?? cause), route);
      }

      sequence += 1;
      // The frame the detector is given must be the frame the graph belongs to, or fusion would
      // join two different moments. The transport mints a frame id per reading; this adopts it.
      const framed: CaptureFrame = {
        id: graph.frameId ?? toFrameId(`perception-${sequence}`),
        capturedAt: now(),
        pixels: encoded,
        format,
        geometry,
      };
      const captureBlock = {
        w: geometry.captureSize.w,
        h: geometry.captureSize.h,
        format,
        bytes: encoded.length,
        dpr: geometry.dpr,
        scaleToCss: geometry.viewportCss.w / geometry.captureSize.w,
      };

      const tInfer = now();
      const detected = await detector.detect(framed, backend);
      const inferMs = now() - tInfer - preprocessMs;

      let visual: readonly VisualDetection[] = [];
      let detectorRefusal: { code: string; detail: string } | null = null;
      if (detected.ok) visual = toVisualDetections(detected.value, framed, detector);
      else detectorRefusal = { code: detected.code, detail: detected.detail };

      const byClass: Record<string, number> = {};
      for (const d of visual) byClass[d.label] = (byClass[d.label] ?? 0) + 1;

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
        return {
          ...perceptionRefused("FUSION_FAILED", String((cause as Error)?.message ?? cause), route),
          capture: captureBlock,
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
