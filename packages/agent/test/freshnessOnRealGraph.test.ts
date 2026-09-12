/**
 * VALIDATE against graphs produced by the REAL perception builder.
 *
 * The unit suite hand-builds `ElementGraph` values, which proves the decision logic but not
 * that it agrees with what `buildElementGraph` actually emits. These tests feed
 * `DomMeasurement` arrays — the shape a content script produces — through the real builder and
 * `classifyEvidence`, and validate against the result.
 *
 * That is the closest thing to an integration test this repository supports today. It is
 * **not** an end-to-end agent test: there is no executor, so nothing is clicked, and no
 * SANITIZE, VERIFY, REASON, PLAN or RE-HYDRATE stage exists to run before or after. See
 * `artifacts/reviews/AUDIT-0005-mvp-loop-readiness.md`.
 */
import { describe, it, expect } from "vitest";
import { actionableTarget, mustReObserve, validateActionFreshness, type TargetClaim } from "@pratibimb/agent";
import {
  buildElementGraph,
  cssPx,
  frameId,
  nodeId,
  type CaptureGeometry,
  type DomMeasurement,
} from "@pratibimb/perception";

const F1 = frameId("frame-a");

/** A 1024x768 viewport at DPR 1, unscrolled — the MVP-0 probe's own geometry. */
const geometry: CaptureGeometry = {
  dpr: 1,
  zoom: 1,
  viewportCss: { w: 1024, h: 768 },
  captureSize: { w: 1024, h: 768 },
  scroll: { x: 0, y: 0 },
  origin: "http://127.0.0.1:8981",
};

/** A small registration form, as a content script would measure it. */
const form = (over: Partial<DomMeasurement>[] = []): DomMeasurement[] => {
  const base: DomMeasurement[] = [
    { selector: "form", role: "form", name: "Registration", rect: { x: 40, y: 40, w: 720, h: 520 }, cssHidden: false, parentIndex: -1 },
    { selector: "#phone", role: "textbox", name: "Phone", rect: { x: 440, y: 216, w: 280, h: 34 }, cssHidden: false, enabled: true, parentIndex: 0 },
    { selector: "#submit", role: "button", name: "Submit", rect: { x: 580, y: 470, w: 140, h: 40 }, cssHidden: false, enabled: true, parentIndex: 0 },
    // an element below the fold: the builder classifies this OFFSCREEN, not hidden
    { selector: "#footer-link", role: "link", name: "Privacy policy", rect: { x: 40, y: 900, w: 120, h: 20 }, cssHidden: false, parentIndex: 0 },
  ];
  return base.map((m, i) => ({ ...m, ...(over[i] ?? {}) }));
};

const claimFor = (g: ReturnType<typeof buildElementGraph>, id: string): TargetClaim => {
  const n = g.byId.get(nodeId(id));
  if (!n) throw new Error(`test setup: node ${id} absent`);
  if (n.evidence.kind !== "OBSERVED" && n.evidence.kind !== "CLIPPED") {
    throw new Error(`test setup: node ${id} has ${n.evidence.kind} evidence`);
  }
  return { nodeId: n.id, role: n.role, name: n.name, frameId: g.frameId, viewportBox: n.evidence.viewportBox };
};

