/**
 * Capture — the frame, and everything needed to interpret it.
 *
 * The dossier-approved mechanism is `chrome.tabs.captureVisibleTab` under `activeTab`, and
 * the frozen contract notes it is **viewport-only**. That single fact drives most of the
 * off-screen machinery elsewhere in this package: there is no such thing as capturing an
 * element below the fold, so a visual claim about one is always a fabrication.
 *
 * A `CaptureFrame` deliberately bundles the pixels with the geometry that interprets them.
 * They are useless apart and dangerous apart — a frame whose DPR you have to look up
 * somewhere else is a frame someone will eventually interpret with the wrong one.
 *
 * S-05's open question (`agentos/registry/feasibility-matrix.md`) is the real rate limit
 * of `captureVisibleTab` under `activeTab`. It is UNKNOWN and this module does not pretend
 * otherwise: the adapter reports throttling as a typed refusal rather than retrying into
 * it, so when the limit is eventually measured the policy has somewhere to live.
 */
import type { CaptureGeometry } from "./coordinates.js";
import { assertGeometryConsistent } from "./coordinates.js";
import { type FrameId, frameId } from "./observation.js";
import { type Perceived, ok, refuse, PerceptionError } from "./failure.js";

/**
 * One captured frame.
 *
 * `pixels` is intentionally opaque to this package. Perception decides WHERE things are;
 * it does not decode images. Keeping the payload behind a narrow type also means nothing
 * here can casually read raw page pixels into a shape that is easy to exfiltrate.
 */
export interface CaptureFrame {
  readonly id: FrameId;
  /** `Date.now()` at the moment the frame was produced. */
  readonly capturedAt: number;
  /** Encoded image bytes, format as reported by the adapter. */
  readonly pixels: Uint8Array;
  readonly format: "png" | "jpeg" | "webp";
  /** The complete coordinate contract for THIS frame. */
  readonly geometry: CaptureGeometry;
}

/**
 * The live page measurements a capture needs, taken in the page context.
 *
 * Separated from the capture call because they come from a different place: the capture
 * happens in the extension's privileged context, the measurements can only be taken where
 * the DOM is. Keeping them separate keeps that boundary visible.
 */
export interface ViewportMeasurement {
  readonly dpr: number;
  readonly zoom: number;
  readonly viewportCssWidth: number;
  readonly viewportCssHeight: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly origin: string;
}

/** The capture mechanism, behind an interface so tests and the real tab path agree. */
export interface CaptureAdapter {
  /**
   * Produce a frame, or refuse with a typed reason.
   *
   * Refuses rather than throws: capture failure is an ordinary outcome here (the tab is
   * not active, the throttle has fired, the page is a restricted URL), and the caller must
   * make a decision about it rather than treat it as a bug.
   */
  capture(measurement: ViewportMeasurement): Promise<Perceived<CaptureFrame>>;
}

/** Build the geometry block, refusing anything internally inconsistent. */
export function geometryFrom(
  m: ViewportMeasurement,
  captureWidth: number,
  captureHeight: number
): CaptureGeometry {
  const g: CaptureGeometry = {
    dpr: m.dpr,
    zoom: m.zoom,
    viewportCss: { w: m.viewportCssWidth, h: m.viewportCssHeight },
    captureSize: { w: captureWidth, h: captureHeight },
    scroll: { x: m.scrollX, y: m.scrollY },
    origin: m.origin,
  };
  // Throws CAPTURE_DIMENSION_MISMATCH or COORDINATE_TRANSFORM_AMBIGUOUS. A frame whose
  // geometry does not resolve is not a frame we are willing to hand onward.
  assertGeometryConsistent(g);
  return g;
}

/**
 * How long a frame remains usable.
 *
 * A stale frame is a required fail-closed state: acting on one means acting on a page that
 * has already changed, and the coordinates in it describe a layout that no longer exists.
 * The value is a policy default and is expected to be tuned once S-05 measures the real
 * capture cadence — it is named and exported rather than inlined so that tuning is a
 * one-line change with a test attached.
 */
export const DEFAULT_FRAME_TTL_MS = 2_000;

export function isStale(frame: CaptureFrame, now: number, ttlMs = DEFAULT_FRAME_TTL_MS): boolean {
  return now - frame.capturedAt > ttlMs;
}

/**
 * Assert a frame is still current, throwing `STALE_FRAME` if not.
 *
 * Used at the points where a frame is about to justify a claim. Throws rather than
 * refusing because reaching here with a stale frame means the caller already failed to
 * check, and continuing would attach a real-looking coordinate to a layout that is gone.
 */
