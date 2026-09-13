/**
 * THE EXECUTION GATE — permits. ADR-0008 (PROPOSED).
 *
 * One claim organises this file: **nothing reaches `act` except a permit the gate minted from an
 * attested ALLOW plus an attested MATCH established for that exact decision — and each permit is
 * spent once.** Every refusal case asserts the bridge was never called.
 *
 * Clocks are injected, so expiry is tested without waiting.
 */
import { describe, expect, it } from "vitest";
import {
  act,
  authorisationPreflight,
  confirmationTierOf,
  establishHitAgreement,
  isIssuedPermit,
  mintDispatchPermit,
  permitState,
  validateActionFreshness,
  type CssPoint,
  type DispatchPermit,
  type FreshnessDecision,
  type HitTestBridge,
  type HitTestResult,
  type PageActionBridge,
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

const F1 = frameId("permit-frame-1");
const F2 = frameId("permit-frame-2");

const geometry: CaptureGeometry = {
  dpr: 1,
  zoom: 1,
  viewportCss: { w: 1024, h: 768 },
  captureSize: { w: 1024, h: 768 },
  scroll: { x: 0, y: 0 },
  origin: "http://127.0.0.1:8990",
};

/** A TEST lifetime, not a proposal. The gate has no default; ADR-0008 §5 leaves the value open. */
const TTL = 1_000;

const page = (frame: FrameId = F1, extra: DomMeasurement[] = []): ElementGraph =>
  buildElementGraph(
    [
      { selector: "#phone", role: "textbox", name: "Phone", rect: { x: 400, y: 260, w: 300, h: 32 }, cssHidden: false, enabled: true, parentIndex: -1 },
      { selector: "#cancel", role: "button", name: "Cancel", rect: { x: 620, y: 360, w: 120, h: 40 }, cssHidden: false, enabled: true, parentIndex: -1 },
      { selector: "#help", role: "link", name: "Help", rect: { x: 400, y: 320, w: 100, h: 18 }, cssHidden: false, enabled: true, parentIndex: -1 },
      { selector: "#go", role: "button", name: "Submit", rect: { x: 400, y: 420, w: 120, h: 40 }, cssHidden: false, enabled: true, parentIndex: -1 },
      ...extra,
    ],
    geometry,
    frame
  );

const allow = (g: ElementGraph, selector: string, kind = "click", point?: CssPoint): FreshnessDecision => {
  const n = g.nodes.find((x) => x.domRef.selector === selector);
  if (!n || (n.evidence.kind !== "OBSERVED" && n.evidence.kind !== "CLIPPED")) throw new Error("test setup");
  return validateActionFreshness(g, {
    kind,
    target: { nodeId: n.id, role: n.role, name: n.name, frameId: g.frameId, viewportBox: n.evidence.viewportBox },
    ...(point ? { point } : {}),
  });
};

/** Reports whatever the graph places at a point, or a scripted answer. */
class Looker implements HitTestBridge {
  constructor(
    private readonly g: ElementGraph,
    private readonly answer: TopmostElement | null | "THROW" | "GRAPH" = "GRAPH",
    readonly frameId: FrameId = g.frameId
  ) {}
  async topmostAtCssPoint(p: CssPoint): Promise<TopmostElement | null> {
    if (this.answer === "THROW") throw new Error("cannot answer");
    if (this.answer !== "GRAPH") return this.answer;
    for (const n of this.g.nodes) {
      const e = n.evidence;
      if (e.kind !== "OBSERVED" && e.kind !== "CLIPPED") continue;
      const b = e.viewportBox;
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        return { frameId: this.g.frameId, selector: n.domRef.selector, role: n.role, name: n.name, box: b };
      }
    }
    return null;
  }
}

class Clicker implements PageActionBridge {
  readonly clicks: CssPoint[] = [];
  constructor(
    readonly frameId: FrameId = F1,
    private readonly mode: "OK" | "THROW" = "OK"
  ) {}
  async clickAtCssPoint(p: CssPoint): Promise<void> {
    this.clicks.push(p);
    if (this.mode === "THROW") throw new TypeError("bridge failed");
  }
}

/** A controllable monotonic clock. */
const clock = (start = 10_000) => {
  let t = start;
  const now = () => t;
  return { now, advance: (ms: number) => void (t += ms) };
};

