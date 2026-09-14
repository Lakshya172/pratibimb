/**
 * The literal-echo refusal — the demonstration the product rests on.
 *
 * If the reasoner returns `9000000001` where it should have returned `<PII:PHONE:1>`, the client
 * refuses. Not after typing it, not after clicking: before rehydration and before any action, because
 * the check runs on the plan rather than on its effects.
 *
 * The tests also pin the distinction INV-10 insists on: a PII-shaped literal the server invented is a
 * plan defect, and a literal that matches the vault is a leakage event. They must never be recorded
 * as the same thing, so when both fire the leak is what gets reported.
 */
import { describe, expect, it } from "vitest";
import { checkLiteral, rehydrate, sanitize, type BindContext, type BindView } from "../src/index.js";
import { DEMO, GOAL, ORIGIN, SECRETS, TODAY, demoContext, demoFields, demoFingerprint, demoGraph } from "./support/demoFixture.js";

const NOW = 1_760_000_000_000;

const scenario = async () => {
  const outcome = await sanitize(demoGraph(), GOAL, demoContext(), { fields: demoFields() });
  if (!outcome.ok) throw new Error("test setup: sanitize refused");
  const refs = new Map(outcome.handoff.redactions.filter((r) => r.token !== "").map((r) => [r.class, r.token]));
  const view: BindView = {
    viewId: "view-1",
    documentId: "doc-1",
    fields: new Map([["#mobile", { accepts: "PHONE" as const, origin: ORIGIN, fingerprint: demoFingerprint("#mobile") }]]),
  };
  const ctx: BindContext = {
    vault: outcome.vault,
    sessionId: "session-1",
    view,
    currentDocumentId: "doc-1",
    classOriginGrants: new Set(["PHONE|" + ORIGIN]),
    useGrants: [],
    now: NOW,
  };
  return { outcome, ctx, phone: refs.get("PHONE") as string };
};

describe("a literal that matches a vault value", () => {
  it("is refused, as a leakage event and not as a plan defect", async () => {
    const { outcome } = await scenario();
    if (!outcome.ok) return;
    const verdict = checkLiteral(DEMO.mobile, { vault: outcome.vault, targetIsRedacted: true, today: TODAY });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.cause).toBe("VAULT_LITERAL_ECHO");
    expect(verdict.severity).toBe("LEAKAGE_EVENT");
    expect(verdict.piiClass).toBe("PHONE");
    // The redacted-field violation is recorded too, but it is not what this event is called.
    expect(verdict.findings.map((f) => f.cause)).toContain("LITERAL_AT_REDACTED_FIELD");
  });

  it("is refused however the server writes it", async () => {
    const { outcome } = await scenario();
    if (!outcome.ok) return;
    for (const written of ["+91 90000 00001", "9000-000-001", "the number is 9000000001", "9OOOOOOOO1"]) {
      const verdict = checkLiteral(written, { vault: outcome.vault, targetIsRedacted: false, today: TODAY });
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.cause).toBe("VAULT_LITERAL_ECHO");
    }
  });

  it("is refused for any value the vault holds, not only the one the plan targeted", async () => {
    const { outcome } = await scenario();
    if (!outcome.ok) return;
    const aadhaar = checkLiteral(DEMO.aadhaar, { vault: outcome.vault, targetIsRedacted: false, today: TODAY });
    expect(aadhaar.allowed).toBe(false);
    if (!aadhaar.allowed) expect(aadhaar.piiClass).toBe("AADHAAR");

    const name = checkLiteral(DEMO.name, { vault: outcome.vault, targetIsRedacted: false, today: TODAY });
    expect(name.allowed).toBe(false);
  });

  it("never quotes the secret in the refusal", async () => {
    const { outcome } = await scenario();
    if (!outcome.ok) return;
    const verdict = checkLiteral(DEMO.mobile, { vault: outcome.vault, targetIsRedacted: true, today: TODAY });
    const serialized = JSON.stringify(verdict);
    for (const secret of SECRETS) expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("9000");
  });

  it("refuses before anything is rehydrated: the reference is still unspent", async () => {
    const { outcome, ctx, phone } = await scenario();
    if (!outcome.ok) return;

    // The order an orchestrator must follow: check the plan, and only then bind.
    const verdict = checkLiteral(DEMO.mobile, { vault: outcome.vault, targetIsRedacted: true, today: TODAY });
    expect(verdict.allowed).toBe(false);

    expect(outcome.vault.describe(phone)?.consumed).toBe(false);
    expect(outcome.vault.holdsLiteral(DEMO.mobile).held).toBe(true);

    // And had it been allowed, this is what would have run. It is not run here.
    expect(typeof rehydrate).toBe("function");
    expect(ctx.useGrants).toEqual([]);
  });
});

describe("a literal that does not match the vault", () => {
  it("allows an ordinary literal at an ordinary field", async () => {
    const { outcome } = await scenario();
    if (!outcome.ok) return;
    for (const literal of ["Punjab", "Chandrayaan-3", "2026", "Submit"]) {
      expect(checkLiteral(literal, { vault: outcome.vault, targetIsRedacted: false, today: TODAY })).toEqual({
        allowed: true,
      });
    }
  });

  it("refuses any literal aimed at a redacted field, whatever it contains", async () => {
    const { outcome } = await scenario();
    if (!outcome.ok) return;
    const verdict = checkLiteral("Punjab", { vault: outcome.vault, targetIsRedacted: true, today: TODAY });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.cause).toBe("LITERAL_AT_REDACTED_FIELD");
    expect(verdict.severity).toBe("PLAN_DEFECT");
  });

  it("records a PII-shaped literal the server invented as a defect, not as a leak", async () => {
    const { outcome } = await scenario();
    if (!outcome.ok) return;
    // A valid Indian mobile number that is not the one in the vault.
    const verdict = checkLiteral("9876543210", { vault: outcome.vault, targetIsRedacted: false, today: TODAY });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.cause).toBe("PII_SHAPED_LITERAL");
    expect(verdict.severity).toBe("PLAN_DEFECT");
    expect(verdict.piiClass).toBe("PHONE");
  });
});
