/**
 * The memory-only vault: what it stores, what it refuses, and what it will not tell you.
 *
 * The enumeration test is the one that matters beyond the type system — the internals are ECMAScript
 * private fields, so "you cannot walk the contents" is a property of the object at runtime and not a
 * promise the compiler makes.
 */
import { describe, expect, it } from "vitest";
import { createVault, parseToken } from "../src/index.js";
import { DEMO, ORIGIN } from "./support/demoFixture.js";

const vaultAt = (origin = ORIGIN, sessionId = "session-1") =>
  createVault({ sessionId, origin, now: () => 1_760_000_000_000 });

describe("issuance", () => {
  it("issues a well-formed reference for a tokenisable class", () => {
    const vault = vaultAt();
    const stored = vault.store({ piiClass: "PHONE", value: DEMO.mobile, target: "#mobile" });
    expect(stored.issued).toBe(true);
    if (!stored.issued) return;
    expect(stored.ref).toBe("<PII:PHONE:1>");
    expect(parseToken(stored.ref)).toEqual({ piiClass: "PHONE", ordinal: 1 });
    expect(stored.tier).toBe("PERSONAL");
  });

  it("never tokenises an OTP — the refusal is at issuance, so nothing exists to spend later", () => {
    const vault = vaultAt();
    const stored = vault.store({ piiClass: "OTP", value: DEMO.otp, target: "#otp" });
    expect(stored).toEqual({ issued: false, cause: "CRITICAL_NOT_TOKENISED" });
    expect(vault.size).toBe(0);
    expect(vault.has("<PII:OTP:1>")).toBe(false);
  });

  it("refuses an unclassified value and an empty one", () => {
    const vault = vaultAt();
    expect(vault.store({ piiClass: "UNKNOWN", value: "whatever" })).toEqual({ issued: false, cause: "UNKNOWN_CLASS" });
    expect(vault.store({ piiClass: "PHONE", value: "   " })).toEqual({ issued: false, cause: "EMPTY_VALUE" });
  });

  it("gives the same value two references, so a token cannot reveal that two secrets are equal", () => {
    const vault = vaultAt();
    const first = vault.store({ piiClass: "PHONE", value: DEMO.mobile });
    const second = vault.store({ piiClass: "PHONE", value: DEMO.mobile });
    expect(first.issued && second.issued && first.ref).not.toBe(second.issued && second.ref);
    expect(vault.size).toBe(2);
  });

  it("puts nothing derived from the value into the reference", () => {
    const vault = vaultAt();
    const stored = vault.store({ piiClass: "AADHAAR", value: DEMO.aadhaar });
    expect(stored.issued).toBe(true);
    if (!stored.issued) return;
    const digits = DEMO.aadhaar.replace(/\s/g, "");
    for (let start = 0; start + 3 <= digits.length; start += 1) {
      expect(stored.ref).not.toContain(digits.slice(start, start + 3));
    }
  });
});

describe("lookup", () => {
  it("answers about a reference it issued, without the value", () => {
    const vault = vaultAt();
    const stored = vault.store({ piiClass: "PHONE", value: DEMO.mobile, target: "#mobile", fingerprint: "fp" });
    if (!stored.issued) throw new Error("test setup");
    const descriptor = vault.describe(stored.ref);
    expect(descriptor).not.toBeNull();
    expect(descriptor?.piiClass).toBe("PHONE");
    expect(descriptor?.target).toBe("#mobile");
    expect(JSON.stringify(descriptor)).not.toContain(DEMO.mobile);
    expect(Object.values(descriptor ?? {})).not.toContain(DEMO.mobile);
  });

  it("refuses to guess at an unknown or malformed reference", () => {
    const vault = vaultAt();
    vault.store({ piiClass: "PHONE", value: DEMO.mobile });
    expect(vault.has("<PII:PHONE:2>")).toBe(false);
    expect(vault.describe("<PII:PHONE:2>")).toBeNull();
    expect(vault.has("PII:PHONE:1")).toBe(false);
    expect(vault.describe(42)).toBeNull();
  });

  it("offers no way to walk its contents", () => {
    const vault = vaultAt();
    vault.store({ piiClass: "PHONE", value: DEMO.mobile });
    const reachable = vault as unknown as Record<string, unknown>;
    for (const name of ["entries", "values", "keys", "forEach", "list", "refs", "all", "dump"]) {
      expect(typeof reachable[name]).not.toBe("function");
    }
    expect(reachable["entries"]).toBeUndefined();
    expect(Object.keys(vault)).toEqual(["sessionId", "origin"]);
    expect(JSON.stringify(vault)).not.toContain(DEMO.mobile);
    expect(JSON.parse(JSON.stringify(vault))).toEqual({
      sessionId: "session-1",
      origin: ORIGIN,
      refs: 1,
      destroyed: false,
    });
  });

  it("does not share references with another session's vault", () => {
    const first = vaultAt(ORIGIN, "session-1");
    const stored = first.store({ piiClass: "PHONE", value: DEMO.mobile });
    if (!stored.issued) throw new Error("test setup");
    const second = vaultAt(ORIGIN, "session-2");
    expect(second.has(stored.ref)).toBe(false);
    expect(second.describe(stored.ref)).toBeNull();
  });
});

