/**
 * The binding boundary: a reference alone authorises nothing.
 *
 * Every refusal in the ordered chain gets a case, because the causes are evidence — a stale view
 * reported as a class mismatch would make a ledger lie about what happened. The order itself is
 * reconstructed from E2's binder, and these cases are the reconstruction's equivalent of its table.
 */
import { describe, expect, it } from "vitest";
import {
  bind,
  classOriginKey,
  rehydrate,
  sanitize,
  type BindContext,
  type BindView,
  type UseGrant,
} from "../src/index.js";
import { DEMO, GOAL, ORIGIN, demoContext, demoFields, demoFingerprint, demoGraph } from "./support/demoFixture.js";

const NOW = 1_760_000_000_000;

const scenario = async () => {
  const outcome = await sanitize(demoGraph(), GOAL, demoContext(), { fields: demoFields() });
  if (!outcome.ok) throw new Error("test setup: sanitize refused");
  const refs = new Map(outcome.handoff.redactions.filter((r) => r.token !== "").map((r) => [r.class, r.token]));

  const view: BindView = {
    viewId: "view-1",
    documentId: "doc-1",
    fields: new Map([
      ["#mobile", { accepts: "PHONE" as const, origin: ORIGIN, fingerprint: demoFingerprint("#mobile") }],
      ["#aadhaar", { accepts: "AADHAAR" as const, origin: ORIGIN, fingerprint: demoFingerprint("#aadhaar") }],
      ["#otp", { accepts: "OTP" as const, origin: ORIGIN, fingerprint: demoFingerprint("#otp") }],
      ["#notes", { accepts: "UNKNOWN" as const, origin: ORIGIN, fingerprint: "#notes|textbox|Notes" }],
      ["#elsewhere", { accepts: "PHONE" as const, origin: "http://127.0.0.1:9999", fingerprint: "fp-other" }],
    ]),
  };

  const ctx: BindContext = {
    vault: outcome.vault,
    sessionId: "session-1",
    view,
    currentDocumentId: "doc-1",
    classOriginGrants: new Set([classOriginKey("PHONE", ORIGIN), classOriginKey("AADHAAR", ORIGIN)]),
    useGrants: [],
    now: NOW,
  };

  return { outcome, ctx, phone: refs.get("PHONE") as string, aadhaar: refs.get("AADHAAR") as string };
};

const grantFor = (ref: string, selector: string, over: Partial<UseGrant> = {}): UseGrant => ({
  ref,
  piiClass: "AADHAAR",
  fingerprint: demoFingerprint(selector),
  origin: ORIGIN,
  sessionId: "session-1",
  purpose: "Fill the Aadhaar field on this form",
  actionContext: "insert into #aadhaar, then click #submit",
  grantedAt: NOW - 1_000,
  expiresAt: NOW + 60_000,
  used: false,
  ...over,
});

describe("the permitted path", () => {
  it("binds a PERSONAL reference into its own field, given a class grant for this page", async () => {
    const { ctx, phone } = await scenario();
    expect(bind({ ref: phone, targetId: "#mobile", viewId: "view-1" }, ctx)).toEqual({ decision: "BIND_OK" });
  });

  it("rehydrates the value, spends the reference, and refuses the second attempt", async () => {
    const { ctx, phone } = await scenario();
    const first = rehydrate({ ref: phone, targetId: "#mobile", viewId: "view-1" }, ctx);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value).toBe(DEMO.mobile);
    expect(first.piiClass).toBe("PHONE");

    const second = rehydrate({ ref: phone, targetId: "#mobile", viewId: "view-1" }, ctx);
    expect(second).toEqual({ ok: false, decision: { decision: "REFUSE", cause: "CONSUMED" } });
  });
});

/**
 * The binder's own consumed-state invariant.
 *
 * `rehydrate` refusing a replay is not the same property as `bind` refusing one, and the difference
 * is not academic: `bind` is exported as a question a caller may ask *without* spending anything, and
 * the next section's plan validation and Planning View are exactly such callers. A binder that
 * answered `BIND_OK` for a spent reference would have the panel offer an action that cannot happen,
 * and would ask a human to authorise a value that can never be released. These three cases exercise
 * the guard on line `if (descriptor.consumed)` directly, rather than through the vault's `consume()`.
 */
