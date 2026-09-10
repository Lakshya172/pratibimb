/**
 * @pratibimb/security — the ADR-0001 CSP and ORT runtime-pin boundary.
 *
 * Two DIFFERENT boundaries live here and must not be conflated:
 *
 *   connect-src (csp.ts)          PROVENANCE      where bytes may come from.
 *                                                 Network layer, pre-wire.
 *   SHA-256 pin (ortRuntimePin)   BYTE IDENTITY   what the bytes are.
 *                                                 Application layer, post-retrieval.
 *
 * Measured: the pin accepts byte-identical WebAssembly from a foreign origin, and
 * connect-src accepts any bytes from the pinned origin. Neither substitutes for the other.
 */
export {
  buildExtensionPagesCsp,
  assertApprovedCsp,
  CspConfigurationError,
} from "./csp.js";

export {
  installVerifiedOrtRuntime,
  createPinnedInferenceSession,
  assertOrtRuntimePinned,
  getInstalledPin,
  OrtRuntimePinError,
  __resetRealmStateForTests,
  type OrtLike,
  type OrtWasmEnv,
  type InstallOptions,
  type InstalledPin,
} from "./ortRuntimePin.js";

export {
  assertWasmCompilationAllowed,
  WasmCapabilityError,
  type WasmCapabilityReport,
} from "./wasmCapability.js";

export { ORT_PIN, ORT_PIN_EVIDENCE, type OrtArtifactPin, type OrtPin } from "./generated/ortPin.js";
