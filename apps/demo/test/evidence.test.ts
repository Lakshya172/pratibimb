/**
 * The evidence projection, checked.
 *
 * Pane 5 and the rehearsal artifact are both built from these functions, and both end up in front of
 * judges — one on a projector, one in a repository. So the tests here are mostly about what must
 * NOT come out: no value, no oracle, and no verdict the run did not reach.
 */
import { describe, expect, it } from "vitest";

import { egressEvidenceOf, headlineOf, HEADLINE_TEXT, sweep, type EgressAttempt } from "../src/evidence.js";

/** Synthetic, and built here rather than imported, so no fixture value is written into source. */
const FAKE_SECRET = "5550000001";

const sentAttempt = (over: Record<string, unknown> = {}): EgressAttempt => ({
  record: {
    requestId: "r1",
    sessionId: "s1",
    at: 0,
    destination: "http://127.0.0.1:8978/v1/chat/completions",
    transport: "LOOPBACK_HTTP",
    reasoner: "local-model",
    verified: true,
    payloadSha256: "abc123",
    payloadBytes: 2679,
    leakCheck: "CLEAN",
    references: ["<PII:PHONE:1>"],
    responseStatus: 200,
    responseBytes: 120,
    elapsedMs: 500,
    ...over,
  } as EgressAttempt["record"],
});

const run = (over: Record<string, unknown> = {}) =>
  ({
    requestId: "r1",
    sessionId: "s1",
    state: "DONE",
    refusal: null,
    fallback: null,
    act: { verification: { verification: "CONFIRMED" } },
    ...over,
  }) as never;

describe("the headline", () => {
  it("says CONFIRMED only when the page confirmed it", () => {
    expect(headlineOf(run())).toBe("CONFIRMED");
  });

  /** `DONE` means the run finished, never that the action worked. The verifier is the only oracle. */
  it("does not call a completed run a success when verification did not confirm", () => {
    expect(headlineOf(run({ act: { verification: { verification: "UNKNOWN" } } }))).toBe("NOT_CONFIRMED");
    expect(headlineOf(run({ act: { verification: { verification: "NOT_CONFIRMED" } } }))).toBe("NOT_CONFIRMED");
    expect(headlineOf(run({ act: null }))).toBe("NOT_CONFIRMED");
  });

  it("distinguishes a completed fallback from a completed model run", () => {
    expect(headlineOf(run({ fallback: { fellBack: true } }))).toBe("CONFIRMED_VIA_FALLBACK");
  });

  /**
   * The distinction the second act exists for. Both stop the run; only one means the client caught
   * the reasoner handing back a secret, and a judge must be able to tell them apart.
   */
  it("separates a caught leakage from an ordinary refusal", () => {
    const leak = run({ state: "REFUSED", refusal: { planRefusal: { literalSeverity: "LEAKAGE_EVENT" } } });
    const other = run({ state: "REFUSED", refusal: { cause: "TARGET_ABSENT_AFTER_REFRESH" } });
    expect(headlineOf(leak)).toBe("LEAKAGE_BLOCKED");
    expect(headlineOf(other)).toBe("REFUSED");
  });

  it("shows nothing before a run", () => {
    expect(headlineOf(null)).toBe("IDLE");
    expect(HEADLINE_TEXT.IDLE).toBe("");
  });

  it("gives every headline words to render", () => {
    for (const key of Object.keys(HEADLINE_TEXT)) {
      if (key !== "IDLE") expect(HEADLINE_TEXT[key as keyof typeof HEADLINE_TEXT].length).toBeGreaterThan(0);
    }
  });
});

