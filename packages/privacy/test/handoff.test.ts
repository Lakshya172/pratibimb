/**
 * The verifier — including the case the whole design turns on: a caller cannot simply write
 * `verified: true`.
 *
 * `verifyHandoff` is reached here directly, with drafts built by hand, so each refusal is isolated.
 * `markDraft` is imported from the module rather than the package barrel because provenance is
 * package-internal: a handoff assembled outside `sanitize()` is not verifiable, which is the first
 * check.
 */
import { describe, expect, it } from "vitest";
import { createVault, isVerifiedHandoff, sanitize, serializeHandoff, verifyHandoff } from "../src/index.js";
import { markDraft, type HandoffDraft, type Redaction } from "../src/handoff.js";
import { DEMO, GOAL, ORIGIN, demoContext, demoFields, demoGraph } from "./support/demoFixture.js";

const vaultWith = (over: { sessionId?: string; origin?: string } = {}) => {
  const vault = createVault({
    sessionId: over.sessionId ?? "session-1",
    origin: over.origin ?? ORIGIN,
    now: () => 1_760_000_000_000,
  });
  vault.store({ piiClass: "PHONE", value: DEMO.mobile, target: "#mobile" });
  return vault;
};

const body = (over: Partial<HandoffDraft> = {}): HandoffDraft => ({
  manifestVersion: "1.1",
  capture: { w: 1024, h: 768, dpr: 1, zoom: 1, scale_to_css: 1, scroll: { x: 0, y: 0 }, origin: ORIGIN },
  capability: { backend: "none" as never, tiers_fired: ["T0", "T2"] },
  elements: [{ id: "#mobile", role: "textbox", name: "Mobile number", source: "dom", visible: true, offscreen: false, enabled: true }],
  goal: GOAL,
  redactions: [],
  request: { requestId: "request-1", sessionId: "session-1", issuedAt: 1_760_000_000_000 },
  verified: false,
  ...over,
});

const draft = (over: Partial<HandoffDraft> = {}): HandoffDraft => markDraft(body(over));

const context = (vault = vaultWith()) => ({
  sessionId: "session-1",
  requestId: "request-1",
  origin: ORIGIN,
  vault,
});

const phoneRedaction: Redaction = {
  token: "<PII:PHONE:1>",
  class: "PHONE",
  tier: "PERSONAL",
  method: "token_reference",
  detectors: ["D1", "D2"],
  hint: { len: 10, kind: "numeric", field_role: "tel" },
  targetId: "#mobile",
};

describe("provenance", () => {
  it("refuses a handoff it did not assemble", () => {
    expect(verifyHandoff(body(), context())).toEqual({ verified: false, cause: "NOT_FROM_SANITIZER" });
  });

  it("does not accept a forged verified flag as verification", async () => {
    const outcome = await sanitize(demoGraph(), GOAL, demoContext(), { fields: demoFields() });
    if (!outcome.ok) throw new Error("test setup");
    const forged = { ...(outcome.handoff as object), verified: true };
    expect(forged.verified).toBe(true);
    expect(isVerifiedHandoff(forged)).toBe(false);
    expect(isVerifiedHandoff({ verified: true })).toBe(false);
    expect(isVerifiedHandoff(JSON.parse(serializeHandoff(outcome.handoff)))).toBe(false);
  });

  it("accepts the object it produced", () => {
    const result = verifyHandoff(draft(), context());
    expect(result.verified).toBe(true);
    if (!result.verified) return;
    expect(isVerifiedHandoff(result.handoff)).toBe(true);
    expect(Object.isFrozen(result.handoff)).toBe(true);
  });
});

