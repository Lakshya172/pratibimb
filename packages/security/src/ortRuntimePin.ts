/**
 * ADR-0001 §7.3 — the ORT WebAssembly runtime pin, and the C-1 realm guard.
 *
 * THE PROPERTY THIS ENFORCES:
 *
 *     EXACT BYTES HASHED  ==  EXACT BYTES EXECUTED
 *
 * Measured in W1-S02a-2a-3 on Chromium 151 and Firefox 155, 3 runs each: with
 * `ort.env.wasm.wasmBinary` set to a verified buffer, ORT performs ZERO fetches of the
 * artifact, and handing it deliberately corrupt bytes makes session creation fail with a
 * genuine `CompileError` — which is what proves ORT consumed our buffer rather than
 * ignoring it.
 *
 * THIS IS NOT A PROVENANCE CONTROL. A content hash cannot express origin: in the
 * S-02a-2a-4 control the pin happily accepted byte-identical WebAssembly served from a
 * foreign origin. Provenance is `connect-src` (see ./csp.ts). Both, or neither.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * C-1 — THE REALM GUARD, and why it is code rather than a comment.
 *
 * ORT initialises its WebAssembly module ONCE PER JS REALM and caches it. Setting
 * `wasmBinary` after the first session in a realm is silently ignored, leaving that realm
 * unpinned for its entire lifetime. "Install the pin before the first session" is an
 * ordering convention, and ordering conventions decay. So it is asserted:
 *
 *   - `installVerifiedOrtRuntime()` REFUSES to run if a session was already created here.
 *   - `createPinnedInferenceSession()` REFUSES to create a session if no pin is installed.
 *
 * Every failure path throws. There is no degraded mode, no warning-and-continue, and no
 * option to disable the guard.
 */

import { ORT_PIN, ORT_PIN_EVIDENCE } from "./generated/ortPin.js";

/* ── Minimal structural view of ORT ────────────────────────────────────────────────
 * Deliberately structural rather than importing onnxruntime-web: this module must be
 * unit-testable without pulling a 28 MB runtime into the test process, and it must not
 * couple the security boundary to a specific ORT type surface.
 */
export interface OrtWasmEnv {
  wasmBinary?: ArrayBufferLike | Uint8Array | undefined;
  wasmPaths?: { mjs?: string; wasm?: string } | string | undefined;
  numThreads?: number;
  proxy?: boolean;
}
export interface OrtLike {
  env: { wasm: OrtWasmEnv; logLevel?: string };
  InferenceSession: {
    create(model: Uint8Array | string, options?: unknown): Promise<unknown>;
  };
}

export class OrtRuntimePinError extends Error {
  override readonly name = "OrtRuntimePinError";
  constructor(
    message: string,
    readonly code:
      | "ARTIFACT_UNAVAILABLE"
      | "HASH_MISMATCH"
      | "LATE_INSTALL"
      | "NOT_PINNED"
      | "ALREADY_INSTALLED"
      | "DIGEST_UNAVAILABLE"
  ) {
    super(message);
  }
}

export interface InstalledPin {
  readonly artifact: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly installedAt: string;
}

/* ── Per-realm state. Module scope IS realm scope, which is exactly the granularity
 *    C-1 is about. ─────────────────────────────────────────────────────────────── */
let installed: InstalledPin | null = null;
let sessionCreatedInRealm = false;

/** Test-only reset. Never called by production code paths. */
export function __resetRealmStateForTests(): void {
  installed = null;
  sessionCreatedInRealm = false;
}

export function getInstalledPin(): InstalledPin | null {
  return installed;
}

