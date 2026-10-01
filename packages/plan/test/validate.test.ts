/**
 * VALIDATE PLAN — and the boundary it must not cross.
 *
 * Two claims organise this file:
 *
 * 1. **The literal the reasoner should never have known is refused before anything happens.** No
 *    rehydration, no insertion, no action — and the refusal does not quote it.
 * 2. **Where privacy has an opinion, privacy's opinion is final.** Every binding refusal here is
 *    produced by `bind()` and reported with `bind()`'s own cause. This layer adds structural
 *    refusals of its own; it never adds a permission.
 */
import { describe, expect, it } from "vitest";
import {
  parsePlan,
  validatePlan,
  type Plan,
  type PlanValidationContext,
  type ValidatedInsert,
  type ValidatedReferenceInsert,
} from "../src/index.js";
import { classOriginKey } from "@pratibimb/privacy";
import { DEMO, NOW, ORIGIN, REQUEST, SESSION, grantFor, rawPlan, scenario } from "./support/scenario.js";

const clickStep = { op: "click", target: "#submit" };
const insertRef = (ref: string, target = "#mobile_confirm") => ({ op: "insert", target, ref });

/** Narrow to a reference-backed insert, failing loudly if the step is not one. */
const byReference = (step: ValidatedInsert | undefined): ValidatedReferenceInsert => {
  if (!step || step.source !== "reference") throw new Error("expected a reference-backed insert");
  return step;
};

const parse = (raw: unknown): Plan => {
  const parsed = parsePlan(raw);
  if (!parsed.ok) throw new Error(`test setup: parse refused (${parsed.cause})`);
  return parsed.plan;
};

/** The demo's happy plan, against a real sanitized scenario. */
const happy = async (over: Partial<PlanValidationContext> = {}) => {
  const s = await scenario(over);
  return { s, plan: parse(rawPlan([insertRef(s.phoneRef), clickStep])) };
};

describe("the accepted plan", () => {
  it("validates the demo's two steps and reports what still needs a human", async () => {
    const { s, plan } = await happy();
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((x) => x.op)).toEqual(["insert", "click"]);
    const insert = result.steps[0];
    if (insert?.op !== "insert" || insert.source !== "reference") throw new Error("shape");
    expect(insert.piiClass).toBe("PHONE");
    expect(insert.ref).toBe(s.phoneRef);
    expect(insert.binding).toEqual({ decision: "BIND_OK" });
    expect(result.needsHuman).toEqual([]);
  });

  it("reports NEEDS_HUMAN_GRANT for a SENSITIVE class instead of deciding for the human", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([insertRef(s.aadhaarRef, "#aadhaar"), clickStep]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.needsHuman).toHaveLength(1);
    expect(byReference(result.needsHuman[0]).binding).toEqual({ decision: "NEEDS_HUMAN_GRANT" });
  });

  it("accepts the SENSITIVE step once a matching human grant exists — decided by bind, not here", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([insertRef(s.aadhaarRef, "#aadhaar"), clickStep]));
    s.useGrants.push(grantFor(s.aadhaarRef, "#aadhaar", { piiClass: "AADHAAR" }));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.needsHuman).toEqual([]);
  });
});

describe("the literal that must not get through", () => {
  it("refuses the value the reasoner was never sent, as a leak and not a plan defect", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([{ op: "insert", target: "#mobile_confirm", literal: DEMO.mobile }, clickStep]));
    const result = validatePlan(plan, s.ctx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.cause).toBe("LITERAL_REFUSED");
    expect(result.refusal.literalCause).toBe("VAULT_LITERAL_ECHO");
    expect(result.refusal.literalSeverity).toBe("LEAKAGE_EVENT");
    expect(result.refusal.piiClass).toBe("PHONE");
  });

  it("never quotes the secret, anywhere in the result", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([{ op: "insert", target: "#mobile_confirm", literal: DEMO.mobile }, clickStep]));
    const result = validatePlan(plan, s.ctx);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(DEMO.mobile);
    expect(serialized).not.toContain("900000");
  });

  it("catches it however the reasoner writes it", async () => {
    const s = await scenario();
    for (const written of ["+91 90000 00001", "9000-000-001", "the number is 9000000001", "9OOOOOOOO1"]) {
      const plan = parse(rawPlan([{ op: "insert", target: "#mobile_confirm", literal: written }, clickStep]));
      const result = validatePlan(plan, s.ctx);
      expect(result.ok, written).toBe(false);
      if (result.ok) continue;
      expect(result.refusal.literalCause).toBe("VAULT_LITERAL_ECHO");
    }
  });

  it("refuses before anything is rehydrated: the reference is still unspent", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([{ op: "insert", target: "#mobile_confirm", literal: DEMO.mobile }, clickStep]));
    validatePlan(plan, s.ctx);
    expect(s.vault.isConsumed(s.phoneRef)).toBe(false);
    expect(s.vault.describe(s.phoneRef)?.consumed).toBe(false);
  });

  it("records a literal aimed at a redacted field as a plan defect, not a leak", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([{ op: "insert", target: "#mobile", literal: "Chandrayaan-3" }, clickStep]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.literalCause).toBe("LITERAL_AT_REDACTED_FIELD");
    expect(result.refusal.literalSeverity).toBe("PLAN_DEFECT");
  });

});

