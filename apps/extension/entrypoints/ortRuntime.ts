/**
 * The ONLY sanctioned way to bring ORT up in a PratiBimb realm.
 *
 * ADR-0001 C-1 in one sentence: the verified `wasmBinary` must be installed before the
 * first ORT session in each JS realm, because ORT caches its WebAssembly module per realm
 * and a later install is silently ignored.
 *
 * The ordering is enforced by construction rather than by convention:
 *
 *   1. assert the CSP actually permits WebAssembly here   (G1, compile() not validate())
 *   2. fetch the packaged artifact, hash it, compare to the build-time pin
 *   3. hand ORT the exact verified buffer
 *   4. only now may a session be created, and only via createPinnedInferenceSession
 *
 * Any failure throws. There is no degraded path: with no verified runtime there is no
 * perception tier, and running on without one would be exactly the silent degradation
 * ENGINEERING_PRINCIPLES §7 forbids.
 */

import {
  assertWasmCompilationAllowed,
  installVerifiedOrtRuntime,
  createPinnedInferenceSession,
  type OrtLike,
  type InstalledPin,
  type WasmCapabilityReport,
} from "@pratibimb/security";

/**
 * Resolve a packaged asset from within THIS realm.
 *
 * A relative resolution against the current script's own location is required rather than
 * `chrome.runtime.getURL`: that API is undefined inside a dedicated worker (measured in
 * W1-S02a-2a-1), which is precisely where inference runs.
 */
export function resolvePackagedAsset(fileName: string): string {
  return new URL(fileName, self.location.href).href;
}

export interface RealmBootstrap {
  readonly context: string;
  readonly capability: WasmCapabilityReport;
  readonly pin: InstalledPin;
}

/**
 * Bring up a realm for inference. Call once, before anything touches ORT.
 *
 * @param context human label for the realm, used in error messages and the ledger
 * @param ort     the ORT module for this realm
 */
export async function bootstrapOrtRealm(context: string, ort: OrtLike): Promise<RealmBootstrap> {
  // 1 — G1. Assert the capability before doing any work that assumes it. On Firefox a
  //     wrong or withdrawn directive fails SILENTLY, so this is the only thing that turns
  //     "the tier never ran" into a diagnosable error.
  const capability = await assertWasmCompilationAllowed(context);

  // Deterministic runtime settings. numThreads = 1 keeps the artifact set to exactly what
  // the pin covers; the threaded path spawns workers that may fetch further assets and is
  // an open question (S-02a-2a-3a), so it is not enabled here.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = "error";

  // 2 + 3 — verify, then install. installVerifiedOrtRuntime refuses on mismatch BEFORE
  //         ORT is touched, and refuses entirely if this realm already used ORT.
  const pin = await installVerifiedOrtRuntime({ ort, resolveAssetUrl: resolvePackagedAsset });

  return { context, capability, pin };
}

/**
 * Re-exported so callers never reach for `ort.InferenceSession.create` directly — that
 * path bypasses the C-1 guard, and the lint rule in the extension config forbids it.
 */
export { createPinnedInferenceSession };
