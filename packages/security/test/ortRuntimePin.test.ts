/**
 * ADR-0001 G4a (constraint C-1) + the fail-closed matrix for the ORT runtime pin.
 *
 * Every test here asserts a REFUSAL. That is deliberate: the pin's value is entirely in
 * what it declines to do, and a suite that only proved the happy path would go green while
 * the guard was inert.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  installVerifiedOrtRuntime,
  createPinnedInferenceSession,
  assertOrtRuntimePinned,
  getInstalledPin,
  OrtRuntimePinError,
  __resetRealmStateForTests,
  type OrtLike,
} from "../src/ortRuntimePin.js";
import { ORT_PIN } from "../src/generated/ortPin.js";

/** A stand-in ORT that records what was handed to it. */
function makeOrt(): OrtLike & { created: number } {
  const ort = {
    created: 0,
    env: { wasm: {} as Record<string, unknown>, logLevel: "error" },
    InferenceSession: {
      create: async () => {
        ort.created += 1;
        return { released: false };
      },
    },
  };
  return ort as unknown as OrtLike & { created: number };
}

/** Bytes whose SHA-256 is the pinned value, produced by hashing whatever we feed back. */
function goodBytes(): ArrayBuffer {
  return new Uint8Array(ORT_PIN.artifact.bytes).buffer;
}

/**
 * A subtle-crypto stub. Real hashing of a 28 MB buffer is not what these tests are about;
 * what matters is that the COMPARISON happens, and happens before ORT is touched.
 */
function fakeSubtle(digestHex: string): SubtleCrypto {
  const bytes = Uint8Array.from(
    digestHex.match(/../g)!.map((h) => parseInt(h, 16))
  );
  return { digest: async () => bytes.buffer } as unknown as SubtleCrypto;
}

const okFetch = (buf: ArrayBuffer) =>
  vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buf })) as unknown as typeof fetch;

const resolveAssetUrl = (f: string) => `chrome-extension://test/${f}`;

beforeEach(() => __resetRealmStateForTests());

describe("verified install (happy path)", () => {
  it("hands ORT the exact buffer it hashed, and records the pin", async () => {
    const ort = makeOrt();
    const buf = goodBytes();
    const pin = await installVerifiedOrtRuntime({
      ort,
      resolveAssetUrl,
      fetchImpl: okFetch(buf),
      subtle: fakeSubtle(ORT_PIN.artifact.sha256),
    });

    expect(pin.sha256).toBe(ORT_PIN.artifact.sha256);
    // EXACT BYTES HASHED == EXACT BYTES EXECUTED: identity, not equality.
    expect(ort.env.wasm.wasmBinary).toBe(buf);
    expect(getInstalledPin()?.artifact).toBe(ORT_PIN.artifact.name);
  });

  it("points the glue at the PACKAGED copy (C-3) and never at a remote origin", async () => {
    const ort = makeOrt();
    await installVerifiedOrtRuntime({
      ort,
      resolveAssetUrl,
      fetchImpl: okFetch(goodBytes()),
      subtle: fakeSubtle(ORT_PIN.artifact.sha256),
    });
    const paths = ort.env.wasm.wasmPaths as { mjs?: string; wasm?: string };
    expect(paths.mjs).toBe(`chrome-extension://test/${ORT_PIN.glue.name}`);
    // No `wasm` path at all: the verified buffer is the only source.
    expect(paths.wasm).toBeUndefined();
  });
});