export function assertFresh(
  frame: CaptureFrame,
  now: number,
  ttlMs = DEFAULT_FRAME_TTL_MS
): void {
  if (isStale(frame, now, ttlMs)) {
    throw new PerceptionError(
      `Frame ${frame.id} is stale: captured ${now - frame.capturedAt} ms ago, ` +
        `TTL is ${ttlMs} ms. The layout it describes may no longer exist.`,
      "STALE_FRAME"
    );
  }
}

/**
 * The `chrome.tabs.captureVisibleTab` adapter.
 *
 * Typed structurally rather than against `@types/chrome`, for the same reason the security
 * package types ORT structurally: the perception package stays unit-testable without the
 * extension runtime. The shape asserted here is small enough to read in full.
 */
export interface TabsCaptureApi {
  captureVisibleTab(options: { format: "png" | "jpeg"; quality?: number }): Promise<string>;
}

/** Decode a `data:` URL into raw bytes and its declared format. */
export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; format: "png" | "jpeg" } {
  const match = /^data:image\/(png|jpeg);base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new PerceptionError(
      "captureVisibleTab returned a payload that is not a base64 PNG or JPEG data URL.",
      "CAPTURE_FAILED"
    );
  }
  const format = match[1] as "png" | "jpeg";
  const b64 = match[2] ?? "";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { bytes, format };
}

/**
 * Recognise the browser's own rate-quota refusal.
 *
 * W1-S05-rate measured exactly one throttle error string on Chromium 151, and it names the
 * quota itself:
 *
 *   "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota."
 *
 * Firefox 155 produced no throttle error at all within the tested envelope (100% success
 * through 10 Hz, 8-deep bursts and 5-way concurrency), so there is no Firefox signature to
 * match — and none is invented.
 *
 * MATCHING A STRING IS A WEAK TEST, AND IT FAILS IN THE SAFE DIRECTION. An unrecognised
 * message yields `CAPTURE_FAILED`, which promises nothing. The dangerous mistake would be
 * the reverse — labelling an unrecoverable failure as throttling, so a scheduler waits
 * politely forever for something that will never succeed.
 */
export function isThrottleSignature(message: string): boolean {
  return /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|exceeds the .* quota/i.test(message);
}

/**
 * Create the real capture adapter.
 *
 * `decodeSize` is injected because reading the intrinsic dimensions of an encoded image
 * needs a decoder, and which decoder exists depends on the context (`createImageBitmap` in
 * a document or worker, nothing at all in a bare unit test). The perception tier must not
 * ASSUME the capture is `viewportCss * dpr`: that assumption is what
 * CAPTURE_DIMENSION_MISMATCH exists to catch, and it cannot catch anything if the value it
 * checks was derived from the assumption instead of measured.
 */
export function createTabCaptureAdapter(
  tabs: TabsCaptureApi,
  decodeSize: (bytes: Uint8Array, format: string) => Promise<{ width: number; height: number }>,
  now: () => number = Date.now
): CaptureAdapter {
  let sequence = 0;
  return {
    async capture(measurement) {
      let dataUrl: string;
      try {
        dataUrl = await tabs.captureVisibleTab({ format: "png" });
      } catch (cause) {
        const message = String((cause as Error)?.message ?? cause);
        // Throttling is now MEASURED rather than anticipated (W1-S05-rate), so it is
        // classified. It is still never retried into here: the adapter reports, the
        // refresh scheduler decides. A retry loop inside the adapter would make the
        // capture cadence a property of the adapter, invisible to the tier that owns it.
        return refuse(
          isThrottleSignature(message) ? "CAPTURE_THROTTLED" : "CAPTURE_FAILED",
          `captureVisibleTab rejected: ${message}`
        );
      }

      let bytes: Uint8Array;
      let format: "png" | "jpeg";
      try {
        ({ bytes, format } = decodeDataUrl(dataUrl));
      } catch (cause) {
        return refuse("CAPTURE_FAILED", String((cause as Error)?.message ?? cause));
      }

      let size: { width: number; height: number };
      try {
        size = await decodeSize(bytes, format);
      } catch (cause) {
        return refuse(
          "CAPTURE_FAILED",
          `frame could not be measured: ${String((cause as Error)?.message ?? cause)}`
        );
      }

      let geometry: CaptureGeometry;
      try {
        geometry = geometryFrom(measurement, size.width, size.height);
      } catch (cause) {
        const code =
          cause instanceof PerceptionError ? cause.code : ("CAPTURE_FAILED" as const);
        return refuse(code, String((cause as Error)?.message ?? cause));
      }

      sequence += 1;
      return ok({
        id: frameId(`frame-${sequence}-${now()}`),
        capturedAt: now(),
        pixels: bytes,
        format,
        geometry,
      });
    },
  };
}
