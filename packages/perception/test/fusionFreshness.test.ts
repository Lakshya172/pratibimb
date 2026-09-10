/**
 * Frame freshness and DOM/vision disagreement — T1 fusion semantics.
 *
 * T1, not D4. D4 is the dossier's VISUAL PII channel (faces, signatures, ID cards, QR)
 * and belongs to the T2 sanitize tier. This file is the T1 UI-perception fusion.
 *
 * The load-bearing test here is the stale-frame refusal. "Old screenshot + new DOM,
 * silently treated as one current observation" is the most dangerous state this tier can
 * reach: both halves are individually valid, the fused result is internally consistent,
 * and nothing looks wrong anywhere. The page has simply moved on, and every coordinate now
 * describes a layout that no longer exists.
 *
 * This gap was real. `fuse()` carried `frameId` through from the day it was written and
 * never once compared it against the graph's.
 */
import { describe, it, expect } from "vitest";
import {
  type CaptureGeometry,
  type DomMeasurement,
  type VisualDetection,
  buildElementGraph,
  fuse,
  assertSameFrame,
  frameId,
  cssBox,
  PerceptionError,
} from "@pratibimb/perception";

const CURRENT = frameId("frame-current");
const STALE = frameId("frame-stale");

const geometry: CaptureGeometry = {
  dpr: 1.0,
  zoom: 1.0,
  viewportCss: { w: 1024, h: 640 },
  captureSize: { w: 1024, h: 640 },
  scroll: { x: 0, y: 0 },
  origin: "https://seva.gov.in",
};

const measure = (over: Partial<DomMeasurement> = {}): DomMeasurement => ({
  selector: "#el",
  role: "button",
  name: "Submit",
  rect: { x: 100, y: 100, w: 200, h: 40 },
  cssHidden: false,
  parentIndex: -1,
  ...over,
});

const detection = (
  x: number,
  y: number,
  w: number,
  h: number,
  frame = CURRENT,
  label = "button"
): VisualDetection => ({
  box: cssBox(x, y, w, h),
  label,
  score: 0.9,
  role: "UIElementDetector",
  frameId: frame,
  modelId: "pratibimb-ui-head",
  revision: "v0",
});

describe("stale visual evidence is refused, not blended", () => {
  it("REFUSES to fuse a current DOM graph with a detection from another frame", () => {
    const graph = buildElementGraph([measure()], geometry, CURRENT);
    expect(() => fuse(graph, [detection(102, 102, 196, 38, STALE)], true, geometry)).toThrow(
      PerceptionError
    );
    try {
      fuse(graph, [detection(102, 102, 196, 38, STALE)], true, geometry);
    } catch (e) {
      expect((e as PerceptionError).code).toBe("STALE_FRAME");
    }
  });

  it("names both frames and the count, so the mismatch is diagnosable", () => {
    const graph = buildElementGraph([measure()], geometry, CURRENT);
    try {
      fuse(
        graph,
        [detection(102, 102, 196, 38, STALE), detection(400, 400, 50, 50, STALE)],
        true,
        geometry
      );
      expect.unreachable("should have refused");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("frame-current");
      expect(msg).toContain("frame-stale");
      expect(msg).toContain("2 of 2");
    }
  });

  it("REFUSES even when only ONE detection is stale", () => {
    // Partial staleness is not partially acceptable. There is no correct way to combine a
    // DOM node with a detection from a different frame, so nothing is salvaged.
    const graph = buildElementGraph([measure()], geometry, CURRENT);
    expect(() =>
      fuse(graph, [detection(102, 102, 196, 38), detection(400, 400, 50, 50, STALE)], true, geometry)
    ).toThrow(PerceptionError);
  });

  it("fuses normally when every detection belongs to the graph's frame", () => {
    const graph = buildElementGraph([measure()], geometry, CURRENT);
    const r = fuse(graph, [detection(102, 102, 196, 38)], true, geometry);
    expect(r.matchedCount).toBe(1);
  });

  it("accepts an empty detection set — the DOM-only floor is not stale", () => {
    // The currently admissible configuration. It must not trip the freshness guard.
    const graph = buildElementGraph([measure()], geometry, CURRENT);
    expect(() => fuse(graph, [], false, geometry)).not.toThrow();
  });

  it("assertSameFrame is usable on its own, before any fusion work", () => {
    const graph = buildElementGraph([measure()], geometry, CURRENT);
    expect(() => assertSameFrame(graph, [detection(0, 0, 1, 1)])).not.toThrow();
    expect(() => assertSameFrame(graph, [detection(0, 0, 1, 1, STALE)])).toThrow(PerceptionError);
  });
});

