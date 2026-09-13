/**
 * VALIDATE → ACT against the controlled MVP fixture's REAL geometry, deterministically.
 *
 * The browser run lives in `artifacts/experiments/MVP-1-act-executor/` and needs Chromium. This
 * is its CI-runnable counterpart: the numbers below are the rects a real Chromium measured on
 * `tests/browser/qg02/fixture/form.html` at 1024x768, DPR 1, fed through the real
 * `buildElementGraph`. Same page, same classification, no browser, no timing.
 *
 * MEASURED, and the citation is checkable — which the previous one was not. These rects were
 * wrong from the first commit and cited `logs/mvp1.json` as their source; that log records click
 * points and a viewport, and has never contained a single rect. An unverifiable citation is how
 * wrong numbers survive, so the measurement is now recorded as data:
 * `artifacts/experiments/MVP-2-hit-test-verify-result/logs/fixture-geometry.json`
 * (Chromium 151.0.7922.34, workstation 1, 2026-09-13). `guardedActOnMvpFixture.test.ts` uses the
 * same values, and the two files must not drift apart again.
 *
 * It is **not** an end-to-end agent test. There is no executor in the product (the bridge is an
 * interface, and there is no `manifest.json` to host a content script), no SANITIZE, no VERIFY,
 * no REASON, no RE-HYDRATE and no VERIFY RESULT. Nothing here completes a task.
 */
import { describe, expect, it } from "vitest";
import {
  act,
  authorisationPreflight,
  establishHitAgreement,
  mintDispatchPermit,
  validateActionFreshness,
  type ActResult,
  type CssPoint,
  type FreshnessDecision,
  type HitTestBridge,
  type PageActionBridge,
  type ProposedAction,
  type TargetClaim,
  type TopmostElement,
} from "@pratibimb/agent";
import {
  buildElementGraph,
  frameId,
  type CaptureGeometry,
  type DomMeasurement,
  type ElementGraph,
  type FrameId,
} from "@pratibimb/perception";

const F = frameId("mode-a-frame-1");

/** 1024x768 at DPR 1, unscrolled — the viewport the MVP-1 harness used. */
const geometry: CaptureGeometry = {
  dpr: 1,
  zoom: 1,
  viewportCss: { w: 1024, h: 768 },
  captureSize: { w: 1024, h: 768 },
  scroll: { x: 0, y: 0 },
  origin: "http://127.0.0.1:8982",
};

/**
 * The QG-02 fixture as Chromium measured it. `#submit` at y=1180 and `#footer-link` at y=1400
 * are below the fold on purpose — that is what the fixture is for.
 */
const fixture = (over: Partial<DomMeasurement>[] = []): DomMeasurement[] => {
  const base: DomMeasurement[] = [
    { selector: "#phone-label", role: "label", name: "Phone", rect: { x: 400, y: 220, w: 300, h: 20 }, cssHidden: false, enabled: true, parentIndex: -1 },
    { selector: "#phone", role: "textbox", name: "Phone", rect: { x: 400, y: 260, w: 300, h: 32 }, cssHidden: false, enabled: true, parentIndex: -1 },
    { selector: "#help-link", role: "link", name: "What number should I use?", rect: { x: 400, y: 310, w: 160, h: 18 }, cssHidden: false, enabled: true, parentIndex: -1 },
    { selector: "#cancel", role: "button", name: "Cancel", rect: { x: 620, y: 360, w: 120, h: 40 }, cssHidden: false, enabled: true, parentIndex: -1 },
    { selector: "#submit", role: "button", name: "Submit", rect: { x: 400, y: 1180, w: 120, h: 40 }, cssHidden: false, enabled: true, parentIndex: -1 },
    { selector: "#footer-link", role: "link", name: "Privacy policy", rect: { x: 400, y: 1400, w: 200, h: 18 }, cssHidden: false, enabled: true, parentIndex: -1 },
  ];
  return base.map((m, i) => ({ ...m, ...(over[i] ?? {}) }));
};

const graph = (over: Partial<DomMeasurement>[] = [], frame: FrameId = F): ElementGraph =>
  buildElementGraph(fixture(over), geometry, frame);

const bySelector = (g: ElementGraph, selector: string) => {
  const n = g.nodes.find((x) => x.domRef.selector === selector);
  if (!n) throw new Error(`test setup: ${selector} absent`);
  return n;
};

const claim = (g: ElementGraph, selector: string): TargetClaim => {
  const n = bySelector(g, selector);
  const e = n.evidence;
  if (e.kind !== "OBSERVED" && e.kind !== "CLIPPED") throw new Error(`test setup: ${selector} is ${e.kind}`);
  return { nodeId: n.id, role: n.role, name: n.name, frameId: g.frameId, viewportBox: e.viewportBox };
};

