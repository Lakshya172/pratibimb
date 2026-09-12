/**
 * VALIDATE + REFRESH — the action-freshness boundary.
 *
 * These tests are the reason the layer can be trusted, so they are written to be hostile to
 * it: every negative case asserts not merely that the decision is `RE_OBSERVE` but that **no
 * actionable target comes back**. A validator that refused and still handed out a box would
 * pass a naive decision check and be useless.
 *
 * Everything is constructed in memory. No browser, no network, no model, no DOM, no secrets.
 */
import { describe, it, expect } from "vitest";
import {
  ALLOWED_ACTIONS,
  PROPOSED_FRESHNESS_TOLERANCE,
  actionableTarget,
  mustReObserve,
  validateActionFreshness,
  type FreshnessDecision,
  type ProposedAction,
  type TargetClaim,
} from "@pratibimb/agent";
import {
  cssPx,
  docPx,
  frameId,
  nodeId,
  type CssBox,
  type ElementGraph,
  type ElementNode,
  type FrameId,
  type VisualEvidence,
} from "@pratibimb/perception";

const F1 = frameId("frame-1");
const F2 = frameId("frame-2");
const ID = nodeId("e12");

const box = (x: number, y: number, w: number, h: number): CssBox => ({
  x: cssPx(x),
  y: cssPx(y),
  w: cssPx(w),
  h: cssPx(h),
});
const dbox = (x: number, y: number, w: number, h: number) => ({
  x: docPx(x),
  y: docPx(y),
  w: docPx(w),
  h: docPx(h),
});

const observed = (b: CssBox, f: FrameId = F1): VisualEvidence => ({
  kind: "OBSERVED",
  frameId: f,
  viewportBox: b,
  documentBox: dbox(b.x, b.y, b.w, b.h),
});

const node = (over: Partial<ElementNode> = {}): ElementNode => ({
  id: ID,
  role: "textbox",
  name: "Phone",
  domRef: { selector: "#phone" },
  evidence: observed(box(100, 200, 300, 40)),
  enabled: true,
  parent: null,
  children: [],
  ...over,
});

const graph = (nodes: readonly ElementNode[], f: FrameId = F1): ElementGraph => ({
  frameId: f,
  nodes,
  byId: new Map(nodes.map((n) => [n.id, n])),
});

const claim = (over: Partial<TargetClaim> = {}): TargetClaim => ({
  nodeId: ID,
  role: "textbox",
  name: "Phone",
  frameId: F1,
  viewportBox: box(100, 200, 300, 40),
  ...over,
});

const click = (over: Partial<ProposedAction> = {}): ProposedAction => ({
  kind: "click",
  target: claim(),
  ...over,
});

/** Every negative case must satisfy all three of these, not just the first. */
function expectRefused(d: FreshnessDecision, reason: string) {
  expect(d.decision).toBe("RE_OBSERVE");
  if (d.decision === "RE_OBSERVE") expect(d.reason).toBe(reason);
  expect(mustReObserve(d)).toBe(true);
  // the load-bearing assertion: no fallback target is produced
  expect(actionableTarget(d)).toBeNull();
  expect((d as { viewportBox?: unknown }).viewportBox).toBeUndefined();
  expect((d as { node?: unknown }).node).toBeUndefined();
}