describe("VALIDATE on a graph from the real builder", () => {
  it("allows a click on an on-screen textbox measured by the builder", () => {
    const g = buildElementGraph(form(), geometry, F1);
    const d = validateActionFreshness(g, { kind: "click", target: claimFor(g, "e1") });
    expect(d.decision).toBe("ALLOW");
    expect(actionableTarget(d)).toEqual({ x: cssPx(440), y: cssPx(216), w: cssPx(280), h: cssPx(34) });
  });

  it("allows a type on the same target, and a confirm on the button", () => {
    const g = buildElementGraph(form(), geometry, F1);
    expect(validateActionFreshness(g, { kind: "type", target: claimFor(g, "e1") }).decision).toBe("ALLOW");
    expect(validateActionFreshness(g, { kind: "confirm", target: claimFor(g, "e2") }).decision).toBe("ALLOW");
  });

  it("refuses an element the builder classified OFFSCREEN", () => {
    const g = buildElementGraph(form(), geometry, F1);
    const below = g.byId.get(nodeId("e3"));
    expect(below?.evidence.kind).toBe("OFFSCREEN");
    // a claim cannot even be built honestly for it, so construct the stale one a planner
    // might have held from an earlier, scrolled observation
    const d = validateActionFreshness(g, {
      kind: "click",
      target: { nodeId: nodeId("e3"), role: "link", name: "Privacy policy", frameId: F1, viewportBox: { x: cssPx(40), y: cssPx(900), w: cssPx(120), h: cssPx(20) } },
    });
    expect(d.decision).toBe("RE_OBSERVE");
    if (d.decision === "RE_OBSERVE") expect(d.reason).toBe("NOT_VISIBLE");
    expect(actionableTarget(d)).toBeNull();
  });

  it("refuses when the page reflowed between the two observations", () => {
    const before = buildElementGraph(form(), geometry, F1);
    const plan = claimFor(before, "e1");
    // the same page, re-measured after a banner pushed everything down 24 px
    const F2 = frameId("frame-b");
    const after = buildElementGraph(
      form().map((m) => ({ ...m, rect: { ...m.rect, y: m.rect.y + 24 } })),
      geometry,
      F2
    );
    const d = validateActionFreshness(after, { kind: "click", target: plan });
    expect(mustReObserve(d)).toBe(true);
    // the frame changed too, which is the first thing that disqualifies it
    if (d.decision === "RE_OBSERVE") expect(d.reason).toBe("FRAME_MISMATCH");
  });

  it("refuses a reflow even when the frame id is unchanged", () => {
    // the harder case: the same frame re-measured, so only geometry can catch it
    const before = buildElementGraph(form(), geometry, F1);
    const plan = claimFor(before, "e1");
    const after = buildElementGraph(
      form().map((m) => ({ ...m, rect: { ...m.rect, y: m.rect.y + 24 } })),
      geometry,
      F1
    );
    const d = validateActionFreshness(after, { kind: "click", target: plan });
    expect(d.decision).toBe("RE_OBSERVE");
    if (d.decision === "RE_OBSERVE") expect(d.reason).toBe("MOVED_BEYOND_TOLERANCE");
    expect(actionableTarget(d)).toBeNull();
  });

  it("refuses a disabled submit the builder recorded as disabled", () => {
    const enabled = buildElementGraph(form(), geometry, F1);
    const plan = claimFor(enabled, "e2");
    const after = buildElementGraph(form([{}, {}, { enabled: false }]), geometry, F1);
    const d = validateActionFreshness(after, { kind: "click", target: plan });
    expect(d.decision).toBe("RE_OBSERVE");
    if (d.decision === "RE_OBSERVE") expect(d.reason).toBe("NOT_ENABLED");
  });

  it("refuses a control that became display:none — not confused with off-screen", () => {
    const visible = buildElementGraph(form(), geometry, F1);
    const plan = claimFor(visible, "e2");
    const after = buildElementGraph(form([{}, {}, { cssHidden: true }]), geometry, F1);
    const d = validateActionFreshness(after, { kind: "click", target: plan });
    expect(d.decision).toBe("RE_OBSERVE");
    if (d.decision === "RE_OBSERVE") expect(d.reason).toBe("NOT_VISIBLE");
  });

  it("refuses the lookalike swap: the submit button becomes a different button in place", () => {
    const before = buildElementGraph(form(), geometry, F1);
    const plan = claimFor(before, "e2");
    const after = buildElementGraph(form([{}, {}, { name: "Delete my account" }]), geometry, F1);
    const d = validateActionFreshness(after, { kind: "click", target: plan });
    expect(d.decision).toBe("RE_OBSERVE");
    if (d.decision === "RE_OBSERVE") expect(d.reason).toBe("NAME_CHANGED");
    // and nothing hands back a box that would have been clicked anyway
    expect(actionableTarget(d)).toBeNull();
  });
});
