/**
 * The TR-01 worker protocol — the only messages that cross between the offscreen document and its
 * dedicated detector worker. Local to the extension; never on the page transport, never on
 * `chrome.runtime` messaging.
 *
 * IN (offscreen → worker): an INIT, and a DETECT carrying ONE frame of pixels and its dimensions.
 * No page text, URL, selector, class, secret or reasoner output has a field here — and
 * no region identity either: which visual-only region a frame came from stays in the offscreen
 * document, keyed by `runId`.
 *
 * OUT (worker → offscreen): READY / INIT_FAILED, and per run either RESULT (boxes and scores only)
 * or REFUSED (a code). A detection is `{ x, y, w, h, score }` in the pixel space of the frame sent;
 * the label is the constant `"text-region"` and is not carried. There is no field for text, a
 * count, a class, a reference or OCR metadata, and the parsers below refuse any extra key.
 *
 * Every parser is strict (exact keys, finite numbers, closed unions) and returns `null` on anything
 * else. A `null` from the worker side is treated as a malformed reply, never as an empty result.
 */

export const TR01_PROTOCOL = 1 as const;

/** Largest frame edge the worker accepts. A frame is a region crop or a viewport capture. */
export const TR01_MAX_EDGE = 8_192;

export type Tr01InitFailureCode = "MODEL_UNAVAILABLE" | "MODEL_HASH_MISMATCH" | "RUNTIME_UNAVAILABLE" | "SESSION_FAILED";
export const TR01_INIT_FAILURE_CODES: readonly Tr01InitFailureCode[] = ["MODEL_UNAVAILABLE", "MODEL_HASH_MISMATCH", "RUNTIME_UNAVAILABLE", "SESSION_FAILED"];

/** Per-run refusals the WORKER can send. The host adds its own (timeout, busy, crash, …). */
export type Tr01WorkerRefusalCode = "DETECTOR_UNAVAILABLE" | "MODEL_OUTPUT_MALFORMED" | "DETECTOR_BUSY" | "PROTOCOL_ERROR";
export const TR01_WORKER_REFUSAL_CODES: readonly Tr01WorkerRefusalCode[] = ["DETECTOR_UNAVAILABLE", "MODEL_OUTPUT_MALFORMED", "DETECTOR_BUSY", "PROTOCOL_ERROR"];

export interface Tr01Detection {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly score: number;
}

export type Tr01Request =
  | { readonly type: "TR01_INIT"; readonly protocol: typeof TR01_PROTOCOL }
  | {
      readonly type: "TR01_DETECT";
      readonly protocol: typeof TR01_PROTOCOL;
      readonly runId: number;
      readonly width: number;
      readonly height: number;
      readonly rgba: Uint8ClampedArray;
    };

export type Tr01Reply =
  | {
      readonly type: "TR01_READY";
      readonly protocol: typeof TR01_PROTOCOL;
      readonly model: { readonly sha256: string; readonly bytes: number };
      readonly ms: { readonly runtime: number; readonly model: number; readonly session: number };
    }
  | {
      readonly type: "TR01_INIT_FAILED";
      readonly protocol: typeof TR01_PROTOCOL;
      readonly code: Tr01InitFailureCode;
      readonly detail: string;
      /** What was read, when anything was: digest and length only. */
      readonly observed: { readonly sha256: string | null; readonly bytes: number | null };
    }
  | {
      readonly type: "TR01_RESULT";
      readonly protocol: typeof TR01_PROTOCOL;
      readonly runId: number;
      readonly detections: readonly Tr01Detection[];
      readonly ms: { readonly preprocess: number; readonly infer: number; readonly postprocess: number };
    }
  | {
      readonly type: "TR01_REFUSED";
      readonly protocol: typeof TR01_PROTOCOL;
      readonly runId: number | null;
      readonly code: Tr01WorkerRefusalCode;
      readonly detail: string;
    };

const MAX_DETAIL = 300;
export const boundedDetail = (s: unknown): string => String(s ?? "").slice(0, MAX_DETAIL);