describe("consumption", () => {
  it("spends a reference once", () => {
    const vault = vaultAt();
    const stored = vault.store({ piiClass: "PHONE", value: DEMO.mobile });
    if (!stored.issued) throw new Error("test setup");
    expect(vault.consume(stored.ref)).toBe(true);
    expect(vault.consume(stored.ref)).toBe(false);
    expect(vault.describe(stored.ref)?.consumed).toBe(true);
  });
});

describe("destruction", () => {
  it("destroys everything on an origin change, before answering", () => {
    const vault = vaultAt();
    vault.store({ piiClass: "PHONE", value: DEMO.mobile });
    expect(vault.enforceOrigin("http://127.0.0.1:9999")).toBe(false);
    expect(vault.isDestroyed).toBe(true);
    expect(vault.size).toBe(0);
    expect(vault.holdsLiteral(DEMO.mobile)).toEqual({ held: false });
    expect(vault.store({ piiClass: "PHONE", value: DEMO.mobile })).toEqual({ issued: false, cause: "VAULT_DESTROYED" });
  });

  it("keeps working while the origin is unchanged", () => {
    const vault = vaultAt();
    expect(vault.enforceOrigin(ORIGIN)).toBe(true);
    expect(vault.isDestroyed).toBe(false);
  });
});

describe("the literal check", () => {
  const held = () => {
    const vault = vaultAt();
    vault.store({ piiClass: "PHONE", value: DEMO.mobile });
    vault.store({ piiClass: "AADHAAR", value: DEMO.aadhaar });
    vault.store({ piiClass: "NAME", value: DEMO.name });
    return vault;
  };

  it("recognises a value it holds, exactly", () => {
    expect(held().holdsLiteral(DEMO.mobile)).toEqual({ held: true, piiClass: "PHONE" });
  });

  it("recognises it written differently", () => {
    const vault = held();
    expect(vault.holdsLiteral("+91 90000-00001").held).toBe(true);
    expect(vault.holdsLiteral("my number is 9000000001, call me").held).toBe(true);
    expect(vault.holdsLiteral("9OOOOOOOO1").held).toBe(true); // letter-for-digit confusion
    expect(vault.holdsLiteral("234567890124").held).toBe(true);
    expect(vault.holdsLiteral("  ramesh   kumar  ").held).toBe(true);
  });

  it("does not fire on values it does not hold", () => {
    const vault = held();
    expect(vault.holdsLiteral("Submit").held).toBe(false);
    expect(vault.holdsLiteral("9000000002").held).toBe(false);
    expect(vault.holdsLiteral("Punjab").held).toBe(false);
    expect(vault.holdsLiteral("").held).toBe(false);
  });

  it("names the class and never the value", () => {
    const answer = held().holdsLiteral(DEMO.aadhaar);
    expect(answer).toEqual({ held: true, piiClass: "AADHAAR" });
    expect(JSON.stringify(answer)).not.toContain("2345");
  });
});
