/**
 * ADR-0001 G1 — the startup capability assertion.
 *
 * The load-bearing test in this file is the one asserting `WebAssembly.validate` is NEVER
 * called. W1-S02a-2a-2 measured that `validate()` succeeds in every Firefox variant
 * INCLUDING the default CSP where compilation is blocked — so a capability check built on
 * it reports WebAssembly as available when it is not. That is a false green on precisely
 * the question this gate exists to answer, and on Firefox nothing else would reveal it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { assertWasmCompilationAllowed, WasmCapabilityError } from "../src/wasmCapability.js";

const realCompile = WebAssembly.compile;
const realInstantiate = WebAssembly.instantiate;
const realValidate = WebAssembly.validate;

afterEach(() => {
  WebAssembly.compile = realCompile;
  WebAssembly.instantiate = realInstantiate;
  WebAssembly.validate = realValidate;
  vi.restoreAllMocks();
});

describe("when WebAssembly genuinely works", () => {
  it("compiles, instantiates and PROVES execution by checking the result", async () => {
    const report = await assertWasmCompilationAllowed("unit-test");
    expect(report.compiled).toBe(true);
    expect(report.instantiated).toBe(true);
    // Not "it compiled" but "it computed the right answer".
    expect(report.probeResult).toBe(5);
    expect(report.context).toBe("unit-test");
  });

  it("NEVER calls WebAssembly.validate — the Firefox false-green trap", async () => {
    const validateSpy = vi.fn(() => true);
    WebAssembly.validate = validateSpy as unknown as typeof WebAssembly.validate;
    const compileSpy = vi.spyOn(WebAssembly, "compile");

    await assertWasmCompilationAllowed("unit-test");

    expect(validateSpy).not.toHaveBeenCalled();
    expect(compileSpy).toHaveBeenCalled();
  });
});

describe("fail closed", () => {
  it("throws COMPILE_BLOCKED when the CSP blocks compilation", async () => {
    // The shape Firefox produces: validate() would still succeed, compile() does not.
    WebAssembly.validate = (() => true) as unknown as typeof WebAssembly.validate;
    WebAssembly.compile = (() =>
      Promise.reject(
        new Error("call to WebAssembly.compile() blocked by CSP")
      )) as unknown as typeof WebAssembly.compile;

    await expect(assertWasmCompilationAllowed("offscreen")).rejects.toMatchObject({
      code: "COMPILE_BLOCKED",
    });
  });

  it("does not fall back to validate() when compile() is blocked", async () => {
    const validateSpy = vi.fn(() => true);
    WebAssembly.validate = validateSpy as unknown as typeof WebAssembly.validate;
    WebAssembly.compile = (() =>
      Promise.reject(new Error("blocked"))) as unknown as typeof WebAssembly.compile;

    await expect(assertWasmCompilationAllowed("worker")).rejects.toThrow(WasmCapabilityError);
    // A "helpful" fallback here would turn a blocked tier into a reported-healthy one.
    expect(validateSpy).not.toHaveBeenCalled();
  });

  it("throws INSTANTIATE_FAILED when compilation succeeds but instantiation does not", async () => {
    WebAssembly.instantiate = (() =>
      Promise.reject(new Error("no memory"))) as unknown as typeof WebAssembly.instantiate;

    await expect(assertWasmCompilationAllowed("worker")).rejects.toMatchObject({
      code: "INSTANTIATE_FAILED",
    });
  });

  it("throws INCORRECT_RESULT when the module runs but computes the wrong answer", async () => {
    // instantiate(Module) resolves to an Instance directly; only instantiate(BufferSource)
    // resolves to { instance, module }. Production calls the Module overload.
    WebAssembly.instantiate = (async () => ({
      exports: { add: () => 4 },
    })) as unknown as typeof WebAssembly.instantiate;

    await expect(assertWasmCompilationAllowed("worker")).rejects.toMatchObject({
      code: "INCORRECT_RESULT",
    });
  });

  it("throws WASM_ABSENT when WebAssembly is not present at all", async () => {
    const saved = globalThis.WebAssembly;
    // @ts-expect-error deliberately removing the global for this case
    delete globalThis.WebAssembly;
    try {
      await expect(assertWasmCompilationAllowed("sw")).rejects.toMatchObject({
        code: "WASM_ABSENT",
      });
    } finally {
      globalThis.WebAssembly = saved;
    }
  });
});
