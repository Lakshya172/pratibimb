/**
 * THE EGRESS EVIDENCE PATHS, ABSENT. This is what a production build gets.
 *
 * `probe/egress-evidence.ts` holds the two experiment paths that performed a `fetch` outside
 * `@pratibimb/egress` (`CSP_PROBE`, `E4_EMIT`). `wxt.config.ts` resolves `#egress-evidence-probe` to
 * **this file** unless `EGRESS_EVIDENCE_PROBE=1` is set, so a product build contains no such path:
 * a `CSP_PROBE` or `E4_EMIT` sent to it falls through to `UNKNOWN_KIND`, and nothing is fetched.
 *
 * This file must stay free of any network primitive (QG-04 item 1; `networkBoundary.test.ts`).
 */
export function serveEgressEvidence(_msg: unknown, _sender: unknown, _sendResponse: (reply: unknown) => void): boolean {
  return false;
}
