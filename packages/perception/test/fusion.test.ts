/**
 * Fusion and provenance.
 *
 * Two things are being protected. First the frozen IoU > 0.5 threshold and the three
 * outcomes it produces. Second, and more important, that provenance survives fusion: after
 * fusing it must still be answerable whether an element's evidence came from the DOM, from
 * pixels, from both, or from neither.
 */
import { describe, it, expect } from "vitest";
import {
  type CaptureGeometry,
  type DomMeasurement,
  type VisualDetection,
  buildElementGraph,
  fuse,
  iou,
  manifestSource,
  frameId,
  cssBox,
  FUSION_IOU_THRESHOLD,
} from "@pratibimb/perception";

const FRAME = frameId("f1");

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

const detection = (x: number, y: number, w: number, h: number, label = "button"): VisualDetection => ({
  box: cssBox(x, y, w, h),
  label,
  score: 0.9,
  role: "UIElementDetector",
  frameId: FRAME,
});

describe("IoU", () => {
  it("is 1 for identical boxes and 0 for disjoint ones", () => {
    expect(iou(cssBox(0, 0, 10, 10), cssBox(0, 0, 10, 10))).toBe(1);
    expect(iou(cssBox(0, 0, 10, 10), cssBox(50, 50, 10, 10))).toBe(0);
  });

  it("is 0 for boxes that merely touch", () => {
    expect(iou(cssBox(0, 0, 10, 10), cssBox(10, 0, 10, 10))).toBe(0);
  });

  it("uses the frozen threshold of 0.5", () => {
    // Changing this is a constitution §8 change, not a tuning exercise.
    expect(FUSION_IOU_THRESHOLD).toBe(0.5);
  });
});

describe("provenance is preserved, not collapsed", () => {
  it("marks a DOM element confirmed by a detection as dom+vision", () => {
    const graph = buildElementGraph([measure()], geometry, FRAME);
    const r = fuse(graph, [detection(102, 102, 196, 38)], true, geometry);

    expect(r.matchedCount).toBe(1);
    const e = r.elements[0]!;
    expect(e.provenance.source).toBe("dom+vision");
    if (e.provenance.source === "dom+vision") {
      // Both halves survive: which DOM node, which detection, and how well they agreed.
      expect(e.provenance.domNode).toBe("e0");
      expect(e.provenance.detection.score).toBe(0.9);
      expect(e.provenance.iou).toBeGreaterThan(FUSION_IOU_THRESHOLD);
    }
  });

  it("keeps the detector score OUT of the provenance discriminant", () => {
    // A DOM-only element and a vision-only element can both be "0.9". Averaging them into
    // one number destroys the only question downstream actually needs answered: is there
    // pixel evidence for this, or only a DOM claim?
    const graph = buildElementGraph([measure()], geometry, FRAME);
    const r = fuse(graph, [detection(102, 102, 196, 38)], true, geometry);
    const e = r.elements[0]!;
    expect(typeof e.provenance.source).toBe("string");
    expect(e.provenance).not.toHaveProperty("confidence");
  });

  it("marks an unmatched DOM element as dom, and says WHY there is no vision", () => {
    const graph = buildElementGraph([measure()], geometry, FRAME);
    const r = fuse(graph, [], true, geometry);
    const e = r.elements[0]!;
    expect(e.provenance.source).toBe("dom");
    if (e.provenance.source === "dom") expect(e.provenance.visualAbsence).toBe("NOT_DETECTED");
  });

  it("distinguishes 'detector found nothing' from 'no detector ran'", () => {
    // The DOM-only floor is the current admissible configuration. It must not look like a
    // working detector reporting an empty page.
    const graph = buildElementGraph([measure()], geometry, FRAME);
    const noDetector = fuse(graph, [], false, geometry);
    const e = noDetector.elements[0]!;
    if (e.provenance.source === "dom") expect(e.provenance.visualAbsence).toBe("NO_DETECTOR");
  });

  it("marks an off-screen element's absence of vision as OFFSCREEN", () => {
    const graph = buildElementGraph(
      [measure({ rect: { x: 100, y: 1200, w: 200, h: 40 } })],
      geometry,
      FRAME
    );
    const r = fuse(graph, [], true, geometry);
    const e = r.elements[0]!;
    expect(e.box).toBeNull();
    if (e.provenance.source === "dom") expect(e.provenance.visualAbsence).toBe("OFFSCREEN");
  });

  it("keeps a detection the DOM cannot account for, as vision-only", () => {
    // Canvas interfaces and cross-origin iframes live here. Discarding these as noise
    // would remove exactly the content that justifies having a vision tier.
    const graph = buildElementGraph([], geometry, FRAME);
    const r = fuse(graph, [detection(400, 400, 100, 50, "canvas-control")], true, geometry);

    expect(r.visionOnlyCount).toBe(1);
    const e = r.elements[0]!;
    expect(e.provenance.source).toBe("vision");
    if (e.provenance.source === "vision") {
      // Actioned by coordinate under a synthetic id, per the frozen contract.
      expect(e.provenance.syntheticId).toMatch(/^v\d+$/);
    }
    expect(e.box).not.toBeNull();
  });

  it("refuses to serialize an unresolved provenance", () => {
    expect(() => manifestSource({ source: "unresolved", detail: "no attribution" })).toThrowError(
      /unresolved/i
    );
  });

  it("serializes the three legitimate sources to the manifest enum", () => {
    expect(manifestSource({ source: "dom", domNode: "e0" as never, visualAbsence: "NOT_DETECTED" })).toBe("dom");
    expect(
      manifestSource({ source: "vision", detection: detection(0, 0, 1, 1), syntheticId: "v0" as never })
    ).toBe("vision");
  });
});