describe("fail closed", () => {
  it("REFUSES on hash mismatch, and never touches ORT", async () => {
    const ort = makeOrt();
    const wrong = "f".repeat(64);
    await expect(
      installVerifiedOrtRuntime({
        ort,
        resolveAssetUrl,
        fetchImpl: okFetch(goodBytes()),
        subtle: fakeSubtle(wrong),
      })
    ).rejects.toMatchObject({ code: "HASH_MISMATCH" });

    // The whole point: ORT was never invoked, so the bad bytes never reached a compiler.
    expect(ort.env.wasm.wasmBinary).toBeUndefined();
    expect(getInstalledPin()).toBeNull();
    expect(ort.created).toBe(0);
  });

  it("REFUSES when the artifact is missing", async () => {
    const ort = makeOrt();
    await expect(
      installVerifiedOrtRuntime({
        ort,
        resolveAssetUrl,
        fetchImpl: vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch,
        subtle: fakeSubtle(ORT_PIN.artifact.sha256),
      })
    ).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(ort.env.wasm.wasmBinary).toBeUndefined();
  });

  it("REFUSES when the digest matches but the length does not", async () => {
    const ort = makeOrt();
    await expect(
      installVerifiedOrtRuntime({
        ort,
        resolveAssetUrl,
        fetchImpl: okFetch(new Uint8Array(8).buffer), // wrong length
        subtle: fakeSubtle(ORT_PIN.artifact.sha256),
      })
    ).rejects.toMatchObject({ code: "HASH_MISMATCH" });
  });

  it("REFUSES when crypto.subtle is unavailable rather than skipping verification", async () => {
    const ort = makeOrt();
    // `subtle: undefined` deliberately falls back to globalThis.crypto.subtle - that is
    // the intended default. The unavailable path is only reachable when the GLOBAL is
    // absent, which is what a hardened or stripped context looks like.
    const savedCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      await expect(
        installVerifiedOrtRuntime({ ort, resolveAssetUrl, fetchImpl: okFetch(goodBytes()) })
      ).rejects.toMatchObject({ code: "DIGEST_UNAVAILABLE" });
      // Fail closed: no bytes reached ORT.
      expect(ort.env.wasm.wasmBinary).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: savedCrypto, configurable: true });
    }
  });
});

describe("C-1 realm guard (G4a)", () => {
  it("REFUSES to create a session when no pin is installed", async () => {
    const ort = makeOrt();
    await expect(createPinnedInferenceSession(ort, new Uint8Array([0]))).rejects.toMatchObject({
      code: "NOT_PINNED",
    });
    expect(ort.created).toBe(0);
  });

  it("REJECTS LATE INSTALLATION after a session exists in this realm", async () => {
    const ort = makeOrt();
    // Pin, create a session, reset only the *pin* to simulate a second init attempt.
    await installVerifiedOrtRuntime({
      ort,
      resolveAssetUrl,
      fetchImpl: okFetch(goodBytes()),
      subtle: fakeSubtle(ORT_PIN.artifact.sha256),
    });
    await createPinnedInferenceSession(ort, new Uint8Array([0]));

    // ORT has now cached its module for this realm. A later install would be silently
    // ignored by ORT, so claiming success here would be a lie.
    await expect(
      installVerifiedOrtRuntime({
        ort,
        resolveAssetUrl,
        fetchImpl: okFetch(goodBytes()),
        subtle: fakeSubtle(ORT_PIN.artifact.sha256),
      })
    ).rejects.toMatchObject({ code: "LATE_INSTALL" });
  });

  it("REFUSES a second install even before any session (no unverified second path)", async () => {
    const ort = makeOrt();
    const opts = {
      ort,
      resolveAssetUrl,
      fetchImpl: okFetch(goodBytes()),
      subtle: fakeSubtle(ORT_PIN.artifact.sha256),
    };
    await installVerifiedOrtRuntime(opts);
    await expect(installVerifiedOrtRuntime(opts)).rejects.toMatchObject({
      code: "ALREADY_INSTALLED",
    });
  });

  it("marks the realm as used even when session creation THROWS", async () => {
    const ort = makeOrt();
    await installVerifiedOrtRuntime({
      ort,
      resolveAssetUrl,
      fetchImpl: okFetch(goodBytes()),
      subtle: fakeSubtle(ORT_PIN.artifact.sha256),
    });
    ort.InferenceSession.create = async () => {
      throw new Error("boom");
    };
    await expect(createPinnedInferenceSession(ort, new Uint8Array([0]))).rejects.toThrow("boom");

    // ORT was touched, so the realm is no longer safely re-pinnable. LATE_INSTALL wins
    // over ALREADY_INSTALLED here because the realm check runs first - deliberately: "a
    // session already ran in this realm" is the stronger and more dangerous condition.
    await expect(
      installVerifiedOrtRuntime({
        ort,
        resolveAssetUrl,
        fetchImpl: okFetch(goodBytes()),
        subtle: fakeSubtle(ORT_PIN.artifact.sha256),
      })
    ).rejects.toMatchObject({ code: "LATE_INSTALL" });
  });

  it("assertOrtRuntimePinned throws before install and returns the pin after", async () => {
    expect(() => assertOrtRuntimePinned()).toThrow(OrtRuntimePinError);
    const ort = makeOrt();
    await installVerifiedOrtRuntime({
      ort,
      resolveAssetUrl,
      fetchImpl: okFetch(goodBytes()),
      subtle: fakeSubtle(ORT_PIN.artifact.sha256),
    });
    expect(assertOrtRuntimePinned().sha256).toBe(ORT_PIN.artifact.sha256);
  });
});
