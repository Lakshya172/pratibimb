/**
 * ACT — the executor. ADR-0006, amended by ADR-0008 (PROPOSED).
 *
 * ACT now accepts a `DispatchPermit` and nothing else, so this suite exercises it through the real
 * gate: VALIDATE → AUTHORISE → HIT-TEST → MINT → ACT. The organising claim is unchanged from the
 * first version of this file — **there is no path from an unvalidated or refused action to the
 * browser** — and every negative case still asserts that the bridge's single method was never
 * called. `permit.test.ts` covers the permit itself: forgery, copies, revival, frames, expiry and
 * single use.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ALLOWED_ACTIONS,
  EXECUTABLE_ACTIONS,
  act,
  authorisationPreflight,
  confirmationTierOf,
  establishHitAgreement,
  mintDispatchPermit,
  validateActionFreshness,
  wasDispatched,
  type ActResult,
  type CssPoint,
  type FreshnessDecision,
  type FreshnessTolerance,
  type HitTestBridge,
  type PageActionBridge,
  type ProposedAction,
  type TargetClaim,
  type TopmostElement,
} from "@pratibimb/agent";
import {
  cssBox,
  cssPx,
  docBox,
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

/** A TEST lifetime, not a proposal. The gate has no default; ADR-0008 §5 leaves the value open. */
const TEST_TTL_MS = 60_000;

const box = (x: number, y: number, w: number, h: number): CssBox => cssBox(cssPx(x), cssPx(y), cssPx(w), cssPx(h));

const observed = (b: CssBox, frame: FrameId = F1): VisualEvidence => ({
  kind: "OBSERVED",
  frameId: frame,
  viewportBox: b,
  documentBox: docBox(b.x, b.y, b.w, b.h),
});

const clipped = (full: CssBox, visible: CssBox, frame: FrameId = F1): VisualEvidence => ({
  kind: "CLIPPED",
  frameId: frame,
  viewportBox: full,
  visiblePart: visible,
  documentBox: docBox(full.x, full.y, full.w, full.h),
});

const node = (over: Partial<ElementNode> = {}): ElementNode => ({
  id: nodeId("e1"),
  role: "textbox",
  name: "Phone",
  domRef: { selector: "#phone" },
  evidence: observed(box(100, 200, 240, 32)),
  enabled: true,
  parent: null,
  children: [],
  ...over,
});

const graphOf = (nodes: readonly ElementNode[], frame: FrameId = F1): ElementGraph => ({
  frameId: frame,
  nodes: [...nodes],
  byId: new Map(nodes.map((n) => [n.id, n])),
});

const claimOf = (n: ElementNode, frame: FrameId = F1): TargetClaim => {
  const e = n.evidence;
  if (e.kind !== "OBSERVED" && e.kind !== "CLIPPED") throw new Error("test setup: no box to claim");
  return { nodeId: n.id, role: n.role, name: n.name, frameId: frame, viewportBox: e.viewportBox };
};

/** A page that agrees with its own graph: the node whose full box contains the point is topmost. */
class PageAgrees implements HitTestBridge {
  readonly frameId: FrameId;
  constructor(private readonly g: ElementGraph) {
    this.frameId = g.frameId;
  }
  async topmostAtCssPoint(p: CssPoint): Promise<TopmostElement | null> {
    for (const n of this.g.nodes) {
      const e = n.evidence;
      if (e.kind !== "OBSERVED" && e.kind !== "CLIPPED") continue;
      const full = e.viewportBox;
      if (p.x >= full.x && p.x <= full.x + full.w && p.y >= full.y && p.y <= full.y + full.h) {
        return { frameId: this.g.frameId, selector: n.domRef.selector, role: n.role, name: n.name, box: full };
      }
    }
    return null;
  }
}

