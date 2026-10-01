/**
 * Classification, and the rule that decides disagreement.
 *
 * The protection-ranking tests are the ones with teeth: a field that says PHONE and a value that
 * validates as AADHAAR must be treated as AADHAAR. There is no test asserting the opposite, because
 * there is no code path that could produce it.
 */
import { describe, expect, it } from "vitest";
import {
  classifyField,
  classifyObserved,
  classifyValue,
  mostProtective,
  mostProtectiveOf,
  protectionRank,
} from "../src/index.js";
import { DEMO, ORIGIN, TODAY } from "./support/demoFixture.js";

describe("field classification (D1)", () => {
  it("classifies the demo fields", () => {
    expect(classifyField({ autocomplete: "tel", type: "tel", label: "Mobile number" })).toBe("PHONE");
    expect(classifyField({ label: "Aadhaar number" })).toBe("AADHAAR");
    expect(classifyField({ type: "date", label: "Date of birth" })).toBe("DOB");
    expect(classifyField({ autocomplete: "name", label: "Full name" })).toBe("NAME");
    expect(classifyField({ autocomplete: "one-time-code", label: "OTP" })).toBe("OTP");
  });

  it("returns UNKNOWN rather than guessing when signals disagree", () => {
    expect(classifyField({ label: "Mobile number", name: "aadhaar" })).toBe("UNKNOWN");
    expect(classifyField({ autocomplete: "tel", label: "Date of birth" })).toBe("UNKNOWN");
    expect(classifyField({ label: "Contact" })).toBe("UNKNOWN");
  });

  it("refuses to read a qualified name as the applicant's own", () => {
    expect(classifyField({ label: "Father's name" })).toBe("UNKNOWN");
    expect(classifyField({ label: "Company name" })).toBe("UNKNOWN");
    expect(classifyField({ label: "Full name" })).toBe("NAME");
  });

  it("treats a field naming something else as unidentified", () => {
    expect(classifyField({ autocomplete: "email", label: "Mobile number" })).toBe("UNKNOWN");
    expect(classifyField({ type: "password", label: "Mobile number" })).toBe("UNKNOWN");
  });

  it("calls an unlabelled textarea free text, and an unlabelled input unknown", () => {
    expect(classifyField({ tag: "textarea" })).toBe("FREE_TEXT");
    expect(classifyField({ tag: "input" })).toBe("UNKNOWN");
    expect(classifyField({ tag: "textarea", label: "Feedback" })).toBe("FREE_TEXT");
  });
});

describe("value classification (D2)", () => {
  it("classifies the demo values", () => {
    expect(classifyValue(DEMO.aadhaar, TODAY)).toBe("AADHAAR");
    expect(classifyValue(DEMO.mobile, TODAY)).toBe("PHONE");
    expect(classifyValue(DEMO.dob, TODAY)).toBe("DOB");
    expect(classifyValue(DEMO.name, TODAY)).toBe("NAME");
  });

  it("does not classify a checksum-invalid Aadhaar number as AADHAAR", () => {
    expect(classifyValue(DEMO.aadhaarInvalid, TODAY)).toBe("UNKNOWN");
  });

  it("does not assert OTP from shape alone", () => {
    expect(classifyValue(DEMO.otp, TODAY)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for ordinary text", () => {
    expect(classifyValue("Submit application", TODAY)).toBe("UNKNOWN");
    expect(classifyValue("", TODAY)).toBe("UNKNOWN");
    expect(classifyValue("Punjab", TODAY)).toBe("UNKNOWN");
  });
});

describe("protection ranking", () => {
  it("orders classes by treatment: CRITICAL over SENSITIVE over PERSONAL", () => {
    expect(protectionRank("OTP")).toBeGreaterThan(protectionRank("AADHAAR"));
    expect(protectionRank("AADHAAR")).toBeGreaterThan(protectionRank("PHONE"));
    expect(protectionRank("PHONE")).toBeGreaterThan(protectionRank("NAME"));
    expect(protectionRank("NAME")).toBeGreaterThan(protectionRank("UNKNOWN"));
  });

  it("resolves any pair upward", () => {
    expect(mostProtective("PHONE", "AADHAAR")).toBe("AADHAAR");
    expect(mostProtective("AADHAAR", "PHONE")).toBe("AADHAAR");
    expect(mostProtective("UNKNOWN", "NAME")).toBe("NAME");
    expect(mostProtectiveOf(["NAME", "DOB", "AADHAAR", "UNKNOWN"])).toBe("AADHAAR");
    expect(mostProtectiveOf([])).toBe("UNKNOWN");
  });

  it("AADHAAR wins over PHONE when the field and the value disagree — the regression case", () => {
    const disagreeing = classifyObserved(
      { id: "#mobile", value: DEMO.aadhaar, label: "Mobile number", autocomplete: "tel", type: "tel", origin: ORIGIN },
      TODAY
    );
    expect(disagreeing.fieldClass).toBe("PHONE");
    expect(disagreeing.valueClass).toBe("AADHAAR");
    expect(disagreeing.effective).toBe("AADHAAR");
    expect(disagreeing.disagreement).toBe(true);
  });

  it("does not downgrade when the field is the more protective signal", () => {
    const reverse = classifyObserved(
      { id: "#aadhaar", value: DEMO.mobile, label: "Aadhaar number", origin: ORIGIN },
      TODAY
    );
    expect(reverse.fieldClass).toBe("AADHAAR");
    expect(reverse.valueClass).toBe("PHONE");
    expect(reverse.effective).toBe("AADHAAR");
  });

  it("keeps an OTP field CRITICAL whatever the value looks like", () => {
    const otpField = classifyObserved(
      { id: "#otp", value: DEMO.mobile, label: "OTP", autocomplete: "one-time-code", origin: ORIGIN },
      TODAY
    );
    expect(otpField.effective).toBe("OTP");
  });

  it("uses the value when the field says nothing", () => {
    const unlabelled = classifyObserved({ id: "#x", value: DEMO.aadhaar, origin: ORIGIN }, TODAY);
    expect(unlabelled.fieldClass).toBe("UNKNOWN");
    expect(unlabelled.effective).toBe("AADHAAR");
  });
});