describe("a spent reference is refused by the binder itself", () => {
  it("answers REFUSE/CONSUMED to a direct question, with nothing spent", async () => {
    const { ctx, phone } = await scenario();
    const step = { ref: phone, targetId: "#mobile", viewId: "view-1" };
    expect(bind(step, ctx)).toEqual({ decision: "BIND_OK" });

    expect(ctx.vault.consume(phone)).toBe(true); // spent by some earlier use
    expect(bind(step, ctx)).toEqual({ decision: "REFUSE", cause: "CONSUMED" });
  });

  it("refuses a spent SENSITIVE reference instead of asking a human to authorise it", async () => {
    const { ctx, aadhaar } = await scenario();
    const step = { ref: aadhaar, targetId: "#aadhaar", viewId: "view-1" };
    expect(bind(step, ctx)).toEqual({ decision: "NEEDS_HUMAN_GRANT" });

    expect(ctx.vault.consume(aadhaar)).toBe(true);
    // CONSUMED is checked before either grant question, so the cause stays honest and no panel is
    // raised for a value that could not be released even if the human said yes.
    expect(bind(step, ctx)).toEqual({ decision: "REFUSE", cause: "CONSUMED" });
  });

  it("does not burn a human grant on a reference that was already spent", async () => {
    const { ctx, aadhaar } = await scenario();
    const grant = grantFor(aadhaar, "#aadhaar");
    const granted = { ...ctx, useGrants: [grant] };
    expect(ctx.vault.consume(aadhaar)).toBe(true);

    const outcome = rehydrate({ ref: aadhaar, targetId: "#aadhaar", viewId: "view-1" }, granted);
    expect(outcome).toEqual({ ok: false, decision: { decision: "REFUSE", cause: "CONSUMED" } });
    // A one-shot human decision is scarce. Binding stops before `rehydrate` marks it used, so a
    // replayed reference cannot exhaust outstanding grants.
    expect(grant.used).toBe(false);
  });
});

describe("the ordered refusals", () => {
  it("refuses a plan made against a view that has moved on", async () => {
    const { ctx, phone } = await scenario();
    expect(bind({ ref: phone, targetId: "#mobile", viewId: "view-0" }, ctx)).toEqual({
      decision: "REFUSE",
      cause: "STALE_VIEW",
    });
  });

  it("refuses when the document has been replaced under the view", async () => {
    const { ctx, phone } = await scenario();
    expect(bind({ ref: phone, targetId: "#mobile", viewId: "view-1" }, { ...ctx, currentDocumentId: "doc-2" })).toEqual({
      decision: "REFUSE",
      cause: "STALE_BINDING",
    });
  });

  it("refuses a target the view does not have", async () => {
    const { ctx, phone } = await scenario();
    expect(bind({ ref: phone, targetId: "#nope", viewId: "view-1" }, ctx)).toEqual({
      decision: "REFUSE",
      cause: "UNKNOWN_TARGET",
    });
  });

  it("refuses an invented, malformed or non-tokenisable reference without guessing", async () => {
    const { ctx } = await scenario();
    for (const ref of ["<PII:PHONE:9>", "PII:PHONE:1", "<PII:EMAIL:1>", "<PII:OTP:1>", DEMO.mobile]) {
      expect(bind({ ref, targetId: "#mobile", viewId: "view-1" }, ctx)).toEqual({
        decision: "REFUSE",
        cause: "UNKNOWN_TOKEN",
      });
    }
  });

  it("sends a reference aimed at an OTP field to a human, never to the page", async () => {
    const { ctx, phone } = await scenario();
    expect(bind({ ref: phone, targetId: "#otp", viewId: "view-1" }, ctx)).toEqual({
      decision: "NEEDS_USER",
      cause: "CRITICAL_FIELD",
    });
  });

  it("sends an ambiguous field to a human rather than guessing what it accepts", async () => {
    const { ctx, phone } = await scenario();
    expect(bind({ ref: phone, targetId: "#notes", viewId: "view-1" }, ctx)).toEqual({
      decision: "NEEDS_USER",
      cause: "AMBIGUOUS_FIELD",
    });
  });

  it("refuses a class that does not match the field", async () => {
    const { ctx, phone } = await scenario();
    expect(bind({ ref: phone, targetId: "#aadhaar", viewId: "view-1" }, ctx)).toEqual({
      decision: "REFUSE",
      cause: "CLASS_MISMATCH",
    });
  });

  it("refuses a field belonging to another origin", async () => {
    const { ctx, phone } = await scenario();
    expect(bind({ ref: phone, targetId: "#elsewhere", viewId: "view-1" }, ctx)).toEqual({
      decision: "REFUSE",
      cause: "ORIGIN_MISMATCH",
    });
  });

  it("requires a class grant for this page", async () => {
    const { ctx, phone } = await scenario();
    const withoutGrant = { ...ctx, classOriginGrants: new Set<string>() };
    expect(bind({ ref: phone, targetId: "#mobile", viewId: "view-1" }, withoutGrant)).toEqual({
      decision: "NEEDS_USER",
      cause: "CLASS_ORIGIN_GRANT_REQUIRED",
    });
  });

  it("refuses a session that is not the vault's", async () => {
    const { ctx, phone } = await scenario();
    expect(bind({ ref: phone, targetId: "#mobile", viewId: "view-1" }, { ...ctx, sessionId: "session-2" })).toEqual({
      decision: "REFUSE",
      cause: "SESSION_MISMATCH",
    });
  });

  it("refuses once the vault is gone", async () => {
    const { ctx, phone } = await scenario();
    ctx.vault.destroy();
    expect(bind({ ref: phone, targetId: "#mobile", viewId: "view-1" }, ctx)).toEqual({
      decision: "REFUSE",
      cause: "VAULT_DESTROYED",
    });
  });

  it("returns no value on any refusal", async () => {
    const { ctx, phone } = await scenario();
    const outcome = rehydrate({ ref: phone, targetId: "#aadhaar", viewId: "view-1" }, ctx);
    expect(outcome.ok).toBe(false);
    expect("value" in outcome).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain(DEMO.mobile);
  });
});