describe("VALIDATE — positive cases", () => {
  it("an unchanged valid target is ALLOWed", () => {
    const d = validateActionFreshness(graph([node()]), click());
    expect(d.decision).toBe("ALLOW");
    expect(mustReObserve(d)).toBe(false);
    if (d.decision === "ALLOW") {
      expect(d.kind).toBe("click");
      expect(d.node?.id).toBe(ID);
      expect(d.movedCssPx).toBe(0);
      expect(d.boxIou).toBe(1);
    }
  });

  it("ALLOW hands back the CURRENT box, not the claimed one", () => {
    // moved 1 px: inside the tolerance, so allowed — and the caller must act on 101, not 100
    const d = validateActionFreshness(graph([node({ evidence: observed(box(101, 200, 300, 40)) })]), click());
    expect(d.decision).toBe("ALLOW");
    expect(actionableTarget(d)).toEqual(box(101, 200, 300, 40));
    if (d.decision === "ALLOW") expect(d.movedCssPx).toBeCloseTo(1, 10);
  });

  it("a point inside the current box is ALLOWed", () => {
    const d = validateActionFreshness(graph([node()]), click({ point: { x: cssPx(250), y: cssPx(220) } }));
    expect(d.decision).toBe("ALLOW");
  });

  it("a CLIPPED target is judged on its VISIBLE part", () => {
    const g = graph([
      node({
        evidence: {
          kind: "CLIPPED",
          frameId: F1,
          viewportBox: box(100, 200, 300, 40),
          visiblePart: box(100, 200, 150, 40),
          documentBox: dbox(100, 200, 300, 40),
        },
      }),
    ]);
    // a point in the visible half is fine
    expect(validateActionFreshness(g, click({ point: { x: cssPx(150), y: cssPx(220) } })).decision).toBe("ALLOW");
    // a point in the clipped half is not on screen, so it is refused
    expectRefused(
      validateActionFreshness(g, click({ point: { x: cssPx(390), y: cssPx(220) } })),
      "POINT_OUTSIDE_TARGET"
    );
  });

  it("target-free control actions are ALLOWed without a target", () => {
    for (const kind of ["wait", "done"] as const) {
      const d = validateActionFreshness(graph([node()]), { kind });
      expect(d.decision).toBe("ALLOW");
      if (d.decision === "ALLOW") expect(d.node).toBeUndefined();
    }
  });

  it("every allowlisted targeted action validates the same way", () => {
    for (const kind of ALLOWED_ACTIONS) {
      const targeted = kind !== "wait" && kind !== "done";
      const d = validateActionFreshness(graph([node()]), targeted ? { kind, target: claim() } : { kind });
      expect(d.decision, `${kind} should be allowed`).toBe("ALLOW");
    }
  });
});

describe("VALIDATE — negative cases, all fail closed", () => {
  it("an action outside the frozen allowlist is refused", () => {
    for (const kind of ["execute_javascript", "eval", "navigate", "download"]) {
      expectRefused(validateActionFreshness(graph([node()]), { kind, target: claim() }), "ACTION_NOT_ALLOWLISTED");
    }
  });

  it("a removed target is refused", () => {
    expectRefused(validateActionFreshness(graph([]), click()), "TARGET_MISSING");
  });

  it("a target replaced by a different element at the same id is refused", () => {
    // same id, same geometry, different control: the lookalike-swap attack
    const g = graph([node({ role: "button", name: "Delete account" })]);
    expectRefused(validateActionFreshness(g, click()), "ROLE_CHANGED");
  });

  it("a changed role is refused", () => {
    expectRefused(validateActionFreshness(graph([node({ role: "button" })]), click()), "ROLE_CHANGED");
  });

  it("a changed accessible name is refused", () => {
    expectRefused(validateActionFreshness(graph([node({ name: "Aadhaar" })]), click()), "NAME_CHANGED");
  });

  it("a disabled target is refused", () => {
    expectRefused(validateActionFreshness(graph([node({ enabled: false })]), click()), "NOT_ENABLED");
  });

  it("an OFFSCREEN target is refused — it carries no pixel claim at all", () => {
    const g = graph([node({ evidence: { kind: "OFFSCREEN", documentBox: dbox(100, 2000, 300, 40) } })]);
    expectRefused(validateActionFreshness(g, click()), "NOT_VISIBLE");
  });

  it("an UNOBSERVED target is refused, and unknown is never read as safe", () => {
    const g = graph([
      node({ evidence: { kind: "UNOBSERVED", reason: "CAPTURE_FAILED", detail: "no frame" } }),
    ]);
    const d = validateActionFreshness(g, click());
    expectRefused(d, "NOT_VISIBLE");
    if (d.decision === "RE_OBSERVE") expect(d.detail).toContain("CAPTURE_FAILED");
  });

  it("a target moved beyond tolerance is refused", () => {
    // 3 px right: beyond the 2.0 px proposed tolerance
    const g = graph([node({ evidence: observed(box(103, 200, 300, 40)) })]);
    expectRefused(validateActionFreshness(g, click()), "MOVED_BEYOND_TOLERANCE");
  });

  it("a resize that keeps the centre is refused by the geometry floor", () => {
    // centre unchanged, width doubled: movement is 0, so only the IoU check can catch it
    const g = graph([node({ evidence: observed(box(-50, 200, 600, 40)) })]);
    const d = validateActionFreshness(g, click());
    expectRefused(d, "GEOMETRY_MISMATCH");
    if (d.decision === "RE_OBSERVE") expect(d.detail).toContain("IoU");
  });

  it("a frame mismatch on the claim is refused", () => {
    expectRefused(validateActionFreshness(graph([node()], F1), click({ target: claim({ frameId: F2 }) })), "FRAME_MISMATCH");
  });

  it("a frame mismatch hidden inside the evidence is refused too", () => {
    // the graph and the claim agree on F1, but the node's evidence came from F2
    const g = graph([node({ evidence: observed(box(100, 200, 300, 40), F2) })], F1);
    expectRefused(validateActionFreshness(g, click()), "FRAME_MISMATCH");
  });

  it("a point outside the current box is refused", () => {
    expectRefused(
      validateActionFreshness(graph([node()]), click({ point: { x: cssPx(900), y: cssPx(900) } })),
      "POINT_OUTSIDE_TARGET"
    );
  });

  it("insufficient metadata is refused — a missing role or name", () => {
    expectRefused(validateActionFreshness(graph([node()]), click({ target: claim({ role: "" }) })), "MALFORMED_CLAIM");
    expectRefused(validateActionFreshness(graph([node()]), click({ target: claim({ name: "" }) })), "MALFORMED_CLAIM");
  });

  it("a malformed box is refused", () => {
    for (const b of [box(Number.NaN, 200, 300, 40), box(100, 200, 0, 40), box(100, 200, 300, -5)]) {
      expectRefused(validateActionFreshness(graph([node()]), click({ target: claim({ viewportBox: b }) })), "MALFORMED_CLAIM");
    }
  });

  it("a non-finite point is refused", () => {
    expectRefused(
      validateActionFreshness(graph([node()]), click({ point: { x: cssPx(Number.POSITIVE_INFINITY), y: cssPx(1) } })),
      "MALFORMED_CLAIM"
    );
  });

  it("a targeted action with no target is refused", () => {
    expectRefused(validateActionFreshness(graph([node()]), { kind: "click" }), "MALFORMED_CLAIM");
  });

  it("a control action carrying a target is refused rather than ignored", () => {
    expectRefused(validateActionFreshness(graph([node()]), { kind: "done", target: claim() }), "MALFORMED_CLAIM");
  });

  it("a node whose current box is degenerate is refused", () => {
    const g = graph([node({ evidence: observed(box(100, 200, 0, 40)) })]);
    const d = validateActionFreshness(g, click());
    expect(d.decision).toBe("RE_OBSERVE");
    expect(actionableTarget(d)).toBeNull();
  });
});