const isRecord = (u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null && !Array.isArray(u);
const keysExactly = (o: Record<string, unknown>, keys: readonly string[]): boolean =>
  keys.every((k) => Object.hasOwn(o, k)) && Object.keys(o).every((k) => keys.includes(k));
const isFiniteNumber = (u: unknown): u is number => typeof u === "number" && Number.isFinite(u);
const isRunId = (u: unknown): u is number => isFiniteNumber(u) && Number.isInteger(u) && u >= 0;
const isEdge = (u: unknown): u is number => isFiniteNumber(u) && Number.isInteger(u) && u > 0 && u <= TR01_MAX_EDGE;
const isMs = (u: unknown): u is number => isFiniteNumber(u) && u >= 0;
const isHex64 = (u: unknown): u is string => typeof u === "string" && /^[0-9a-f]{64}$/.test(u);

export function parseTr01Request(u: unknown): Tr01Request | null {
  if (!isRecord(u) || u.protocol !== TR01_PROTOCOL) return null;
  if (u.type === "TR01_INIT") return keysExactly(u, ["type", "protocol"]) ? { type: "TR01_INIT", protocol: TR01_PROTOCOL } : null;
  if (u.type !== "TR01_DETECT" || !keysExactly(u, ["type", "protocol", "runId", "width", "height", "rgba"])) return null;
  if (!isRunId(u.runId) || !isEdge(u.width) || !isEdge(u.height)) return null;
  if (!(u.rgba instanceof Uint8ClampedArray) || u.rgba.length !== u.width * u.height * 4) return null;
  return { type: "TR01_DETECT", protocol: TR01_PROTOCOL, runId: u.runId, width: u.width, height: u.height, rgba: u.rgba };
}

/**
 * One detection, inside the frame it was run on. Exact keys: a sixth field of any name — `text`,
 * `label`, `chars` — refuses the whole reply.
 */
function parseDetection(u: unknown, width: number, height: number): Tr01Detection | null {
  if (!isRecord(u) || !keysExactly(u, ["x", "y", "w", "h", "score"])) return null;
  const { x, y, w, h, score } = u;
  if (![x, y, w, h, score].every(isFiniteNumber)) return null;
  const [bx, by, bw, bh, s] = [x, y, w, h, score] as number[];
  if (bw! <= 0 || bh! <= 0 || bx! < 0 || by! < 0) return null;
  if (bx! + bw! > width + 1e-9 || by! + bh! > height + 1e-9) return null;
  if (s! < 0 || s! > 1) return null;
  return { x: bx!, y: by!, w: bw!, h: bh!, score: s! };
}

/**
 * A worker reply, validated against the frame the host actually sent (`frame`, for a RESULT). A
 * RESULT whose boxes fall outside that frame is malformed.
 */
export function parseTr01Reply(u: unknown, frame?: { readonly width: number; readonly height: number }): Tr01Reply | null {
  if (!isRecord(u) || u.protocol !== TR01_PROTOCOL) return null;
  switch (u.type) {
    case "TR01_READY": {
      if (!keysExactly(u, ["type", "protocol", "model", "ms"])) return null;
      const m = u.model;
      const ms = u.ms;
      if (!isRecord(m) || !keysExactly(m, ["sha256", "bytes"]) || !isHex64(m.sha256) || !isRunId(m.bytes)) return null;
      if (!isRecord(ms) || !keysExactly(ms, ["runtime", "model", "session"]) || ![ms.runtime, ms.model, ms.session].every(isMs)) return null;
      return {
        type: "TR01_READY",
        protocol: TR01_PROTOCOL,
        model: { sha256: m.sha256, bytes: m.bytes },
        ms: { runtime: ms.runtime as number, model: ms.model as number, session: ms.session as number },
      };
    }
    case "TR01_INIT_FAILED": {
      if (!keysExactly(u, ["type", "protocol", "code", "detail", "observed"])) return null;
      if (!(TR01_INIT_FAILURE_CODES as readonly unknown[]).includes(u.code) || typeof u.detail !== "string") return null;
      const o = u.observed;
      if (!isRecord(o) || !keysExactly(o, ["sha256", "bytes"])) return null;
      if (o.sha256 !== null && !isHex64(o.sha256)) return null;
      if (o.bytes !== null && !isRunId(o.bytes)) return null;
      return {
        type: "TR01_INIT_FAILED",
        protocol: TR01_PROTOCOL,
        code: u.code as Tr01InitFailureCode,
        detail: boundedDetail(u.detail),
        observed: { sha256: o.sha256 as string | null, bytes: o.bytes as number | null },
      };
    }
    case "TR01_RESULT": {
      if (!frame || !keysExactly(u, ["type", "protocol", "runId", "detections", "ms"]) || !isRunId(u.runId)) return null;
      const ms = u.ms;
      if (!isRecord(ms) || !keysExactly(ms, ["preprocess", "infer", "postprocess"]) || ![ms.preprocess, ms.infer, ms.postprocess].every(isMs)) return null;
      if (!Array.isArray(u.detections)) return null;
      const detections: Tr01Detection[] = [];
      for (const d of u.detections) {
        const parsed = parseDetection(d, frame.width, frame.height);
        if (!parsed) return null;
        detections.push(parsed);
      }
      return {
        type: "TR01_RESULT",
        protocol: TR01_PROTOCOL,
        runId: u.runId,
        detections,
        ms: { preprocess: ms.preprocess as number, infer: ms.infer as number, postprocess: ms.postprocess as number },
      };
    }
    case "TR01_REFUSED": {
      if (!keysExactly(u, ["type", "protocol", "runId", "code", "detail"])) return null;
      if (u.runId !== null && !isRunId(u.runId)) return null;
      if (!(TR01_WORKER_REFUSAL_CODES as readonly unknown[]).includes(u.code) || typeof u.detail !== "string") return null;
      return {
        type: "TR01_REFUSED",
        protocol: TR01_PROTOCOL,
        runId: u.runId as number | null,
        code: u.code as Tr01WorkerRefusalCode,
        detail: boundedDetail(u.detail),
      };
    }
    default:
      return null;
  }
}
