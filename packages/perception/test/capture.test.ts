/**
 * Capture, staleness, and the dimension-mismatch guard.
 *
 * The adapter's job is to produce a frame OR a typed refusal. It has no third behaviour,
 * and in particular it does not retry into a throttle: the real `captureVisibleTab` rate
 * limit under `activeTab` is S-05's open question and is still UNKNOWN, so a retry policy
 * here would be invented ahead of its measurement.
 */
import { describe, it, expect } from "vitest";
import {
  type CaptureFrame,
  type ViewportMeasurement,
  type TabsCaptureApi,
  createTabCaptureAdapter,
  geometryFrom,
  isStale,
  assertFresh,
  decodeDataUrl,
  frameId,
  PerceptionError,
  DEFAULT_FRAME_TTL_MS,
} from "@pratibimb/perception";

const measurement: ViewportMeasurement = {
  dpr: 2.0,
  zoom: 1.0,
  viewportCssWidth: 1024,
  viewportCssHeight: 640,
  scrollX: 0,
  scrollY: 0,
  origin: "https://seva.gov.in",
};

/** A 1x1 PNG, base64. Content is irrelevant; only the envelope is under test. */
const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const okTabs = (dataUrl = PNG_1x1): TabsCaptureApi => ({
  captureVisibleTab: async () => dataUrl,
});

/** Reports the size the geometry expects, so the happy path is genuinely consistent. */
const sizeOf = (w: number, h: number) => async () => ({ width: w, height: h });

describe("the capture envelope", () => {
  it("produces a frame carrying its own complete geometry", () => {
    const g = geometryFrom(measurement, 2048, 1280);
    // The manifest obligation: every field, always, even when it is 1.0.
    expect(g.dpr).toBe(2.0);
    expect(g.zoom).toBe(1.0);
    expect(g.scroll).toEqual({ x: 0, y: 0 });
    expect(g.origin).toBe("https://seva.gov.in");
    expect(g.captureSize).toEqual({ w: 2048, h: 1280 });
  });

  it("REFUSES a geometry whose capture cannot describe the viewport", () => {
    // The frame is squashed vertically: one scale_to_css cannot describe both axes.
    expect(() => geometryFrom(measurement, 2048, 960)).toThrow(PerceptionError);
    try {
      geometryFrom(measurement, 2048, 960);
    } catch (e) {
      expect((e as PerceptionError).code).toBe("CAPTURE_DIMENSION_MISMATCH");
    }
  });

  it("decodes a base64 PNG data URL", () => {
    const { bytes, format } = decodeDataUrl(PNG_1x1);
    expect(format).toBe("png");
    expect(bytes.length).toBeGreaterThan(0);
    // PNG magic number, so we know we decoded rather than merely produced bytes.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("REFUSES a payload that is not an image data URL", () => {
    expect(() => decodeDataUrl("not-a-data-url")).toThrow(PerceptionError);
    expect(() => decodeDataUrl("data:text/html;base64,PGh0bWw+")).toThrowError(/PNG or JPEG/);
  });
});

describe("the adapter fails closed", () => {
  it("captures successfully when everything is consistent", async () => {
    const adapter = createTabCaptureAdapter(okTabs(), sizeOf(2048, 1280), () => 5000);
    const r = await adapter.capture(measurement);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.capturedAt).toBe(5000);
      expect(r.value.geometry.captureSize).toEqual({ w: 2048, h: 1280 });
      expect(r.value.format).toBe("png");
    }
  });

  it("REFUSES rather than retrying when captureVisibleTab rejects", async () => {
    // Throttling arrives here. S-05's rate limit is UNKNOWN, so there is deliberately no
    // backoff policy to be found in this module.
    const tabs: TabsCaptureApi = {
      captureVisibleTab: async () => {
        throw new Error("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded");
      },
    };
    const r = await createTabCaptureAdapter(tabs, sizeOf(2048, 1280)).capture(measurement);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("CAPTURE_FAILED");
      expect(r.detail).toMatch(/quota exceeded/);
    }
  });

  it("REFUSES when the frame cannot be measured", async () => {
    const decode = async () => {
      throw new Error("no decoder in this context");
    };
    const r = await createTabCaptureAdapter(okTabs(), decode).capture(measurement);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CAPTURE_FAILED");
  });

  it("REFUSES when the decoded frame disagrees with the viewport", async () => {
    // This is the check that only works because the size is MEASURED from the decoded
    // image rather than assumed to be viewportCss * dpr. Assuming it would make the guard
    // structurally incapable of ever firing.
    const adapter = createTabCaptureAdapter(okTabs(), sizeOf(2048, 900));
    const r = await adapter.capture(measurement);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CAPTURE_DIMENSION_MISMATCH");
  });

  it("REFUSES a non-image payload without throwing", async () => {
    const r = await createTabCaptureAdapter(
      okTabs("data:text/html;base64,PGh0bWw+"),
      sizeOf(2048, 1280)
    ).capture(measurement);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CAPTURE_FAILED");
  });
});

describe("stale frames", () => {
  const frame: CaptureFrame = {
    id: frameId("f1"),
    capturedAt: 1000,
    pixels: new Uint8Array([1]),
    format: "png",
    geometry: geometryFrom(measurement, 2048, 1280),
  };

  it("is fresh inside the TTL", () => {
    expect(isStale(frame, 1000 + DEFAULT_FRAME_TTL_MS - 1)).toBe(false);
    expect(() => assertFresh(frame, 1000 + DEFAULT_FRAME_TTL_MS - 1)).not.toThrow();
  });

  it("REJECTS a frame past its TTL", () => {
    // Acting on a stale frame means acting on coordinates for a layout that is gone.
    expect(isStale(frame, 1000 + DEFAULT_FRAME_TTL_MS + 1)).toBe(true);
    expect(() => assertFresh(frame, 1000 + DEFAULT_FRAME_TTL_MS + 1)).toThrow(PerceptionError);
    try {
      assertFresh(frame, 99999);
    } catch (e) {
      expect((e as PerceptionError).code).toBe("STALE_FRAME");
    }
  });

  it("honours an explicit TTL", () => {
    expect(isStale(frame, 1100, 50)).toBe(true);
    expect(isStale(frame, 1100, 500)).toBe(false);
  });
});
