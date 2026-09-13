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
// A synthetic canary with a phone's shape (10 digits), so tel and maxlength fixtures behave as they
// would for a real phone value. It is not a real number and is never sent anywhere.
const vaultStub = new Map<string, string>([["<PII:PHONE:1>", "9000000001"]]);
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

/**
 * EXPERIMENT E4-offscreen — emit ONE request, built elsewhere, from this document.
 *
 * The harness builds every byte (URL, method, headers, body) with E4's own code; this document only
 * performs the fetch, so the bytes leave from the cell the product would send from. It chooses
 * nothing, builds nothing, and reaches only the E4 loopback collector, which is also the manifest's
 * one pinned connect-src origin. The payloads are synthetic canaries, never vault values.
 *
 * A rejected fetch is reported, not hidden: whether bytes reached the wire is the collector's call.
 */
const E4_COLLECTOR = "http://127.0.0.1:8995/";

async function e4Emit(msg: { url: string; method: string; headers: Readonly<Record<string, string>>; bodyB64: string | null }) {
  if (typeof msg.url !== "string" || !msg.url.startsWith(E4_COLLECTOR)) return { refused: "NOT_THE_E4_COLLECTOR" };
  const body = msg.bodyB64 === null ? undefined : Uint8Array.from(atob(msg.bodyB64), (c) => c.charCodeAt(0));
  const emitter = location.href;
  const t0 = performance.now();
  try {
    const r = await fetch(msg.url, { method: msg.method, headers: msg.headers, body });
    return { settled: "resolved", status: r.status, emitter, ms: performance.now() - t0 };
  } catch (e) {
    return { settled: "rejected", fetchError: e instanceof Error ? `${e.name}: ${e.message}` : String(e), emitter, ms: performance.now() - t0 };
  }
}

/**
 * EXPERIMENT E6 — value release bound to a browser-attested document.
 *
 * The service worker arms a single-use nonce for (tabId, frameId, documentId). A content script may
 * redeem it only if the browser reports exactly that tab, frame and document as the sender, before
 * expiry, once. The value then goes to that content script and nowhere else.
 */
const armed = new Map<string, { tabId: number; frameId: number; documentId: string; ref: string; expiresAt: number }>();

function release(msg: { nonce: string }, sender: chrome.runtime.MessageSender): { value: string } | { refused: string } {
  const a = armed.get(msg.nonce);
  if (!a) return { refused: "UNKNOWN_OR_CONSUMED_NONCE" };
  armed.delete(msg.nonce); // consumed on any attempt that names it
  nonces.delete(msg.nonce);
  const s = sender as chrome.runtime.MessageSender & { documentId?: string };
  if (Date.now() >= a.expiresAt) return { refused: "NONCE_EXPIRED" };
  if (sender.tab?.id !== a.tabId || sender.frameId !== a.frameId || s.documentId !== a.documentId) return { refused: "SENDER_DOCUMENT_MISMATCH" };
  const value = vaultStub.get(a.ref);
  return value === undefined ? { refused: "UNKNOWN_REF" } : { value };
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const msg = raw as ToOffscreen | { target: "offscreen"; kind: "E6_ARM"; nonce: string; tabId: number; frameId: number; documentId: string; ref: string; ttlMs: number } | { target: "offscreen"; kind: "E6_RELEASE"; nonce: string };
  if (msg?.target !== "offscreen") return false;
  if (!isFromThisExtension(sender)) {
    sendResponse({ refused: "SENDER_NOT_ACCEPTED" });
    return false;
  }
  if (msg.kind === "E6_ARM") {
    if (sender.tab) {
      sendResponse({ refused: "ARM_ONLY_FROM_SERVICE_WORKER" });
      return false;
    }
    armed.set(msg.nonce, { tabId: msg.tabId, frameId: msg.frameId, documentId: msg.documentId, ref: msg.ref, expiresAt: Date.now() + msg.ttlMs });
    nonces.add(msg.nonce);
    sendResponse({ armed: true });
    return false;
  }
  if (msg.kind === "E6_RELEASE") {
    if (!sender.tab) {
      sendResponse({ refused: "RELEASE_ONLY_TO_A_CONTENT_SCRIPT" });
      return false;
    }
    sendResponse(release(msg, sender));
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
  if (msg.kind === "E4_EMIT") {
    if (sender.tab) {
      sendResponse({ refused: "EMIT_ONLY_FROM_SERVICE_WORKER" });
      return false;
    }
    void e4Emit(msg).then(sendResponse);
    return true;
  }
  sendResponse({ refused: "UNKNOWN_KIND" });
  return false;
});
