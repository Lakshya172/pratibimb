/**
 * THE CONFIRMATION CHANNEL — the gate's answer to its own refusal.
 *
 * Until now `authorisationPreflight` refused every confirmation-tier control with "No confirmation
 * channel exists, so no permit can be issued on a human's behalf." This file holds the channel to the
 * standard that refusal set: the tier is **satisfied or it refuses**, never relaxed.
 *
 * The claim under test: **a permit for a confirmation-tier control exists only when a human confirmed
 * that exact control, in that frame, on that origin, and the consent has not already been spent.**
 * Every other gate — freshness, hit agreement, the point, the TTL — still runs and still refuses.
 */
import { describe, expect, it } from "vitest";
import {
  act,
  authorisationPreflight,
  confirmationCovers,
  confirmationState,
  establishHitAgreement,
  guardedAct,
  isHumanConfirmation,
  mintDispatchPermit,
  recordHumanConfirmation,
  validateActionFreshness,
  type ConfirmationSubject,
  type CssPoint,
  type DispatchPermit,
  type FreshnessDecision,
  type HitTestBridge,
  type HumanConfirmation,
  type PageActionBridge,
  type ProposedAction,
  type TopmostElement,
} from "@pratibimb/agent";
import {
  buildElementGraph,
  frameId,
  nodeId,
  type CaptureGeometry,
  type ElementGraph,
  type FrameId,
} from "@pratibimb/perception";

const F1 = frameId("confirm-frame-1");
const F2 = frameId("confirm-frame-2");
const ORIGIN = "http://127.0.0.1:8990";
const OTHER_ORIGIN = "http://127.0.0.1:9999";
/** A TEST lifetime, not a proposal. No TTL is approved by this repository (ADR-0008 §5). */
const TTL = 1_000;

const geometry: CaptureGeometry = {
  dpr: 1,
  zoom: 1,
  viewportCss: { w: 1024, h: 768 },
  captureSize: { w: 1024, h: 768 },
  scroll: { x: 0, y: 0 },
  origin: ORIGIN,
};

const page = (frame: FrameId = F1): ElementGraph =>
  buildElementGraph(
    [
      { selector: "#submit", role: "button", name: "Submit application", rect: { x: 400, y: 420, w: 120, h: 40 }, cssHidden: false, enabled: true, parentIndex: -1 },
      { selector: "#cancel", role: "button", name: "Cancel", rect: { x: 620, y: 420, w: 120, h: 40 }, cssHidden: false, enabled: true, parentIndex: -1 },
    ],
    geometry,
    frame
  );

const allow = (g: ElementGraph, selector: string): FreshnessDecision => {
  const n = g.nodes.find((x) => x.domRef.selector === selector);
  if (!n || (n.evidence.kind !== "OBSERVED" && n.evidence.kind !== "CLIPPED")) throw new Error("test setup");
  return validateActionFreshness(g, {
    kind: "click",
    target: { nodeId: n.id, role: n.role, name: n.name, frameId: g.frameId, viewportBox: n.evidence.viewportBox },
  });
};