/** A bridge that records every dispatch instead of performing one. */
class RecordingBridge implements PageActionBridge {
  readonly clicks: CssPoint[] = [];
  constructor(readonly frameId: FrameId = F1) {}
  async clickAtCssPoint(point: CssPoint): Promise<void> {
    this.clicks.push(point);
  }
  get callCount(): number {
    return this.clicks.length;
  }
}

let bridge: RecordingBridge;
beforeEach(() => {
  bridge = new RecordingBridge();
});

/** Every refusal must look identical from the outside: no dispatch, ever. */
const expectNoBrowserOperation = (r: ActResult, b: RecordingBridge): void => {
  expect(b.callCount).toBe(0);
  expect(wasDispatched(r)).toBe(false);
  expect(r.status).not.toBe("EXECUTED");
};

/** The whole gate, for one proposal against one page. The only route to `act` in this file. */
async function gated(
  g: ElementGraph,
  proposal: ProposedAction,
  b: PageActionBridge,
  tolerance?: FreshnessTolerance
): Promise<{ decision: FreshnessDecision; result: ActResult }> {
  const decision = validateActionFreshness(g, proposal, tolerance);
  const pre = authorisationPreflight(decision);
  if (pre) return { decision, result: pre };
  const hit = await establishHitAgreement(decision, new PageAgrees(g));
  const minted = mintDispatchPermit(decision, hit, { ttlMs: TEST_TTL_MS });
  if (!minted.minted) return { decision, result: minted.refusal };
  return { decision, result: await act(minted.permit, b) };
}

