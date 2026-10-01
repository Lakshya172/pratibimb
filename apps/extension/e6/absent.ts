/**
 * THE E6 PROBE, ABSENT. This is what a production build gets.
 *
 * `apps/extension/e6/probe.ts` holds a pointer/mouse sequence and three text-insertion mechanisms
 * that E6 measured. None of them consults a permit, a hit test, a plan, a target binding or a
 * document binding: E6 was capability discovery — *what can a content script do at all* — and the
 * answer to that question is deliberately not an authority.
 *
 * It was reachable in the shipped bundle until M3, behind the service worker's test-only control
 * plane. That is a real second execution path, and "no page can reach it" is an argument about
 * reachability rather than about capability. So it is no longer in the bundle: `wxt.config.ts`
 * resolves `#e6-probe` to **this file** unless `E6_PROBE=1` is set for the build, and the only
 * caller of that flag is E6's own harness.
 *
 * WHAT THIS MEANS CONCRETELY. A production `content.js` contains no `PointerEvent` construction
 * outside `page-surface-dom.ts`'s `prepareClick` — the one route ACT reaches, through a permit
 * minted from an attested ALLOW and an attested MATCH. Two tests check that, one over the source
 * the bundle is built from and one over the built bundle itself.
 *
 * This file must stay free of any dispatch. It is not a disabled mechanism; there is no mechanism.
 */

/**
 * Take nothing.
 *
 * `false` means "this message is not mine", so the caller falls through to its own
 * `UNKNOWN_KIND`. An `E6_CLICK` sent to a production build is answered exactly as a message kind
 * that was never defined would be, which is what it now is.
 */
export function serveE6(_message: unknown, _sendResponse: (reply: unknown) => void): boolean {
  return false;
}
