/**
 * M10.4 — the TR-01 dedicated worker. Built by WXT as the unlisted classic script `/tr01-worker.js`
 * and created ONLY by the offscreen document (`host-lib/tr01-host.ts`).
 *
 * This file is the browser glue and nothing else; the logic is `host-lib/tr01-worker-core.ts`. It
 * supplies exactly three capabilities:
 *
 *   1. the pinned ORT runtime — the packaged `ort.all.min.js`, then `bootstrapOrtRealm`, which hashes
 *      the WASM artifact against ORT_PIN before ORT is touched (ADR-0001 C-1);
 *   2. the pinned model — `loadVerifiedModel` reads `tr01-ppocrv4-mobile-det.onnx` from this
 *      extension's own package and refuses unless its SHA-256 and length equal `TR01_PACKAGE.onnx`;
 *   3. a session over those verified bytes — `createPinnedInferenceSession`, wasm only.
 *
 * Every URL is resolved relative to this script, inside the package (`chrome.runtime.getURL` does not
 * exist in a worker). There is no other fetch, no DOM, no text, no encode and no egress here.
 *
 * `#tr01-instrument` is a test-build seam, resolved by `wxt.config.ts`: in a product build it is
 * `probe/tr01-instrument-absent.ts`, which measures nothing and answers nothing.
 */
import { installInstrument, serveInstrument } from "#tr01-instrument";
import { loadVerifiedModel, ModelPinError, ORT_PIN } from "@pratibimb/security";

import { bootstrapOrtRealm, createPinnedInferenceSession, resolvePackagedAsset } from "../entrypoints/ortRuntime";
import { TR01_PACKAGE } from "../host-lib/tr01-pin";
import type { Tr01Reply } from "../host-lib/tr01-protocol";
import { createTr01WorkerCore, Tr01InitError, type Tr01Session } from "../host-lib/tr01-worker-core";

interface WorkerScope {
  importScripts(...urls: string[]): void;
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  ort?: OrtModule;
}
interface OrtSessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: readonly number[] }>>;
}
interface OrtModule {
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  env: unknown;
  InferenceSession: unknown;
}

const message = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export default defineUnlistedScript(() => {
  const scope = globalThis as unknown as WorkerScope;
  // Before ORT exists, so a test build's memory instrument sees the runtime's memory being created.
  installInstrument();
  scope.importScripts(resolvePackagedAsset(ORT_PIN.bundle.name));
  const ort = scope.ort ?? null;

  const core = createTr01WorkerCore({
    installRuntime: async () => {
      if (!ort) throw new Tr01InitError("the pinned ORT bundle did not define `ort` in this worker", "RUNTIME_UNAVAILABLE");
      try {
        await bootstrapOrtRealm("tr01-worker", ort as never);
      } catch (e) {
        throw new Tr01InitError(message(e), "RUNTIME_UNAVAILABLE");
      }
    },
    loadModel: async () => {
      try {
        const model = await loadVerifiedModel({ pin: TR01_PACKAGE.onnx, resolveAssetUrl: resolvePackagedAsset });
        return { bytes: model.bytes, sha256: model.sha256 };
      } catch (e) {
        if (e instanceof ModelPinError) {
          throw new Tr01InitError(message(e), e.code === "MODEL_HASH_MISMATCH" ? "MODEL_HASH_MISMATCH" : "MODEL_UNAVAILABLE", e.observed);
        }
        throw new Tr01InitError(message(e), "MODEL_UNAVAILABLE");
      }
    },
    createSession: async (bytes): Promise<Tr01Session> => {
      let session: OrtSessionLike;
      try {
        session = (await createPinnedInferenceSession(ort as never, bytes, { executionProviders: ["wasm"] })) as OrtSessionLike;
      } catch (e) {
        throw new Tr01InitError(message(e), "SESSION_FAILED");
      }
      const Tensor = (ort as OrtModule).Tensor;
      return {
        infer: async (tensor, dims) => {
          const out = await session.run({ [session.inputNames[0] as string]: new Tensor("float32", tensor, [...dims]) });
          const first = out[session.outputNames[0] as string];
          if (!first) throw new Error("the session produced no output tensor");
          return { data: first.data as Float32Array, dims: first.dims };
        },
      };
    },
    post: (reply: Tr01Reply) => scope.postMessage(reply),
    now: () => performance.now(),
  });

  scope.onmessage = (event) => {
    if (serveInstrument(event.data, (reply) => scope.postMessage(reply))) return;
    void core.handle(event.data);
  };
});