class Bridge implements PageActionBridge {
  readonly clicks: CssPoint[] = [];
  constructor(readonly frameId: FrameId = F) {}
  async clickAtCssPoint(p: CssPoint): Promise<void> {
    this.clicks.push(p);
  }
}

/** A page that agrees with its own graph: whatever the graph puts at a point is topmost there. */
class PageAgrees implements HitTestBridge {
  readonly frameId: FrameId;
  constructor(private readonly page: ElementGraph) {
    this.frameId = page.frameId;
  }
  async topmostAtCssPoint(p: CssPoint): Promise<TopmostElement | null> {
    for (const n of this.page.nodes) {
      const e = n.evidence;
      if (e.kind !== "OBSERVED" && e.kind !== "CLIPPED") continue;
      const b = e.viewportBox;
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        return { frameId: this.page.frameId, selector: n.domRef.selector, role: n.role, name: n.name, box: b };
      }
    }
    return null;
  }
}

/** A TEST lifetime, not a proposal: the gate has no default TTL and ADR-0008 leaves the value open. */
const TEST_TTL_MS = 60_000;

/**
 * VALIDATE → AUTHORISE → HIT-TEST → MINT → ACT, through the real gate. Replaces the removed
 * `validateAndAct`, which reached ACT without any hit-test agreement (ADR-0007 §8, closed by ADR-0008).
 */
async function gated(g: ElementGraph, proposal: ProposedAction, b: Bridge): Promise<{ decision: FreshnessDecision; result: ActResult }> {
  const decision = validateActionFreshness(g, proposal);
  const pre = authorisationPreflight(decision);
  if (pre) return { decision, result: pre };
  const hit = await establishHitAgreement(decision, new PageAgrees(g));
  const minted = mintDispatchPermit(decision, hit, { ttlMs: TEST_TTL_MS });
  if (!minted.minted) return { decision, result: minted.refusal };
  return { decision, result: await act(minted.permit, b) };
}

const expectNoDispatch = (r: ActResult, b: Bridge): void => {
  expect(b.clicks.length).toBe(0);
  expect(r.status).not.toBe("EXECUTED");
};

