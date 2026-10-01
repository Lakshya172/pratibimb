/**
 * TR-01's packaging record — everything the build and the worker need to refuse a wrong model.
 *
 * SELF-CONTAINED ON PURPOSE (no imports): `wxt.config.ts` reads it at build time, before any bundler
 * alias exists. `test/tr01Pin.test.ts` holds every value here equal to its source of truth:
 *
 *   modelId / revision / onnx.*   `TR01` in `packages/perception/src/textRegion.ts` (M10.1)
 *   source.*                      M8.1's acquisition log, `logs/tr-01-conversion.json`
 *   ortVersion                    `ORT_PIN.version` (`packages/security/src/generated/ortPin.ts`)
 *
 * THE WEIGHTS ARE NOT IN GIT. `modelPath` is under `artifacts/models/`, which `.gitignore` excludes,
 * exactly like the UI head. It is provisioned by copying M8.1's converted file there; the build
 * hashes it and refuses a mismatch, and the worker hashes it again before a session exists.
 */
export const TR01_PACKAGE = Object.freeze({
  modelId: "PP-OCRv4_mobile_det",
  revision: "3cc09f3a5b424e8e010abc7a4271aea12999c2f7",
  /** The upstream weights the ONNX was converted from, verified at acquisition against the LFS sha256. */
  source: Object.freeze({
    repo: "PaddlePaddle/PP-OCRv4_mobile_det",
    file: "inference.pdiparams",
    bytes: 4_692_937,
    sha256: "54a85087b4d31fa3ea4e4aba100169a1ec3e3274cd3352b9068b3cfccbca7829",
  }),
  /** The converted artifact the product runs. Byte-identical across M8.1's four conversions. */
  onnx: Object.freeze({
    name: "tr01-ppocrv4-mobile-det.onnx",
    bytes: 4_766_440,
    sha256: "18aaccf9c9cd27656becda13bc0ef31eaa0ea3aef4d45166839f2093561575e8",
  }),
  conversion: "paddle2onnx 2.1.0, opset 16 (M8.1 acquire-convert.py)",
  ortVersion: "1.29.0",
  /** Repository-relative, git-ignored. */
  modelPath: "artifacts/models/tr01-ppocrv4-mobile-det/tr01-ppocrv4-mobile-det.onnx",
  evidence: "artifacts/experiments/M8.1-visual-text-screening/logs/tr-01-conversion.json",
});

/** The worker's published path inside the package. */
export const TR01_WORKER_SCRIPT = "tr01-worker.js";

/**
 * The approved engineering deadline (owner decision D3, M10): 2,000 ms per frame, EXCLUDING one-time
 * initialisation. Changing it requires an owner decision.
 */
export const TR01_DEADLINE_MS = 2_000;

/**
 * How long initialisation (runtime pin, model fetch + hash, session create) may take before the tier
 * is declared unavailable. An ENGINEERING SAFEGUARD against a hung init, not an owner gate and not a
 * measurement: M8.1 measured a 1,060 ms session load on W1, and this is set well above it.
 */
export const TR01_INIT_DEADLINE_MS = 30_000;