/**
 * THE SAFE LITERAL — the half of the policy that must NOT be "refuse everything".
 *
 * `docs/architecture/action-schema.md` calls a schema that cannot express a non-sensitive literal
 * *"a functional defect"*: most of what an agent types is not secret, and *search for Chandrayaan-3,
 * select Punjab, enter 2026* has to be expressible. The contract's answer is not prohibition, it is
 * three checks — target, shape, vault — and a literal that passes all three is legitimate.
 *
 * These cases pin all four arms of the policy so neither half can drift: a safe literal is accepted
 * with no vault involvement and no human grant, and the three refusals above still refuse.
 */
describe("the safe literal", () => {
  const safeInsert = (literal: string, target = "#notes") => ({ op: "insert", target, literal });

  /** A free-text field carrying no redaction token — the contract's own example of where literals go. */
  const withFreeTextField = async () => {
    const s = await scenario();
    const fields = new Map(s.ctx.view.fields);
    fields.set("#notes", { accepts: "FREE_TEXT", origin: ORIGIN, fingerprint: "#notes|textbox|Notes" });
    const ctx = {
      ...s.ctx,
      view: { ...s.ctx.view, fields },
      actionableTargets: new Set([...s.ctx.actionableTargets, "#notes"]),
    };
    return { s, ctx };
  };

  it("accepts a literal that passes all three checks", async () => {
    const { ctx } = await withFreeTextField();
    const result = validatePlan(parse(rawPlan([safeInsert("Chandrayaan-3"), clickStep])), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0]).toEqual({ op: "insert", source: "literal", index: 0, target: "#notes", needsHuman: false });
  });

  it("needs no human grant: there is no secret to release", async () => {
    const { ctx } = await withFreeTextField();
    const result = validatePlan(parse(rawPlan([safeInsert("Punjab"), clickStep])), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.needsHuman).toEqual([]);
  });

  it("does not carry the reasoner's text into the result the client keeps", async () => {
    const { ctx } = await withFreeTextField();
    const result = validatePlan(parse(rawPlan([safeInsert("Chandrayaan-3"), clickStep])), ctx);
    expect(JSON.stringify(result)).not.toContain("Chandrayaan-3");
  });

  it("touches the vault only to ask, never to spend", async () => {
    const { s, ctx } = await withFreeTextField();
    validatePlan(parse(rawPlan([safeInsert("Punjab"), clickStep])), ctx);
    expect(s.vault.size).toBe(4);
    expect(s.vault.describe(s.phoneRef)?.consumed).toBe(false);
  });

  it("still refuses the three unsafe cases at the same target", async () => {
    const { s, ctx } = await withFreeTextField();
    // C — the literal is a value the vault holds.
    const echo = validatePlan(parse(rawPlan([safeInsert(DEMO.mobile), clickStep])), ctx);
    expect(echo.ok).toBe(false);
    if (!echo.ok) expect(echo.refusal.literalCause).toBe("VAULT_LITERAL_ECHO");

    // B — the literal is PII-shaped, even though the vault has never seen it.
    const shaped = validatePlan(parse(rawPlan([safeInsert("9876543210"), clickStep])), ctx);
    expect(shaped.ok).toBe(false);
    if (!shaped.ok) expect(shaped.refusal.literalCause).toBe("PII_SHAPED_LITERAL");

    // D — a perfectly harmless literal aimed at a field that carries a redaction token.
    const atRedacted = validatePlan(parse(rawPlan([safeInsert("Punjab", "#mobile"), clickStep])), s.ctx);
    expect(atRedacted.ok).toBe(false);
    if (!atRedacted.ok) expect(atRedacted.refusal.literalCause).toBe("LITERAL_AT_REDACTED_FIELD");
  });

  it("keeps a reference and a safe literal distinguishable in one plan", async () => {
    const { s, ctx } = await withFreeTextField();
    const result = validatePlan(
      parse(rawPlan([insertRef(s.phoneRef), safeInsert("Punjab"), clickStep])),
      ctx
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sources = result.steps.filter((x) => x.op === "insert").map((x) => (x.op === "insert" ? x.source : ""));
    expect(sources).toEqual(["reference", "literal"]);
  });
});

