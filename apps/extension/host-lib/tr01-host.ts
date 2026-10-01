/**
 * M10.4 — THE TR-01 DETECTOR HOST, owned by the offscreen document (the perception realm).
 *
 * The offscreen document owns the pixels; the detector runs in ONE dedicated worker that this host
 * creates, feeds, times and — when it must — terminates. This file holds every decision about that
 * worker; the worker itself (`tr01-worker-core.ts`) only computes.
 *
 * LIFECYCLE
 *
 *     idle ──detect──► initialising ──READY──► ready ──detect──► running ──RESULT──► ready
 *                           │                                       │
 *                     INIT_FAILED / hang                  deadline / crash / bad reply
 *                           ▼                                       ▼
 *                      unavailable                   worker TERMINATED → idle (the next detect
 *               (for this document's life; no retry)   creates a fresh worker; nothing retries on its own)
 *
 * - Lazy: nothing is created until the first `detect`.
 * - One worker per document, at most one run in flight. A `detect` while initialising or running is
 *   REFUSED with DETECTOR_BUSY rather than queued: the caller decides what to do, and there is no
 *   hidden queue that could run two inferences or reorder frames.
 * - An initialisation failure makes the tier UNAVAILABLE for the document's life (M9 lifecycle). No
 *   silent retry, no alternate model, no OCR fallback.
 *
 * THE DEADLINE IS ENFORCED FROM OUTSIDE (owner decision D3: 2,000 ms per frame, excluding one-time
 * initialisation). WASM inference occupies the worker's thread, so a timer inside it could not fire
 * until inference ended. The timer lives HERE, starts when the DETECT is posted to a ready worker,
 * and on expiry calls `worker.terminate()`, which stops the inference where it stands. The run's
 * outcome is DETECTOR_TIMEOUT — not a partial result and not an empty list — and the next `detect`
 * starts a new worker.
 *
 * STALE REPLIES CANNOT LAND. Each worker gets a generation number and each run a run id; a reply is
 * accepted only if it comes from the CURRENT worker for the CURRENT run. A terminated worker's
 * handlers are detached, and anything that still arrives is counted and dropped.
 *
 * NO REGION IDENTITY CROSSES. `detect` takes a frame of pixels; which visual-only region it came
 * from is the caller's to remember. The worker cannot name a region, so it cannot misattribute one.
 */
import { boundedDetail, parseTr01Reply, TR01_PROTOCOL, type Tr01Detection, type Tr01Reply } from "./tr01-protocol";
import { TR01_DEADLINE_MS, TR01_INIT_DEADLINE_MS, TR01_WORKER_SCRIPT } from "./tr01-pin";

/** The part of a `Worker` this host uses. */
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

export interface Tr01Frame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

export type Tr01HostRefusalCode =
  | "DETECTOR_UNAVAILABLE"
  | "DETECTOR_TIMEOUT"
  | "DETECTOR_BUSY"
  | "DETECTOR_ERROR"
  | "MODEL_OUTPUT_MALFORMED"
  | "DETECTOR_DISPOSED";

export type Tr01Outcome =
  | {
      readonly ok: true;
      readonly runId: number;
      readonly detections: readonly Tr01Detection[];
      readonly ms: { readonly preprocess: number; readonly infer: number; readonly postprocess: number; readonly total: number };
    }
  | { readonly ok: false; readonly runId: number | null; readonly code: Tr01HostRefusalCode; readonly detail: string };

export type Tr01State = "idle" | "initialising" | "ready" | "running" | "unavailable" | "disposed";

export interface Tr01HostStatus {
  readonly state: Tr01State;
  readonly generation: number;
  readonly workersCreated: number;
  readonly terminations: number;
  readonly staleDropped: number;
  readonly lastInit:
    | { readonly ok: true; readonly model: { readonly sha256: string; readonly bytes: number }; readonly ms: { readonly runtime: number; readonly model: number; readonly session: number } }
    | { readonly ok: false; readonly code: string; readonly detail: string; readonly observed: { readonly sha256: string | null; readonly bytes: number | null } }
    | null;
}

