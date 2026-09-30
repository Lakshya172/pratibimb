/**
 * The MODEL pin: exact model bytes hashed == exact model bytes a session is created from.
 *
 * The same property `ortRuntimePin.ts` enforces for the ORT WebAssembly artifact, applied to a
 * model file. The packaged model is fetched from the extension's own package, hashed, and compared
 * with a digest and a length fixed in source BEFORE anything else sees the bytes. On any mismatch,
 * or if the file cannot be read, it throws; there is no "whatever file is present" path and no
 * fallback model.
 *
 * NOT A PROVENANCE CONTROL, for the same measured reason as the runtime pin: a content hash says what
 * the bytes are, not where they came from. Provenance is `connect-src` (./csp.ts) and packaging.
 */

export interface ModelPin {
  /** File name inside the extension package. */
  readonly name: string;
  readonly bytes: number;
  /** Lowercase hex SHA-256. */
  readonly sha256: string;
}

export class ModelPinError extends Error {
  override readonly name = "ModelPinError";
  constructor(
    message: string,
    readonly code: "MODEL_UNAVAILABLE" | "MODEL_HASH_MISMATCH" | "DIGEST_UNAVAILABLE",
    /** What was actually read, when anything was. Digests and lengths only. */
    readonly observed: { readonly sha256: string | null; readonly bytes: number | null } = { sha256: null, bytes: null }
  ) {
    super(message);
  }
}

export interface VerifiedModel {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface LoadModelOptions {
  readonly pin: ModelPin;
  /** Relative resolution inside the package; `chrome.runtime.getURL` is absent in a worker. */
  readonly resolveAssetUrl: (fileName: string) => string;
  readonly fetchImpl?: typeof fetch;
  readonly subtle?: SubtleCrypto;
}

const hex = (digest: ArrayBuffer): string =>
  Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Fetch the packaged model and refuse unless its digest AND length equal the pin. */
export async function loadVerifiedModel(options: LoadModelOptions): Promise<VerifiedModel> {
  const { pin } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const subtle = options.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) throw new ModelPinError("crypto.subtle is unavailable, so the model cannot be verified. Fail closed.", "DIGEST_UNAVAILABLE");

  const url = options.resolveAssetUrl(pin.name);
  let buffer: ArrayBuffer;
  try {
    const res = await doFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = await res.arrayBuffer();
  } catch (cause) {
    throw new ModelPinError(
      `The pinned model ${pin.name} could not be read from the package (${String((cause as Error)?.message ?? cause)}). ` +
        "There is no fallback model.",
      "MODEL_UNAVAILABLE"
    );
  }

  const sha256 = hex(await subtle.digest("SHA-256", buffer));
  if (sha256 !== pin.sha256 || buffer.byteLength !== pin.bytes) {
    throw new ModelPinError(
      `Model digest mismatch — refusing to create a session.\n` +
        `  model:    ${pin.name}\n` +
        `  expected: ${pin.sha256} (${pin.bytes} bytes)\n` +
        `  actual:   ${sha256} (${buffer.byteLength} bytes)`,
      "MODEL_HASH_MISMATCH",
      { sha256, bytes: buffer.byteLength }
    );
  }
  return { bytes: new Uint8Array(buffer), sha256, byteLength: buffer.byteLength };
}