describe("the egress evidence", () => {
  it("is nothing before a run", () => {
    expect(egressEvidenceOf(null, [])).toBeNull();
  });

  it("reports the client's digest and the peer's claim side by side", () => {
    const evidence = egressEvidenceOf(run(), [sentAttempt({ peerReceipt: { sha256: "abc123", bytes: 2679, agrees: true } })]);
    expect(evidence?.sent?.clientSha256).toBe("abc123");
    expect(evidence?.sent?.peerSha256).toBe("abc123");
    expect(evidence?.sent?.digestsAgree).toBe(true);
  });

  /**
   * A peer that said nothing is not a peer that disagreed. Rendering `null` as a mismatch would
   * put a red cross on a correct run, which on a projector is indistinguishable from a real failure.
   */
  it("reports a silent peer as no claim rather than as disagreement", () => {
    const evidence = egressEvidenceOf(run(), [sentAttempt()]);
    expect(evidence?.sent?.peerSha256).toBeNull();
    expect(evidence?.sent?.digestsAgree).toBeNull();
    expect(evidence?.sent?.digestsAgree).not.toBe(false);
  });

  it("reports a peer that disagreed as a disagreement", () => {
    const evidence = egressEvidenceOf(run(), [sentAttempt({ peerReceipt: { sha256: "different", bytes: 10, agrees: false } })]);
    expect(evidence?.sent?.digestsAgree).toBe(false);
  });

  it("records a refused send as something that did not happen", () => {
    const evidence = egressEvidenceOf(run(), [
      {
        refusal: {
          requestId: "r1",
          sessionId: "s1",
          at: 0,
          destination: "http://127.0.0.1:8978/",
          cause: "VAULT_VALUE_IN_PAYLOAD",
          stage: "LEAK_SCAN",
          severity: "LEAKAGE_EVENT",
          leakedClass: "PHONE",
          detail: "a value this client holds locally appears in the outgoing bytes.",
        },
      },
    ]);
    expect(evidence?.sent).toBeNull();
    expect(evidence?.blocked[0]?.cause).toBe("VAULT_VALUE_IN_PAYLOAD");
    expect(evidence?.blocked[0]?.leakedClass).toBe("PHONE");
  });

  /** The projection is written to files and shown on screen. It must carry no body and no value. */
  it("carries no payload body, only its measurements", () => {
    const evidence = egressEvidenceOf(run(), [sentAttempt()]);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("body");
    expect(evidence?.sent?.payloadBytes).toBe(2679);
  });
});

describe("the sweep", () => {
  it("finds a value that is present, and says how many without saying which text", () => {
    const result = sweep({ note: `the number is ${FAKE_SECRET}` }, [FAKE_SECRET, "absent-value"]);
    expect(result.clean).toBe(false);
    expect(result.found).toBe(1);
    expect(result.checked).toBe(2);
    expect(result.foundAt).toEqual([0]);
  });

  /**
   * The point of returning indices rather than matches: a failing sweep must be locatable without
   * the failure report itself becoming the leak.
   */
  it("never returns the value it was looking for", () => {
    const result = sweep(`contains ${FAKE_SECRET}`, [FAKE_SECRET]);
    expect(JSON.stringify(result)).not.toContain(FAKE_SECRET);
  });

  it("is clean when nothing is present", () => {
    expect(sweep({ token: "<PII:PHONE:1>" }, [FAKE_SECRET]).clean).toBe(true);
  });

  it("ignores empty candidates rather than matching everything", () => {
    const result = sweep({ anything: "at all" }, ["", "   "]);
    expect(result.checked).toBe(0);
    expect(result.clean).toBe(true);
  });

  it("searches structure, not just strings", () => {
    expect(sweep({ deep: { nested: [{ value: FAKE_SECRET }] } }, [FAKE_SECRET]).clean).toBe(false);
  });

  /**
   * A run record is built from live objects and really can contain a cycle. Throwing here would
   * take out the evidence pane mid-demo, and a caller that caught the throw would be one line from
   * reporting "clean" because the check could not run.
   */
  it("prunes a cycle instead of throwing, and still finds a value beyond it", () => {
    const cyclic: Record<string, unknown> = { note: `the number is ${FAKE_SECRET}` };
    cyclic["self"] = cyclic;
    expect(() => sweep(cyclic, [FAKE_SECRET])).not.toThrow();
    const result = sweep(cyclic, [FAKE_SECRET]);
    expect(result.clean).toBe(false);
    expect(result.complete).toBe(false);
  });

  it("reports a complete sweep when nothing had to be pruned", () => {
    expect(sweep({ a: 1, b: { c: 2 } }, [FAKE_SECRET]).complete).toBe(true);
  });

  it("reports a subject that serializes to nothing as checked but incomplete-safe", () => {
    // `undefined` stringifies to undefined; the sweep must not treat that as proof of cleanliness
    // for a caller that assumed it had searched something.
    const result = sweep(undefined, [FAKE_SECRET]);
    expect(result.checked).toBe(1);
    expect(result.found).toBe(0);
  });
});
