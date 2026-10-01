/**
 * THE TR-01 PROBE, ABSENT. This is what a production build gets.
 *
 * `probe/tr01.ts` lets an evidence run drive the detector worker from the offscreen document step by
 * step — create, initialise, detect on a supplied frame, terminate, recreate — and, from M10.6, drive
 * the product perception pass and verify its sanitized frame. It also supplies an instrumented worker
 * spawn and a pre-fill digest hook. It adds no authority, but it is test-only control and measurement,
 * so `wxt.config.ts` resolves `#tr01-probe` to **this file** unless `TR01_PROBE=1` is set, following
 * `#structural-probe` and `#e6-probe`.
 *
 * This file must stay free of any driver. It is not a disabled probe; there is no probe.
 */

/** No seam: the product spawns its own worker and has no verification hook. */
export const tr01Seam = null;

/** Take nothing: a `TR01_PROBE` sent to a product build is answered as an unknown kind would be. */
export function serveTr01Probe(_message: unknown, _sender: unknown, _sendResponse: (reply: unknown) => void, _context?: unknown): boolean {
  return false;
}