describe("VALIDATE — check ordering is load-bearing", () => {
  it("identity is checked before geometry, so a lookalike swap cannot pass on its box", () => {
    // perfect geometry, changed name: must be NAME_CHANGED, never ALLOW
    const g = graph([node({ name: "Transfer ₹50,000" })]);
    const d = validateActionFreshness(g, click());
    expectRefused(d, "NAME_CHANGED");
  });

  it("frame is checked before the node, so a stale frame is not masked by a missing node", () => {
    // node absent AND frame wrong: the frame answer is the one that matters
    expectRefused(validateActionFreshness(graph([], F1), click({ target: claim({ frameId: F2 }) })), "FRAME_MISMATCH");
  });

  it("the allowlist is checked before anything about the page", () => {
    // a forbidden action with a perfect target is still refused for being forbidden
    expectRefused(
      validateActionFreshness(graph([node()]), { kind: "execute_javascript", target: claim() }),
      "ACTION_NOT_ALLOWLISTED"
    );
  });
});

describe("REFRESH — the decision, and what it denies", () => {
  it("mustReObserve is true for every refusal and false only for ALLOW", () => {
    expect(mustReObserve(validateActionFreshness(graph([node()]), click()))).toBe(false);
    expect(mustReObserve(validateActionFreshness(graph([]), click()))).toBe(true);
  });

  it("no refusal ever yields an actionable target — swept across every negative case", () => {
    const refusals: ProposedAction[] = [
      { kind: "eval", target: claim() },
      { kind: "click" },
      { kind: "click", target: claim({ frameId: F2 }) },
      { kind: "click", target: claim({ role: "" }) },
      { kind: "click", target: claim({ nodeId: nodeId("absent") }) },
      { kind: "click", target: claim(), point: { x: cssPx(9999), y: cssPx(9999) } },
    ];
    for (const a of refusals) {
      const d = validateActionFreshness(graph([node()]), a);
      expect(d.decision, JSON.stringify(a.kind)).toBe("RE_OBSERVE");
      expect(actionableTarget(d)).toBeNull();
    }
  });

  it("re-submitting the same claim against a NEW frame still refuses", () => {
    // the caller's temptation after a refusal: observe again, reuse the old claim. The claim
    // names the old frame, so it must keep failing until the plan is rebuilt.
    const fresh = graph([node({ evidence: observed(box(100, 200, 300, 40), F2) })], F2);
    expectRefused(validateActionFreshness(fresh, click()), "FRAME_MISMATCH");
  });

  it("the decision is deterministic — same inputs, same answer", () => {
    const g = graph([node()]);
    const a = click();
    expect(validateActionFreshness(g, a)).toEqual(validateActionFreshness(g, a));
  });
});

