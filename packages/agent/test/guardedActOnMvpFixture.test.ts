/**
 * VALIDATE → HIT-TEST → ACT → VERIFY RESULT, end to end, on the controlled MVP fixture's REAL
 * geometry — deterministically, with no browser.
 *
 * The numbers are the rects a real Chromium measured on `tests/browser/qg02/fixture/form.html`
 * at 1024x768, the same ones `actOnMvpFixture.test.ts` uses, fed through the real
 * `buildElementGraph`. The browser run that exercises the same six cases against an actual page
 * lives in `artifacts/experiments/MVP-2-hit-test-verify-result/`; this is its CI-runnable
 * counterpart, so the flow is defended on every push rather than only when Chromium is present.
 *
 * It is **not** an end-to-end agent test. There is no observation loop, no planner, no server, no
 * SANITIZE, no RE-HYDRATE and no vault. Nothing here completes a task, and one click that is
 * confirmed is not an agent.
 */
import { describe, expect, it } from "vitest";
import {
  guardedAct,
  guardedActionConfirmed,
  guardedActionDispatched,
  type CssPoint,
  type GuardedBridges,
  type HitTestBridge,
  type PageActionBridge,
  type PostActionObservation,
  type TopmostElement,
} from "@pratibimb/agent";
import {
  buildElementGraph,
  cssBox,
  frameId,
  type CaptureGeometry,
  type DomMeasurement,
  type ElementGraph,
  type FrameId,
} from "@pratibimb/perception";

const F1 = frameId("mvp2-frame-1");
const F2 = frameId("mvp2-frame-2");

/** 1024x768 at DPR 1, unscrolled — the viewport the MVP harnesses use. */
const geometry: CaptureGeometry = {
  dpr: 1,
  zoom: 1,
  viewportCss: { w: 1024, h: 768 },
  captureSize: { w: 1024, h: 768 },
  scroll: { x: 0, y: 0 },
  origin: "http://127.0.0.1:8983",
};

/** The QG-02 fixture as Chromium measures it. `#submit` and `#footer-link` are below the fold. */
const fixture = (): DomMeasurement[] => [
  { selector: "#phone-label", role: "label", name: "Phone", rect: { x: 400, y: 220, w: 300, h: 20 }, cssHidden: false, enabled: true, parentIndex: -1 },
  { selector: "#phone", role: "textbox", name: "Phone", rect: { x: 400, y: 260, w: 300, h: 32 }, cssHidden: false, enabled: true, parentIndex: -1 },
  { selector: "#help-link", role: "link", name: "What number should I use?", rect: { x: 400, y: 310, w: 160, h: 18 }, cssHidden: false, enabled: true, parentIndex: -1 },
  { selector: "#cancel", role: "button", name: "Cancel", rect: { x: 620, y: 360, w: 120, h: 40 }, cssHidden: false, enabled: true, parentIndex: -1 },
  { selector: "#submit", role: "button", name: "Submit", rect: { x: 400, y: 1180, w: 120, h: 40 }, cssHidden: false, enabled: true, parentIndex: -1 },
];

const graph = (frame: FrameId = F1, over: Partial<DomMeasurement>[] = [], drop: string[] = []): ElementGraph =>
  buildElementGraph(
    fixture()
      .map((m, i) => ({ ...m, ...(over[i] ?? {}) }))
      .filter((m) => !drop.includes(m.selector)),
    geometry,
    frame
  );

const nodeFor = (g: ElementGraph, selector: string) => {
  const n = g.nodes.find((x) => x.domRef.selector === selector);
  if (!n) throw new Error(`test setup: ${selector} absent`);
  return n;
};

const claimFor = (g: ElementGraph, selector: string) => {
  const n = nodeFor(g, selector);
  const e = n.evidence;
  if (e.kind !== "OBSERVED" && e.kind !== "CLIPPED") throw new Error(`test setup: ${selector} is ${e.kind}`);
  return { nodeId: n.id, role: n.role, name: n.name, frameId: g.frameId, viewportBox: e.viewportBox };
};

