/**
 * Minimal host — offscreen document. The trusted context for ORT, the vault stub and egress probes.
 *
 * The vault here is a STUB: synthetic canary strings only, in memory, never sent in any message and
 * never written to storage. It exists so later experiments can check that a value stays on this side.
 * There is no production vault, sanitizer, verifier or egress module in this host.
 */
import { bootstrapOrtRealm, createPinnedInferenceSession, resolvePackagedAsset } from "../../entrypoints/ortRuntime";
import { isFromThisExtension, type ToOffscreen } from "../../host-lib/messages";

const instanceId = crypto.randomUUID();
const createdAt = Date.now();
const vaultStub = new Map<string, string>([["<PII:PHONE:1>", "9000000001-SYNTHETIC-CANARY"]]);
const nonces = new Set<string>();

type OrtGlobal = { InferenceSession: unknown; Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown; env: unknown };

async function ortSmoke() {
  const ort = (globalThis as unknown as { ort?: OrtGlobal }).ort;
  if (!ort) return { ok: false, stage: "BUNDLE", error: "ort global missing" };
  const t0 = performance.now();
  try {
    const realm = await bootstrapOrtRealm("offscreen", ort as never);
    const tBoot = performance.now() - t0;
    const modelBytes = new Uint8Array(await (await fetch(resolvePackagedAsset("t1-ui-head.onnx"))).arrayBuffer());
    const t1 = performance.now();
    const session = (await createPinnedInferenceSession(ort as never, modelBytes, { executionProviders: ["wasm"] })) as {
      inputNames: string[];
      outputNames: string[];
      run: (feeds: Record<string, unknown>) => Promise<Record<string, { dims: readonly number[] }>>;
    };
    const tSession = performance.now() - t1;
    const t2 = performance.now();
    const out = await session.run({ [session.inputNames[0]!]: new ort.Tensor("float32", new Float32Array(3 * 640 * 640), [1, 3, 640, 640]) });
    const tRun = performance.now() - t2;
    return {
      ok: true,
      pinnedArtifact: realm.pin,
      wasmCompilationAllowed: realm.capability,
      modelBytes: modelBytes.length,
      outputDims: out[session.outputNames[0]!]?.dims ?? null,
      ms: { bootstrap: Math.round(tBoot), session: Math.round(tSession), firstRun: Math.round(tRun) },
    };
  } catch (e) {
    return { ok: false, stage: "BOOTSTRAP_OR_RUN", error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

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

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const msg = raw as ToOffscreen;
  if (msg?.target !== "offscreen") return false;
  if (!isFromThisExtension(sender)) {
    sendResponse({ refused: "SENDER_NOT_ACCEPTED" });
    return false;
  }
  if (msg.kind === "ECHO") {
    sendResponse({ instanceId });
    return false;
  }
  if (msg.kind === "STATE") {
    // Sizes only. The stub's values never leave this document.
    sendResponse({ instanceId, createdAt, vaultStubEntries: vaultStub.size, nonces: nonces.size });
    return false;
  }
  if (msg.kind === "ORT_SMOKE") {
    void ortSmoke().then(sendResponse);
    return true;
  }
  if (msg.kind === "CSP_PROBE") {
    void cspProbe(msg.allowed, msg.foreign).then(sendResponse);
    return true;
  }
  sendResponse({ refused: "UNKNOWN_KIND" });
  return false;
});
