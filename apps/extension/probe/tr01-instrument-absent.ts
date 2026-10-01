/**
 * THE TR-01 WORKER INSTRUMENT, ABSENT. This is what a production build gets.
 *
 * `probe/tr01-instrument.ts` wraps `WebAssembly.Memory` and the worker's network entry points so an
 * evidence run can READ the detector worker's linear memory and its fetch arrivals rather than infer
 * them. That is measurement code, and measurement code does not ship: `wxt.config.ts` resolves
 * `#tr01-instrument` to **this file** unless `TR01_PROBE=1` is set for the build — the same rule
 * `#e6-probe` and `#structural-probe` follow.
 *
 * This file must stay free of any hook. It is not a disabled instrument; there is no instrument.
 */

/** Install nothing. */
export function installInstrument(): void {}

/** Take nothing: `false` means "not mine", so every message goes to the detector core. */
export function serveInstrument(_message: unknown, _post: (reply: unknown) => void): boolean {
  return false;
}
