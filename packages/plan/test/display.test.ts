/**
 * The projection the client keeps instead of the reasoner's bytes.
 *
 * This exists because a test caught the gap: the refusal never quoted the secret, but the run record
 * held the raw response — so a log, a screenshot or a Planning View would have put the leaked value
 * back on screen. The claim here is narrow and total: **no literal the reasoner sent survives into
 * anything the client keeps.**
 */
import { describe, expect, it } from "vitest";
import { literalMarker, parsePlan, redactPlan, type Plan } from "../src/index.js";
import { DEMO, rawPlan, scenario } from "./support/scenario.js";

const parse = (raw: unknown): Plan => {
  const parsed = parsePlan(raw);
  if (!parsed.ok) throw new Error(`test setup: ${parsed.cause}`);
  return parsed.plan;
};

const click = { op: "click", target: "#submit" };

describe("a literal never survives the projection", () => {
  it("replaces an echoed secret with its class, and keeps the shape", async () => {
    const s = await scenario();
    const safe = redactPlan(parse(rawPlan([{ op: "insert", target: "#mobile_confirm", literal: DEMO.mobile }, click])), s.vault);
    expect(safe.steps[0]).toEqual({
      op: "insert",
      target: "#mobile_confirm",
      literalMarker: "⟨literal:PHONE⟩",
      literalClass: "PHONE",
    });
    expect(safe.steps[1]).toEqual({ op: "click", target: "#submit" });
    expect(JSON.stringify(safe)).not.toContain(DEMO.mobile);
  });

  it("masks a literal the vault does not recognise either", async () => {
    const s = await scenario();
    const safe = redactPlan(parse(rawPlan([{ op: "insert", target: "#mobile_confirm", literal: "Punjab" }, click])), s.vault);
    expect(safe.steps[0]).toEqual({ op: "insert", target: "#mobile_confirm", literalMarker: "⟨literal⟩" });
    expect(JSON.stringify(safe)).not.toContain("Punjab");
  });

  it("masks it however it was written, because the vault answers under normalisation", async () => {
    const s = await scenario();
    for (const written of ["+91 90000 00001", "9000-000-001", "9OOOOOOOO1"]) {
      const safe = redactPlan(parse(rawPlan([{ op: "insert", target: "#mobile_confirm", literal: written }, click])), s.vault);
      const step = safe.steps[0];
      expect(step?.op === "insert" && step.literalClass, written).toBe("PHONE");
      expect(JSON.stringify(safe)).not.toContain(written);
    }
  });

  it("masks every secret the vault holds, not only the phone number", async () => {
    const s = await scenario();
    for (const [value, piiClass] of [[DEMO.aadhaar, "AADHAAR"], [DEMO.name, "NAME"], [DEMO.dob, "DOB"]] as const) {
      const safe = redactPlan(parse(rawPlan([{ op: "insert", target: "#mobile_confirm", literal: value }, click])), s.vault);
      const step = safe.steps[0];
      expect(step?.op === "insert" && step.literalClass, value.slice(0, 3)).toBe(piiClass);
    }
  });
});

describe("what the projection keeps", () => {
  it("keeps references verbatim: an opaque token is the thing worth showing", async () => {
    const s = await scenario();
    const safe = redactPlan(parse(rawPlan([{ op: "insert", target: "#mobile_confirm", ref: s.phoneRef }, click])), s.vault);
    expect(safe.steps[0]).toEqual({ op: "insert", target: "#mobile_confirm", ref: "<PII:PHONE:1>" });
  });

  it("keeps provenance and the goal, so a panel can say which request this answers", async () => {
    const s = await scenario();
    const plan = parse(rawPlan([{ op: "insert", target: "#mobile_confirm", ref: s.phoneRef }, click]));
    const safe = redactPlan(plan, s.vault);
    expect(safe.provenance).toEqual(plan.provenance);
    expect(safe.goal).toBe(plan.goal);
    expect(safe.planVersion).toBe("1");
  });

  it("never invents a marker for a step that had no literal", async () => {
    const s = await scenario();
    const safe = redactPlan(parse(rawPlan([{ op: "insert", target: "#mobile_confirm", ref: s.phoneRef }, click])), s.vault);
    expect("literalMarker" in (safe.steps[0] ?? {})).toBe(false);
  });

  it("names the marker format in one place", () => {
    expect(literalMarker(null)).toBe("⟨literal⟩");
    expect(literalMarker("PHONE")).toBe("⟨literal:PHONE⟩");
  });
});
