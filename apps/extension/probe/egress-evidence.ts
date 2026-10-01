/**
 * M12 — THE HOST'S EGRESS EVIDENCE PATHS. TEST BUILDS ONLY (`EGRESS_EVIDENCE_PROBE=1`).
 *
 * Two experiments needed the offscreen document itself to emit a request:
 *   - `CSP_PROBE` (ADR-0001's G-mv3-host gates): one POST to an allowed origin and one to a foreign
 *     one, to measure what `connect-src` blocks;
 *   - `E4_EMIT` (E4-offscreen): one harness-built request to the E4 loopback collector, so its bytes
 *     leave from the cell the product would send from.
 *
 * Both perform a `fetch` outside `@pratibimb/egress`. QG-04 item 1 and Invariant E forbid that in a
 * product, so they live here, behind the same build-time alias rule as `#tr01-probe` and
 * `#e6-probe`. A product build resolves `#egress-evidence-probe` to `egress-evidence-absent.ts`,
 * which contains no network code; the evidence records they produced are unchanged.
 */
import type { ToOffscreen } from "../host-lib/messages";

async function cspProbe(allowed: string, foreign: string) {
  const attempt = async (url: string) => {
    try {
      const r = await fetch(url, { method: "POST", body: "host-csp-probe" });
      return { reached: true, status: r.status };
    } catch (e) {
      return { reached: false, error: e instanceof Error ? e.name : String(e) };
    }
  };
  return { allowed: await attempt(allowed), foreign: await attempt(foreign) };
}

/**
 * EXPERIMENT E4-offscreen — emit ONE request, built elsewhere, from this document.
 *
 * The harness builds every byte (URL, method, headers, body) with E4's own code; this document only
 * performs the fetch. It reaches only the E4 loopback collector, which is also the manifest's one
 * pinned connect-src origin. The payloads are synthetic canaries, never vault values.
 */
const E4_COLLECTOR = "http://127.0.0.1:8995/";

async function e4Emit(msg: { url: string; method: string; headers: Readonly<Record<string, string>>; bodyB64: string | null }) {
  if (typeof msg.url !== "string" || !msg.url.startsWith(E4_COLLECTOR)) return { refused: "NOT_THE_E4_COLLECTOR" };
  // Spread rather than `body: undefined`: under `exactOptionalPropertyTypes` an explicit
  // `undefined` is not the same as an absent property, and `RequestInit.body` does not accept it.
  const body = msg.bodyB64 === null ? {} : { body: Uint8Array.from(atob(msg.bodyB64), (c) => c.charCodeAt(0)) };
  const emitter = location.href;
  const t0 = performance.now();
  try {
    const r = await fetch(msg.url, { method: msg.method, headers: msg.headers, ...body });
    return { settled: "resolved", status: r.status, emitter, ms: performance.now() - t0 };
  } catch (e) {
    return { settled: "rejected", fetchError: e instanceof Error ? `${e.name}: ${e.message}` : String(e), emitter, ms: performance.now() - t0 };
  }
}

/** Handles `CSP_PROBE` and `E4_EMIT`; `false` for anything else. */
export function serveEgressEvidence(msg: ToOffscreen, sender: { tab?: unknown }, sendResponse: (reply: unknown) => void): boolean {
  if (msg.kind === "CSP_PROBE") {
    void cspProbe(msg.allowed, msg.foreign).then(sendResponse);
    return true;
  }
  if (msg.kind === "E4_EMIT") {
    if (sender.tab) {
      sendResponse({ refused: "EMIT_ONLY_FROM_SERVICE_WORKER" });
      return true;
    }
    void e4Emit(msg).then(sendResponse);
    return true;
  }
  return false;
}