async function validPermit(g = page(), selector = "#phone", now = clock().now): Promise<{ decision: FreshnessDecision; hit: HitTestResult; permit: DispatchPermit }> {
  const decision = allow(g, selector);
  const hit = await establishHitAgreement(decision, new Looker(g));
  const minted = mintDispatchPermit(decision, hit, { ttlMs: TTL, now });
  if (!minted.minted) throw new Error(`test setup: ${JSON.stringify(minted.refusal)}`);
  return { decision, hit, permit: minted.permit };
}

const expectMintRefused = (r: ReturnType<typeof mintDispatchPermit>, cause: string): void => {
  expect(r.minted).toBe(false);
  if (!r.minted) expect(r.refusal.cause).toBe(cause);
};

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("mint — a permit needs an attested ALLOW and an attested MATCH for that decision", () => {
  it("mints from a real ALLOW and a real MATCH, fixing kind, frame, point and target", async () => {
    const { decision, permit } = await validPermit();
    expect(isIssuedPermit(permit)).toBe(true);
    expect(permit.kind).toBe("click");
    expect(permit.frameId).toBe(F1);
    expect(permit.point).toEqual({ x: 550, y: 276 });
    expect(permit.target.selector).toBe("#phone");
    expect(permit.target.role).toBe("textbox");
    expect(permit.target.name).toBe("Phone");
    if (decision.decision === "ALLOW") expect(permit.target.box).toEqual(decision.viewportBox);
    expect(Object.isFrozen(permit)).toBe(true);
    expect(Object.isFrozen(permit.target)).toBe(true);
  });

  it("an UNKNOWN agreement cannot mint", async () => {
    const g = page();
    const d = allow(g, "#phone");
    const hit = await establishHitAgreement(d, new Looker(g, "THROW"));
    expect(hit.agreement).toBe("UNKNOWN");
    expectMintRefused(mintDispatchPermit(d, hit, { ttlMs: TTL }), "NO_HIT_AGREEMENT");
  });

  it("a MISMATCH cannot mint", async () => {
    const g = page();
    const d = allow(g, "#phone");
    const overlay: TopmostElement = { frameId: F1, selector: "#modal", role: "dialog", name: "", box: { x: 0, y: 0, w: 1024, h: 768 } as never };
    const hit = await establishHitAgreement(d, new Looker(g, overlay));
    expect(hit.agreement).toBe("MISMATCH");
    expectMintRefused(mintDispatchPermit(d, hit, { ttlMs: TTL }), "NO_HIT_AGREEMENT");
  });

  it("a forged MATCH literal cannot mint", async () => {
    const g = page();
    const d = allow(g, "#phone");
    const forged = { agreement: "MATCH", point: { x: 550, y: 276 }, observed: { frameId: F1, selector: "#phone", role: "textbox", name: "Phone", box: { x: 400, y: 260, w: 300, h: 32 } }, boxIou: 1, elapsedMs: 0 } as unknown as HitTestResult;
    expectMintRefused(mintDispatchPermit(d, forged, { ttlMs: TTL }), "NO_HIT_AGREEMENT");
  });

  it("a real MATCH for ONE decision cannot mint a permit for ANOTHER (wrong target)", async () => {
    const g = page();
    const phone = allow(g, "#phone");
    const cancel = allow(g, "#cancel");
    const hitForCancel = await establishHitAgreement(cancel, new Looker(g));
    expect(hitForCancel.agreement).toBe("MATCH");
    expectMintRefused(mintDispatchPermit(phone, hitForCancel, { ttlMs: TTL }), "HIT_NOT_FOR_THIS_DECISION");
  });

  it("a MATCH for an equal-looking but different decision object cannot mint (wrong point)", async () => {
    const g = page();
    const centre = allow(g, "#phone");
    const corner = allow(g, "#phone", "click", { x: 401, y: 261 } as CssPoint);
    const hitAtCorner = await establishHitAgreement(corner, new Looker(g));
    expect(hitAtCorner.agreement).toBe("MATCH");
    expectMintRefused(mintDispatchPermit(centre, hitAtCorner, { ttlMs: TTL }), "HIT_NOT_FOR_THIS_DECISION");
  });

  it("an unvalidated, forged, copied or revived decision cannot mint", async () => {
    const g = page();
    const d = allow(g, "#phone");
    const hit = await establishHitAgreement(d, new Looker(g));
    const stale = validateActionFreshness(g, { kind: "click", target: { nodeId: g.nodes[0]!.id, role: "textbox", name: "Phone", frameId: F2, viewportBox: { x: 400, y: 260, w: 300, h: 32 } as never } });
    for (const bad of [stale, { ...(d as object) } as FreshnessDecision, JSON.parse(JSON.stringify(d)) as FreshnessDecision]) {
      expectMintRefused(mintDispatchPermit(bad, hit, { ttlMs: TTL }), "NOT_VALIDATED");
    }
  });

  it("refuses without a lifetime: there is no default TTL", async () => {
    const g = page();
    const d = allow(g, "#phone");
    const hit = await establishHitAgreement(d, new Looker(g));
    for (const ttlMs of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectMintRefused(mintDispatchPermit(d, hit, { ttlMs } as never), "INVALID_TTL");
    }
    expectMintRefused(mintDispatchPermit(d, hit, undefined as never), "INVALID_TTL");
  });

  it("a MATCH on a confirmation-tier target still cannot mint — agreement is not permission", async () => {
    const g = page();
    for (const selector of ["#help", "#go"]) {
      const d = allow(g, selector);
      const hit = await establishHitAgreement(d, new Looker(g));
      expect(hit.agreement).toBe("MATCH");
      expectMintRefused(mintDispatchPermit(d, hit, { ttlMs: TTL }), "HUMAN_CONFIRMATION_REQUIRED");
    }
    expect(confirmationTierOf({ role: "button", name: "Submit" })).toBe("CONFIRM_REQUIRED");
  });

  it("an unsupported action cannot mint, even with a MATCH", async () => {
    const g = page();
    const d = allow(g, "#phone", "type");
    const hit = await establishHitAgreement(d, new Looker(g));
    const r = mintDispatchPermit(d, hit, { ttlMs: TTL });
    expect(r.minted).toBe(false);
    if (!r.minted) {
      expect(r.refusal.status).toBe("UNSUPPORTED_ACTION");
      expect(r.refusal.cause).toBe("CLEARANCE_PIPELINE_ABSENT");
    }
    expect(authorisationPreflight(d)?.status).toBe("UNSUPPORTED_ACTION");
  });
});

