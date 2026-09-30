/**
 * M10.4 — THE TR-01 WORKER'S LOGIC, with the browser removed so it can be tested in Node.
 *
 * `host/tr01-worker.ts` is the entry that runs inside the dedicated worker: it loads the pinned ORT
 * bundle and supplies the three things this file cannot do itself (install the verified runtime,
 * read the pinned model, create a session). Everything else — the message contract, the order of
 * initialisation, one run at a time, and turning a probability map into boxes — is here.
 *
 * WHAT IT IS: a computation engine. Pixels in, `{ x, y, w, h, score }` out, via the SAME
 * `createTextRegionDetector` M10.1 committed and golden-tested (preprocess → session → validate →
 * screened DB post-processing). Nothing is re-implemented here.
 *
 * WHAT IT IS NOT: a privacy authority. It does not know which region a frame came from, what a box
 * means, or whether anything is sensitive. It never reads text, never makes a network request other
 * than the model fetch the pin performs inside the package, never touches a DOM, encodes nothing,
 * and sends nothing but the replies below.
 *
 * FAILURE IS A MESSAGE, NEVER AN EMPTY LIST. A DETECT before READY, a malformed request, a runtime
 * error or a malformed model output each produce TR01_REFUSED. The only way to get `detections: []`
 * is a run that completed and found nothing.
 */
import { createTextRegionDetector, frameId, TR01, type CaptureFrame, type TextRegionOutput } from "@pratibimb/perception";

import {
  boundedDetail,
  parseTr01Request,
  TR01_PROTOCOL,
  type Tr01InitFailureCode,
  type Tr01Reply,
  type Tr01WorkerRefusalCode,
} from "./tr01-protocol";

/** A created session, reduced to the one call the detector needs. */
export interface Tr01Session {
  infer(tensor: Float32Array, dims: readonly [1, 3, number, number]): Promise<TextRegionOutput>;
}

/** An initialisation failure carries a code and, for a model mismatch, what was actually read. */
export class Tr01InitError extends Error {
  constructor(
    message: string,
    readonly code: Tr01InitFailureCode,
    readonly observed: { readonly sha256: string | null; readonly bytes: number | null } = { sha256: null, bytes: null }
  ) {
    super(message);
  }
}

export interface Tr01WorkerDeps {
  /** Install the verified ORT runtime in this realm. Throws Tr01InitError("RUNTIME_UNAVAILABLE"). */
  installRuntime(): Promise<void>;
  /** Read the packaged model and verify it against the pin. Throws Tr01InitError. */
  loadModel(): Promise<{ readonly bytes: Uint8Array; readonly sha256: string }>;
  /** Create the session from the verified bytes. Throws Tr01InitError("SESSION_FAILED"). */
  createSession(model: Uint8Array): Promise<Tr01Session>;
  post(reply: Tr01Reply): void;
  now(): number;
}

export interface Tr01WorkerCore {
  handle(message: unknown): Promise<void>;
}

/** An identity geometry: the detector reports boxes in the pixel space of the frame it was given. */
const frameOf = (runId: number, width: number, height: number): CaptureFrame => ({
  id: frameId(`tr01-run-${runId}`),
  capturedAt: 0,
  source: "live",
  geometry: {
    dpr: 1,
    zoom: 1,
    viewportCss: { w: width, h: height },
    captureSize: { w: width, h: height },
    scroll: { x: 0, y: 0 },
    origin: "tr01-worker://frame",
  },
});

