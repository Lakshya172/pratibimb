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

/**
 * ADR-0013 — THE AMENDED POLICY (version 2). ADR-0001's v1 above is kept unchanged, as the record of
 * what was approved then; the extension builds this one.
 *
 * M12 measured (F-M12-1) that v1 pins `connect-src` but leaves every other fetch directive open: code
 * injected into the offscreen document reached a foreign origin with an `<img>` and an `<iframe>`.
 * v2 starts from `default-src 'none'`, so EVERY fetch directive that is not named is closed — img,
 * media, font, frame/child, manifest, object — and names only what the extension's own pages load:
 *
 *   script-src 'self' 'wasm-unsafe-eval'   unchanged from v1 (the packaged chunks, ORT, the TR-01 worker's
 *                                          importScripts; WASM compile)
 *   worker-src 'self'                      the packaged TR-01 worker
 *   connect-src 'self' <sources>           packaged model/ORT reads, plus the build's network sources —
 *                                          each an origin or an EXACT path, never a wildcard
 *   style-src <hashes> | 'none'            the side panel's one inline <style>, by its SHA-256
 *   object-src 'none'                      stricter than v1's 'self'
 *   base-uri 'none'; form-action 'none'    not fetch directives, so `default-src` does not cover them
 *
 * There is no permissive mode and no way to add a directive by argument.
 */
export const CSP_POLICY_VERSION = 2 as const;

/** An origin, or an origin and an exact path. No wildcard, query, fragment or trailing slash. */
const CONNECT_SOURCE = /^https?:\/\/[^/\s*?#]+(\/[^\s*?#]*[^/\s*?#])?$/;
const STYLE_HASH = /^'sha256-[A-Za-z0-9+/]{43}='$/;

export interface ExtensionPagesCspV2 {
  /** Network sources beyond 'self'. A product build passes the reasoner endpoint; an evidence build may add its test sink. */
  readonly connect: readonly string[];
  /** `'sha256-…'` of each inline <style> an extension page carries. */
  readonly styleHashes: readonly string[];
}

export function buildExtensionPagesCspV2(input: ExtensionPagesCspV2): string {
  for (const source of input.connect) {
    if (typeof source !== "string" || source.includes("*")) throw new CspConfigurationError(`wildcard or non-string connect source rejected: ${String(source)}`);
    if (!CONNECT_SOURCE.test(source)) throw new CspConfigurationError(`not an origin or an exact path: ${source}`);
  }
  for (const hash of input.styleHashes) {
    if (!STYLE_HASH.test(hash)) throw new CspConfigurationError(`not a 'sha256-…' style hash: ${hash}`);
  }
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    ["connect-src 'self'", ...input.connect].join(" "),
    input.styleHashes.length > 0 ? ["style-src", ...input.styleHashes].join(" ") : "style-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** The CSP hash source of an inline <style> element's exact text content. */
export async function styleHashSource(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let bin = "";
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return `'sha256-${btoa(bin)}'`;
}