describe("identity and origin", () => {
  it("refuses a mismatched request or session", () => {
    expect(verifyHandoff(draft(), { ...context(), requestId: "request-2" })).toEqual({
      verified: false,
      cause: "REQUEST_IDENTITY_MISMATCH",
    });
    expect(verifyHandoff(draft(), { ...context(), sessionId: "session-2" })).toEqual({
      verified: false,
      cause: "SESSION_IDENTITY_MISMATCH",
    });
  });

  it("refuses when the vault belongs to another session", () => {
    const result = verifyHandoff(draft(), context(vaultWith({ sessionId: "session-9" })));
    expect(result).toEqual({ verified: false, cause: "SESSION_IDENTITY_MISMATCH" });
  });

  it("refuses when the page is not the page", () => {
    expect(verifyHandoff(draft(), { ...context(), origin: "http://127.0.0.1:9999" })).toEqual({
      verified: false,
      cause: "ORIGIN_MISMATCH",
    });
    const otherVault = vaultWith({ origin: "http://127.0.0.1:9999" });
    expect(verifyHandoff(draft(), { ...context(otherVault) })).toEqual({ verified: false, cause: "ORIGIN_MISMATCH" });
  });

  it("refuses once the vault has been destroyed", () => {
    const vault = vaultWith();
    vault.destroy();
    expect(verifyHandoff(draft(), context(vault))).toEqual({ verified: false, cause: "VAULT_DESTROYED" });
  });
});

describe("structure and tokens", () => {
  it("refuses a malformed manifest", () => {
    expect(verifyHandoff(draft({ manifestVersion: "1.0" as never }), context()).verified).toBe(false);
    expect(
      verifyHandoff(draft({ capture: { ...body().capture, dpr: Number.NaN } }), context())
    ).toEqual({ verified: false, cause: "MALFORMED_STRUCTURE" });
    expect(verifyHandoff(draft({ goal: "  " }), context())).toEqual({ verified: false, cause: "MALFORMED_STRUCTURE" });
  });

  it("refuses a reference the vault does not know", () => {
    expect(
      verifyHandoff(draft({ redactions: [{ ...phoneRedaction, token: "<PII:PHONE:7>" }] }), context())
    ).toEqual({ verified: false, cause: "UNKNOWN_TOKEN" });
  });

  it("refuses a reference for a class that may not be tokenised", () => {
    const outcome = verifyHandoff(
      draft({ redactions: [{ ...phoneRedaction, token: "<PII:OTP:1>", class: "OTP", tier: "CRITICAL" }] }),
      context()
    );
    expect(outcome).toEqual({ verified: false, cause: "UNKNOWN_TOKEN" });
  });

  it("refuses a masked span that claims a reference", () => {
    const outcome = verifyHandoff(
      draft({ redactions: [{ ...phoneRedaction, method: "masked_no_token" }] }),
      context()
    );
    expect(outcome).toEqual({ verified: false, cause: "NON_TOKENISABLE_CLASS" });
  });

  it("refuses the same reference twice", () => {
    expect(verifyHandoff(draft({ redactions: [phoneRedaction, phoneRedaction] }), context())).toEqual({
      verified: false,
      cause: "DUPLICATE_TOKEN",
    });
  });

  it("accepts a well-formed reference the vault issued", () => {
    expect(verifyHandoff(draft({ redactions: [phoneRedaction] }), context()).verified).toBe(true);
  });
});

describe("the value-aware residual check", () => {
  it("refuses a handoff in which a vault value survived, and names only the class", () => {
    const leaked = draft({
      elements: [
        { id: "#echo", role: "status", name: `Sending ${DEMO.mobile}`, source: "dom", visible: true, offscreen: false, enabled: true },
      ],
    });
    const result = verifyHandoff(leaked, context());
    expect(result).toEqual({ verified: false, cause: "VAULT_VALUE_IN_HANDOFF", leakedClass: "PHONE" });
    expect(JSON.stringify(result)).not.toContain(DEMO.mobile);
  });

  it("catches a value written differently from the way it was stored", () => {
    const leaked = draft({
      elements: [
        { id: "#echo", role: "status", name: "+91 90000-00001", source: "dom", visible: true, offscreen: false, enabled: true },
      ],
    });
    expect(verifyHandoff(leaked, context()).verified).toBe(false);
  });

  it("does not fire on a handoff that merely mentions the field", () => {
    const clean = draft({
      elements: [
        { id: "#mobile", role: "textbox", name: "Mobile number", source: "dom", visible: true, offscreen: false, enabled: true },
      ],
    });
    expect(verifyHandoff(clean, context()).verified).toBe(true);
  });
});
