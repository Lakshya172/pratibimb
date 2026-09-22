/**
 * The release authority, refusal by refusal.
 *
 * These are the M1 security properties stated as executable tests. Every one of them asserts a
 * REFUSAL, because a capability system is only worth what it declines: "the right document gets its
 * value" is one test here and the other seventeen are the ways it must not work.
 *
 * They run in Node, with the clock and the nonce source injected, so the expiry and reuse properties
 * are decided rather than waited for — and so a property that a browser run can only demonstrate
 * once is checked on every `npm test`.
 */
import { describe, expect, it } from "vitest";

import { createReleaseAuthority, type AttestedAsker, type ReleaseBinding } from "../host-lib/value-release";

const DOC: ReleaseBinding = { tabId: 7, frameId: 0, documentId: "doc-A" };
const ASKER: AttestedAsker = { tabId: 7, frameId: 0, documentId: "doc-A" };
const TARGET = "#mobile_confirm";
const VALUE = "9000000001"; // synthetic canary, the same shape E6 used (SECURITY.md §2)

/** A fixed clock and a counting nonce source: nothing here depends on wall time or randomness. */
const authority = (startAt = 1_000) => {
  let t = startAt;
  let n = 0;
  return {
    release: createReleaseAuthority({ now: () => t, newNonce: () => `nonce-${(n += 1)}` }),
    advance: (ms: number) => (t += ms),
  };
};

describe("the one-shot value release", () => {
  it("releases to the document it was armed for, for the target it was armed for", () => {
    const { release } = authority();
    const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
    expect(release.redeem(nonce, TARGET, ASKER)).toEqual({ released: true, payload: VALUE, target: TARGET });
  });

  it("does not put the value in the nonce", () => {
    const { release } = authority();
    const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
    // The nonce is what crosses the service worker. If the value were derivable from it the whole
    // inversion would be pointless.
    expect(nonce).not.toContain(VALUE);
    expect(JSON.stringify(nonce)).not.toContain(VALUE);
  });

  describe("reuse", () => {
    it("refuses a second redemption of a nonce that worked", () => {
      const { release } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      expect(release.redeem(nonce, TARGET, ASKER).released).toBe(true);
      expect(release.redeem(nonce, TARGET, ASKER)).toEqual({ released: false, refused: "UNKNOWN_OR_CONSUMED_NONCE" });
    });

    it("spends a nonce even when the attempt is refused, so a wrong asker gets no second try", () => {
      const { release } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      expect(release.redeem(nonce, TARGET, { ...ASKER, documentId: "doc-B" }).released).toBe(false);
      // Now the RIGHT document asks. It is still refused: the capability is gone.
      expect(release.redeem(nonce, TARGET, ASKER)).toEqual({ released: false, refused: "UNKNOWN_OR_CONSUMED_NONCE" });
    });

    it("refuses a nonce that was never armed", () => {
      const { release } = authority();
      expect(release.redeem("nonce-guessed", TARGET, ASKER)).toEqual({
        released: false,
        refused: "UNKNOWN_OR_CONSUMED_NONCE",
      });
    });
  });

  describe("the document it is bound to", () => {
    it("refuses another document in the same tab and frame", () => {
      const { release } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      // What a reload produces: same tab, same frame, new document.
      expect(release.redeem(nonce, TARGET, { ...ASKER, documentId: "doc-B" })).toEqual({
        released: false,
        refused: "SENDER_DOCUMENT_MISMATCH",
      });
    });

    it("refuses another frame", () => {
      const { release } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      expect(release.redeem(nonce, TARGET, { ...ASKER, frameId: 1 })).toEqual({
        released: false,
        refused: "SENDER_DOCUMENT_MISMATCH",
      });
    });

    it("refuses another tab", () => {
      const { release } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      expect(release.redeem(nonce, TARGET, { ...ASKER, tabId: 8 })).toEqual({
        released: false,
        refused: "SENDER_DOCUMENT_MISMATCH",
      });
    });

    it("refuses an asker the browser did not fully attest", () => {
      for (const missing of [{ tabId: null }, { frameId: null }, { documentId: null }] as const) {
        const { release } = authority();
        const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
        expect(release.redeem(nonce, TARGET, { ...ASKER, ...missing })).toEqual({
          released: false,
          refused: "SENDER_DOCUMENT_MISMATCH",
        });
      }
    });
  });

  describe("the target it is bound to", () => {
    it("refuses the right document asking for a different field", () => {
      const { release } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      expect(release.redeem(nonce, "#aadhaar", ASKER)).toEqual({ released: false, refused: "TARGET_MISMATCH" });
    });

    it("spends the capability on a target mismatch too", () => {
      const { release } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      release.redeem(nonce, "#aadhaar", ASKER);
      expect(release.redeem(nonce, TARGET, ASKER)).toEqual({ released: false, refused: "UNKNOWN_OR_CONSUMED_NONCE" });
    });
  });

  describe("expiry", () => {
    it("refuses after the deadline", () => {
      const { release, advance } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      advance(5_000);
      expect(release.redeem(nonce, TARGET, ASKER)).toEqual({ released: false, refused: "NONCE_EXPIRED" });
    });

    it("releases up to, but not at, the deadline", () => {
      const { release, advance } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      advance(4_999);
      expect(release.redeem(nonce, TARGET, ASKER).released).toBe(true);
    });

    it("reports expiry before identity, so a stale capability cannot be probed", () => {
      const { release, advance } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      advance(6_000);
      // A wrong document AND expired. The answer must not disclose which document it named.
      expect(release.redeem(nonce, TARGET, { ...ASKER, documentId: "doc-B" })).toEqual({
        released: false,
        refused: "NONCE_EXPIRED",
      });
    });

    it("spends an expired capability rather than leaving it to be found later", () => {
      const { release, advance } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      advance(6_000);
      release.redeem(nonce, TARGET, ASKER);
      expect(release.armedCount()).toBe(0);
    });
  });

  describe("what the run leaves behind", () => {
    it("holds nothing once a capability is used", () => {
      const { release } = authority();
      release.redeem(release.arm(DOC, TARGET, VALUE, 5_000), TARGET, ASKER);
      expect(release.armedCount()).toBe(0);
    });

    it("revokes everything outstanding and says how many there were", () => {
      const { release } = authority();
      release.arm(DOC, TARGET, VALUE, 5_000);
      release.arm(DOC, "#other", VALUE, 5_000);
      expect(release.revokeAll()).toBe(2);
      expect(release.armedCount()).toBe(0);
    });

    it("refuses a capability that was revoked before it was presented", () => {
      const { release } = authority();
      const nonce = release.arm(DOC, TARGET, VALUE, 5_000);
      release.revokeAll();
      expect(release.redeem(nonce, TARGET, ASKER)).toEqual({ released: false, refused: "UNKNOWN_OR_CONSUMED_NONCE" });
    });

    it("keeps capabilities separate: spending one does not spend another", () => {
      const { release } = authority();
      const first = release.arm(DOC, TARGET, VALUE, 5_000);
      const second = release.arm(DOC, "#other", "482913", 5_000);
      release.redeem(first, TARGET, ASKER);
      expect(release.redeem(second, "#other", ASKER)).toEqual({ released: true, payload: "482913", target: "#other" });
    });
  });
});
