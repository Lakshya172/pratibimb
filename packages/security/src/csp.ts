/**
 * ADR-0001 §7.1 and §7.2 — the approved extension_pages Content Security Policy.
 *
 * APPROVED at the architectural decision level. Every clause is measured, not chosen by
 * preference:
 *
 *   script-src 'self' 'wasm-unsafe-eval'
 *       'wasm-unsafe-eval' is the ONLY token Chrome MV3 accepts for WebAssembly
 *       (W1-S02a-2b-1: 'wasm-eval' and 'unsafe-eval' stop the extension loading; Firefox
 *       accepts them but they are inert). It is measurably NARROW — across 60
 *       context-observations on Chromium, Edge and Firefox it never widened `eval`,
 *       `new Function` or string-`setTimeout`, so INV-15 and INV-16 are preserved.
 *
 *   connect-src 'self' <server origin>
 *       Invariant E enforcement mechanism (3). W1-S02a-2a-4 measured that this blocks
 *       foreign-origin WebAssembly at the NETWORK layer, before the request reaches the
 *       wire — 0 arrivals at an independently instrumented foreign origin.
 *
 * THE TWO BOUNDARIES ARE DIFFERENT AND NEITHER SUBSTITUTES FOR THE OTHER:
 *
 *   connect-src  -> PROVENANCE. Where bytes may come from. Network layer, pre-wire.
 *                   Blind to what the bytes contain.
 *   SHA-256 pin  -> EXACT-BYTE IDENTITY. What the bytes are. Application layer,
 *                   post-retrieval. Blind to where they came from.
 *
 * W1-S02a-2a-4 proved the second half of that the hard way: with connect-src unpinned, the
 * hash pin ACCEPTED byte-identical WebAssembly served from a foreign origin. A content
 * hash cannot express provenance.
 */

/** A concrete origin: scheme + host + optional port, and nothing else. */
const ORIGIN = /^https?:\/\/[^/\s]+$/;

export class CspConfigurationError extends Error {
  override readonly name = "CspConfigurationError";
}

/**
 * Build the approved `extension_pages` policy for one configured server origin.
 *
 * Fails closed on anything that would widen the policy: a wildcard, a path, a trailing
 * slash, a scheme-only value, or an empty origin. There is deliberately no "permissive"
 * mode and no way to append additional sources.
 */
export function buildExtensionPagesCsp(serverOrigin: string): string {
  if (typeof serverOrigin !== "string" || serverOrigin.trim() === "") {
    throw new CspConfigurationError("server origin is required; connect-src must be pinned");
  }
  const origin = serverOrigin.trim();

  if (origin.includes("*")) {
    throw new CspConfigurationError(
      `wildcard origin rejected: ${origin} — ADR-0001 §7.2 pins connect-src with no wildcard`
    );
  }
  if (!ORIGIN.test(origin)) {
    throw new CspConfigurationError(
      `not a bare origin: ${origin} — expected scheme://host[:port] with no path or trailing slash`
    );
  }
  return [
    "script-src 'self' 'wasm-unsafe-eval'",
    "object-src 'self'",
    `connect-src 'self' ${origin}`,
  ].join("; ");
}

/**
 * Assert that a policy string is exactly the approved shape for the given origin.
 * Used by the manifest test and by CI, so a hand-edited manifest cannot drift.
 */
export function assertApprovedCsp(policy: string, serverOrigin: string): void {
  const expected = buildExtensionPagesCsp(serverOrigin);
  if (policy !== expected) {
    throw new CspConfigurationError(
      `extension_pages CSP is not the ADR-0001 approved policy.\n  expected: ${expected}\n  actual:   ${policy}`
    );
  }
}