export interface Tr01HostOptions {
  readonly spawn: () => WorkerLike;
  readonly deadlineMs?: number;
  readonly initDeadlineMs?: number;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface Tr01Host {
  /**
   * Run TR-01 on one frame. `deadlineMs` may only TIGHTEN the owner's deadline for this run — a
   * larger value is clamped to it, so no caller can loosen the gate.
   */
  detect(frame: Tr01Frame, options?: { readonly deadlineMs?: number }): Promise<Tr01Outcome>;
  /** Initialise now instead of on the first `detect`. `true` only when the worker reported READY. */
  prepare(): Promise<boolean>;
  /** Terminate the worker and refuse everything afterwards. */
  dispose(): void;
  status(): Tr01HostStatus;
}

/** The browser spawn: a classic dedicated worker from this extension's own package. */
export const spawnTr01Worker = (): WorkerLike =>
  new Worker(new URL(`/${TR01_WORKER_SCRIPT}`, self.location.href)) as unknown as WorkerLike;

export function createTr01Host(options: Tr01HostOptions): Tr01Host {
  const deadlineMs = options.deadlineMs ?? TR01_DEADLINE_MS;
  const initDeadlineMs = options.initDeadlineMs ?? TR01_INIT_DEADLINE_MS;
  const now = options.now ?? (() => performance.now());
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let state: Tr01State = "idle";
  let worker: WorkerLike | null = null;
  let generation = 0;
  let workersCreated = 0;
  let terminations = 0;
  let staleDropped = 0;
  let nextRunId = 0;
  let lastInit: Tr01HostStatus["lastInit"] = null;

  /** Whatever the current worker is waiting to deliver. Exactly one at a time. */
  let pending:
    | { readonly kind: "init"; readonly resolve: (ok: boolean) => void; readonly timer: unknown }
    | { readonly kind: "run"; readonly runId: number; readonly frame: { readonly width: number; readonly height: number }; readonly started: number; readonly resolve: (o: Tr01Outcome) => void; readonly timer: unknown }
    | null = null;

  /** Terminate the current worker and detach it, so nothing it still says can be heard. */
  function kill(): void {
    if (worker === null) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    terminations += 1;
    worker = null;
  }

  /** Settle whatever was pending as a failure of the given kind, then drop the worker. */
  function fail(code: Tr01HostRefusalCode, detail: string, next: Tr01State): void {
    const p = pending;
    pending = null;
    if (p) clearTimer(p.timer);
    kill();
    state = next;
    if (p?.kind === "run") p.resolve({ ok: false, runId: p.runId, code, detail: boundedDetail(detail) });
    else if (p?.kind === "init") p.resolve(false);
  }

  function onReply(gen: number, data: unknown): void {
    if (gen !== generation || pending === null) {
      staleDropped += 1;
      return;
    }
    const p = pending;
    const reply: Tr01Reply | null = parseTr01Reply(data, p.kind === "run" ? p.frame : undefined);

    if (p.kind === "init") {
      if (reply?.type === "TR01_READY") {
        clearTimer(p.timer);
        pending = null;
        lastInit = { ok: true, model: reply.model, ms: reply.ms };
        state = "ready";
        p.resolve(true);
        return;
      }
      lastInit =
        reply?.type === "TR01_INIT_FAILED"
          ? { ok: false, code: reply.code, detail: reply.detail, observed: reply.observed }
          : { ok: false, code: "PROTOCOL_ERROR", detail: "the worker answered INIT with something other than READY or INIT_FAILED", observed: { sha256: null, bytes: null } };
      // M9 lifecycle: a failed create makes the tier unavailable for the document's life.
      fail("DETECTOR_UNAVAILABLE", lastInit.detail, "unavailable");
      return;
    }

    // A run. Only a reply naming THIS run from THIS worker settles it.
    // A reply for an EARLIER run of this worker (it cannot happen with one run in flight, but the
    // rule is stated as code): dropped, and the current run keeps waiting for its own answer.
    if ((reply?.type === "TR01_RESULT" || reply?.type === "TR01_REFUSED") && reply.runId !== null && reply.runId !== p.runId) {
      staleDropped += 1;
      return;
    }
    clearTimer(p.timer);
    pending = null;
    if (reply?.type === "TR01_RESULT") {
      state = "ready";
      p.resolve({ ok: true, runId: p.runId, detections: reply.detections, ms: { ...reply.ms, total: now() - p.started } });
      return;
    }
    if (reply?.type === "TR01_REFUSED") {
      state = "ready";
      const code: Tr01HostRefusalCode =
        reply.code === "MODEL_OUTPUT_MALFORMED" ? "MODEL_OUTPUT_MALFORMED" : reply.code === "DETECTOR_BUSY" ? "DETECTOR_BUSY" : "DETECTOR_ERROR";
      p.resolve({ ok: false, runId: p.runId, code, detail: reply.detail });
      return;
    }
    // Anything else — unparseable, a RESULT with a box outside the frame or an extra field — is a
    // malformed reply. The worker is no longer trusted for this document state: replace it.
    pending = p;
    fail("MODEL_OUTPUT_MALFORMED", "the worker's reply did not parse as a geometry-only result", "idle");
  }

  function spawn(): void {
    generation += 1;
    const gen = generation;
    const w = options.spawn();
    workersCreated += 1;
    w.onmessage = (event) => onReply(gen, event.data);
    w.onerror = () => {
      if (gen === generation) fail("DETECTOR_ERROR", "the detector worker raised an error", pending?.kind === "init" ? "unavailable" : "idle");
    };
    w.onmessageerror = () => {
      if (gen === generation) fail("DETECTOR_ERROR", "a message from the detector worker could not be deserialised", pending?.kind === "init" ? "unavailable" : "idle");
    };
    worker = w;
  }

  function initialise(): Promise<boolean> {
    spawn();
    state = "initialising";
    return new Promise<boolean>((resolve) => {
      const timer = setTimer(() => {
        if (pending?.kind !== "init") return;
        lastInit = { ok: false, code: "INIT_TIMEOUT", detail: `initialisation exceeded ${initDeadlineMs} ms`, observed: { sha256: null, bytes: null } };
        fail("DETECTOR_UNAVAILABLE", lastInit.detail, "unavailable");
      }, initDeadlineMs);
      pending = { kind: "init", resolve, timer };
      (worker as WorkerLike).postMessage({ type: "TR01_INIT", protocol: TR01_PROTOCOL }, []);
    });
  }

  const refused = (code: Tr01HostRefusalCode, detail: string): Tr01Outcome => ({ ok: false, runId: null, code, detail });

  return {
    async detect(frame: Tr01Frame, detectOptions: { readonly deadlineMs?: number } = {}): Promise<Tr01Outcome> {
      if (state === "disposed") return refused("DETECTOR_DISPOSED", "the detector host was disposed");
      if (state === "unavailable") return refused("DETECTOR_UNAVAILABLE", lastInit && !lastInit.ok ? lastInit.detail : "the detector is unavailable");
      if (state === "initialising" || state === "running" || pending !== null) {
        return refused("DETECTOR_BUSY", "one TR-01 run at a time; this request was not queued");
      }
      if (state === "idle") {
        const ready = await initialise();
        if (!ready) return refused("DETECTOR_UNAVAILABLE", lastInit && !lastInit.ok ? `${lastInit.code}: ${lastInit.detail}` : "initialisation failed");
      }
      // The deadline covers the run only: it starts now, after any one-time initialisation.
      const requested = detectOptions.deadlineMs;
      const runDeadline = typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? Math.min(requested, deadlineMs) : deadlineMs;
      nextRunId += 1;
      const runId = nextRunId;
      // A COPY is transferred, so the perception realm keeps its own pixels for masking later.
      const rgba = frame.rgba.slice();
      const sent: Tr01Frame = { width: frame.width, height: frame.height, rgba };
      state = "running";
      return new Promise<Tr01Outcome>((resolve) => {
        const started = now();
        const timer = setTimer(() => {
          if (pending?.kind !== "run" || pending.runId !== runId) return;
          fail("DETECTOR_TIMEOUT", `TR-01 exceeded the ${runDeadline} ms deadline; the worker was terminated`, "idle");
        }, runDeadline);
        pending = { kind: "run", runId, frame: { width: frame.width, height: frame.height }, started, resolve, timer };
        (worker as WorkerLike).postMessage(
          { type: "TR01_DETECT", protocol: TR01_PROTOCOL, runId, width: sent.width, height: sent.height, rgba },
          [rgba.buffer]
        );
      });
    },

    async prepare(): Promise<boolean> {
      if (state === "ready") return true;
      if (state !== "idle") return false;
      return initialise();
    },

    dispose(): void {
      if (state === "disposed") return;
      fail("DETECTOR_DISPOSED", "the detector host was disposed", "disposed");
    },

    status: () => ({ state, generation, workersCreated, terminations, staleDropped, lastInit }),
  };
}