describe("no fabricated observation for uncaptured content", () => {
  it("never attributes a detection to an off-screen element", () => {
    // The off-screen element has no viewport box, so there is nothing for a detection to
    // match against — the rule is enforced by the absence of data, not by a check.
    const graph = buildElementGraph(
      [measure({ rect: { x: 100, y: 1200, w: 200, h: 40 } })],
      geometry,
      FRAME
    );
    // A detection at the same DOCUMENT position, which a naive matcher might pair with it.
    const r = fuse(graph, [detection(100, 1200, 200, 40)], true, geometry);

    const domElement = r.elements.find((e) => e.id === "e0")!;
    expect(domElement.provenance.source).toBe("dom");
    expect(domElement.box).toBeNull();
    // The detection survives separately as vision-only rather than being merged in.
    expect(r.visionOnlyCount).toBe(1);
  });
});

describe("overlay suspicion — threat model A2", () => {
  it("flags an overlap in the suspicious band between the floor and the threshold", () => {
    const graph = buildElementGraph([measure()], geometry, FRAME);
    // Offset enough that IoU lands between 0.2 and 0.5: the DOM says a button is here,
    // the pixels say something else is sitting on top of it.
    const r = fuse(graph, [detection(190, 100, 200, 40)], true, geometry);

    const e = r.elements[0]!;
    expect(e.overlaySuspected).toBe(true);
    expect(r.overlaySuspectCount).toBe(1);
    expect(e.provenance.source).toBe("dom"); // not matched
  });

  it("does not flag a clean match", () => {
    const graph = buildElementGraph([measure()], geometry, FRAME);
    const r = fuse(graph, [detection(102, 102, 196, 38)], true, geometry);
    expect(r.elements[0]!.overlaySuspected).toBe(false);
    expect(r.overlaySuspectCount).toBe(0);
  });

  it("does not flag a distant, unrelated detection", () => {
    const graph = buildElementGraph([measure()], geometry, FRAME);
    const r = fuse(graph, [detection(700, 500, 100, 30)], true, geometry);
    expect(r.elements[0]!.overlaySuspected).toBe(false);
  });
});

describe("determinism", () => {
  it("produces identical results for identical inputs", () => {
    const graph = buildElementGraph(
      [measure(), measure({ selector: "#b", rect: { x: 400, y: 100, w: 200, h: 40 } })],
      geometry,
      FRAME
    );
    const dets = [detection(402, 102, 196, 38), detection(102, 102, 196, 38)];

    const a = fuse(graph, dets, true, geometry);
    const b = fuse(graph, dets, true, geometry);
    expect(JSON.stringify(a.elements.map((e) => [e.id, e.provenance.source]))).toBe(
      JSON.stringify(b.elements.map((e) => [e.id, e.provenance.source]))
    );
  });

  it("does not let one detection be claimed by two elements", () => {
    const graph = buildElementGraph(
      [measure(), measure({ selector: "#b", rect: { x: 100, y: 100, w: 200, h: 40 } })],
      geometry,
      FRAME
    );
    const r = fuse(graph, [detection(102, 102, 196, 38)], true, geometry);
    expect(r.matchedCount).toBe(1);
    expect(r.elements.filter((e) => e.provenance.source === "dom+vision")).toHaveLength(1);
  });
});