const clickOn = (n: ElementNode, point?: CssPoint): Promise<{ decision: FreshnessDecision; result: ActResult }> =>
  gated(graphOf([n]), { kind: "click", target: claimOf(n), ...(point ? { point } : {}) }, bridge);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The supported path
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("ACT executes a permitted click", () => {
  it("dispatches at the centre of the validated box and reports EXECUTED", async () => {
    const { result: r } = await clickOn(node());
    expect(r.status).toBe("EXECUTED");
    expect(bridge.callCount).toBe(1);
    expect(bridge.clicks[0]).toEqual({ x: 220, y: 216 });
    if (r.status === "EXECUTED") {
      expect(r.kind).toBe("click");
      expect(r.target.nodeId).toBe(nodeId("e1"));
      expect(r.target.role).toBe("textbox");
      expect(r.target.box).toEqual(box(100, 200, 240, 32));
      expect(r.dispatchMs).toBeGreaterThanOrEqual(0);
    }
    expect(wasDispatched(r)).toBe(true);
  });

  it("uses the point the VALIDATOR echoed, carried through the hit test into the permit", async () => {
    const { result } = await clickOn(node(), { x: cssPx(110), y: cssPx(205) });
    expect(result.status).toBe("EXECUTED");
    expect(bridge.clicks[0]).toEqual({ x: 110, y: 205 });
  });

  it("clicks inside the VISIBLE part of a clipped target, never the full box's centre", async () => {
    const n = node({ evidence: clipped(box(100, -40, 240, 80), box(100, 0, 240, 40)) });
    const { result } = await clickOn(n);
    expect(result.status).toBe("EXECUTED");
    expect(bridge.clicks[0]).toEqual({ x: 220, y: 20 });
  });

  it("the gate authorises exactly one action kind", () => {
    expect([...EXECUTABLE_ACTIONS]).toEqual(["click"]);
    expect(ALLOWED_ACTIONS.length).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// No validation, no target, no fallback
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("no validation means no execution", () => {
  it("a RE_OBSERVE decision is refused by the gate and never reaches ACT", async () => {
    const n = node();
    const { decision, result } = await gated(graphOf([n]), { kind: "click", target: { ...claimOf(n), frameId: F2 } }, bridge);
    expect(decision.decision).toBe("RE_OBSERVE");
    expect(result.status).toBe("REJECTED");
    if (result.status === "REJECTED") {
      expect(result.cause).toBe("NOT_VALIDATED");
      expect(result.detail).toContain("FRAME_MISMATCH");
    }
    expectNoBrowserOperation(result, bridge);
  });

  it("does not fall back to another element when the target is gone", async () => {
    const wanted = node({ id: nodeId("e1"), name: "Phone" });
    const neighbour = node({ id: nodeId("e2"), name: "Email", domRef: { selector: "#email" }, evidence: observed(box(100, 260, 240, 32)) });
    const { decision, result } = await gated(graphOf([neighbour]), { kind: "click", target: claimOf(wanted) }, bridge);
    expect(decision.decision).toBe("RE_OBSERVE");
    expectNoBrowserOperation(result, bridge);
  });

  it("sweeps every refusal reason and proves not one of them reaches the browser", async () => {
    const n = node();
    const offscreen = node({ evidence: { kind: "OFFSCREEN", documentBox: docBox(100, 2000, 240, 32) } });
    const disabled = node({ enabled: false });
    const hidden = node({ evidence: { kind: "UNOBSERVED", reason: "ELEMENT_OUTSIDE_CAPTURE", detail: "css-hidden in the test fixture" } });
    const cases: { readonly why: string; readonly graph: ElementGraph; readonly proposal: ProposedAction }[] = [
      { why: "not in the grammar", graph: graphOf([n]), proposal: { kind: "dance", target: claimOf(n) } },
      { why: "stale frame", graph: graphOf([n]), proposal: { kind: "click", target: { ...claimOf(n), frameId: F2 } } },
      { why: "target gone", graph: graphOf([n]), proposal: { kind: "click", target: { ...claimOf(n), nodeId: nodeId("missing") } } },
      { why: "role changed", graph: graphOf([n]), proposal: { kind: "click", target: { ...claimOf(n), role: "button" } } },
      { why: "name changed", graph: graphOf([n]), proposal: { kind: "click", target: { ...claimOf(n), name: "Delete my account" } } },
      { why: "became disabled", graph: graphOf([disabled]), proposal: { kind: "click", target: claimOf(n) } },
      { why: "scrolled off screen", graph: graphOf([offscreen]), proposal: { kind: "click", target: claimOf(n) } },
      { why: "never observed", graph: graphOf([hidden]), proposal: { kind: "click", target: claimOf(n) } },
      { why: "moved", graph: graphOf([n]), proposal: { kind: "click", target: { ...claimOf(n), viewportBox: box(400, 600, 240, 32) } } },
      { why: "resized", graph: graphOf([n]), proposal: { kind: "click", target: { ...claimOf(n), viewportBox: box(100, 200, 900, 32) } } },
      { why: "point off target", graph: graphOf([n]), proposal: { kind: "click", target: claimOf(n), point: { x: cssPx(9000), y: cssPx(9000) } } },
      { why: "no target at all", graph: graphOf([n]), proposal: { kind: "click" } },
    ];
    for (const { why, graph, proposal } of cases) {
      const fresh = new RecordingBridge();
      const { decision, result } = await gated(graph, proposal, fresh);
      expect(decision.decision, why).toBe("RE_OBSERVE");
      expect(result.status, why).toBe("REJECTED");
      expect(fresh.callCount, why).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Unsupported actions and the confirmation tier — refused by the gate, before any permit exists
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("unsupported actions are refused with a specific, honest reason", () => {
  const expectUnsupported = async (proposal: ProposedAction, cause: string) => {
    const { result } = await gated(graphOf([node()]), proposal, bridge);
    expect(result.status).toBe("UNSUPPORTED_ACTION");
    if (result.status === "UNSUPPORTED_ACTION") expect(result.cause).toBe(cause);
    expectNoBrowserOperation(result, bridge);
  };

  it("refuses `type` because the clearance pipeline does not exist", async () => {
    await expectUnsupported({ kind: "type", target: claimOf(node()) }, "CLEARANCE_PIPELINE_ABSENT");
  });

  it("refuses `scroll` and `select` for want of a payload contract", async () => {
    await expectUnsupported({ kind: "scroll", target: claimOf(node()) }, "NO_SAFE_PAYLOAD_CONTRACT");
    await expectUnsupported({ kind: "select", target: claimOf(node()) }, "NO_SAFE_PAYLOAD_CONTRACT");
  });

  it("refuses `confirm` because nothing can represent a human's consent", async () => {
    await expectUnsupported({ kind: "confirm", target: claimOf(node()) }, "NO_HUMAN_CONFIRMATION_CHANNEL");
  });

  it("refuses `wait`, `zoom_request` and `done` as not page operations", async () => {
    await expectUnsupported({ kind: "wait" }, "NOT_A_PAGE_OPERATION");
    await expectUnsupported({ kind: "zoom_request", target: claimOf(node()) }, "NOT_A_PAGE_OPERATION");
    await expectUnsupported({ kind: "done" }, "NOT_A_PAGE_OPERATION");
  });

  it("covers every allowlisted action: each one either executes or is refused by name", async () => {
    const n = node();
    for (const kind of ALLOWED_ACTIONS) {
      const fresh = new RecordingBridge();
      const needsTarget = !["wait", "done"].includes(kind);
      const { result } = await gated(graphOf([n]), needsTarget ? { kind, target: claimOf(n) } : { kind }, fresh);
      if (kind === "click") {
        expect(result.status).toBe("EXECUTED");
        expect(fresh.callCount).toBe(1);
      } else {
        expect(result.status).toBe("UNSUPPORTED_ACTION");
        expect(fresh.callCount).toBe(0);
      }
    }
  });
});

describe("the human-confirmation tier refuses, and has no grant path", () => {
  it("refuses a submit button even though validation allowed it", async () => {
    const submit = node({ id: nodeId("e9"), role: "button", name: "Submit", domRef: { selector: "#submit" } });
    const { decision, result } = await clickOn(submit);
    expect(decision.decision).toBe("ALLOW");
    expect(result.status).toBe("REJECTED");
    if (result.status === "REJECTED") expect(result.cause).toBe("HUMAN_CONFIRMATION_REQUIRED");
    expectNoBrowserOperation(result, bridge);
  });

  it("refuses every link, because the element graph cannot say where a link goes", async () => {
    const link = node({ id: nodeId("e8"), role: "link", name: "What number should I use?", domRef: { selector: "#help" } });
    const { result } = await clickOn(link);
    if (result.status === "REJECTED") expect(result.cause).toBe("HUMAN_CONFIRMATION_REQUIRED");
    expectNoBrowserOperation(result, bridge);
  });

  it("screens the tier names the action schema lists, and leaves ordinary controls routine", () => {
    for (const name of ["Submit", "Send message", "Pay now", "Purchase", "Delete my account", "Transfer funds", "Sign in", "Log out", "Authorise payment", "I agree"]) {
      expect(confirmationTierOf({ role: "button", name })).toBe("CONFIRM_REQUIRED");
    }
    for (const name of ["Phone", "Cancel", "Back", "Next page", "Search", "Close"]) {
      expect(confirmationTierOf({ role: "button", name })).toBe("ROUTINE");
    }
  });

  it("exposes no way to grant confirmation", async () => {
    const mod = await import("@pratibimb/agent");
    expect(Object.keys(mod).filter((k) => /grant|consent|approveAction/i.test(k))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Dispatch failures
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("dispatch failures are surfaced, never swallowed", () => {
  it("reports EXECUTION_ERROR when the bridge throws, and keeps the message out", async () => {
    class Throwing implements PageActionBridge {
      readonly frameId = F1;
      async clickAtCssPoint(): Promise<void> {
        const e = new Error('element is not visible: <input id="phone" value="9876543210">');
        e.name = "TimeoutError";
        throw e;
      }
    }
    const { result: r } = await gated(graphOf([node()]), { kind: "click", target: claimOf(node()) }, new Throwing());
    expect(r.status).toBe("EXECUTION_ERROR");
    if (r.status === "EXECUTION_ERROR") {
      expect(r.category).toBe("BRIDGE_THREW");
      expect(r.errorName).toBe("TimeoutError");
      expect(JSON.stringify(r)).not.toContain("9876543210");
      expect(JSON.stringify(r)).not.toContain("input id");
    }
    expect(wasDispatched(r)).toBe(false);
  });

  it("reports a timeout as an UNKNOWN outcome rather than a failure to act", async () => {
    class Hanging implements PageActionBridge {
      readonly frameId = F1;
      clickAtCssPoint(): Promise<void> {
        return new Promise<void>(() => {
          /* never resolves */
        });
      }
    }
    const g = graphOf([node()]);
    const decision = validateActionFreshness(g, { kind: "click", target: claimOf(node()) });
    const hit = await establishHitAgreement(decision, new PageAgrees(g));
    const minted = mintDispatchPermit(decision, hit, { ttlMs: TEST_TTL_MS });
    if (!minted.minted) throw new Error("test setup");
    const r = await act(minted.permit, new Hanging(), { timeoutMs: 1 });
    expect(r.status).toBe("EXECUTION_ERROR");
    if (r.status === "EXECUTION_ERROR") expect(r.category).toBe("BRIDGE_TIMEOUT");
  });

  it("does not convert a rejected promise into success", async () => {
    class Rejecting implements PageActionBridge {
      readonly frameId = F1;
      clickAtCssPoint(): Promise<void> {
        return Promise.reject(new Error("nope"));
      }
    }
    const { result } = await gated(graphOf([node()]), { kind: "click", target: claimOf(node()) }, new Rejecting());
    expect(result.status).toBe("EXECUTION_ERROR");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// No network, no storage, no values
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("ACT and the gate carry no value and claim no authority they do not need", () => {
  it("has no field anywhere that could hold a typed value or a secret", async () => {
    const { result: r } = await clickOn(node());
    expect(r.status).toBe("EXECUTED");
    const keys = Object.keys(r).concat(r.status === "EXECUTED" ? Object.keys(r.target) : []);
    for (const forbidden of ["value", "valueLiteral", "value_literal", "valueRef", "value_ref", "token", "secret", "text"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("neither module reaches a network or storage API", async () => {
    const fs = await import("node:fs/promises");
    for (const file of ["../src/act.ts", "../src/permit.ts"]) {
      const src = await fs.readFile(new URL(file, import.meta.url), "utf8");
      for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "localStorage", "sessionStorage", "indexedDB", "chrome.storage", "eval(", "Function("]) {
        expect(src, `${file} contains ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("is deterministic: the same proposal dispatches the same point every time", async () => {
    const points = [];
    for (let i = 0; i < 3; i += 1) {
      const b = new RecordingBridge();
      await gated(graphOf([node()]), { kind: "click", target: claimOf(node()) }, b);
      points.push(b.clicks[0]);
    }
    expect(points[0]).toEqual(points[1]);
    expect(points[1]).toEqual(points[2]);
  });

  it("honours a stricter freshness tolerance, and still does not dispatch when it fails", async () => {
    const n = node();
    const shifted: TargetClaim = { ...claimOf(n), viewportBox: box(101, 200, 240, 32) };
    const loose = await gated(graphOf([n]), { kind: "click", target: shifted }, new RecordingBridge());
    expect(loose.result.status).toBe("EXECUTED");
    const strict = await gated(graphOf([n]), { kind: "click", target: shifted }, bridge, { maxCentreShiftCssPx: 0.1, minBoxIou: 0.99 });
    expect(strict.decision.decision).toBe("RE_OBSERVE");
    expectNoBrowserOperation(strict.result, bridge);
  });
});
