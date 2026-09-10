/**
 * The element graph, and the off-screen rule.
 *
 * The load-bearing tests here are the ones proving that an element the DOM knows about but
 * the camera never saw carries NO pixel evidence. QG-02: *"Off-screen elements are
 * reported `visible: false, offscreen: true`, in document space, with no pixel evidence."*
 */
import { describe, it, expect } from "vitest";
import {
  type CaptureGeometry,
  type DomMeasurement,
  buildElementGraph,
  classifyEvidence,
  frameId,
  cssBox,
  manifestVisibility,
  admitsVisualEvidence,
} from "@pratibimb/perception";

const FRAME = frameId("frame-1");

const geometry = (scrollY = 0): CaptureGeometry => ({
  dpr: 2.0,
  zoom: 1.0,
  viewportCss: { w: 1024, h: 640 },
  captureSize: { w: 2048, h: 1280 },
  scroll: { x: 0, y: scrollY },
  origin: "https://seva.gov.in",
});

const measure = (over: Partial<DomMeasurement> = {}): DomMeasurement => ({
  selector: "#el",
  role: "button",
  name: "Submit",
  rect: { x: 10, y: 10, w: 100, h: 30 },
  cssHidden: false,
  parentIndex: -1,
  ...over,
});

describe("off-screen elements carry no pixel evidence", () => {
  it("classifies a below-the-fold element as OFFSCREEN in document space", () => {
    const g = geometry(0);
    const e = classifyEvidence(cssBox(400, 1180, 120, 40), false, g, FRAME);

    expect(e.kind).toBe("OFFSCREEN");
    // Document space is all it gets, and the scroll offset is folded in.
    if (e.kind === "OFFSCREEN") {
      expect(e.documentBox.y).toBe(1180);
      // The structural guarantee: there is no viewport box and no frame id to be found.
      expect("viewportBox" in e).toBe(false);
      expect("frameId" in e).toBe(false);
      expect("visiblePart" in e).toBe(false);
    }
  });

  it("reports exactly visible:false, offscreen:true — the manifest pair", () => {
    const g = geometry();
    const e = classifyEvidence(cssBox(400, 1180, 120, 40), false, g, FRAME);
    expect(manifestVisibility(e)).toEqual({ visible: false, offscreen: true });
  });

  it("does not admit visual evidence for an off-screen element", () => {
    const g = geometry();
    const e = classifyEvidence(cssBox(400, 1180, 120, 40), false, g, FRAME);
    // This is the guard fusion consults before attaching any detection.
    expect(admitsVisualEvidence(e)).toBe(false);
  });

  it("keeps document coordinates correct under scroll", () => {
    // Scrolled 1000px down: an element at viewport y=100 is at document y=1100.
    const g = geometry(1000);
    const e = classifyEvidence(cssBox(400, 100, 120, 40), false, g, FRAME);
    expect(e.kind).toBe("OBSERVED");
    if (e.kind === "OBSERVED") {
      expect(e.viewportBox.y).toBe(100);
      expect(e.documentBox.y).toBe(1100);
    }
  });
});

describe("CSS-hidden is not the same as off-screen", () => {
  it("classifies display:none as UNOBSERVED, not OFFSCREEN", () => {
    // The distinction matters operationally: no amount of scrolling reveals a
    // display:none element, so it must never be queued for a scroll-then-look.
    const e = classifyEvidence(cssBox(10, 10, 100, 30), true, geometry(), FRAME);
    expect(e.kind).toBe("UNOBSERVED");
    expect(manifestVisibility(e)).toEqual({ visible: false, offscreen: false });
  });

  it("gives a hidden element no pixel evidence either", () => {
    const e = classifyEvidence(cssBox(10, 10, 100, 30), true, geometry(), FRAME);
    expect(admitsVisualEvidence(e)).toBe(false);
    expect("viewportBox" in e).toBe(false);
  });
});

describe("partially clipped elements", () => {
  it("reports CLIPPED with the visible part, not the whole box", () => {
    // Straddling the bottom edge of a 640-tall viewport.
    const e = classifyEvidence(cssBox(10, 620, 100, 40), false, geometry(), FRAME);
    expect(e.kind).toBe("CLIPPED");
    if (e.kind === "CLIPPED") {
      expect(e.viewportBox.h).toBe(40); // what the DOM says
      expect(e.visiblePart.h).toBe(20); // what the camera actually saw
      expect(e.visiblePart.y).toBe(620);
    }
  });

  it("still admits visual evidence, because part of it is genuinely in frame", () => {
    const e = classifyEvidence(cssBox(10, 620, 100, 40), false, geometry(), FRAME);
    expect(admitsVisualEvidence(e)).toBe(true);
    expect(manifestVisibility(e)).toEqual({ visible: true, offscreen: false });
  });
});

describe("fixed and sticky elements", () => {
  it("treats a fixed header as observed regardless of scroll", () => {
    // A position:fixed header reports the same viewport rect at any scroll offset. The
    // graph must not "correct" that with the scroll — its document position genuinely
    // moves with the viewport.
    const scrolled = geometry(2000);
    const e = classifyEvidence(cssBox(0, 0, 1024, 60), false, scrolled, FRAME);
    expect(e.kind).toBe("OBSERVED");
    if (e.kind === "OBSERVED") {
      expect(e.viewportBox.y).toBe(0);
      // Document space still adds scroll: that IS where it is on the page right now.
      expect(e.documentBox.y).toBe(2000);
    }
  });
});

describe("graph construction", () => {
  it("preserves parent/child relationships needed for fusion", () => {
    const g = buildElementGraph(
      [
        measure({ selector: "form", role: "form", name: "Application", parentIndex: -1 }),
        measure({ selector: "#phone", role: "textbox", name: "Phone", parentIndex: 0 }),
        measure({ selector: "#submit", role: "button", name: "Submit", parentIndex: 0 }),
      ],
      geometry(),
      FRAME
    );

    expect(g.nodes).toHaveLength(3);
    expect(g.nodes[0]!.children).toEqual(["e1", "e2"]);
    expect(g.nodes[1]!.parent).toBe("e0");
    expect(g.nodes[0]!.parent).toBeNull();
  });

  it("carries the DOM selector so matched elements can be actioned by selector", () => {
    // The contract: DOM-matched elements are actioned by selector, robust to reflow.
    const g = buildElementGraph([measure({ selector: "#phone", nth: 2 })], geometry(), FRAME);
    expect(g.nodes[0]!.domRef).toEqual({ selector: "#phone", nth: 2 });
  });

  it("binds the graph to the frame it was derived against", () => {
    // A graph that outlived its frame would describe a layout that may no longer exist.
    const g = buildElementGraph([measure()], geometry(), FRAME);
    expect(g.frameId).toBe(FRAME);
  });

  it("defaults enabled to true only where the DOM did not say otherwise", () => {
    const g = buildElementGraph(
      [measure({ enabled: false }), measure({ selector: "#b" })],
      geometry(),
      FRAME
    );
    expect(g.nodes[0]!.enabled).toBe(false);
    expect(g.nodes[1]!.enabled).toBe(true);
  });

  it("indexes nodes by id for downstream lookup", () => {
    const g = buildElementGraph([measure(), measure({ selector: "#b" })], geometry(), FRAME);
    expect(g.byId.get(g.nodes[1]!.id)).toBe(g.nodes[1]);
  });
});