class Looker implements HitTestBridge {
  constructor(private readonly g: ElementGraph, readonly frameId: FrameId = g.frameId) {}
  async topmostAtCssPoint(p: CssPoint): Promise<TopmostElement | null> {
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

const subjectFor = (g: ElementGraph, selector: string, over: Partial<ConfirmationSubject> = {}): ConfirmationSubject => {
  const n = g.nodes.find((x) => x.domRef.selector === selector);
  if (!n) throw new Error("test setup");
  return { nodeId: n.id, selector, role: n.role, name: n.name, frameId: g.frameId, origin: ORIGIN, ...over };
};

const confirmFor = (g: ElementGraph, selector: string, over: Partial<ConfirmationSubject> = {}): HumanConfirmation => {
  const outcome = recordHumanConfirmation(subjectFor(g, selector, over), {
    purpose: "Submit the application form on this page",
    ttlMs: TTL,
    now: () => 0,
  });
  if (!outcome.recorded) throw new Error(`test setup: ${outcome.cause}`);
  return outcome.confirmation;
};

/** The proposed action `guardedAct` validates, built from the live graph. */
const allowAction = (g: ElementGraph, selector: string): ProposedAction => {
  const n = g.nodes.find((x) => x.domRef.selector === selector);
  if (!n || (n.evidence.kind !== "OBSERVED" && n.evidence.kind !== "CLIPPED")) throw new Error("test setup");
  return {
    kind: "click",
    target: { nodeId: n.id, role: n.role, name: n.name, frameId: g.frameId, viewportBox: n.evidence.viewportBox },
  };
};

const mint = async (g: ElementGraph, selector: string, options: Record<string, unknown>) => {
  const decision = allow(g, selector);
  const hit = await establishHitAgreement(decision, new Looker(g), {});
  return mintDispatchPermit(decision, hit, { ttlMs: TTL, now: () => 1, ...options });
};

describe("the tier still refuses by default", () => {
  it("refuses a submit control when no confirmation is supplied, exactly as before", async () => {
    const g = page();
    const minted = await mint(g, "#submit", {});
    expect(minted.minted).toBe(false);
    if (minted.minted) return;
    expect(minted.refusal.status).toBe("REJECTED");
    if (minted.refusal.status !== "REJECTED") return;
    expect(minted.refusal.cause).toBe("HUMAN_CONFIRMATION_REQUIRED");
    expect(minted.refusal.detail).toContain("no confirmation was supplied");
  });

  it("leaves a routine control untouched: no confirmation is needed or consulted", async () => {
    const g = page();
    const minted = await mint(g, "#cancel", {});
    expect(minted.minted).toBe(true);
  });

  it("preflight alone reports the same refusal", () => {
    const refusal = authorisationPreflight(allow(page(), "#submit"));
    expect(refusal?.status).toBe("REJECTED");
    if (refusal?.status !== "REJECTED") return;
    expect(refusal.cause).toBe("HUMAN_CONFIRMATION_REQUIRED");
  });
});

describe("only a confirmation this module recorded counts", () => {
  it("mints when a real confirmation names this control", async () => {
    const g = page();
    const minted = await mint(g, "#submit", { confirmation: confirmFor(g, "#submit"), origin: ORIGIN });
    expect(minted.minted).toBe(true);
  });

  it("refuses a forged object carrying every correct field", async () => {
    const g = page();
    const real = confirmFor(g, "#submit");
    const forged = JSON.parse(JSON.stringify(real)) as HumanConfirmation;
    expect(isHumanConfirmation(forged)).toBe(false);
    const minted = await mint(g, "#submit", { confirmation: forged, origin: ORIGIN });
    expect(minted.minted).toBe(false);
    if (minted.minted || minted.refusal.status !== "REJECTED") return;
    expect(minted.refusal.detail).toContain("NOT_RECORDED");
  });

  it("refuses a plain object that merely looks like one", async () => {
    const g = page();
    const shaped = {
      subject: subjectFor(g, "#submit"),
      purpose: "anything",
      confirmedAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
    } as HumanConfirmation;
    const minted = await mint(g, "#submit", { confirmation: shaped, origin: ORIGIN });
    expect(minted.minted).toBe(false);
  });
});

describe("a confirmation authorises one control and no other", () => {
  it("refuses a confirmation recorded for a different element", async () => {
    const g = page();
    const minted = await mint(g, "#submit", { confirmation: confirmFor(g, "#cancel"), origin: ORIGIN });
    expect(minted.minted).toBe(false);
    if (minted.minted || minted.refusal.status !== "REJECTED") return;
    expect(minted.refusal.detail).toContain("DIFFERENT_TARGET");
  });

  it("refuses a confirmation recorded against another frame", async () => {
    const g = page();
    const minted = await mint(g, "#submit", {
      confirmation: confirmFor(g, "#submit", { frameId: F2 }),
      origin: ORIGIN,
    });
    expect(minted.minted).toBe(false);
    if (minted.minted || minted.refusal.status !== "REJECTED") return;
    expect(minted.refusal.detail).toContain("DIFFERENT_FRAME");
  });

  it("refuses a confirmation given on another origin", async () => {
    const g = page();
    const minted = await mint(g, "#submit", {
      confirmation: confirmFor(g, "#submit", { origin: OTHER_ORIGIN }),
      origin: ORIGIN,
    });
    expect(minted.minted).toBe(false);
    if (minted.minted || minted.refusal.status !== "REJECTED") return;
    expect(minted.refusal.detail).toContain("DIFFERENT_ORIGIN");
  });

  it("refuses when the caller cannot say which origin this is", async () => {
    // Unknown is not permission. The decision carries no origin, so an unsupplied one is unknown.
    const g = page();
    const minted = await mint(g, "#submit", { confirmation: confirmFor(g, "#submit") });
    expect(minted.minted).toBe(false);
    if (minted.minted || minted.refusal.status !== "REJECTED") return;
    expect(minted.refusal.detail).toContain("ORIGIN_NOT_SUPPLIED");
  });

  it("refuses a confirmation whose identity no longer matches the live node", async () => {
    const g = page();
    const stale = confirmFor(g, "#submit", { name: "Submit application (old label)" });
    const minted = await mint(g, "#submit", { confirmation: stale, origin: ORIGIN });
    expect(minted.minted).toBe(false);
  });
});

describe("one yes, one permit", () => {
  it("spends the confirmation as the permit is issued", async () => {
    const g = page();
    const confirmation = confirmFor(g, "#submit");
    expect(confirmationState(confirmation, () => 1)).toBe("LIVE");

    const first = await mint(g, "#submit", { confirmation, origin: ORIGIN });
    expect(first.minted).toBe(true);
    expect(confirmationState(confirmation, () => 1)).toBe("SPENT");

    const second = await mint(g, "#submit", { confirmation, origin: ORIGIN });
    expect(second.minted).toBe(false);
    if (second.minted || second.refusal.status !== "REJECTED") return;
    expect(second.refusal.detail).toContain("ALREADY_SPENT");
  });

  it("does not spend a confirmation when a later gate refuses", async () => {
    // The hit test disagrees, so no permit is issued — and the human's consent survives for a
    // retry they have already agreed to.
    const g = page();
    const confirmation = confirmFor(g, "#submit");
    const decision = allow(g, "#submit");
    const elsewhere = page(F2);
    const hit = await establishHitAgreement(decision, new Looker(elsewhere, g.frameId), {});
    const minted = mintDispatchPermit(decision, hit, { ttlMs: TTL, now: () => 1, confirmation, origin: ORIGIN });
    expect(minted.minted).toBe(false);
    expect(confirmationState(confirmation, () => 1)).toBe("LIVE");
  });

  it("expires, and an expired confirmation mints nothing", async () => {
    const g = page();
    const confirmation = confirmFor(g, "#submit");
    expect(confirmationState(confirmation, () => TTL + 1)).toBe("EXPIRED");
    const minted = await mint(g, "#submit", { confirmation, origin: ORIGIN, now: () => TTL + 1 });
    expect(minted.minted).toBe(false);
    if (minted.minted || minted.refusal.status !== "REJECTED") return;
    expect(minted.refusal.detail).toContain("EXPIRED");
  });
});

describe("recording a confirmation is itself fail-closed", () => {
  it("refuses an empty purpose: a human must have been told something", () => {
    const g = page();
    expect(recordHumanConfirmation(subjectFor(g, "#submit"), { purpose: "   ", ttlMs: TTL }).recorded).toBe(false);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("refuses ttlMs %s", (ttlMs) => {
    const g = page();
    expect(recordHumanConfirmation(subjectFor(g, "#submit"), { purpose: "ok", ttlMs }).recorded).toBe(false);
  });

  it("refuses a subject with no origin or no selector", () => {
    const g = page();
    expect(recordHumanConfirmation(subjectFor(g, "#submit", { origin: "" }), { purpose: "ok", ttlMs: TTL }).recorded).toBe(false);
    expect(recordHumanConfirmation(subjectFor(g, "#submit", { selector: "" }), { purpose: "ok", ttlMs: TTL }).recorded).toBe(false);
  });

  it("carries the words the human was shown, and no page content", () => {
    const g = page();
    const confirmation = confirmFor(g, "#submit");
    expect(confirmation.purpose).toContain("application");
    // Structural identity only: role, name, selector, frame, origin. Nothing value-bearing.
    expect(Object.keys(confirmation.subject).sort()).toEqual(
      ["frameId", "name", "nodeId", "origin", "role", "selector"].sort()
    );
  });
});

/**
 * THE CHAIN, AND THE ABSENCE OF A SHORTCUT AROUND IT.
 *
 *   HumanConfirmation → DispatchPermit → guardedAct → one dispatch
 *
 * A confirmation is an *input to the mint*, never a substitute for a permit. These cases assert the
 * shape structurally rather than by reading the code: a confirmation cannot be redeemed, cannot be
 * spent by anyone but the mint, and going through the whole composition produces exactly one
 * dispatch for one consent.
 */
describe("confirmation → permit → guardedAct, with no way round", () => {
  it("a confirmation is not a permit: act refuses it outright", async () => {
    const g = page();
    const confirmation = confirmFor(g, "#submit");
    let clicks = 0;
    const bridge: PageActionBridge = {
      frameId: g.frameId,
      async clickAtCssPoint() {
        clicks += 1;
      },
    };
    // Deliberately mis-typed: this is the bypass a caller would attempt if one existed.
    const result = await act(confirmation as unknown as DispatchPermit, bridge);
    expect(result.status).toBe("REJECTED");
    if (result.status === "REJECTED") expect(result.cause).toBe("NOT_PERMITTED");
    expect(clicks).toBe(0);
  });

  it("the whole composition dispatches once for one consent, and refuses the replay", async () => {
    const g = page();
    let clicks = 0;
    const bridges = {
      action: {
        frameId: g.frameId,
        async clickAtCssPoint() {
          clicks += 1;
        },
      },
      hitTest: new Looker(g),
    };
    const verify = {
      expect: { kind: "TARGET_ENABLED", expected: true } as const,
      observe: async () => ({ graph: page(F2) }),
    };

    const first = await guardedAct(g, allowAction(g, "#submit"), bridges, {
      verify,
      permitTtlMs: TTL,
      confirmation: confirmFor(g, "#submit"),
      origin: ORIGIN,
      now: () => 1,
    });
    expect(first.reached).toBe("VERIFY_RESULT");
    expect(first.result?.status).toBe("EXECUTED");
    expect(clicks).toBe(1);

    // The same consent again: refused at AUTHORISE, before the page is touched a second time.
    const spent = confirmFor(g, "#submit");
    expect((await mint(g, "#submit", { confirmation: spent, origin: ORIGIN })).minted).toBe(true);
    const replay = await guardedAct(g, allowAction(g, "#submit"), bridges, {
      verify,
      permitTtlMs: TTL,
      confirmation: spent,
      origin: ORIGIN,
      now: () => 1,
    });
    expect(replay.reached).toBe("AUTHORISE");
    expect(clicks).toBe(1);
  });

  it("without a confirmation the composition still refuses, exactly as it did before", async () => {
    const g = page();
    let clicks = 0;
    const outcome = await guardedAct(
      g,
      allowAction(g, "#submit"),
      {
        action: {
          frameId: g.frameId,
          async clickAtCssPoint() {
            clicks += 1;
          },
        },
        hitTest: new Looker(g),
      },
      { verify: { expect: { kind: "TARGET_ENABLED", expected: true }, observe: async () => ({ graph: page(F2) }) }, permitTtlMs: TTL }
    );
    expect(outcome.reached).toBe("AUTHORISE");
    expect(outcome.result?.status).toBe("REJECTED");
    if (outcome.result?.status === "REJECTED") expect(outcome.result.cause).toBe("HUMAN_CONFIRMATION_REQUIRED");
    expect(clicks).toBe(0);
  });
});

describe("confirmationCovers is a pure check", () => {
  it("does not spend what it inspects", async () => {
    const g = page();
    const confirmation = confirmFor(g, "#submit");
    const subject = subjectFor(g, "#submit");
    for (let i = 0; i < 3; i += 1) {
      expect(confirmationCovers(confirmation, subject, ORIGIN, () => 1)).toEqual({ covers: true });
    }
    expect(confirmationState(confirmation, () => 1)).toBe("LIVE");
    expect((await mint(g, "#submit", { confirmation, origin: ORIGIN })).minted).toBe(true);
  });

  it("reports NOT_RECORDED for anything that is not a confirmation", () => {
    const g = page();
    const subject = subjectFor(g, "#submit");
    for (const candidate of [null, undefined, 0, "yes", {}, { subject }]) {
      expect(confirmationCovers(candidate, subject, ORIGIN, () => 1)).toEqual({
        covers: false,
        cause: "NOT_RECORDED",
      });
    }
  });

  it("does not treat an unknown node id as a match", () => {
    const g = page();
    const confirmation = confirmFor(g, "#submit");
    const subject = { ...subjectFor(g, "#submit"), nodeId: nodeId("not-this-one") };
    expect(confirmationCovers(confirmation, subject, ORIGIN, () => 1)).toEqual({
      covers: false,
      cause: "DIFFERENT_TARGET",
    });
  });
});