/** Counts clicks the way the browser harness counts them: in the thing being clicked. */
class Clicker implements PageActionBridge {
  readonly clicks: CssPoint[] = [];
  constructor(
    readonly frameId: FrameId = F1,
    private readonly behaviour: "OK" | "HANG" = "OK"
  ) {}
  async clickAtCssPoint(p: CssPoint): Promise<void> {
    this.clicks.push(p);
    if (this.behaviour === "HANG") return new Promise<never>(() => {});
  }
}

/** A page whose topmost element at a point can be set by the test, as an overlay would set it. */
class Looker implements HitTestBridge {
  readonly asked: CssPoint[] = [];
  constructor(
    readonly frameId: FrameId,
    private readonly page: ElementGraph,
    private readonly overlay: TopmostElement | null | "THROW" = null
  ) {}
  async topmostAtCssPoint(p: CssPoint): Promise<TopmostElement | null> {
    this.asked.push(p);
    if (this.overlay === "THROW") throw new RangeError("no page");
    if (this.overlay) return this.overlay;
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

const bridges = (click: Clicker, look: Looker): GuardedBridges => ({ action: click, hitTest: look });

/**
 * A TEST lifetime, not a proposal. The gate has no default permit TTL and ADR-0008 leaves the value
 * open; a minute is simply long enough that no test here can expire a permit by accident.
 */
const TEST_TTL_MS = 60_000;


/** A fresh observation, in a NEW frame, reporting where focus went. */
const after = (focusedSelector: string | null, over: Partial<DomMeasurement>[] = [], drop: string[] = []) =>
  async (): Promise<PostActionObservation> => ({ graph: graph(F2, over, drop), focusedSelector });

/** Options for paths expected to refuse before dispatch: a postcondition is mandatory regardless. */
const OPTS = { permitTtlMs: TEST_TTL_MS, verify: { expect: { kind: "FOCUS_ON_TARGET" as const }, observe: after(null) } };

describe("13 — a validated click that agrees and whose effect is observed is CONFIRMED", () => {
  it("clicks #phone at its measured centre and the page confirms focus", async () => {
    const g = graph();
    const click = new Clicker();
    const look = new Looker(F1, g);
    const o = await guardedAct(g, { kind: "click", target: claimFor(g, "#phone") }, bridges(click, look), {
      permitTtlMs: TEST_TTL_MS,
      verify: { expect: { kind: "FOCUS_ON_TARGET" }, observe: after("#phone") },
    });

    expect(o.reached).toBe("VERIFY_RESULT");
    expect(o.decision.decision).toBe("ALLOW");
    expect(o.hit?.agreement).toBe("MATCH");
    expect(o.result?.status).toBe("EXECUTED");
    expect(o.verification?.verification).toBe("CONFIRMED");
    expect(guardedActionConfirmed(o)).toBe(true);

    // the hit test asked about exactly the point that was then clicked: #phone's centre
    expect(look.asked).toEqual([{ x: 550, y: 276 }]);
    expect(click.clicks).toEqual([{ x: 550, y: 276 }]);
  });
});

describe("14 — an overlay over the validated point produces zero click events", () => {
  it("MISMATCH stops at the gate; ACT is never called and the page is never touched", async () => {
    const g = graph();
    const click = new Clicker();
    // A consent banner that appeared after validation and now covers #cancel.
    const banner: TopmostElement = {
      frameId: F1,
      selector: "#consent-banner",
      role: "generic",
      name: "We use cookies",
      box: cssBox(0, 330, 1024, 120),
    };
    const look = new Looker(F1, g, banner);
    const o = await guardedAct(g, { kind: "click", target: claimFor(g, "#cancel") }, bridges(click, look), {
      permitTtlMs: TEST_TTL_MS,
      verify: { expect: { kind: "FOCUS_ON_TARGET" }, observe: after("#cancel") },
    });

    expect(o.decision.decision).toBe("ALLOW");
    expect(o.reached).toBe("HIT_TEST");
    expect(o.hit?.agreement).toBe("MISMATCH");
    if (o.hit?.agreement === "MISMATCH") expect(o.hit.cause).toBe("DIFFERENT_ELEMENT");
    expect(o.result).toBeNull();
    expect(o.verification).toBeNull();
    expect(click.clicks.length).toBe(0);
    expect(guardedActionDispatched(o)).toBe(false);
    expect(guardedActionConfirmed(o)).toBe(false);
  });

  it("an empty point is also a MISMATCH, and also costs the page nothing", async () => {
    const g = graph();
    const click = new Clicker();
    // #submit is below the fold, so validation refuses first; use a moved-away #cancel instead.
    const moved = graph(F1, [{}, {}, {}, { rect: { x: 0, y: 0, w: 1, h: 1 } }]);
    const look = new Looker(F1, moved);
    const o = await guardedAct(g, { kind: "click", target: claimFor(g, "#cancel") }, bridges(click, look), OPTS);
    expect(o.hit?.agreement).toBe("MISMATCH");
    if (o.hit?.agreement === "MISMATCH") expect(o.hit.cause).toBe("NOTHING_AT_POINT");
    expect(click.clicks.length).toBe(0);
  });
});

describe("15 — an UNKNOWN hit test produces zero click events", () => {
  it("a bridge that cannot answer refuses just as hard as a mismatch", async () => {
    const g = graph();
    const click = new Clicker();
    const o = await guardedAct(g, { kind: "click", target: claimFor(g, "#cancel") }, bridges(click, new Looker(F1, g, "THROW")), OPTS);
    expect(o.reached).toBe("HIT_TEST");
    expect(o.hit?.agreement).toBe("UNKNOWN");
    if (o.hit?.agreement === "UNKNOWN") expect(o.hit.cause).toBe("BRIDGE_THREW");
    expect(o.result).toBeNull();
    expect(click.clicks.length).toBe(0);
  });

  it("a hit-test bridge on the wrong frame never even asks, and nothing is clicked", async () => {
    const g = graph();
    const click = new Clicker();
    const look = new Looker(F2, g);
    const o = await guardedAct(g, { kind: "click", target: claimFor(g, "#cancel") }, bridges(click, look), OPTS);
    expect(o.hit?.agreement).toBe("UNKNOWN");
    if (o.hit?.agreement === "UNKNOWN") expect(o.hit.cause).toBe("BRIDGE_FRAME_MISMATCH");
    expect(look.asked.length).toBe(0);
    expect(click.clicks.length).toBe(0);
  });
});

describe("16 — dispatched, but the expected state never appeared", () => {
  it("clicking the label focuses the INPUT, so FOCUS_ON_TARGET is NOT_CONFIRMED", async () => {
    // The fixture's label carries `for="phone"`. The click really is dispatched and really does
    // something — just not the thing that was asked for. This is the exact shape of the bug that
    // "EXECUTED means success" would hide.
    const g = graph();
    const click = new Clicker();
    const o = await guardedAct(g, { kind: "click", target: claimFor(g, "#phone-label") }, bridges(click, new Looker(F1, g)), {
      permitTtlMs: TEST_TTL_MS,
      verify: { expect: { kind: "FOCUS_ON_TARGET" }, observe: after("#phone") },
    });

    expect(o.hit?.agreement).toBe("MATCH");
    expect(o.result?.status).toBe("EXECUTED");
    expect(guardedActionDispatched(o)).toBe(true);
    expect(o.verification?.verification).toBe("NOT_CONFIRMED");
    if (o.verification?.verification === "NOT_CONFIRMED") expect(o.verification.cause).toBe("FOCUS_ELSEWHERE");
    expect(guardedActionConfirmed(o)).toBe(false);
    expect(click.clicks.length).toBe(1);
  });

  it("EXECUTED does not become CONFIRMED when nothing at all happened", async () => {
    const g = graph();
    const click = new Clicker();
    const o = await guardedAct(g, { kind: "click", target: claimFor(g, "#cancel") }, bridges(click, new Looker(F1, g)), {
      permitTtlMs: TEST_TTL_MS,
      verify: { expect: { kind: "FOCUS_ON_TARGET" }, observe: after(null) },
    });
    expect(o.result?.status).toBe("EXECUTED");
    expect(o.verification?.verification).toBe("NOT_CONFIRMED");
    if (o.verification?.verification === "NOT_CONFIRMED") expect(o.verification.cause).toBe("FOCUS_ABSENT");
  });

  it("with no readback supplied, NOTHING is dispatched — a postcondition is mandatory (ADR-0008)", async () => {
    // Changed on purpose. Under ADR-0007 this dispatched and reported `verification: null`; a
    // dispatch that nothing will read back is now refused before the page is even queried.
    const g = graph();
    const click = new Clicker();
    const look = new Looker(F1, g);
    const o = await guardedAct(g, { kind: "click", target: claimFor(g, "#cancel") }, bridges(click, look), {
      permitTtlMs: TEST_TTL_MS,
    } as never);
    expect(o.reached).toBe("AUTHORISE");
    expect(o.result?.status).toBe("REJECTED");
    if (o.result?.status === "REJECTED") expect(o.result.cause).toBe("POSTCONDITION_REQUIRED");
    expect(look.asked.length).toBe(0);
    expect(click.clicks.length).toBe(0);
    expect(o.verification).toBeNull();
  });
});

describe("17 — a dispatch timeout is UNKNOWN", () => {
  it("the click may have landed, so the outcome is neither confirmed nor denied", async () => {
    const g = graph();
    const click = new Clicker(F1, "HANG");
    const o = await guardedAct(g, { kind: "click", target: claimFor(g, "#phone") }, bridges(click, new Looker(F1, g)), {
      permitTtlMs: TEST_TTL_MS,
      timeoutMs: 20,
      // The page LOOKS right. It must still not be read as a confirmation.
      verify: { expect: { kind: "FOCUS_ON_TARGET" }, observe: after("#phone") },
    });
    expect(o.result?.status).toBe("EXECUTION_ERROR");
    if (o.result?.status === "EXECUTION_ERROR") expect(o.result.category).toBe("BRIDGE_TIMEOUT");
    expect(o.verification?.verification).toBe("UNKNOWN");
    if (o.verification?.verification === "UNKNOWN") expect(o.verification.cause).toBe("DISPATCH_OUTCOME_UNKNOWN");
    expect(guardedActionConfirmed(o)).toBe(false);
    expect(guardedActionDispatched(o)).toBe(false);
  });
});

describe("18 — the target disappears after the action", () => {
  it("is UNKNOWN, not a failure: the final state cannot say what happened first", async () => {
    const g = graph();
    const click = new Clicker();
    const o = await guardedAct(g, { kind: "click", target: claimFor(g, "#cancel") }, bridges(click, new Looker(F1, g)), {
      permitTtlMs: TEST_TTL_MS,
      verify: { expect: { kind: "FOCUS_ON_TARGET" }, observe: after(null, [], ["#cancel"]) },
    });
    expect(o.result?.status).toBe("EXECUTED");
    expect(o.verification?.verification).toBe("UNKNOWN");
    if (o.verification?.verification === "UNKNOWN") expect(o.verification.cause).toBe("TARGET_ABSENT_AFTER_ACTION");
  });
});

describe("the earlier safety boundary is not bypassed", () => {
  it("a stale frame is refused by VALIDATE, and the hit test is never reached", async () => {
    const before = graph();
    const plan = claimFor(before, "#cancel");
    const nextFrame = graph(F2);
    const click = new Clicker(F2);
    const look = new Looker(F2, nextFrame);
    const o = await guardedAct(nextFrame, { kind: "click", target: plan }, bridges(click, look), OPTS);
    expect(o.reached).toBe("VALIDATE");
    expect(o.decision.decision).toBe("RE_OBSERVE");
    if (o.decision.decision === "RE_OBSERVE") expect(o.decision.reason).toBe("FRAME_MISMATCH");
    expect(o.hit).toBeNull();
    expect(look.asked.length).toBe(0);
    expect(click.clicks.length).toBe(0);
  });

  it("a target that moved is refused by VALIDATE, and the hit test is never reached", async () => {
    const before = graph();
    const plan = claimFor(before, "#cancel");
    const moved = graph(F1, [{}, {}, {}, { rect: { x: 620, y: 420, w: 120, h: 40 } }]);
    const click = new Clicker();
    const look = new Looker(F1, moved);
    const o = await guardedAct(moved, { kind: "click", target: plan }, bridges(click, look), OPTS);
    expect(o.reached).toBe("VALIDATE");
    if (o.decision.decision === "RE_OBSERVE") expect(o.decision.reason).toBe("MOVED_BEYOND_TOLERANCE");
    expect(look.asked.length).toBe(0);
    expect(click.clicks.length).toBe(0);
  });

  it("the confirmation tier refuses before the page is queried — and a MATCH would not have been permission", async () => {
    // Changed on purpose (ADR-0008). The tier is static authorisation, so it now refuses at
    // AUTHORISE, before the hit test; `permit.test.ts` separately proves that even an attested
    // MATCH on a tier target cannot mint a permit.
    const g = graph();
    const click = new Clicker();
    const look = new Looker(F1, g);
    const o = await guardedAct(g, { kind: "click", target: claimFor(g, "#help-link") }, bridges(click, look), {
      permitTtlMs: TEST_TTL_MS,
      verify: { expect: { kind: "FOCUS_ON_TARGET" }, observe: after("#help-link") },
    });
    expect(o.reached).toBe("AUTHORISE");
    expect(o.hit).toBeNull();
    expect(look.asked.length).toBe(0);
    expect(o.result?.status).toBe("REJECTED");
    if (o.result?.status === "REJECTED") expect(o.result.cause).toBe("HUMAN_CONFIRMATION_REQUIRED");
    expect(click.clicks.length).toBe(0);
    expect(o.verification).toBeNull();
  });

  it("every refusal in the flow leaves the page with zero click events", async () => {
    const g = graph();
    const cases: { name: string; run: () => Promise<{ clicks: number }> }[] = [
      {
        name: "validation refuses",
        run: async () => {
          const c = new Clicker();
          await guardedAct(graph(F2), { kind: "click", target: claimFor(g, "#cancel") }, bridges(c, new Looker(F2, graph(F2))), OPTS);
          return { clicks: c.clicks.length };
        },
      },
      {
        name: "hit test mismatches",
        run: async () => {
          const c = new Clicker();
          const overlay: TopmostElement = { frameId: F1, selector: "#modal", role: "dialog", name: "", box: cssBox(0, 0, 1024, 768) };
          await guardedAct(g, { kind: "click", target: claimFor(g, "#cancel") }, bridges(c, new Looker(F1, g, overlay)), OPTS);
          return { clicks: c.clicks.length };
        },
      },
      {
        name: "hit test is unknown",
        run: async () => {
          const c = new Clicker();
          await guardedAct(g, { kind: "click", target: claimFor(g, "#cancel") }, bridges(c, new Looker(F1, g, "THROW")), OPTS);
          return { clicks: c.clicks.length };
        },
      },
      {
        name: "confirmation tier refuses",
        run: async () => {
          const c = new Clicker();
          await guardedAct(g, { kind: "click", target: claimFor(g, "#help-link") }, bridges(c, new Looker(F1, g)), OPTS);
          return { clicks: c.clicks.length };
        },
      },
      {
        name: "the action is unsupported",
        run: async () => {
          const c = new Clicker();
          await guardedAct(g, { kind: "type", target: claimFor(g, "#phone") }, bridges(c, new Looker(F1, g)), OPTS);
          return { clicks: c.clicks.length };
        },
      },
    ];
    const seen: Record<string, number> = {};
    for (const c of cases) seen[c.name] = (await c.run()).clicks;
    expect(seen).toEqual({
      "validation refuses": 0,
      "hit test mismatches": 0,
      "hit test is unknown": 0,
      "confirmation tier refuses": 0,
      "the action is unsupported": 0,
    });
  });
});
