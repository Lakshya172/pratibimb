/**
 * M3 — LOCAL VISUAL PERCEPTION, IN THE REALM THAT ALREADY HOLDS THE RUNTIME.
 *
 * This is the extension-side adapter for `@pratibimb/perception`. It builds nothing that package
 * already builds: the letterbox, the tensor layout, the head decode, the coordinate transforms and
 * the DOM/vision join are all that package's, called from here. What lives in this file is the
 * three things a package that "makes no network calls and compiles no WebAssembly" deliberately
 * cannot do — decode an image, rasterise it on a canvas, and run an ORT session.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHERE THE PIXELS ARE, AND WHY THEY ARE THERE
 *
 * MEASURED on W1, not assumed (`REALM_PROBE`):
 *
 *   content script   `chrome.tabs` absent              cannot capture
 *   offscreen doc    `chrome.tabs` absent entirely     cannot capture; HAS OffscreenCanvas, ORT, WASM
 *   service worker   `captureVisibleTab` present       CAN capture, with activeTab or <all_urls>
 *
 * So on Chrome MV3 the service worker is the ONLY realm that can obtain page pixels without a user
 * gesture, and the route that would avoid it — `tabCapture.getMediaStreamId`, whose pixels would
 * flow straight into this document through the media pipeline while the worker held only an opaque
 * id — refuses without an `activeTab` invocation that no harness can produce.
 *
 * **That is a real weakening relative to M2 and it is stated rather than dressed up.** A page's DOM
 * values never enter a worker message; a page's PIXELS do, on exactly one hop, because Chrome
 * offers no other door. What this file can do, and does, is make that hop the only one: the bytes
 * arrive here, are decoded here, are detected on here, and are dropped here. Nothing derived from
 * them that leaves this realm carries a pixel.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THE DETECTOR CANNOT LEAK TEXT, BY CONSTRUCTION
 *
 * `UI_CLASSES` is eight interactable classes and no text class; a `Detection` is a box, a label
 * from that fixed list, and a score. There is no OCR in this milestone and no field for one. So the
 * strongest privacy property here is not a check that ran — it is that the detector is structurally
 * incapable of producing the characters on the screen. A sanitizer can only be as good as its
 * detectors; a detector that emits no text cannot leak any.
 *
 * WHAT THIS DOES NOT CLAIM. The artifact is `CONDITIONAL` in the feasibility matrix and W1-QG03
 * measured why: the preprocessing a browser can actually perform moves 16–34% of its detections.
 * This file runs it, records what it produced, and asserts nothing about whether the boxes are
 * right. M3 verifies a pipeline and a boundary, not a detector.
 */
import {
  type Backend,
  type CaptureFrame,
  type CaptureGeometry,
  type Detector,
  type ElementGraph,
  type FusionResult,
  type HeadOutput,
  type HeadRuntime,
  type LetterboxTransform,
  type HeadTensorContract,
  type Perceived,
  type SanitizedElement,
  type ViewportMeasurement,
  type VisualDetection,
  createTabCaptureAdapter,
  createUiElementDetector,
  fuse,
  preprocessToTensor,
  projectElement,
  toVisualDetections,
} from "@pratibimb/perception";

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
  readonly capture: {
    readonly w: number;
    readonly h: number;
    readonly format: string;
    /** The encoded PNG's length. The bytes themselves are not here and never leave this realm. */
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
   * selector, so there is nothing for the manifest to attach them to — and in M3 that is the right
   * answer rather than a gap: an element only pixels assert is not something this milestone lets a
   * plan target. It is counted, and it is not made actionable.
   */
  readonly sourceBySelector: Readonly<Record<string, SanitizedElement["source"]>>;
  readonly ms: {
    readonly capture: number;
    readonly decode: number;
    readonly preprocess: number;
    readonly infer: number;
    readonly fuse: number;
    readonly total: number;
  };
}

/** A pass that could not start. Still a summary, so callers have one shape to read. */
export const perceptionRefused = (code: string, detail: string): PerceptionSummary => ({
  ran: false,
  refusal: { code, detail },
  capture: null,
  detector: { modelId: "none", revision: "none", backend: "wasm", ran: false, detections: 0, byClass: {}, refusal: null },
  fusion: null,
  elements: [],
  sourceBySelector: {},
  ms: { capture: 0, decode: 0, preprocess: 0, infer: 0, fuse: 0, total: 0 },
});

/** Decode an encoded image into RGBA, on this realm's own canvas. */
async function decodeRgba(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context in this realm");
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, rgba: data.data };
  } finally {
    // The decoded bitmap is the largest thing this function touches. Released on every path.
    bitmap.close();
  }
}

export interface PerceptionRealmDeps {
  /**
   * Ask for one frame. The worker is on the other end because it is the only realm that can
   * capture; what comes back is base64 PNG, and it is decoded and dropped inside this file.
   */
  readonly requestCapture: () => Promise<{ ok: true; dataUrl: string } | { ok: false; refused: string }>;
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
  perceive(graph: ElementGraph, measurement: ViewportMeasurement): Promise<PerceptionSummary>;
  readonly modelId: string;
  readonly revision: string;
}