describe("identity, provenance and the view", () => {
  it("refuses a plan built by something other than the parser", async () => {
    const { s, plan } = await happy();
    const forged = JSON.parse(JSON.stringify(plan)) as Plan;
    const result = validatePlan(forged, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.cause).toBe("NOT_A_PARSED_PLAN");
  });

  it.each([
    ["another request", { requestId: "request-2" }, "REQUEST_MISMATCH"],
    ["another session", { sessionId: "session-2" }, "SESSION_MISMATCH"],
    ["another page", { origin: "http://127.0.0.1:9999" }, "ORIGIN_MISMATCH"],
    ["a view the client has replaced", { viewId: "view-0" }, "STALE_VIEW"],
  ])("refuses a plan from %s", async (_label, over, cause) => {
    const s = await scenario();
    const plan = parse(
      rawPlan([insertRef(s.phoneRef), clickStep], {
        provenance: { requestId: REQUEST, sessionId: SESSION, viewId: REQUEST, origin: ORIGIN, ...over },
      })
    );
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.cause).toBe(cause);
  });

  it("checks the view before it looks up any target, so the cause stays honest", async () => {
    const s = await scenario();
    const plan = parse(
      rawPlan([insertRef(s.phoneRef, "#gone"), clickStep], {
        provenance: { requestId: REQUEST, sessionId: SESSION, viewId: "view-0", origin: ORIGIN },
      })
    );
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Both are wrong; the stale view is the one that explains the other.
    expect(result.refusal.cause).toBe("STALE_VIEW");
  });
});

describe("targets", () => {
  it("refuses an element the live view does not have", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([insertRef(s.phoneRef, "#invented"), clickStep]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.cause).toBe("UNKNOWN_TARGET");
    expect(result.refusal.target).toBe("#invented");
  });

  it("refuses a click on something not present, visible and enabled", async () => {
    const s = await scenario({ actionableTargets: new Set(["#mobile_confirm"]) });
    const plan = parse(rawPlan([insertRef(s.phoneRef), clickStep]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.cause).toBe("TARGET_NOT_ACTIONABLE");
  });

  it("refuses a plan that submits before it restores the value it needs", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([clickStep, insertRef(s.phoneRef)]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.cause).toBe("CLICK_BEFORE_INSERT");
  });

  it("refuses a plan that repeats an operation on one element", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([insertRef(s.phoneRef), insertRef(s.phoneRef), clickStep]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.cause).toBe("DUPLICATE_TARGET");
  });

  it("refuses a plan that proposes no action at all", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([insertRef(s.phoneRef)]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.cause).toBe("NO_EXECUTABLE_STEP");
  });
});

