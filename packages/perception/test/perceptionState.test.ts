/**
 * Projection into the manifest's `elements[]` shape.
 *
 * This is the serialization edge — the last place the off-screen rule could be violated,
 * and the first place a wrong box would become something the server plans against.
 */
import { describe, it, expect } from "vitest";
import {
  type CaptureGeometry,
  type DomMeasurement,
  type PerceptionState,
  buildElementGraph,
  fuse,
  projectElement,
  projectElements,
  frameId,
} from "@pratibimb/perception";

const FRAME = frameId("f1");

const geometry: CaptureGeometry = {
  dpr: 2.0,
  zoom: 1.0,
  viewportCss: { w: 1024, h: 640 },
  captureSize: { w: 2048, h: 1280 },
  scroll: { x: 0, y: 480 },
  origin: "https://seva.gov.in",
};

const measure = (over: Partial<DomMeasurement> = {}): DomMeasurement => ({
  selector: "#el",
  role: "textbox",
  name: "Phone",
  rect: { x: 400, y: 260, w: 300, h: 32 },
  cssHidden: false,
  parentIndex: -1,
  ...over,
});

function project(measurements: DomMeasurement[]) {
  const graph = buildElementGraph(measurements, geometry, FRAME);
  const fusion = fuse(graph, [], false, geometry);
  return fusion.elements.map(projectElement);
}

describe("on-screen elements", () => {
  it("emits bbox in canonical CSS viewport pixels", () => {
    const [e] = project([measure()]);
    // Matches the manifest example's shape exactly: [x, y, w, h].
    expect(e!.bbox).toEqual([400, 260, 300, 32]);
    expect(e!.visible).toBe(true);
    expect(e!.offscreen).toBe(false);
  });

  it("carries role, name, source and enabled", () => {
    const [e] = project([measure({ enabled: false })]);
    expect(e!.role).toBe("textbox");
    expect(e!.name).toBe("Phone");
    expect(e!.source).toBe("dom");
    expect(e!.enabled).toBe(false);
  });
});

describe("off-screen elements carry NO pixel evidence", () => {
  const offscreen = measure({ role: "button", name: "Submit", rect: { x: 400, y: 1180, w: 120, h: 40 } });

  it("omits bbox entirely rather than emitting a document box", () => {
    const [e] = project([offscreen]);
    // Emitting the document box would hand the server a viewport-looking coordinate for
    // something never on screen. The key is absent, not null, not zeroed.
    expect(e).not.toHaveProperty("bbox");
    expect("bbox" in e!).toBe(false);
  });

  it("reports exactly visible:false, offscreen:true", () => {
    const [e] = project([offscreen]);
    expect(e!.visible).toBe(false);
    expect(e!.offscreen).toBe(true);
  });

  it("still reports role and name, so the server can plan a scroll toward it", () => {
    // The whole point of reporting off-screen elements: the server plans a scroll toward
    // a named field it has never seen, and the next observation confirms it. Without this
    // a multi-field form silently caps the agent at one screen.
    const [e] = project([offscreen]);
    expect(e!.role).toBe("button");
    expect(e!.name).toBe("Submit");
  });

  it("matches the manifest schema's own worked example", () => {
    // manifest-schema.md: { id, role: "button", name: "Submit", source: "dom",
    //                       visible: false, offscreen: true } and no bbox.
    const [e] = project([offscreen]);
    expect(e).toEqual({
      id: "e0",
      role: "button",
      name: "Submit",
      source: "dom",
      visible: false,
      offscreen: true,
      enabled: true,
    });
  });
});

describe("hidden elements", () => {
  it("emits no bbox for a display:none element either", () => {
    const [e] = project([measure({ cssHidden: true })]);
    expect(e).not.toHaveProperty("bbox");
    expect(e!.visible).toBe(false);
    // Not off-screen: no scroll can reveal it, so it must not be queued for one.
    expect(e!.offscreen).toBe(false);
  });
});

describe("projectElements over a whole state", () => {
  it("projects every fused element", () => {
    const graph = buildElementGraph(
      [measure(), measure({ selector: "#s", rect: { x: 400, y: 1180, w: 120, h: 40 } })],
      geometry,
      FRAME
    );
    const fusion = fuse(graph, [], false, geometry);
    const state = {
      frame: {
        id: FRAME,
        capturedAt: 0,
        pixels: new Uint8Array([1]),
        format: "png",
        geometry,
      },
      geometry,
      graph,
      fusion,
      capability: { backend: "wasm", tiersFired: ["T0"], unavailableDetectors: [] },
      trigger: { kind: "INITIAL" },
      observedAt: 0,
    } as unknown as PerceptionState;

    const projected = projectElements(state);
    expect(projected).toHaveLength(2);
    expect(projected[0]!).toHaveProperty("bbox");
    expect(projected[1]!).not.toHaveProperty("bbox");
  });
});