async function sha256Hex(bytes: ArrayBuffer, subtle: SubtleCrypto): Promise<string> {
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface InstallOptions {
  /** The ORT instance whose env will receive the verified buffer. */
  readonly ort: OrtLike;
  /**
   * Resolves a packaged asset to a URL. A RELATIVE resolution against the current
   * script's own location is required: `chrome.runtime.getURL` is undefined inside a
   * dedicated worker (measured in W1-S02a-2a-1), which is exactly where inference runs.
   */
  readonly resolveAssetUrl: (fileName: string) => string;
  readonly fetchImpl?: typeof fetch;
  readonly subtle?: SubtleCrypto;
}

/**
 * Fetch the packaged artifact, verify its digest against the build-time pin, and only
 * then hand the verified buffer to ORT.
 *
 * Order matters and is load-bearing: the digest is computed and compared BEFORE `ort` is
 * touched at all. On mismatch, ORT is never invoked.
 */
export async function installVerifiedOrtRuntime(
  options: InstallOptions
): Promise<InstalledPin> {
  const { ort, resolveAssetUrl } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const subtle = options.subtle ?? globalThis.crypto?.subtle;

  // C-1: refuse to install late. A realm that already created a session is unpinned and
  // cannot be retrofitted — reporting success here would be a lie.
  if (sessionCreatedInRealm) {
    throw new OrtRuntimePinError(
      "ADR-0001 C-1: an ORT session was already created in this realm, so ORT has cached " +
        "its WebAssembly module and setting wasmBinary now would be silently ignored. " +
        "This realm is unpinned and must not be used for inference.",
      "LATE_INSTALL"
    );
  }
  if (installed) {
    throw new OrtRuntimePinError(
      `ADR-0001 C-1: the runtime pin is already installed in this realm (${installed.artifact}). ` +
        "Re-installing would suggest a second, unverified initialisation path.",
      "ALREADY_INSTALLED"
    );
  }
  if (!subtle) {
    throw new OrtRuntimePinError(
      "crypto.subtle is unavailable, so the artifact cannot be verified. Fail closed.",
      "DIGEST_UNAVAILABLE"
    );
  }

  const artifactUrl = resolveAssetUrl(ORT_PIN.artifact.name);
  let bytes: ArrayBuffer;
  try {
    const res = await doFetch(artifactUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = await res.arrayBuffer();
  } catch (cause) {
    throw new OrtRuntimePinError(
      `ADR-0001: the pinned ORT artifact could not be retrieved from ${artifactUrl} ` +
        `(${String((cause as Error)?.message ?? cause)}). There is no fallback: without the ` +
        "verified artifact the perception tier must not run.",
      "ARTIFACT_UNAVAILABLE"
    );
  }

  const digest = await sha256Hex(bytes, subtle);
  if (digest !== ORT_PIN.artifact.sha256) {
    // Deliberately BEFORE any ORT interaction.
    throw new OrtRuntimePinError(
      `ADR-0001: ORT artifact digest mismatch — refusing to initialise the runtime.\n` +
        `  artifact: ${ORT_PIN.artifact.name}\n` +
        `  expected: ${ORT_PIN.artifact.sha256}\n` +
        `  actual:   ${digest}\n` +
        `  pin evidence: ${ORT_PIN_EVIDENCE}`,
      "HASH_MISMATCH"
    );
  }
  if (bytes.byteLength !== ORT_PIN.artifact.bytes) {
    throw new OrtRuntimePinError(
      `ADR-0001: ORT artifact length mismatch (expected ${ORT_PIN.artifact.bytes}, got ` +
        `${bytes.byteLength}) despite a matching digest. Refusing to initialise.`,
      "HASH_MISMATCH"
    );
  }

  // Verified. Hand ORT the exact buffer we hashed — no second fetch, no substitution.
  ort.env.wasm.wasmBinary = bytes;
  // C-3: the glue is resolved from the PACKAGE. It is loaded by dynamic import(), which
  // MV3 governs through script-src, so it cannot be intercepted and hashed the way the
  // artifact can. Packaging is the control; this is not a runtime pin.
  ort.env.wasm.wasmPaths = { mjs: resolveAssetUrl(ORT_PIN.glue.name) };

  installed = {
    artifact: ORT_PIN.artifact.name,
    sha256: digest,
    bytes: bytes.byteLength,
    installedAt: new Date().toISOString(),
  };
  return installed;
}

/** Throws unless this realm has a verified pin installed. */
export function assertOrtRuntimePinned(): InstalledPin {
  if (!installed) {
    throw new OrtRuntimePinError(
      "ADR-0001 C-1: no verified ORT runtime pin is installed in this realm. " +
        "installVerifiedOrtRuntime() must complete before any session is created.",
      "NOT_PINNED"
    );
  }
  return installed;
}

/**
 * The ONLY sanctioned way to create an ORT session.
 *
 * Calling `ort.InferenceSession.create` directly bypasses the C-1 guard, which is why a
 * lint rule forbids it outside this module (see the ADR-0001 gate table, G4a).
 */
export async function createPinnedInferenceSession(
  ort: OrtLike,
  model: Uint8Array | string,
  sessionOptions?: unknown
): Promise<unknown> {
  assertOrtRuntimePinned();
  // Marked before the await: if creation throws, the realm has still touched ORT and a
  // later install would be unsafe.
  sessionCreatedInRealm = true;
  return await ort.InferenceSession.create(model, sessionOptions);
}