describe("VALIDATE — tolerances are configuration, and documented as proposals", () => {
  it("the proposed defaults are the documented values", () => {
    expect(PROPOSED_FRESHNESS_TOLERANCE).toEqual({ maxCentreShiftCssPx: 2.0, minBoxIou: 0.8 });
  });

  it("a stricter tolerance refuses a movement the default allows", () => {
    const g = graph([node({ evidence: observed(box(101.5, 200, 300, 40)) })]);
    expect(validateActionFreshness(g, click()).decision).toBe("ALLOW");
    expectRefused(
      validateActionFreshness(g, click(), { maxCentreShiftCssPx: 0.5, minBoxIou: 0.8 }),
      "MOVED_BEYOND_TOLERANCE"
    );
  });

  it("a looser tolerance cannot rescue a failed IDENTITY check", () => {
    // the point of the ordering: no tolerance setting makes a changed control acceptable
    const g = graph([node({ role: "button" })]);
    expectRefused(
      validateActionFreshness(g, click(), { maxCentreShiftCssPx: 10_000, minBoxIou: 0 }),
      "ROLE_CHANGED"
    );
  });
});

describe("adversarial / race scenarios, simulated on the element graph", () => {
  /** Plan against one observation, then validate against the next. */
  const race = (after: ElementGraph, a: ProposedAction = click()) => validateActionFreshness(after, a);

  it("1 — the target existed when planned, then disappeared", () => {
    expectRefused(race(graph([])), "TARGET_MISSING");
  });

  it("2 — same location, role and name changed underneath it", () => {
    expectRefused(race(graph([node({ role: "button", name: "Confirm transfer" })])), "ROLE_CHANGED");
  });

  it("3 — the target moved before execution", () => {
    expectRefused(race(graph([node({ evidence: observed(box(100, 260, 300, 40)) })])), "MOVED_BEYOND_TOLERANCE");
  });

  it("4 — a visually similar replacement appeared in the old location under a new id", () => {
    // the old id is gone; something that looks identical sits at the same box
    const replacement = node({ id: nodeId("e99") });
    const d = race(graph([replacement]));
    expectRefused(d, "TARGET_MISSING");
    // and nothing in the result points at the replacement
    expect(JSON.stringify(d)).not.toContain("e99");
  });

  it("5 — the frame id changed", () => {
    expectRefused(race(graph([node({ evidence: observed(box(100, 200, 300, 40), F2) })], F2)), "FRAME_MISMATCH");
  });

  it("6 — the element became disabled", () => {
    expectRefused(race(graph([node({ enabled: false })])), "NOT_ENABLED");
  });

  it("7 — the element scrolled out of the viewport", () => {
    expectRefused(race(graph([node({ evidence: { kind: "OFFSCREEN", documentBox: dbox(100, 3000, 300, 40) } })])), "NOT_VISIBLE");
  });

  it("8 — capture failed, so visibility is simply unknown", () => {
    expectRefused(
      race(graph([node({ evidence: { kind: "UNOBSERVED", reason: "CAPTURE_THROTTLED", detail: "quota" } })])),
      "NOT_VISIBLE"
    );
  });
});

describe("privacy surface of the validator itself", () => {
  it("a claim has nowhere to put a value, a literal or a vault token", () => {
    const keys = Object.keys(claim()).sort();
    expect(keys).toEqual(["frameId", "name", "nodeId", "role", "viewportBox"]);
    for (const forbidden of ["value", "value_ref", "literal", "token", "secret"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("a refusal detail never echoes anything but identity and geometry", () => {
    const d = validateActionFreshness(graph([node({ name: "Phone number" })]), click());
    // the name IS structural UI text and is allowed to appear; nothing else is available to leak
    expect(d.decision).toBe("RE_OBSERVE");
    if (d.decision === "RE_OBSERVE") {
      expect(d.detail).toContain("Phone");
      expect(d.detail).not.toMatch(/\d{10}/); // no phone-shaped value, because none is ever passed in
    }
  });
});
