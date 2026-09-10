/**
 * ADR-0001 G1 — assert at runtime startup, in every context, that the CSP actually
 * permits WebAssembly compilation. Fail closed.
 *
 * WHY THIS EXISTS AT ALL, rather than trusting the manifest.
 *
 * W1-S02a-2a-2 measured that the two browsers fail DIFFERENTLY when the directive is
 * wrong or withdrawn:
 *
 *   Chrome   'wasm-eval' / 'unsafe-eval'  ->  the extension DOES NOT LOAD. Loudly broken.
 *   Firefox  'wasm-eval' / 'unsafe-eval'  ->  the extension LOADS and WebAssembly is
 *                                             SILENTLY ABSENT. No load error at all.
 *
 * On Firefox a misconfiguration therefore produces a perception tier that simply never
 * runs, with nothing to explain why. A directive present in a file is not evidence that
 * the capability exists in this context, so it is asserted here instead.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS DELIBERATELY AVOIDS — do not "optimise" this to validate().
 *
 * `WebAssembly.validate()` SUCCEEDS in every Firefox variant, INCLUDING the default CSP
 * where compilation is blocked, because validation parses without compiling to machine
 * code. A capability check built on validate() reports WebAssembly as available when it
 * is not — a false green on the exact question this gate exists to answer.
 *
 * This module uses `WebAssembly.compile()`, and the accompanying test asserts that
 * `validate` is never called.
 */

/**
 * The smallest valid WebAssembly module that still requires real compilation:
 *   (module (func (export "add") (param i32 i32) (result i32)
 *     local.get 0  local.get 1  i32.add))
 *
 * 41 bytes, synthetic, byte-identical to the fixture used across the S-02a experiments so
 * a failure here is directly comparable to their evidence.
 */
const PROBE_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);

export class WasmCapabilityError extends Error {
  override readonly name = "WasmCapabilityError";
  constructor(
    message: string,
    readonly code: "WASM_ABSENT" | "COMPILE_BLOCKED" | "INSTANTIATE_FAILED" | "INCORRECT_RESULT",
    // `override` is required: Error already declares `cause`. Keeping the underlying
    // error attached matters here - "compilation was blocked" is far more actionable
    // with the browser's own CSP message than without it.
    override readonly cause?: unknown
  ) {
    super(message);
  }
}

export interface WasmCapabilityReport {
  readonly context: string;
  readonly compiled: true;
  readonly instantiated: true;
  /** Proof the compiled module actually executes correctly in this context. */
  readonly probeResult: 5;
  readonly checkedAt: string;
}

/**
 * Compile — and execute — a real WebAssembly module in the calling context.
 *
 * Resolves only if WebAssembly genuinely works here. Throws otherwise. Callers must not
 * catch-and-continue: with no WebAssembly there is no perception tier, and running on
 * without one is a silent degradation.
 */
export async function assertWasmCompilationAllowed(
  context: string
): Promise<WasmCapabilityReport> {
  if (typeof WebAssembly === "undefined" || typeof WebAssembly.compile !== "function") {
    throw new WasmCapabilityError(
      `WebAssembly is not available in context "${context}".`,
      "WASM_ABSENT"
    );
  }

  // compile(), NEVER validate(). See the header — validate() succeeds where compilation
  // is blocked, which is precisely the false green this gate must not produce.
  let module: WebAssembly.Module;
  try {
    module = await WebAssembly.compile(PROBE_MODULE);
  } catch (cause) {
    throw new WasmCapabilityError(
      `WebAssembly compilation is BLOCKED in context "${context}". The extension_pages CSP ` +
        "does not permit it — on Firefox this failure is silent, which is why it is asserted " +
        `here. Underlying error: ${String((cause as Error)?.message ?? cause)}`,
      "COMPILE_BLOCKED",
      cause
    );
  }

  let instance: WebAssembly.Instance;
  try {
    instance = await WebAssembly.instantiate(module);
  } catch (cause) {
    throw new WasmCapabilityError(
      `WebAssembly compiled but failed to instantiate in context "${context}".`,
      "INSTANTIATE_FAILED",
      cause
    );
  }

  const add = (instance.exports as { add?: (a: number, b: number) => number }).add;
  const result = typeof add === "function" ? add(2, 3) : undefined;
  if (result !== 5) {
    throw new WasmCapabilityError(
      `WebAssembly instantiated in context "${context}" but produced ${String(result)} ` +
        "instead of 5. The runtime is not trustworthy.",
      "INCORRECT_RESULT"
    );
  }

  return {
    context,
    compiled: true,
    instantiated: true,
    probeResult: 5,
    checkedAt: new Date().toISOString(),
  };
}
