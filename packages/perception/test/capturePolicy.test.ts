/**
 * QG-03b-2c — the T1 capture-format policy (ADR-0002), enforced as BEHAVIOUR.
 *
 * `realCaptureConformance.test.ts` already guards the adapter's SOURCE TEXT. A regex over
 * source proves a string is present; it cannot prove what the adapter does with what the
 * browser hands back. These tests drive the real adapter against a browser model whose
 * semantics are the MEASURED ones — W1-QG03b-2a `metrics.json` → `capture.apiSurface`
 * (Chromium 151, workstation 1):
 *
 *   format omitted      -> image/jpeg (byte-identical to {format:"jpeg"})
 *   {format:"png"}      -> image/png
 *   {format:"jpeg"}     -> image/jpeg
 *   {format:"webp"}     -> rejected at schema validation
 *
 * The compile-time half of the policy (a JPEG or WebP `CaptureFrame` does not typecheck) is
 * enforced by `npm run typecheck`, which compiles this file; vitest alone does not typecheck.
 */
import { describe, it, expect } from "vitest";
import {
  type CaptureFrame,
  type ViewportMeasurement,
  T1_CAPTURE_FORMAT,
  createTabCaptureAdapter,
  decodeDataUrl,
  frameId,
  geometryFrom,
  PerceptionError,
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

/** A real 1x1 PNG. Content is irrelevant; the envelope and signature are under test. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/** A JFIF header (FF D8 FF E0 …) followed by EOI. Enough to carry the JPEG signature. */
const JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==";

const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;
const JPEG_DATA_URL = `data:image/jpeg;base64,${JPEG_B64}`;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

type CaptureOptions = { format?: string; quality?: number };

/**
 * `chrome.tabs.captureVisibleTab` with the measured Chromium semantics, recording every call.
 * `pngResponse` lets a test model a browser that ignores the requested format.
 */
function measuredChromium(pngResponse: string = PNG_DATA_URL) {
  const calls: (CaptureOptions | undefined)[] = [];
  return {
    calls,
    async captureVisibleTab(options?: CaptureOptions): Promise<string> {
      calls.push(options === undefined ? undefined : { ...options });
      const format = options?.format;
      if (format === undefined || format === "jpeg") return JPEG_DATA_URL;
      if (format === "png") return pngResponse;
      throw new Error(
        "Error in invocation of tabs.captureVisibleTab(optional integer windowId, optional " +
          `extensionTypes.ImageDetails options): Error at parameter 'options': '${format}'`
      );
    },
  };
}

function recordingDecodeSize() {
  const seen: { bytes: Uint8Array; format: string }[] = [];
  const decodeSize = async (bytes: Uint8Array, format: string) => {
    seen.push({ bytes, format });
    return { width: 2048, height: 1280 };
  };
  return { seen, decodeSize };
}

describe("the production adapter requests PNG explicitly", () => {
  it("calls captureVisibleTab exactly once, with {format: 'png'} and nothing else", async () => {
    const browser = measuredChromium();
    const r = await createTabCaptureAdapter(browser, recordingDecodeSize().decodeSize).capture(
      measurement
    );
    expect(r.ok).toBe(true);
    // Deep equality: an omitted format ({} or undefined) or an added quality would fail here.
    expect(browser.calls).toEqual([{ format: "png" }]);
    expect(T1_CAPTURE_FORMAT).toBe("png");
  });

  it("omitting the format is NOT the production policy: the browser default is JPEG", async () => {
    const browser = measuredChromium();
    // What a caller relying on the default would get — the measured Chromium behaviour.
    const defaulted = decodeDataUrl(await browser.captureVisibleTab());
    expect(defaulted.format).toBe("jpeg");

    // What the production adapter gets from the same browser.
    const r = await createTabCaptureAdapter(browser, recordingDecodeSize().decodeSize).capture(
      measurement
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.format).toBe("png");
    expect(browser.calls[1]).toEqual({ format: "png" });
    expect(browser.calls[1]).not.toEqual(browser.calls[0]);
  });
});

describe("anything other than PNG is refused, never accepted and never re-requested", () => {
  it("REFUSES a JPEG returned for a PNG request, instead of producing a JPEG frame", async () => {
    // A browser (or shim) that ignores the format argument and hands back JPEG.
    const browser = measuredChromium(JPEG_DATA_URL);
    const { seen, decodeSize } = recordingDecodeSize();
    const r = await createTabCaptureAdapter(browser, decodeSize).capture(measurement);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("CAPTURE_FAILED");
      expect(r.detail).toMatch(/image\/jpeg/);
      expect(r.detail).toMatch(/PNG only/);
    }
    // Refused before any further processing, and not retried in any format.
    expect(seen).toHaveLength(0);
    expect(browser.calls).toEqual([{ format: "png" }]);
  });

  it("no fallback: a failed PNG capture is reported, never re-requested as JPEG", async () => {
    const calls: (CaptureOptions | undefined)[] = [];
    const browser = {
      async captureVisibleTab(options?: CaptureOptions): Promise<string> {
        calls.push(options === undefined ? undefined : { ...options });
        if (options?.format === "png") throw new Error("Cannot access contents of the page.");
        return JPEG_DATA_URL;
      },
    };
    const r = await createTabCaptureAdapter(browser, recordingDecodeSize().decodeSize).capture(
      measurement
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CAPTURE_FAILED");
    expect(calls).toEqual([{ format: "png" }]);
  });

  it("REFUSES formats the capture path does not admit — WebP, GIF, SVG — at decode", async () => {
    for (const mime of ["webp", "gif", "svg+xml", "avif"]) {
      expect(() => decodeDataUrl(`data:image/${mime};base64,${PNG_B64}`)).toThrow(PerceptionError);
      const browser = measuredChromium(`data:image/${mime};base64,${PNG_B64}`);
      const r = await createTabCaptureAdapter(browser, recordingDecodeSize().decodeSize).capture(
        measurement
      );
      expect(r.ok, mime).toBe(false);
      if (!r.ok) expect(r.code).toBe("CAPTURE_FAILED");
    }
  });
});

describe("the declared MIME type must agree with the bytes", () => {
  it("REJECTS a PNG label on JPEG bytes, and a JPEG label on PNG bytes", () => {
    for (const [url, label] of [
      [`data:image/png;base64,${JPEG_B64}`, "image/png"],
      [`data:image/jpeg;base64,${PNG_B64}`, "image/jpeg"],
    ] as const) {
      try {
        decodeDataUrl(url);
        expect.unreachable(`${label} with contradicting bytes was accepted`);
      } catch (e) {
        expect(e).toBeInstanceOf(PerceptionError);
        expect((e as PerceptionError).code).toBe("CAPTURE_FAILED");
        expect((e as PerceptionError).message).toMatch(/signature/);
      }
    }
  });

  it("the adapter REFUSES a PNG-labelled payload whose bytes are not PNG", async () => {
    const browser = measuredChromium(`data:image/png;base64,${JPEG_B64}`);
    const r = await createTabCaptureAdapter(browser, recordingDecodeSize().decodeSize).capture(
      measurement
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("CAPTURE_FAILED");
      expect(r.detail).toMatch(/signature/);
    }
  });

  it("an empty PNG payload is refused rather than accepted as a zero-byte frame", () => {
    expect(() => decodeDataUrl("data:image/png;base64,")).toThrow(PerceptionError);
  });
});

describe("the frame's metadata is internally consistent", () => {
  it("format, bytes, the size probe and the geometry all describe the same PNG", async () => {
    const { seen, decodeSize } = recordingDecodeSize();
    const r = await createTabCaptureAdapter(measuredChromium(), decodeSize, () => 42).capture(
      measurement
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const frame = r.value;
    expect(frame.format).toBe(T1_CAPTURE_FORMAT);
    expect([...frame.pixels.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    // The size probe was asked about exactly these bytes, as PNG.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.format).toBe("png");
    expect(seen[0]!.bytes).toBe(frame.pixels);
    expect(frame.geometry.captureSize).toEqual({ w: 2048, h: 1280 });
    expect(frame.capturedAt).toBe(42);
  });
});

describe("the contract admits only PNG — at compile time", () => {
  it("a JPEG or WebP T1 frame does not typecheck", () => {
    const geometry = geometryFrom(measurement, 2048, 1280);
    const png: CaptureFrame = { id: frameId("p"), capturedAt: 0, pixels: new Uint8Array(0), format: "png", geometry };
    // If CaptureFrame.format is ever widened again, these directives become unused and
    // `npm run typecheck` fails — which is the point.
    // @ts-expect-error ADR-0002: a T1 CaptureFrame cannot be JPEG
    const jpeg: CaptureFrame = { id: frameId("j"), capturedAt: 0, pixels: new Uint8Array(0), format: "jpeg", geometry };
    // @ts-expect-error ADR-0002: a T1 CaptureFrame cannot be WebP (captureVisibleTab cannot produce it)
    const webp: CaptureFrame = { id: frameId("w"), capturedAt: 0, pixels: new Uint8Array(0), format: "webp", geometry };
    expect(png.format).toBe("png");
    expect([jpeg, webp]).toHaveLength(2);
  });
});