describe("the human grant", () => {
  it("routes a SENSITIVE value to a human when no grant covers it", async () => {
    const { ctx, aadhaar } = await scenario();
    expect(bind({ ref: aadhaar, targetId: "#aadhaar", viewId: "view-1" }, ctx)).toEqual({
      decision: "NEEDS_HUMAN_GRANT",
    });
  });

  it("accepts the grant that names this reference, field, origin and session", async () => {
    const { ctx, aadhaar } = await scenario();
    const granted = { ...ctx, useGrants: [grantFor(aadhaar, "#aadhaar")] };
    expect(bind({ ref: aadhaar, targetId: "#aadhaar", viewId: "view-1" }, granted)).toEqual({ decision: "BIND_OK" });

    const outcome = rehydrate({ ref: aadhaar, targetId: "#aadhaar", viewId: "view-1" }, granted);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toBe(DEMO.aadhaar);
    expect(granted.useGrants[0]?.used).toBe(true);
  });

  it("does not honour a grant for another field, origin or session", async () => {
    const { ctx, aadhaar } = await scenario();
    const cases: UseGrant[] = [
      grantFor(aadhaar, "#mobile"),
      grantFor(aadhaar, "#aadhaar", { origin: "http://127.0.0.1:9999" }),
      grantFor(aadhaar, "#aadhaar", { sessionId: "session-2" }),
      grantFor(aadhaar, "#aadhaar", { expiresAt: NOW - 1 }),
      grantFor(aadhaar, "#aadhaar", { used: true }),
      grantFor("<PII:AADHAAR:2>", "#aadhaar"),
    ];
    for (const grant of cases) {
      expect(bind({ ref: aadhaar, targetId: "#aadhaar", viewId: "view-1" }, { ...ctx, useGrants: [grant] })).toEqual({
        decision: "NEEDS_HUMAN_GRANT",
      });
    }
  });

  it("is one-shot: the same grant does not authorise a second use", async () => {
    const { ctx, aadhaar } = await scenario();
    const grant = grantFor(aadhaar, "#aadhaar");
    const granted = { ...ctx, useGrants: [grant] };
    expect(rehydrate({ ref: aadhaar, targetId: "#aadhaar", viewId: "view-1" }, granted).ok).toBe(true);
    expect(grant.used).toBe(true);
    const again = rehydrate({ ref: aadhaar, targetId: "#aadhaar", viewId: "view-1" }, granted);
    expect(again.ok).toBe(false);
  });

  it("carries what the human was asked, so a panel can show it and a ledger can record it", async () => {
    const { aadhaar } = await scenario();
    const grant = grantFor(aadhaar, "#aadhaar");
    expect(grant.purpose).toContain("Aadhaar");
    expect(grant.actionContext).toContain("#submit");
    expect(JSON.stringify(grant)).not.toContain(DEMO.aadhaar);
  });
});
