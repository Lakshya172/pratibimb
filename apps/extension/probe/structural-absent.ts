/**
 * THE STRUCTURAL PROBE, ABSENT. This is what a production build gets.
 *
 * `apps/extension/probe/structural.ts` drives constitution §6's stale-observation path one step at
 * a time, so an evidence run can take a reading, change the page itself, and only then ask the
 * gates to act. M6.1 needed that because the refusal it demonstrates lives in a window a
 * whole-run harness cannot open on purpose.
 *
 * It added no authority — `guardedAct` there is the unchanged gate composition on the same
 * transport cycle a product run uses — and it was refused from a tab. Neither is the point. It was
 * a test-only control operation reachable in the shipped bundle, and "harmless" is an argument
 * about consequences rather than about what belongs in a product. The same reasoning removed the
 * E6 mechanisms in M3: see `e6/absent.ts`, whose wording this follows deliberately.
 *
 * So it is no longer in the bundle. `wxt.config.ts` resolves `#structural-probe` to **this file**
 * unless `STRUCTURAL_PROBE=1` is set for the build, and the only caller that sets it is
 * `tests/browser/extension/run-structural-stale.mjs`.
 *
 * WHAT IS NOT AFFECTED. The structural signal itself — the observers in `page-surface-dom.ts`, the
 * counters in the page agent, the `STRUCTURE` op, and the `OBSERVATION_STALE` refusal in the
 * freshness validator — is product code and is untouched by this flag. The probe only ever drove
 * it. A build with the flag and a build without it produce a byte-identical `content.js`, which the
 * evidence record checks rather than asserts.
 *
 * This file must stay free of any driver. It is not a disabled probe; there is no probe.
 */

/**
 * Take nothing.
 *
 * `false` means "this message is not mine", so the caller falls through to its own handling — a
 * `STRUCTURAL_PROBE` sent to a production build is answered exactly as a message kind that was
 * never defined would be, which is what it now is.
 */
export function serveStructuralProbe(
  _relay: unknown,
  _message: unknown,
  _sender: unknown,
  _sendResponse: (reply: unknown) => void
): boolean {
  return false;
}
