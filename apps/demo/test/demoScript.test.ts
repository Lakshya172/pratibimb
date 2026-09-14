/**
 * The demo script, checked as a contract.
 *
 * These tests do not exercise the product. They pin the things a presenter depends on that have no
 * other guard: that an act cannot acquire a non-loopback address, that the acts a judge is shown
 * expect what the security layers actually do, and that the reset contract stays enumerated rather
 * than becoming whatever the code happens to clear.
 */
import { describe, expect, it } from "vitest";

import { ACTS, ENDPOINTS, isLoopbackUrl, RESET_CONTRACT, RUNNING_ORDER, type ActId } from "../src/demoScript.js";

describe("the demo script", () => {
  it("runs success first, because the narrative depends on it", () => {
    expect(RUNNING_ORDER[0]).toBe("SUCCESS");
    expect(RUNNING_ORDER).toEqual(["SUCCESS", "REFUSAL", "OUTAGE"]);
  });

  it("declares every act exactly once and names each one", () => {
    for (const id of RUNNING_ORDER) {
      expect(ACTS[id].id).toBe(id);
      expect(ACTS[id].label.length).toBeGreaterThan(0);
      expect(ACTS[id].blurb.length).toBeGreaterThan(0);
    }
    expect(new Set(RUNNING_ORDER).size).toBe(RUNNING_ORDER.length);
  });

  /**
   * The act the whole demo is for. If this expectation is ever relaxed — a click that is not
   * required, a rehydration that need not happen — the demo would "pass" while proving less.
   */
  it("expects the success act to restore exactly one value and reach a confirmed click", () => {
    expect(ACTS.SUCCESS.expect).toEqual({
      state: "DONE",
      verification: "CONFIRMED",
      fellBack: false,
      rehydrations: 1,
      clicks: 5,
    });
  });

  /**
   * The refusal act must expect NOTHING to have happened. A demo that showed a refusal banner while
   * a click had landed would be worse than no demo.
   */
  it("expects the refusal act to execute nothing at all", () => {
    expect(ACTS.REFUSAL.expect.state).toBe("REFUSED");
    expect(ACTS.REFUSAL.expect.verification).toBeNull();
    expect(ACTS.REFUSAL.expect.rehydrations).toBe(0);
    expect(ACTS.REFUSAL.expect.clicks).toBe(0);
  });

  /**
   * And it must NOT expect a fallback. Falling back from a refused plan would replace a caught
   * leakage event with a success — the one substitution the fallback policy exists to forbid.
   */
  it("expects the refusal act not to fall back into a working plan", () => {
    expect(ACTS.REFUSAL.expect.fellBack).toBe(false);
  });

  it("expects the outage act to fall back and still complete through every gate", () => {
    expect(ACTS.OUTAGE.expect.fellBack).toBe(true);
    expect(ACTS.OUTAGE.expect.state).toBe("DONE");
    expect(ACTS.OUTAGE.expect.verification).toBe("CONFIRMED");
    expect(ACTS.OUTAGE.expect.rehydrations).toBe(1);
  });

  it("asks a real model over a real address for the two acts that should", () => {
    expect(ACTS.SUCCESS.reasoner).toBe("local-model");
    expect(ACTS.REFUSAL.reasoner).toBe("local-model");
    expect(ACTS.SUCCESS.endpoint).toBe("model");
    expect(ACTS.REFUSAL.endpoint).toBe("hostile");
  });

  /**
   * The outage must be a refused connection, not a flag. An act that reached `unavailable`
   * in-process would prove the fallback code runs but not that a dead service produces it.
   */
  it("forces the outage with an address rather than an in-process stub", () => {
    expect(ACTS.OUTAGE.endpoint).toBe("outage");
    expect(ACTS.OUTAGE.reasoner).toBe("local-model");
  });
});

describe("every address the demo can reach is on this machine", () => {
  it("routes all three acts to loopback", () => {
    for (const url of Object.values(ENDPOINTS)) expect(isLoopbackUrl(url)).toBe(true);
  });

  it("sends the acts to three different addresses, so none can stand in for another", () => {
    expect(new Set(Object.values(ENDPOINTS)).size).toBe(3);
  });

  it.each([
    ["a remote host", "http://example.com/v1/chat/completions"],
    ["a host that merely looks local", "http://127.0.0.1.example.com/v1"],
    ["a non-http scheme", "file:///etc/passwd"],
    ["nonsense", "not a url"],
    ["an empty string", ""],
  ])("refuses %s", (_what, url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });
});

describe("the reset contract", () => {
  it("names what a presenter needs put back between acts", () => {
    expect(RESET_CONTRACT.length).toBeGreaterThanOrEqual(7);
    const text = RESET_CONTRACT.join(" | ");
    for (const required of ["confirm-mobile field is empty", "Not submitted", "fresh document identity", "Planning View shows no run"]) {
      expect(text).toContain(required);
    }
  });
});

describe("the act definitions carry no value", () => {
  /**
   * `SECURITY.md` §2: a synthetic demo value written into source is still a value in the source.
   * The acts describe behaviour; the values live in the fixture, which is where they belong.
   */
  it("contains no digit run long enough to be one of the fixture's values", () => {
    const serialized = JSON.stringify(ACTS);
    expect(serialized).not.toMatch(/\d{6,}/);
    expect(serialized.toLowerCase()).not.toContain("ramesh");
  });
});

describe("an act cannot be added without an expectation", () => {
  it("gives every act a complete, checkable expectation", () => {
    for (const id of Object.keys(ACTS) as ActId[]) {
      const { expect: e } = ACTS[id];
      expect(typeof e.state).toBe("string");
      expect(typeof e.fellBack).toBe("boolean");
      expect(Number.isInteger(e.rehydrations)).toBe(true);
      expect(Number.isInteger(e.clicks)).toBe(true);
    }
  });
});