describe("redeem — through act, and only once", () => {
  it("a valid permit executes exactly once", async () => {
    const c = clock();
    const { permit } = await validPermit(page(), "#phone", c.now);
    const clicker = new Clicker();
    const first = await act(permit, clicker, { now: c.now });
    expect(first.status).toBe("EXECUTED");
    expect(clicker.clicks).toEqual([{ x: 550, y: 276 }]);
    const second = await act(permit, clicker, { now: c.now });
    expect(second.status).toBe("REJECTED");
    if (second.status === "REJECTED") expect(second.cause).toBe("PERMIT_CONSUMED");
    expect(clicker.clicks.length).toBe(1);
    expect(permitState(permit, c.now)).toBe("CONSUMED");
  });

  it("a forged permit literal is refused", async () => {
    const clicker = new Clicker();
    const forged = { kind: "click", frameId: F1, point: { x: 550, y: 276 }, target: { nodeId: "e0", selector: "#phone", role: "textbox", name: "Phone", box: { x: 400, y: 260, w: 300, h: 32 } }, mintedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER } as unknown as DispatchPermit;
    const r = await act(forged, clicker);
    expect(r.status).toBe("REJECTED");
    if (r.status === "REJECTED") expect(r.cause).toBe("NOT_PERMITTED");
    expect(clicker.clicks.length).toBe(0);
  });

  it("a copied (spread) permit is refused, and the original stays spendable", async () => {
    const c = clock();
    const { permit } = await validPermit(page(), "#phone", c.now);
    const clicker = new Clicker();
    const copy = { ...permit } as DispatchPermit;
    const r = await act(copy, clicker, { now: c.now });
    expect(r.status).toBe("REJECTED");
    if (r.status === "REJECTED") expect(r.cause).toBe("NOT_PERMITTED");
    expect(clicker.clicks.length).toBe(0);
    expect(permitState(permit, c.now)).toBe("LIVE");
  });

  it("a reflective copy — every own property and symbol descriptor re-applied — is refused", async () => {
    const c = clock();
    const { permit } = await validPermit(page(), "#phone", c.now);
    const clone = Object.freeze(Object.defineProperties({}, Object.getOwnPropertyDescriptors(permit))) as DispatchPermit;
    expect(clone).toEqual(permit);
    const clicker = new Clicker();
    const r = await act(clone, clicker, { now: c.now });
    expect(r.status).toBe("REJECTED");
    if (r.status === "REJECTED") expect(r.cause).toBe("NOT_PERMITTED");
    expect(clicker.clicks.length).toBe(0);
  });

  it("a JSON-revived permit is refused", async () => {
    const c = clock();
    const { permit } = await validPermit(page(), "#phone", c.now);
    const clicker = new Clicker();
    const r = await act(JSON.parse(JSON.stringify(permit)) as DispatchPermit, clicker, { now: c.now });
    expect(r.status).toBe("REJECTED");
    if (r.status === "REJECTED") expect(r.cause).toBe("NOT_PERMITTED");
    expect(clicker.clicks.length).toBe(0);
  });

  it("a permit presented to a bridge on the wrong frame is refused — and spent", async () => {
    const c = clock();
    const { permit } = await validPermit(page(), "#phone", c.now);
    const wrong = new Clicker(F2);
    const r = await act(permit, wrong, { now: c.now });
    expect(r.status).toBe("REJECTED");
    if (r.status === "REJECTED") expect(r.cause).toBe("BRIDGE_FRAME_MISMATCH");
    expect(wrong.clicks.length).toBe(0);
    const right = new Clicker(F1);
    const again = await act(permit, right, { now: c.now });
    if (again.status === "REJECTED") expect(again.cause).toBe("PERMIT_CONSUMED");
    expect(right.clicks.length).toBe(0);
  });

  it("an expired permit is refused — and spent", async () => {
    const c = clock();
    const { permit } = await validPermit(page(), "#phone", c.now);
    c.advance(TTL);
    expect(permitState(permit, c.now)).toBe("EXPIRED");
    const clicker = new Clicker();
    const r = await act(permit, clicker, { now: c.now });
    expect(r.status).toBe("REJECTED");
    if (r.status === "REJECTED") expect(r.cause).toBe("PERMIT_EXPIRED");
    expect(clicker.clicks.length).toBe(0);
    expect(permitState(permit, c.now)).toBe("CONSUMED");
  });

  it("one millisecond before expiry still redeems", async () => {
    const c = clock();
    const { permit } = await validPermit(page(), "#phone", c.now);
    c.advance(TTL - 1);
    const r = await act(permit, new Clicker(), { now: c.now });
    expect(r.status).toBe("EXECUTED");
  });

  it("an execution error consumes the permit and requires a whole new cycle", async () => {
    const c = clock();
    const { permit } = await validPermit(page(), "#phone", c.now);
    const failing = new Clicker(F1, "THROW");
    const r = await act(permit, failing, { now: c.now });
    expect(r.status).toBe("EXECUTION_ERROR");
    expect(permitState(permit, c.now)).toBe("CONSUMED");
    const retry = await act(permit, new Clicker(), { now: c.now });
    expect(retry.status).toBe("REJECTED");
    if (retry.status === "REJECTED") expect(retry.cause).toBe("PERMIT_CONSUMED");
  });

  it("ACT dispatches at the permit's point, never anywhere it could choose", async () => {
    const c = clock();
    const g = page();
    const d = allow(g, "#phone", "click", { x: 410, y: 270 } as CssPoint);
    const hit = await establishHitAgreement(d, new Looker(g));
    const minted = mintDispatchPermit(d, hit, { ttlMs: TTL, now: c.now });
    if (!minted.minted) throw new Error("test setup");
    const clicker = new Clicker();
    await act(minted.permit, clicker, { now: c.now });
    expect(clicker.clicks).toEqual([{ x: 410, y: 270 }]);
  });
});