describe("VALIDATE -> ACT on the controlled MVP fixture's real geometry", () => {
  it("A — clicks the phone field at the centre of its measured box", async () => {
    const g = graph();
    const b = new Bridge();
    const { decision, result } = await gated(g, { kind: "click", target: claim(g, "#phone") }, b);
    expect(decision.decision).toBe("ALLOW");
    expect(result.status).toBe("EXECUTED");
    // the point the real browser run dispatched at: (550, 276)
    expect(b.clicks[0]).toEqual({ x: 550, y: 276 });
  });

  it("B — refuses a claim from an earlier frame", async () => {
    const before = graph();
    const plan = claim(before, "#phone");
    const after = graph([], frameId("mode-a-frame-2"));
    const b = new Bridge(after.frameId);
    const { decision, result } = await gated(after, { kind: "click", target: plan }, b);
    if (decision.decision === "RE_OBSERVE") expect(decision.reason).toBe("FRAME_MISMATCH");
    expectNoDispatch(result, b);
  });

  it("C — refuses Cancel after it moved 60 CSS px within the same frame", async () => {
    const before = graph();
    const plan = claim(before, "#cancel");
    const after = graph([{}, {}, {}, { rect: { x: 620, y: 420, w: 120, h: 40 } }]);
    const b = new Bridge();
    const { decision, result } = await gated(after, { kind: "click", target: plan }, b);
    if (decision.decision === "RE_OBSERVE") expect(decision.reason).toBe("MOVED_BEYOND_TOLERANCE");
    expectNoDispatch(result, b);
  });

  it("D — refuses Cancel after it became \"Delete my account\" in place", async () => {
    const before = graph();
    const plan = claim(before, "#cancel");
    const after = graph([{}, {}, {}, { name: "Delete my account" }]);
    const b = new Bridge();
    const { decision, result } = await gated(after, { kind: "click", target: plan }, b);
    if (decision.decision === "RE_OBSERVE") expect(decision.reason).toBe("NAME_CHANGED");
    expectNoDispatch(result, b);
  });

  it("E — a removed element shifts later ids, so the claim rebinds and is refused on identity", async () => {
    // Positional ids are a real property of the snapshot: this is the browser run's demo E.
    const before = graph();
    const plan = claim(before, "#cancel");
    const shorter = buildElementGraph(fixture().filter((m) => m.selector !== "#cancel"), geometry, F);
    const b = new Bridge();
    const { decision, result } = await gated(shorter, { kind: "click", target: plan }, b);
    expect(decision.decision).toBe("RE_OBSERVE");
    if (decision.decision === "RE_OBSERVE") {
      expect(["NAME_CHANGED", "ROLE_CHANGED", "TARGET_MISSING"]).toContain(decision.reason);
    }
    expectNoDispatch(result, b);
  });

  it("F — refuses the submit button at the confirmation tier, even when validation allows it", async () => {
    // A taller viewport brings #submit on screen: the fixture puts it at y=1180.
    const tall: CaptureGeometry = { ...geometry, viewportCss: { w: 1024, h: 1600 }, captureSize: { w: 1024, h: 1600 } };
    const g = buildElementGraph(fixture(), tall, F);
    expect(bySelector(g, "#submit").evidence.kind).toBe("OBSERVED");
    const b = new Bridge();
    const { decision, result } = await gated(g, { kind: "click", target: claim(g, "#submit") }, b);
    expect(decision.decision).toBe("ALLOW");
    expect(result.status).toBe("REJECTED");
    if (result.status === "REJECTED") expect(result.cause).toBe("HUMAN_CONFIRMATION_REQUIRED");
    expectNoDispatch(result, b);
  });

  it("G — refuses the help link: the graph cannot say whether it leaves this origin", async () => {
    const g = graph();
    const b = new Bridge();
    const { decision, result } = await gated(g, { kind: "click", target: claim(g, "#help-link") }, b);
    expect(decision.decision).toBe("ALLOW");
    if (result.status === "REJECTED") expect(result.cause).toBe("HUMAN_CONFIRMATION_REQUIRED");
    expectNoDispatch(result, b);
  });

  it("H — refuses the submit button while it is below the fold", async () => {
    const g = graph();
    expect(bySelector(g, "#submit").evidence.kind).toBe("OFFSCREEN");
    const stale: TargetClaim = {
      nodeId: bySelector(g, "#submit").id,
      role: "button",
      name: "Submit",
      frameId: g.frameId,
      viewportBox: { x: 400, y: 1180, w: 120, h: 40 } as TargetClaim["viewportBox"],
    };
    const b = new Bridge();
    const { decision, result } = await gated(g, { kind: "click", target: stale }, b);
    if (decision.decision === "RE_OBSERVE") expect(decision.reason).toBe("NOT_VISIBLE");
    expectNoDispatch(result, b);
  });

  it("I — refuses to type into the tel field, and nothing about a value is carried", async () => {
    const g = graph();
    const b = new Bridge();
    const { decision, result } = await gated(g, { kind: "type", target: claim(g, "#phone") }, b);
    expect(decision.decision).toBe("ALLOW");
    expect(result.status).toBe("UNSUPPORTED_ACTION");
    if (result.status === "UNSUPPORTED_ACTION") expect(result.cause).toBe("CLEARANCE_PIPELINE_ABSENT");
    expectNoDispatch(result, b);
  });

  it("J — a DOM-poor page offers no node, so no action can be validated at all", async () => {
    // The canvas fixture's measurable DOM: nothing actionable. A detector candidate is not an
    // ElementNode, so there is no claim to make and nothing to hand ACT.
    const empty = buildElementGraph([], geometry, F);
    expect(empty.nodes.length).toBe(0);
    const b = new Bridge();
    const { decision, result } = await gated(
      empty,
      { kind: "click", target: { ...claim(graph(), "#phone") } },
      b
    );
    expect(decision.decision).toBe("RE_OBSERVE");
    if (decision.decision === "RE_OBSERVE") expect(decision.reason).toBe("TARGET_MISSING");
    expectNoDispatch(result, b);
  });

  it("the whole fixture: exactly three of its controls are clickable today, and submit is not one of them", async () => {
    const g = graph();
    const outcomes: Record<string, string> = {};
    for (const n of g.nodes) {
      const e = n.evidence;
      const b = new Bridge();
      if (e.kind !== "OBSERVED" && e.kind !== "CLIPPED") {
        outcomes[n.domRef.selector] = `NOT_VISIBLE(${e.kind})`;
        continue;
      }
      const { result } = await gated(
        g,
        { kind: "click", target: { nodeId: n.id, role: n.role, name: n.name, frameId: g.frameId, viewportBox: e.viewportBox } },
        b
      );
      outcomes[n.domRef.selector] =
        result.status === "EXECUTED" ? "EXECUTED" : result.status === "REJECTED" ? `REJECTED(${result.cause})` : result.status;
    }
    expect(outcomes).toEqual({
      "#phone-label": "EXECUTED",
      "#phone": "EXECUTED",
      "#help-link": "REJECTED(HUMAN_CONFIRMATION_REQUIRED)",
      "#cancel": "EXECUTED",
      "#submit": "NOT_VISIBLE(OFFSCREEN)",
      "#footer-link": "NOT_VISIBLE(OFFSCREEN)",
    });
  });
});
