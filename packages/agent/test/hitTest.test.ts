/**
 * HIT-TEST AGREEMENT — unit tests.
 *
 * The property under test is not "does it return MATCH when things are fine". It is the
 * opposite one: **every way of not knowing must refuse**, and there must be no input at all that
 * reaches `MATCH` without the frame, the stable reference, the role, the name and the geometry
 * each being positively established.
 *
 * Every graph here is built by the real `buildElementGraph` from real `DomMeasurement` shapes, so
 * a change to the perception contract breaks these tests rather than silently passing them.
 */
import { describe, expect, it } from "vitest";
import {
  act,
  agreesForDispatch,
  bearsHitAgreement,
  dispatchPointOf,
  mintDispatchPermit,
  establishHitAgreement,
  validateActionFreshness,
  type CssPoint,
  type FreshnessDecision,
  type HitTestBridge,
  type HitTestResult,
  type PageActionBridge,
  type TargetClaim,
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

const F = frameId("hit-frame-1");
const OTHER = frameId("hit-frame-2");

const geometry: CaptureGeometry = {
  dpr: 1,
  zoom: 1,
  viewportCss: { w: 1024, h: 768 },
  captureSize: { w: 1024, h: 768 },
  scroll: { x: 0, y: 0 },
  origin: "http://127.0.0.1:8983",
};

const measurements = (): DomMeasurement[] => [
  { selector: "#phone", role: "textbox", name: "Phone", rect: { x: 400, y: 260, w: 300, h: 32 }, cssHidden: false, enabled: true, parentIndex: -1 },
  { selector: "#cancel", role: "button", name: "Cancel", rect: { x: 620, y: 360, w: 120, h: 40 }, cssHidden: false, enabled: true, parentIndex: -1 },
];

const graph = (over: Partial<DomMeasurement>[] = [], frame: FrameId = F): ElementGraph =>
  buildElementGraph(
    measurements().map((m, i) => ({ ...m, ...(over[i] ?? {}) })),
    geometry,
    frame
  );

const nodeFor = (g: ElementGraph, selector: string) => {
  const n = g.nodes.find((x) => x.domRef.selector === selector);
  if (!n) throw new Error(`test setup: ${selector} absent`);
  return n;
};

const claim = (g: ElementGraph, selector: string): TargetClaim => {
  const n = nodeFor(g, selector);
  const e = n.evidence;
  if (e.kind !== "OBSERVED" && e.kind !== "CLIPPED") throw new Error(`test setup: ${selector} is ${e.kind}`);
  return { nodeId: n.id, role: n.role, name: n.name, frameId: g.frameId, viewportBox: e.viewportBox };
};

const allow = (g: ElementGraph, selector: string): FreshnessDecision =>
  validateActionFreshness(g, { kind: "click", target: claim(g, selector) });

/** What the page would report for one of the fixture's own elements. */
const topmostFor = (g: ElementGraph, selector: string, over: Partial<TopmostElement> = {}): TopmostElement => {
  const n = nodeFor(g, selector);
  const e = n.evidence;
  if (e.kind !== "OBSERVED" && e.kind !== "CLIPPED") throw new Error("test setup");
  return { frameId: g.frameId, selector: n.domRef.selector, role: n.role, name: n.name, box: e.viewportBox, ...over };
};

/** A bridge that answers with whatever the test says is on top, and counts its calls. */
class Looker implements HitTestBridge {
  readonly asked: CssPoint[] = [];
  constructor(
    readonly frameId: FrameId,
    private readonly answer: TopmostElement | null | "THROW" | "HANG"
  ) {}
  async topmostAtCssPoint(p: CssPoint): Promise<TopmostElement | null> {
    this.asked.push(p);
    if (this.answer === "THROW") throw new TypeError("the page went away");
    if (this.answer === "HANG") return new Promise<never>(() => {});
    return this.answer;
  }
}

const expectRefusal = (r: HitTestResult): void => {
  expect(r.agreement).not.toBe("MATCH");
  expect(agreesForDispatch(r)).toBe(false);
};

describe("HIT-TEST AGREEMENT — 1: the validated element is topmost", () => {
  it("agrees, and says which point it agreed about", async () => {
    const g = graph();
    const d = allow(g, "#cancel");
    const b = new Looker(F, topmostFor(g, "#cancel"));
    const r = await establishHitAgreement(d, b);
    expect(r.agreement).toBe("MATCH");
    expect(agreesForDispatch(r)).toBe(true);
    if (r.agreement === "MATCH") {
      expect(r.boxIou).toBe(1);
      // the centre of #cancel: (620 + 60, 360 + 20)
      expect(r.point).toEqual({ x: 680, y: 380 });
    }
    expect(b.asked).toEqual([{ x: 680, y: 380 }]);
  });

  it("asks about exactly the point ACT will click, and asks once", async () => {
    const g = graph();
    // A caller-supplied point that passed validation must be the point hit tested.
    const d = validateActionFreshness(g, {
      kind: "click",
      target: claim(g, "#phone"),
      point: { x: 410, y: 265 } as CssPoint,
    });
    const b = new Looker(F, topmostFor(g, "#phone"));
    const r = await establishHitAgreement(d, b);
    expect(r.agreement).toBe("MATCH");
    expect(b.asked).toEqual([{ x: 410, y: 265 }]);
  });
});

describe("HIT-TEST AGREEMENT — 2: something else is topmost", () => {
  it("an overlay covering the point is a MISMATCH, by stable reference", async () => {
    const g = graph();
    const d = allow(g, "#cancel");
    const overlay: TopmostElement = {
      frameId: F,
      selector: "#consent-banner",
      role: "generic",
      name: "We use cookies",
      box: cssBox(0, 300, 1024, 200),
    };
    const r = await establishHitAgreement(d, new Looker(F, overlay));
    expect(r.agreement).toBe("MISMATCH");
    if (r.agreement === "MISMATCH") {
      expect(r.cause).toBe("DIFFERENT_ELEMENT");
      expect(r.observed?.selector).toBe("#consent-banner");
    }
    expectRefusal(r);
  });

  it("nothing at the point is a MISMATCH, not an UNKNOWN — the page answered", async () => {
    const g = graph();
    const r = await establishHitAgreement(allow(g, "#cancel"), new Looker(F, null));
    expect(r.agreement).toBe("MISMATCH");
    if (r.agreement === "MISMATCH") {
      expect(r.cause).toBe("NOTHING_AT_POINT");
      expect(r.observed).toBeNull();
    }
  });

  it("the same selector with a changed role or name is still a MISMATCH", async () => {
    const g = graph();
    const d = allow(g, "#cancel");
    const renamed = await establishHitAgreement(d, new Looker(F, topmostFor(g, "#cancel", { name: "Delete my account" })));
    expect(renamed.agreement).toBe("MISMATCH");
    if (renamed.agreement === "MISMATCH") expect(renamed.cause).toBe("NAME_DISAGREES");

    const rerolled = await establishHitAgreement(d, new Looker(F, topmostFor(g, "#cancel", { role: "link" })));
    expect(rerolled.agreement).toBe("MISMATCH");
    if (rerolled.agreement === "MISMATCH") expect(rerolled.cause).toBe("ROLE_DISAGREES");
  });

  it("a non-unique selector is separated by geometry", async () => {
    // The MVP DOM probe falls back to a tag name for an element with no id, so `button` can
    // describe several controls. Reference alone would agree; the box is what disagrees.
    const g = buildElementGraph(
      [
        { selector: "button", role: "button", name: "Cancel", rect: { x: 620, y: 360, w: 120, h: 40 }, cssHidden: false, enabled: true, parentIndex: -1 },
      ],
      geometry,
      F
    );
    const n = nodeFor(g, "button");
    const e = n.evidence;
    if (e.kind !== "OBSERVED") throw new Error("test setup");
    const d = validateActionFreshness(g, {
      kind: "click",
      target: { nodeId: n.id, role: n.role, name: n.name, frameId: F, viewportBox: e.viewportBox },
    });
    const elsewhere: TopmostElement = {
      frameId: F,
      selector: "button",
      role: "button",
      name: "Cancel",
      box: cssBox(20, 20, 120, 40),
    };
    const r = await establishHitAgreement(d, new Looker(F, elsewhere));
    expect(r.agreement).toBe("MISMATCH");
    if (r.agreement === "MISMATCH") expect(r.cause).toBe("GEOMETRY_DISAGREES");
  });
});

describe("HIT-TEST AGREEMENT — 3: unavailable is UNKNOWN, and UNKNOWN is not MATCH", () => {
  it("a bridge that throws is UNKNOWN, and the error message is not carried", async () => {
    const g = graph();
    const r = await establishHitAgreement(allow(g, "#cancel"), new Looker(F, "THROW"));
    expect(r.agreement).toBe("UNKNOWN");
    if (r.agreement === "UNKNOWN") {
      expect(r.cause).toBe("BRIDGE_THREW");
      expect(r.detail).toContain("TypeError");
      expect(r.detail).not.toContain("the page went away");
    }
    expectRefusal(r);
  });

  it("a bridge that never answers is UNKNOWN, not MATCH and not MISMATCH", async () => {
    const g = graph();
    const r = await establishHitAgreement(allow(g, "#cancel"), new Looker(F, "HANG"), { timeoutMs: 20 });
    expect(r.agreement).toBe("UNKNOWN");
    if (r.agreement === "UNKNOWN") expect(r.cause).toBe("BRIDGE_TIMEOUT");
    expectRefusal(r);
  });

  it("an unreadable answer is UNKNOWN", async () => {
    const g = graph();
    const junk = { frameId: F, selector: "#cancel", role: "button", name: "Cancel", box: { x: NaN, y: 0, w: 1, h: 1 } } as unknown as TopmostElement;
    const r = await establishHitAgreement(allow(g, "#cancel"), new Looker(F, junk));
    expect(r.agreement).toBe("UNKNOWN");
    if (r.agreement === "UNKNOWN") expect(r.cause).toBe("MALFORMED_TOPMOST");
  });

  it("an unvalidated decision can never reach MATCH, however well-formed it looks", async () => {
    const g = graph();
    const n = nodeFor(g, "#cancel");
    const e = n.evidence;
    if (e.kind !== "OBSERVED") throw new Error("test setup");
    // Structurally a perfect ALLOW. It did not come from the validator.
    const forged = {
      decision: "ALLOW",
      kind: "click",
      node: n,
      frameId: F,
      viewportBox: e.viewportBox,
    } as unknown as FreshnessDecision;
    const b = new Looker(F, topmostFor(g, "#cancel"));
    const r = await establishHitAgreement(forged, b);
    expect(r.agreement).toBe("UNKNOWN");
    if (r.agreement === "UNKNOWN") expect(r.cause).toBe("NOT_VALIDATED");
    // and the page was never even asked
    expect(b.asked.length).toBe(0);
  });

  it("a RE_OBSERVE decision is UNKNOWN and the bridge is not consulted", async () => {
    const g = graph();
    const refused = validateActionFreshness(g, { kind: "click" });
    expect(refused.decision).toBe("RE_OBSERVE");
    const b = new Looker(F, null);
    const r = await establishHitAgreement(refused, b);
    expect(r.agreement).toBe("UNKNOWN");
    if (r.agreement === "UNKNOWN") expect(r.cause).toBe("NOT_VALIDATED");
    expect(b.asked.length).toBe(0);
  });

  it("a result that is not this module's own is never permission", () => {
    const forged = { agreement: "MATCH", point: { x: 1, y: 1 }, observed: null, boxIou: 1, elapsedMs: 0 } as unknown as HitTestResult;
    expect(bearsHitAgreement(forged)).toBe(false);
    expect(agreesForDispatch(forged)).toBe(false);
  });
});

describe("HIT-TEST AGREEMENT — 4: a stale frame is refused", () => {
  it("a bridge on another frame is UNKNOWN and is never asked", async () => {
    const g = graph();
    const b = new Looker(OTHER, topmostFor(g, "#cancel"));
    const r = await establishHitAgreement(allow(g, "#cancel"), b);
    expect(r.agreement).toBe("UNKNOWN");
    if (r.agreement === "UNKNOWN") expect(r.cause).toBe("BRIDGE_FRAME_MISMATCH");
    expect(b.asked.length).toBe(0);
  });

  it("an answer reported from another frame is UNKNOWN even when the bridge's frame agrees", async () => {
    const g = graph();
    const r = await establishHitAgreement(
      allow(g, "#cancel"),
      new Looker(F, topmostFor(g, "#cancel", { frameId: OTHER }))
    );
    expect(r.agreement).toBe("UNKNOWN");
    if (r.agreement === "UNKNOWN") expect(r.cause).toBe("BRIDGE_FRAME_MISMATCH");
  });
});

describe("HIT-TEST AGREEMENT — 5: positional node ids are never the identity", () => {
  it("a rebound node id does not produce agreement — the selector disagrees", async () => {
    // Remove #phone. #cancel becomes e0, which is the id the old claim for #phone held.
    const before = graph();
    const phoneClaim = claim(before, "#phone");
    expect(phoneClaim.nodeId).toBe("e0");
    const shorter = buildElementGraph(measurements().slice(1), geometry, F);
    expect(shorter.nodes[0]?.id).toBe("e0");
    expect(shorter.nodes[0]?.domRef.selector).toBe("#cancel");

    // Validation catches this first, on identity: the rebound e0 is a button named Cancel.
    const d = validateActionFreshness(shorter, { kind: "click", target: phoneClaim });
    expect(d.decision).toBe("RE_OBSERVE");

    // And even if it had not, the hit test would not agree: it compares the selector.
    const cancelAllow = allow(shorter, "#cancel");
    const r = await establishHitAgreement(
      cancelAllow,
      new Looker(F, { frameId: F, selector: "#phone", role: "textbox", name: "Phone", box: cssBox(400, 260, 300, 32) })
    );
    expect(r.agreement).toBe("MISMATCH");
    if (r.agreement === "MISMATCH") expect(r.cause).toBe("DIFFERENT_ELEMENT");
  });

  it("a node with no stable reference is refused rather than compared by node id", async () => {
    const g = buildElementGraph(
      [{ selector: "", role: "button", name: "Cancel", rect: { x: 620, y: 360, w: 120, h: 40 }, cssHidden: false, enabled: true, parentIndex: -1 }],
      geometry,
      F
    );
    const n = g.nodes[0];
    if (!n || n.evidence.kind !== "OBSERVED") throw new Error("test setup");
    const d = validateActionFreshness(g, {
      kind: "click",
      target: { nodeId: n.id, role: n.role, name: n.name, frameId: F, viewportBox: n.evidence.viewportBox },
    });
    const b = new Looker(F, { frameId: F, selector: "", role: "button", name: "Cancel", box: n.evidence.viewportBox });
    const r = await establishHitAgreement(d, b);
    expect(r.agreement).toBe("UNKNOWN");
    if (r.agreement === "UNKNOWN") expect(r.cause).toBe("NO_STABLE_REFERENCE");
    expect(b.asked.length).toBe(0);
  });
});

describe("HIT-TEST AGREEMENT — 6: a refusal costs the page nothing", () => {
  class Clicker implements PageActionBridge {
    readonly clicks: CssPoint[] = [];
    constructor(readonly frameId: FrameId = F) {}
    async clickAtCssPoint(p: CssPoint): Promise<void> {
      this.clicks.push(p);
    }
  }

  it("every non-MATCH outcome leaves the action bridge untouched when the caller honours it", async () => {
    const g = graph();
    const d = allow(g, "#cancel");
    const answers: (TopmostElement | null | "THROW" | "HANG")[] = [
      null,
      "THROW",
      "HANG",
      { frameId: F, selector: "#overlay", role: "generic", name: "", box: cssBox(0, 0, 1024, 768) },
      topmostFor(g, "#cancel", { name: "Delete my account" }),
      topmostFor(g, "#cancel", { frameId: OTHER }),
    ];
    for (const a of answers) {
      const clicker = new Clicker();
      const hit = await establishHitAgreement(d, new Looker(F, a), { timeoutMs: 20 });
      expectRefusal(hit);
      if (agreesForDispatch(hit)) {
        const minted = mintDispatchPermit(d, hit, { ttlMs: 60_000 });
        if (minted.minted) await act(minted.permit, clicker);
      }
      expect(clicker.clicks.length).toBe(0);
    }
  });
});

describe("HIT-TEST AGREEMENT — the hit-tested point is the clicked point", () => {
  /**
   * ACT derives its dispatch point privately (`decision.point ?? centre(box)`). If this module
   * hit tested a different point, the gate would be decorative. The rule is duplicated in
   * `dispatchPointOf`, so it is pinned here against ACT's real behaviour rather than trusted.
   */
  it("agrees with ACT over a sweep of boxes and explicit points", async () => {
    const boxes = [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 620, y: 360, w: 120, h: 40 },
      { x: 400.5, y: 260.25, w: 300.5, h: 33.75 },
      { x: 1, y: 2, w: 1023, h: 765 },
    ];
    for (const rect of boxes) {
      for (const explicit of [null, { x: rect.x + 0.5, y: rect.y + 0.5 }]) {
        const g = buildElementGraph(
          [{ selector: "#t", role: "button", name: "Go", rect, cssHidden: false, enabled: true, parentIndex: -1 }],
          geometry,
          F
        );
        const n = g.nodes[0];
        if (!n || n.evidence.kind !== "OBSERVED") throw new Error("test setup");
        const proposal = {
          kind: "click" as const,
          target: { nodeId: n.id, role: n.role, name: n.name, frameId: F, viewportBox: n.evidence.viewportBox },
          ...(explicit ? { point: explicit as CssPoint } : {}),
        };
        const d = validateActionFreshness(g, proposal);
        expect(d.decision).toBe("ALLOW");
        const clicker = new Clicker();
        // ACT no longer derives a point: it clicks the point the permit fixed, which the gate took
        // from the MATCH. So the pin now spans all three — hit-tested point, permit point, click.
        const hit = await establishHitAgreement(d, new Looker(F, topmostFor(g, "#t")));
        expect(hit.agreement).toBe("MATCH");
        const minted = mintDispatchPermit(d, hit, { ttlMs: 60_000 });
        if (!minted.minted) throw new Error("test setup: permit refused");
        expect(minted.permit.point).toEqual(dispatchPointOf(d));
        expect(minted.permit.point).toEqual(hit.point);
        const r = await act(minted.permit, clicker);
        expect(r.status).toBe("EXECUTED");
        expect(clicker.clicks[0]).toEqual(dispatchPointOf(d));
      }
    }
  });

  class Clicker implements PageActionBridge {
    readonly clicks: CssPoint[] = [];
    constructor(readonly frameId: FrameId = F) {}
    async clickAtCssPoint(p: CssPoint): Promise<void> {
      this.clicks.push(p);
    }
  }

  it("returns null for anything that is not an allowed, targeted decision", () => {
    const g = graph();
    expect(dispatchPointOf(validateActionFreshness(g, { kind: "click" }))).toBeNull();
    expect(dispatchPointOf(validateActionFreshness(g, { kind: "wait" }))).toBeNull();
  });
});