describe("the API makes ACT without a permit impossible", () => {
  it("does not type-check with a decision, a hit result, a point or nothing", async () => {
    const g = page();
    const d = allow(g, "#phone");
    const hit = await establishHitAgreement(d, new Looker(g));
    const clicker = new Clicker();
    // Each line below must FAIL type-checking; `tsc -b` errors if any of them stops failing.
    // @ts-expect-error — a freshness decision is not a permit
    await act(d, clicker).catch(() => undefined);
    // @ts-expect-error — a hit-test result is not a permit
    await act(hit, clicker).catch(() => undefined);
    // @ts-expect-error — a point is not a permit
    await act({ x: 1, y: 1 }, clicker).catch(() => undefined);
    // @ts-expect-error — nothing is not a permit
    await act(undefined, clicker).catch(() => undefined);
    expect(clicker.clicks.length).toBe(0);
  });

  it("validateAndAct no longer exists, so it cannot be a bypass", async () => {
    const mod = (await import("@pratibimb/agent")) as Record<string, unknown>;
    expect(mod.validateAndAct).toBeUndefined();
    expect(typeof mod.act).toBe("function");
    // and nothing else exported accepts a proposal and dispatches without the gate
    expect(Object.keys(mod).filter((k) => /^(validateAnd|unsafe|force|raw)/i.test(k))).toEqual([]);
  });
});
