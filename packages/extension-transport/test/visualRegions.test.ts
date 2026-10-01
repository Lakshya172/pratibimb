/**
 * M10 — visual-only region enumeration: the inclusion rule, the strict wire contract, the page agent's
 * OBSERVE reply, the core-realm observation, and the CSS-pixel contract at DPR 1, 1.25, 1.5 and 2.
 *
 * DOM-free: the DOM adapter (`page-surface-dom.ts`) only reads samples, and is exercised in a real
 * browser by `tests/browser/extension/run-extension-visual-regions.mjs`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { cssBox, cssToCapture, cssToCapturePixelRect, type CaptureGeometry } from "@pratibimb/perception";

import {
  MAX_MEASUREMENTS,
  VISUAL_REGION_KINDS,
  VISUAL_REGION_SELECTOR,
  createPageAgent,
  observeBoundDocument,
  observePage,
  parsePageReply,
  parseVisualRegions,
  visualRegionsFrom,
  type AttestedDocument,
  type PageRequest,
  type PageSurface,
  type RelayEnvelope,
  type TransportRelay,
  type VisualRegionReading,
  type VisualRegionSample,
} from "../src/index.js";

const sample = (over: Partial<VisualRegionSample> = {}): VisualRegionSample => ({
  kind: "canvas",
  ordinal: 0,
  rect: { x: 10, y: 20, w: 300, h: 150 },
  display: "inline",
  visibility: "visible",
  ...over,
});

const region = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "canvas:0",
  kind: "canvas",
  rect: { x: 10, y: 20, w: 300, h: 150 },
  ...over,
});

const STRUCTURE = { watching: true, seq: 1, nodes: 0, attributes: 0, text: 0, resizes: 0, tracked: 0, at: null };
const VIEWPORT = { w: 1280, h: 720, dpr: 1, scrollX: 0, scrollY: 0 };
const MEASUREMENT = { selector: "#submit", role: "button", name: "Submit", rect: { x: 1, y: 2, w: 80, h: 30 }, enabled: true, cssHidden: false, parentIndex: -1 };

const observeReply = (visualRegions: unknown, over: Record<string, unknown> = {}) => ({
  op: "OBSERVE",
  requestId: "r1",
  measurements: [MEASUREMENT],
  focus: { state: "NONE" },
  viewport: VIEWPORT,
  structure: STRUCTURE,
  visualRegions,
  ...over,
});

// ───────────────────────────── the inclusion rule ─────────────────────────────

describe("visualRegionsFrom — which canvases and images are regions", () => {
  it("enumerates exactly canvas and img, by the selector the adapter uses", () => {
    expect(VISUAL_REGION_KINDS).toEqual(["canvas", "img"]);
    expect(VISUAL_REGION_SELECTOR).toBe("canvas, img");
  });

  it("enumerates a canvas and an unroled image with their full CSS rectangles", () => {
    const out = visualRegionsFrom([
      sample(),
      sample({ kind: "img", ordinal: 0, rect: { x: 400, y: 50, w: 200, h: 120 } }),
    ]);
    expect(out).toEqual([
      { id: "canvas:0", kind: "canvas", rect: { x: 10, y: 20, w: 300, h: 150 } },
      { id: "img:0", kind: "img", rect: { x: 400, y: 50, w: 200, h: 120 } },
    ]);
  });

  it("leaves out exactly what cssHidden leaves out: display none, visibility hidden, zero width or height", () => {
    const out = visualRegionsFrom([
      sample({ ordinal: 0, display: "none", rect: { x: 0, y: 0, w: 0, h: 0 } }),
      sample({ ordinal: 1, visibility: "hidden" }),
      sample({ kind: "img", ordinal: 0, rect: { x: 5, y: 5, w: 0, h: 10 } }),
      sample({ kind: "img", ordinal: 1, rect: { x: 5, y: 5, w: 10, h: 0 } }),
      sample({ ordinal: 2 }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["canvas:2"]);
  });

  it("keeps ids positional and stable: hiding an earlier canvas does not renumber a later one", () => {
    const visible = visualRegionsFrom([sample({ ordinal: 0 }), sample({ ordinal: 1, rect: { x: 0, y: 400, w: 50, h: 50 } })]);
    const earlierHidden = visualRegionsFrom([
      sample({ ordinal: 0, display: "none" }),
      sample({ ordinal: 1, rect: { x: 0, y: 400, w: 50, h: 50 } }),
    ]);
    expect(visible.map((r) => r.id)).toEqual(["canvas:0", "canvas:1"]);
    expect(earlierHidden.map((r) => r.id)).toEqual(["canvas:1"]);
    expect(earlierHidden[0]).toEqual(visible[1]);
  });

  it("is deterministic and gives unique ids", () => {
    const samples = [sample(), sample({ ordinal: 1 }), sample({ kind: "img", ordinal: 0 }), sample({ kind: "img", ordinal: 1 })];
    const a = visualRegionsFrom(samples);
    expect(visualRegionsFrom(samples)).toEqual(a);
    expect(new Set(a.map((r) => r.id)).size).toBe(a.length);
    expect(parseVisualRegions(a)).toEqual(a);
  });

  it("keeps the FULL rectangle of a partly or wholly off-screen element; clipping is the coordinate stage's", () => {
    const out = visualRegionsFrom([
      sample({ kind: "img", ordinal: 0, rect: { x: -50, y: 100, w: 200, h: 100 } }),
      sample({ kind: "img", ordinal: 1, rect: { x: 1200, y: 650, w: 200, h: 100 } }),
      sample({ kind: "img", ordinal: 2, rect: { x: 0, y: 2000, w: 200, h: 100 } }),
    ]);
    expect(out.map((r) => r.rect)).toEqual([
      { x: -50, y: 100, w: 200, h: 100 },
      { x: 1200, y: 650, w: 200, h: 100 },
      { x: 0, y: 2000, w: 200, h: 100 },
    ]);
  });

  it("preserves fractional geometry exactly, never rounding", () => {
    const rect = { x: 10.5, y: 20.25, w: 100.75, h: 50.125 };
    expect(visualRegionsFrom([sample({ rect })])[0]!.rect).toEqual(rect);
  });

  it("does NOT drop an unmeasurable rectangle — it is kept as measured, so the parser refuses the observation", () => {
    for (const rect of [
      { x: NaN, y: 0, w: 10, h: 10 },
      { x: 0, y: 0, w: Infinity, h: 10 },
      { x: 0, y: 0, w: -10, h: 10 },
      { x: 0, y: 0, w: 10, h: NaN },
    ]) {
      const out = visualRegionsFrom([sample({ rect })]);
      expect(out).toHaveLength(1);
      expect(parseVisualRegions(out)).toBeNull();
      expect(parsePageReply(observeReply(out))).toBeNull();
    }
  });

  it("returns geometry only: id, kind and rect, nothing else", () => {
    for (const r of visualRegionsFrom([sample(), sample({ kind: "img" })])) {
      expect(Object.keys(r).sort()).toEqual(["id", "kind", "rect"]);
      expect(Object.keys(r.rect).sort()).toEqual(["h", "w", "x", "y"]);
    }
  });
});

// ───────────────────────────── the strict parser ─────────────────────────────

describe("parseVisualRegions — strict, and all-or-nothing", () => {
  it("accepts a valid list, including negative x/y and fractional values, and an empty one", () => {
    const list = [region(), region({ id: "img:3", kind: "img", rect: { x: -12.5, y: -3, w: 40.25, h: 30 } })];
    expect(parseVisualRegions(list)).toEqual(list);
    expect(parseVisualRegions([])).toEqual([]);
  });

  it.each([
    ["an unknown key", region({ src: "https://example.test/a.png" })],
    ["pixel data", region({ pixels: [0, 0, 0, 255] })],
    ["a missing id", (() => { const r = region(); delete r["id"]; return r; })()],
    ["a missing kind", (() => { const r = region(); delete r["kind"]; return r; })()],
    ["a missing rect", (() => { const r = region(); delete r["rect"]; return r; })()],
    ["an unapproved kind", region({ id: "video:0", kind: "video" })],
    ["an id whose prefix is not its kind", region({ id: "img:0" })],
    ["an id carrying page text", region({ id: "canvas:secret" })],
    ["an id copied from the page's id attribute", region({ id: "#chart" })],
    ["an id with a leading zero", region({ id: "canvas:01" })],
    ["a numeric id", region({ id: 0 })],
    ["zero width", region({ rect: { x: 0, y: 0, w: 0, h: 10 } })],
    ["zero height", region({ rect: { x: 0, y: 0, w: 10, h: 0 } })],
    ["negative width", region({ rect: { x: 0, y: 0, w: -1, h: 10 } })],
    ["negative height", region({ rect: { x: 0, y: 0, w: 10, h: -1 } })],
    ["NaN", region({ rect: { x: NaN, y: 0, w: 10, h: 10 } })],
    ["Infinity", region({ rect: { x: 0, y: 0, w: Infinity, h: 10 } })],
    ["-Infinity", region({ rect: { x: -Infinity, y: 0, w: 10, h: 10 } })],
    ["a string coordinate", region({ rect: { x: "0", y: 0, w: 10, h: 10 } })],
    ["a rect missing h", region({ rect: { x: 0, y: 0, w: 10 } })],
    ["a rect with an extra key", region({ rect: { x: 0, y: 0, w: 10, h: 10, text: "7712" } })],
    ["an ArrayBuffer rect", region({ rect: new ArrayBuffer(16) })],
    ["an array rect", region({ rect: [0, 0, 10, 10] })],
    ["null", null],
    ["a string", "canvas:0"],
  ])("refuses the whole list when one region has %s", (_name, bad) => {
    expect(parseVisualRegions([region({ id: "canvas:9" }), bad])).toBeNull();
  });

  it("refuses duplicate ids", () => {
    expect(parseVisualRegions([region(), region({ rect: { x: 0, y: 0, w: 1, h: 1 } })])).toBeNull();
  });

  it("refuses a non-array and an oversized list", () => {
    for (const bad of [undefined, null, {}, "[]", region()]) expect(parseVisualRegions(bad)).toBeNull();
    const many = Array.from({ length: MAX_MEASUREMENTS + 1 }, (_, i) => region({ id: `canvas:${i}` }));
    expect(parseVisualRegions(many)).toBeNull();
    expect(parseVisualRegions(many.slice(0, MAX_MEASUREMENTS))).toHaveLength(MAX_MEASUREMENTS);
  });

  it("refuses NaN after the wire: JSON turns it into null, which is not a number", () => {
    const wire = JSON.parse(JSON.stringify([region({ rect: { x: NaN, y: 0, w: 10, h: 10 } })]));
    expect(wire[0].rect.x).toBeNull();
    expect(parseVisualRegions(wire)).toBeNull();
  });

  it("returns copies: nothing the caller passed is retained", () => {
    const input = [region()];
    const out = parseVisualRegions(input)!;
    expect(out[0]).not.toBe(input[0]);
    expect(out[0]!.rect).not.toBe(input[0]!["rect"]);
  });
});

describe("strict OBSERVE parsing", () => {
  it("accepts an observation carrying visualRegions", () => {
    const reply = parsePageReply(observeReply([region()]));
    expect(reply?.op === "OBSERVE" && reply.visualRegions).toEqual([region()]);
  });

  it("refuses an observation without visualRegions — an absent list is not an empty one", () => {
    const { visualRegions: _omit, ...without } = observeReply([]);
    expect(parsePageReply(without)).toBeNull();
    expect(parsePageReply(observeReply(undefined))).toBeNull();
    expect(parsePageReply(observeReply(null))).toBeNull();
  });

  it("refuses the WHOLE observation when any region is malformed — no region is silently dropped", () => {
    expect(parsePageReply(observeReply([region(), region({ id: "img:0", kind: "img", rect: { x: 0, y: 0, w: 0, h: 5 } })]))).toBeNull();
    expect(parsePageReply(observeReply([region(), region()]))).toBeNull();
  });

  it("refuses a region list smuggled under another key", () => {
    expect(parsePageReply(observeReply([], { regions: [region()] }))).toBeNull();
  });

  it("leaves the rest of the observation exactly as it parsed before", () => {
    const reply = parsePageReply(observeReply([]));
    expect(reply).toEqual({ op: "OBSERVE", requestId: "r1", measurements: [MEASUREMENT], focus: { state: "NONE" }, viewport: VIEWPORT, structure: STRUCTURE, visualRegions: [] });
  });
});

// ───────────────────────────── the page agent ─────────────────────────────

describe("the page agent's OBSERVE reply", () => {
  const regions: VisualRegionReading[] = [
    { id: "canvas:0", kind: "canvas", rect: { x: 10, y: 20, w: 300, h: 150 } },
    { id: "img:1", kind: "img", rect: { x: -40, y: 400, w: 120, h: 80 } },
  ];
  const surface = (visual: readonly VisualRegionReading[]): PageSurface<never> => ({
    now: () => 1_000,
    viewport: () => VIEWPORT,
    elementAt: () => null,
    describe: () => {
      throw new Error("not used");
    },
    measure: () => ({ measurements: [MEASUREMENT], focus: { state: "NONE" } }),
    visualRegions: () => visual,
    prepareClick: () => {
      throw new Error("not used");
    },
  });

  it("carries the surface's regions, and parses", () => {
    const reply = createPageAgent(surface(regions)).handle({ op: "OBSERVE", requestId: "r1" });
    expect(reply?.op === "OBSERVE" && reply.visualRegions).toEqual(regions);
    expect(parsePageReply(JSON.parse(JSON.stringify(reply)))).toEqual(reply);
  });

  it("changes nothing else in the reply: same measurements, focus, viewport and structure as without regions", () => {
    const withRegions = createPageAgent(surface(regions)).handle({ op: "OBSERVE", requestId: "r1" });
    const without = createPageAgent(surface([])).handle({ op: "OBSERVE", requestId: "r1" });
    expect(Object.keys(withRegions ?? {}).sort()).toEqual(["focus", "measurements", "op", "requestId", "structure", "viewport", "visualRegions"]);
    const strip = (r: unknown) => {
      const { visualRegions: _v, ...rest } = r as Record<string, unknown>;
      return rest;
    };
    expect(strip(withRegions)).toEqual(strip(without));
    expect(strip(withRegions)).toEqual({ op: "OBSERVE", requestId: "r1", measurements: [MEASUREMENT], focus: { state: "NONE" }, viewport: VIEWPORT, structure: expect.any(Object) });
  });

  it("the region list contains no pixel, URL or text payload once serialized", () => {
    const reply = createPageAgent(surface(regions)).handle({ op: "OBSERVE", requestId: "r1" });
    const wire = JSON.stringify(reply && reply.op === "OBSERVE" ? reply.visualRegions : null);
    expect(wire).not.toMatch(/data:|base64|https?:|blob:|src|alt|pixels|bitmap|rgba/i);
  });
});

// ───────────────────────────── the core realm ─────────────────────────────

describe("the core-realm observation, and the document the regions belong to", () => {
  const DOC: AttestedDocument = { tabId: 7, frameId: 0, documentId: "doc-A", origin: "http://127.0.0.1:8975" };
  const relayOf = (visualRegions: unknown): TransportRelay => ({
    request: async (request: { readonly body: PageRequest }): Promise<RelayEnvelope> =>
      ({
        channel: "pratibimb.page-transport.v1",
        kind: "RELAYED",
        swBootId: "boot-1",
        attested: DOC,
        reply: observeReply(visualRegions, { requestId: request.body.requestId }),
      }) as RelayEnvelope,
  });
  let n = 0;
  const deps = { newId: () => `id-${(n += 1)}` };

  it("observePage returns the regions bound to the browser-attested document that answered", async () => {
    const observation = await observePage(relayOf([region()]), { tabId: 7, frameId: 0 }, deps);
    expect(observation.visualRegions).toEqual([region()]);
    expect(observation.binding.document).toEqual(DOC);
  });

  it("observeBoundDocument returns them too", async () => {
    const observation = await observePage(relayOf([region()]), { tabId: 7, frameId: 0 }, deps);
    const again = await observeBoundDocument(relayOf([region({ id: "img:0", kind: "img" })]), observation.binding, deps);
    expect(again.visualRegions).toEqual([region({ id: "img:0", kind: "img" })]);
  });

  it("refuses the observation outright when a region is malformed", async () => {
    await expect(observePage(relayOf([region({ rect: { x: 0, y: 0, w: 0, h: 1 } })]), { tabId: 7, frameId: 0 }, deps)).rejects.toThrow();
    await expect(observePage(relayOf(undefined), { tabId: 7, frameId: 0 }, deps)).rejects.toThrow();
  });
});

// ───────────────────────────── the CSS-pixel contract ─────────────────────────────

describe("region rectangles are CSS pixels at every DPR (the frozen coordinate contract)", () => {
  const geometryAt = (dpr: number): CaptureGeometry => ({
    dpr,
    zoom: 1,
    viewportCss: { w: 1280, h: 720 },
    captureSize: { w: Math.round(1280 * dpr), h: Math.round(720 * dpr) },
    scroll: { x: 0, y: 0 },
    origin: "http://127.0.0.1:8975",
  });

  const cases: [string, VisualRegionReading["rect"]][] = [
    ["a normal canvas", { x: 10, y: 20, w: 300, h: 150 }],
    ["a normal image", { x: 400, y: 50, w: 200, h: 120 }],
    ["fractional coordinates", { x: 10.5, y: 20.25, w: 100.75, h: 50.125 }],
  ];

  for (const dpr of [1, 1.25, 1.5, 2]) {
    describe(`DPR ${dpr}`, () => {
      const g = geometryAt(dpr);

      it.each(cases)("%s maps to a capture rectangle that covers it exactly scaled", (_name, rect) => {
        const exact = cssToCapture(cssBox(rect.x, rect.y, rect.w, rect.h), g);
        const px = cssToCapturePixelRect(cssBox(rect.x, rect.y, rect.w, rect.h), g)!;
        expect(px.x).toBeLessThanOrEqual(exact.x);
        expect(px.y).toBeLessThanOrEqual(exact.y);
        expect(px.x + px.w).toBeGreaterThanOrEqual(exact.x + exact.w - 1e-9);
        expect(px.y + px.h).toBeGreaterThanOrEqual(exact.y + exact.h - 1e-9);
        // Rounded outward by less than one capture pixel on every side.
        expect(exact.x - px.x).toBeLessThan(1);
        expect(px.x + px.w - (exact.x + exact.w)).toBeLessThan(1);
      });

      it("a partly visible image keeps its full CSS rectangle; the capture rectangle is clipped to the frame", () => {
        const [partial] = visualRegionsFrom([sample({ kind: "img", rect: { x: -50, y: 680, w: 200, h: 100 } })]);
        expect(partial!.rect).toEqual({ x: -50, y: 680, w: 200, h: 100 });
        const px = cssToCapturePixelRect(cssBox(-50, 680, 200, 100), g)!;
        expect(px).toEqual({ x: 0, y: Math.floor(680 * (g.captureSize.w / 1280)), w: Math.ceil(150 * (g.captureSize.w / 1280)), h: g.captureSize.h - Math.floor(680 * (g.captureSize.w / 1280)) });
      });

      it("zero-size canvas and image are not regions; negative, NaN and Infinity geometry refuse the observation", () => {
        expect(visualRegionsFrom([sample({ rect: { x: 1, y: 1, w: 0, h: 0 } }), sample({ kind: "img", rect: { x: 1, y: 1, w: 0, h: 40 } })])).toEqual([]);
        for (const rect of [
          { x: 1, y: 1, w: -5, h: 10 },
          { x: NaN, y: 1, w: 5, h: 10 },
          { x: 1, y: 1, w: Infinity, h: 10 },
        ]) {
          expect(parsePageReply(observeReply(visualRegionsFrom([sample({ rect })])))).toBeNull();
        }
      });

      it("the DOM rectangle is the same CSS rectangle whatever the DPR — no device-pixel value enters it", () => {
        const rect = { x: 10.5, y: 20.25, w: 100.75, h: 50.125 };
        const reply = parsePageReply(observeReply(visualRegionsFrom([sample({ rect })]), { viewport: { ...VIEWPORT, dpr } }));
        expect(reply?.op === "OBSERVE" && reply.visualRegions[0]!.rect).toEqual(rect);
      });
    });
  }
});

// ───────────────────────────── structure ─────────────────────────────

describe("no pixel, bitmap, URL or text path in the enumeration source", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const rule = strip(readFileSync(fileURLToPath(new URL("../src/visualRegions.ts", import.meta.url)), "utf8"));
  const adapter = strip(readFileSync(fileURLToPath(new URL("../../../apps/extension/host-lib/page-surface-dom.ts", import.meta.url)), "utf8"));
  const enumerate = /function visualRegions\(\)[\s\S]*?\n}\n/.exec(adapter)?.[0] ?? "";

  it("finds the adapter's enumeration function", () => {
    expect(enumerate).toContain("getBoundingClientRect");
    expect(enumerate).toContain("visualRegionsFrom");
  });

  it.each([
    ["src", /\.(src|currentSrc|srcset)\b/],
    ["alt or text", /\.(alt|textContent|innerText|innerHTML|outerHTML|title)\b/],
    ["attributes", /getAttribute/],
    ["a canvas context", /getContext/],
    ["pixels", /getImageData|toDataURL|toBlob|convertToBlob|ImageData|createImageBitmap|ImageBitmap|captureStream/],
    ["binary payloads", /\bBlob\b|ArrayBuffer|Uint8|FileReader/],
    ["the network", /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/],
  ])("reads no %s", (_what, pattern) => {
    expect(enumerate).not.toMatch(pattern);
    expect(rule).not.toMatch(pattern);
  });

  it("does not touch the element graph's selector", () => {
    expect(adapter).toContain('const MEASURED_SELECTOR = "a, button, input, select, textarea, label, [role]";');
  });
});