export function createPerceptionRealm(deps: PerceptionRealmDeps): PerceptionRealm {
  const now = deps.now ?? (() => Date.now());
  const backend: Backend = "wasm";

  let decodeMs = 0;
  let preprocessMs = 0;

  /**
   * The capture adapter, over a `captureVisibleTab` the worker performs on this realm's behalf.
   *
   * `decodeSize` really decodes: the perception tier refuses to ASSUME the capture is
   * `viewportCss * dpr`, because that assumption is exactly what CAPTURE_DIMENSION_MISMATCH exists
   * to catch, and it catches nothing if the value it checks came from the assumption.
   */
  const adapter = createTabCaptureAdapter(
    {
      captureVisibleTab: async () => {
        const answer = await deps.requestCapture();
        if (!answer.ok) throw new Error(answer.refused);
        return answer.dataUrl;
      },
    },
    async (bytes, format) => {
      const t0 = now();
      const image = await decodeRgba(bytes, `image/${format}`);
      decodeMs += now() - t0;
      return { width: image.width, height: image.height };
    },
    now
  );

  const runtime: HeadRuntime | null =
    deps.session === null || deps.ort === null
      ? null
      : {
          modelId: deps.modelId,
          revision: deps.revision,
          acceptedBackends: deps.acceptedBackends,
          preprocess: async (frame: CaptureFrame, _transform: LetterboxTransform, contract: HeadTensorContract) => {
            const t0 = now();
            const image = await decodeRgba(frame.pixels, `image/${frame.format}`);
            // The package owns every arithmetic decision here: resize, pad, channel order,
            // normalisation. This file supplies pixels and nothing else.
            const stages = preprocessToTensor(image, contract);
            preprocessMs += now() - t0;
            return stages.tensor;
          },
          infer: async (input: Float32Array, size: number): Promise<HeadOutput> => {
            const session = deps.session as OrtSession;
            const ort = deps.ort as OrtGlobal;
            const feeds = { [session.inputNames[0] as string]: new ort.Tensor("float32", input, [1, 3, size, size]) };
            const out = await session.run(feeds);
            const first = out[session.outputNames[0] as string];
            if (!first) throw new Error("the session produced no output tensor");
            return { data: first.data, dims: first.dims };
          },
        };

  const detector: Detector = createUiElementDetector(runtime);

  return {
    modelId: detector.modelId,
    revision: detector.revision,

    async perceive(graph: ElementGraph, measurement: ViewportMeasurement): Promise<PerceptionSummary> {
      const started = now();
      decodeMs = 0;
      preprocessMs = 0;

      const tCapture = now();
      let frame: Perceived<CaptureFrame>;
      try {
        frame = await adapter.capture(measurement);
      } catch (cause) {
        return perceptionRefused("CAPTURE_FAILED", String((cause as Error)?.message ?? cause));
      }
      const captureMs = now() - tCapture - decodeMs;
      if (!frame.ok) return perceptionRefused(frame.code, frame.detail);

      const captured = frame.value;
      const geometry: CaptureGeometry = captured.geometry;
      const captureBlock = {
        w: geometry.captureSize.w,
        h: geometry.captureSize.h,
        format: captured.format,
        bytes: captured.pixels.length,
        dpr: geometry.dpr,
        scaleToCss: geometry.viewportCss.w / geometry.captureSize.w,
      };

      // The frame the detector is given must be the frame the graph belongs to, or fusion would
      // join two different moments. The transport mints a frame id per reading; this adopts it.
      const framed: CaptureFrame = { ...captured, id: graph.frameId };

      const tInfer = now();
      const detected = await detector.detect(framed, backend);
      const inferMs = now() - tInfer - preprocessMs;

      let visual: readonly VisualDetection[] = [];
      let detectorRefusal: { code: string; detail: string } | null = null;
      if (detected.ok) {
        visual = toVisualDetections(detected.value, framed, detector);
      } else {
        detectorRefusal = { code: detected.code, detail: detected.detail };
      }

      const byClass: Record<string, number> = {};
      for (const d of visual) byClass[d.label] = (byClass[d.label] ?? 0) + 1;

      const tFuse = now();
      const sourceBySelector: Record<string, SanitizedElement["source"]> = {};
      let fusion: FusionResult | null = null;
      let elements: readonly SanitizedElement[] = [];
      try {
        fusion = fuse(graph, visual, detected.ok, geometry);
        elements = fusion.elements.map(projectElement);
        for (const element of fusion.elements) {
          // Only elements the DOM also knows have a selector to key on.
          const node = graph.byId.get(element.id);
          if (node) sourceBySelector[node.domRef.selector] = projectElement(element).source;
        }
      } catch (cause) {
        // A fusion that cannot be computed is reported, never approximated.
        return {
          ...perceptionRefused("FUSION_FAILED", String((cause as Error)?.message ?? cause)),
          capture: captureBlock,
          ms: { capture: captureMs, decode: decodeMs, preprocess: preprocessMs, infer: inferMs, fuse: 0, total: now() - started },
        };
      }
      const fuseMs = now() - tFuse;

      return {
        ran: true,
        refusal: null,
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
        ms: { capture: captureMs, decode: decodeMs, preprocess: preprocessMs, infer: inferMs, fuse: fuseMs, total: now() - started },
      };
    },
  };
}