describe("an off-screen element cannot acquire visual evidence", () => {
  it("does not attach a detection that overlaps its DOCUMENT position", () => {
    // The specific trap: an element below the fold at document y=1200, and a detection at
    // viewport y=1200 in some other part of the page. A matcher comparing raw numbers
    // would pair them.
    const graph = buildElementGraph(
      [measure({ rect: { x: 100, y: 1200, w: 200, h: 40 } })],
      geometry,
      CURRENT
    );
    const r = fuse(graph, [detection(100, 1200, 200, 40)], true, geometry);

    const dom = r.elements.find((e) => e.id === "e0")!;
    expect(dom.box).toBeNull();
    expect(dom.provenance.source).toBe("dom");
    if (dom.provenance.source === "dom") expect(dom.provenance.visualAbsence).toBe("OFFSCREEN");
    // The detection survives separately rather than being merged in.
    expect(r.visionOnlyCount).toBe(1);
  });

  it("keeps the off-screen element out of the matched count entirely", () => {
    const graph = buildElementGraph(
      [measure({ rect: { x: 100, y: 1200, w: 200, h: 40 } })],
      geometry,
      CURRENT
    );
    const r = fuse(graph, [detection(100, 1200, 200, 40)], true, geometry);
    expect(r.matchedCount).toBe(0);
  });
});

describe("disagreement is preserved, not resolved", () => {
  it("DOM says button, vision sees nothing → dom with NOT_DETECTED", () => {
    const graph = buildElementGraph([measure()], geometry, CURRENT);
    const r = fuse(graph, [], true, geometry);
    const e = r.elements[0]!;
    expect(e.provenance.source).toBe("dom");
    if (e.provenance.source === "dom") expect(e.provenance.visualAbsence).toBe("NOT_DETECTED");
  });

  it("distinguishes that from 'no detector ran at all'", () => {
    // The DOM-only floor must not be reported as a working detector finding nothing.
    const graph = buildElementGraph([measure()], geometry, CURRENT);
    const r = fuse(graph, [], false, geometry);
    const e = r.elements[0]!;
    if (e.provenance.source === "dom") expect(e.provenance.visualAbsence).toBe("NO_DETECTOR");
  });

  it("vision sees a control the DOM has no node for → vision, synthetic id", () => {
    // Canvas interfaces and cross-origin iframes live here. Discarding them as noise would
    // remove exactly the content that justifies having a vision tier.
    const graph = buildElementGraph([], geometry, CURRENT);
    const r = fuse(graph, [detection(400, 400, 100, 50, CURRENT, "canvas-control")], true, geometry);
    const e = r.elements[0]!;
    expect(e.provenance.source).toBe("vision");
    if (e.provenance.source === "vision") {
      expect(e.provenance.syntheticId).toMatch(/^v\d+$/);
      // And WHICH model said so survives - two heads disagree in different ways.
      expect(e.provenance.detection.modelId).toBe("pratibimb-ui-head");
      expect(e.provenance.detection.revision).toBe("v0");
    }
  });

  it("materially different bounds → NOT matched, and flagged as an overlay suspect", () => {
    // The A2 band: overlapping enough to be related, not enough to be the same thing.
    // That is what a click-jacking overlay looks like.
    const graph = buildElementGraph([measure()], geometry, CURRENT);
    const r = fuse(graph, [detection(190, 100, 200, 40)], true, geometry);
    const e = r.elements[0]!;
    expect(e.provenance.source).toBe("dom");
    expect(e.overlaySuspected).toBe(true);
    expect(r.overlaySuspectCount).toBe(1);
  });

  it("agreement → dom+vision, keeping both halves and how well they agreed", () => {
    const graph = buildElementGraph([measure()], geometry, CURRENT);
    const r = fuse(graph, [detection(102, 102, 196, 38)], true, geometry);
    const e = r.elements[0]!;
    expect(e.provenance.source).toBe("dom+vision");
    if (e.provenance.source === "dom+vision") {
      expect(e.provenance.domNode).toBe("e0");
      expect(e.provenance.detection.modelId).toBe("pratibimb-ui-head");
      expect(e.provenance.iou).toBeGreaterThan(0.5);
    }
  });

  it("answers all four provenance questions after fusion", () => {
    // What did DOM observe, what did vision observe, did they agree, which model and frame.
    const graph = buildElementGraph([measure()], geometry, CURRENT);
    const r = fuse(graph, [detection(102, 102, 196, 38)], true, geometry);
    const e = r.elements[0]!;

    expect(e.role).toBe("button"); // DOM's answer
    expect(e.evidence.kind).toBe("OBSERVED"); // was it in frame
    if (e.provenance.source === "dom+vision") {
      expect(e.provenance.detection.label).toBe("button"); // vision's answer
      expect(typeof e.provenance.iou).toBe("number"); // did they agree, and how well
      expect(e.provenance.detection.frameId).toBe(CURRENT); // which frame
      expect(e.provenance.detection.modelId).toBeTruthy(); // which model
    }
  });
});