describe("privacy decides about references, and this layer reports it", () => {
  it.each([
    ["an invented reference", "<PII:PHONE:9>", "UNKNOWN_TOKEN"],
    ["a malformed reference", "PII:PHONE:1", "UNKNOWN_TOKEN"],
    ["a class that may never be tokenised", "<PII:OTP:1>", "UNKNOWN_TOKEN"],
  ])("refuses %s with the binder's own cause", async (_label, ref, cause) => {
    const s = await scenario();
    const plan = parse(rawPlan([insertRef(ref), clickStep]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.cause).toBe("PRIVACY_REFUSED");
    expect(result.refusal.bindCause).toBe(cause);
  });

  it("refuses a reference aimed at a field of another class", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([insertRef(s.phoneRef, "#aadhaar"), clickStep]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.bindCause).toBe("CLASS_MISMATCH");
  });

  it("refuses a reference from another session's vault", async () => {
    const s = await scenario({ sessionId: "session-2" });
    const plan = parse(
      rawPlan([insertRef(s.phoneRef), clickStep], {
        provenance: { requestId: REQUEST, sessionId: "session-2", viewId: REQUEST, origin: ORIGIN },
      })
    );
    const result = validatePlan(plan, { ...s.ctx, requestId: REQUEST });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.bindCause).toBe("SESSION_MISMATCH");
  });

  it("refuses a reference whose origin is not the field's", async () => {
    const s = await scenario();
    const crossOrigin = new Map(s.ctx.view.fields);
    crossOrigin.set("#mobile_confirm", {
      accepts: "PHONE",
      origin: "http://127.0.0.1:9999",
      fingerprint: "elsewhere",
    });
    const plan = parse(rawPlan([insertRef(s.phoneRef), clickStep]));
    const result = validatePlan(plan, { ...s.ctx, view: { ...s.ctx.view, fields: crossOrigin } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.bindCause).toBe("ORIGIN_MISMATCH");
  });

  it("refuses a reference that has already been spent", async () => {
    const s = await scenario();
    expect(s.vault.consume(s.phoneRef)).toBe(true);
    const plan = parse(rawPlan([insertRef(s.phoneRef), clickStep]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.bindCause).toBe("CONSUMED");
  });

  it("refuses when the page has no class grant for this session", async () => {
    const s = await scenario({ classOriginGrants: new Set<string>() });
    const plan = parse(rawPlan([insertRef(s.phoneRef), clickStep]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(true); // NEEDS_USER is not a refusal; it is a question for a human.
    if (!result.ok) return;
    expect(byReference(result.needsHuman[0]).binding).toEqual({
      decision: "NEEDS_USER",
      cause: "CLASS_ORIGIN_GRANT_REQUIRED",
    });
  });

  it("refuses once the vault is gone", async () => {
    const s = await scenario();
    s.vault.destroy();
    const plan = parse(rawPlan([insertRef(s.phoneRef), clickStep]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.bindCause).toBe("VAULT_DESTROYED");
  });

  it("cannot be talked into allowing what bind refuses, by any grant this layer holds", async () => {
    // A grant naming the right reference does not override a class mismatch: the grant is checked by
    // privacy, after privacy's own class check, and this layer has no path around it.
    const s = await scenario();
    s.useGrants.push(grantFor(s.phoneRef, "#aadhaar"));
    const plan = parse(rawPlan([insertRef(s.phoneRef, "#aadhaar"), clickStep]));
    const result = validatePlan(plan, s.ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.bindCause).toBe("CLASS_MISMATCH");
  });
});

describe("what the validator does not do", () => {
  it("never spends a reference, on any path", async () => {
    const s = await scenario();
    for (const raw of [
      rawPlan([insertRef(s.phoneRef), clickStep]),
      rawPlan([{ op: "insert", target: "#mobile_confirm", literal: DEMO.mobile }, clickStep]),
      rawPlan([insertRef(s.phoneRef, "#aadhaar"), clickStep]),
    ]) {
      validatePlan(parse(raw), s.ctx);
    }
    expect(s.vault.describe(s.phoneRef)?.consumed).toBe(false);
    expect(s.vault.size).toBe(4);
  });

  it("never marks a grant used", async () => {
    const s = await scenario();
    const grant = grantFor(s.aadhaarRef, "#aadhaar", { piiClass: "AADHAAR" });
    s.useGrants.push(grant);
    validatePlan(parse(rawPlan([insertRef(s.aadhaarRef, "#aadhaar"), clickStep])), s.ctx);
    expect(grant.used).toBe(false);
  });

  it("keeps no secret anywhere in a successful validation either", async () => {
    const { s, plan } = await happy();
    const serialized = JSON.stringify(validatePlan(plan, s.ctx));
    for (const secret of [DEMO.mobile, DEMO.aadhaar, DEMO.name, DEMO.dob, DEMO.otp]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("uses the same class×origin key privacy does", async () => {
    // Not a re-implementation: the key function is imported from privacy.
    const s = await scenario();
    expect(s.ctx.classOriginGrants.has(classOriginKey("PHONE", ORIGIN))).toBe(true);
    expect(s.ctx.now).toBe(NOW);
  });
});