export function createTr01WorkerCore(deps: Tr01WorkerDeps): Tr01WorkerCore {
  let session: Tr01Session | null = null;
  let initialising = false;
  let initialised = false;
  let busy = false;

  const refuse = (runId: number | null, code: Tr01WorkerRefusalCode, detail: string): void =>
    deps.post({ type: "TR01_REFUSED", protocol: TR01_PROTOCOL, runId, code, detail: boundedDetail(detail) });

  async function init(): Promise<void> {
    // One initialisation per worker. A second INIT is a protocol error, not a re-load: a worker that
    // needs a fresh session is terminated and replaced by the offscreen document.
    if (initialising || initialised) {
      refuse(null, "PROTOCOL_ERROR", "TR01_INIT received twice; a worker initialises once");
      return;
    }
    initialising = true;
    try {
      const t0 = deps.now();
      await deps.installRuntime();
      const t1 = deps.now();
      const model = await deps.loadModel();
      const t2 = deps.now();
      session = await deps.createSession(model.bytes);
      const t3 = deps.now();
      initialised = true;
      deps.post({
        type: "TR01_READY",
        protocol: TR01_PROTOCOL,
        model: { sha256: model.sha256, bytes: model.bytes.length },
        ms: { runtime: t1 - t0, model: t2 - t1, session: t3 - t2 },
      });
    } catch (cause) {
      session = null;
      const e = cause instanceof Tr01InitError ? cause : new Tr01InitError(String((cause as Error)?.message ?? cause), "RUNTIME_UNAVAILABLE");
      deps.post({
        type: "TR01_INIT_FAILED",
        protocol: TR01_PROTOCOL,
        code: e.code,
        detail: boundedDetail(e.message),
        observed: { sha256: e.observed.sha256, bytes: e.observed.bytes },
      });
    } finally {
      initialising = false;
    }
  }

  async function detect(runId: number, width: number, height: number, rgba: Uint8ClampedArray): Promise<void> {
    if (session === null) return refuse(runId, "DETECTOR_UNAVAILABLE", "no session: the worker is not initialised");
    // One inference at a time, in this worker. The host already refuses a second request while one
    // is in flight; this is the same rule held on the other side of the boundary.
    if (busy) return refuse(runId, "DETECTOR_BUSY", "an inference is already running in this worker");
    busy = true;
    const ms = { preprocess: 0, infer: 0, postprocess: 0 };
    try {
      const live = session;
      const detector = createTextRegionDetector({
        modelId: TR01.modelId,
        revision: TR01.revision,
        acceptedBackends: TR01.acceptedBackends,
        pixels: () => ({ width, height, rgba }),
        infer: (tensor, dims) => live.infer(tensor, dims),
        onStage: (stage, t) => {
          ms[stage] += t;
        },
        now: deps.now,
      });
      const out = await detector.detect(frameOf(runId, width, height), "wasm");
      if (!out.ok) {
        const code: Tr01WorkerRefusalCode = out.code === "MODEL_OUTPUT_MALFORMED" ? "MODEL_OUTPUT_MALFORMED" : "DETECTOR_UNAVAILABLE";
        return refuse(runId, code, out.detail);
      }
      // Geometry and score, copied field by field: nothing the detector might have carried rides
      // along, and the constant label is dropped because it says nothing.
      const detections = out.value.map((d) => ({ x: d.box.x, y: d.box.y, w: d.box.w, h: d.box.h, score: d.score }));
      deps.post({ type: "TR01_RESULT", protocol: TR01_PROTOCOL, runId, detections, ms });
    } catch (cause) {
      refuse(runId, "DETECTOR_UNAVAILABLE", String((cause as Error)?.message ?? cause));
    } finally {
      busy = false;
    }
  }

  return {
    async handle(message: unknown): Promise<void> {
      const request = parseTr01Request(message);
      if (!request) {
        const runId = typeof (message as { runId?: unknown })?.runId === "number" ? ((message as { runId: number }).runId) : null;
        return refuse(Number.isInteger(runId) && (runId as number) >= 0 ? runId : null, "PROTOCOL_ERROR", "malformed request");
      }
      switch (request.type) {
        case "TR01_INIT":
          return init();
        case "TR01_DETECT":
          return detect(request.runId, request.width, request.height, request.rgba);
      }
    },
  };
}
