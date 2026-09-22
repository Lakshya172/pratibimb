/**
 * Minimal host — offscreen document. The trusted context for ORT, the vault stub and egress probes.
 *
 * The vault here is a STUB: synthetic canary strings only, in memory, never sent in any message and
 * never written to storage. It exists so later experiments can check that a value stays on this side.
 * There is no production vault, sanitizer, verifier or egress module in this host.
 */
import { observePage, type TransportBinding } from "@pratibimb/extension-transport";
import { type GrantDecision, type GrantRequest } from "@pratibimb/orchestrator";

import { bootstrapOrtRealm, createPinnedInferenceSession, resolvePackagedAsset } from "../../entrypoints/ortRuntime";
import { type BoundaryReply, type BoundaryRequest, type CapabilityPayload } from "../../host-lib/boundary-protocol";
import { runExtensionTask, type ExtensionRunRequest, type ExtensionRunResult } from "../../host-lib/extension-run";
import { identityOf, isFromThisExtension, type ToOffscreen } from "../../host-lib/messages";
import { chromeRelay } from "../../host-lib/transport-chrome";
import { installTransportControlPlane } from "../../host-lib/transport-control-plane";
import { createPerceptionRealm, type PerceptionRealm } from "../../host-lib/perception-realm";
import { createReleaseAuthority, type AttestedAsker } from "../../host-lib/value-release";

const instanceId = crypto.randomUUID();
const createdAt = Date.now();
// A synthetic canary with a phone's shape (10 digits), so tel and maxlength fixtures behave as they
// would for a real phone value. It is not a real number and is never sent anywhere.
const vaultStub = new Map<string, string>([["<PII:PHONE:1>", "9000000001"]]);

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

/**
 * THE PERCEPTION REALM, built once and kept.
 *
 * ONE SESSION PER DOCUMENT, not one per observation. A run observes several times (the first
 * reading, the refresh before acting, the reading VERIFY RESULT is given), and creating a pinned
 * ORT session each time would make the milestone's latency numbers a measurement of session setup
 * rather than of perception. The pin is re-verified on the one bootstrap, as ADR-0001 requires.
 *
 * THE BACKENDS THIS ARTIFACT IS ACCEPTED ON ARE AN EVIDENCE CLAIM, NOT A SETTING. W1-QG03 measured
 * `wasm` for `ba6d9e93695b`: it executes correctly, deterministically and cheaply through the
 * pinned runtime, and its detections are NOT robust to the preprocessing a browser can perform
 * (16-34% move). That is why the feasibility cell is CONDITIONAL, and why M3 records what the
 * detector produced without asserting that it is right.
 */
const MODEL_ID = "pratibimb-t1-ui-head";
const MODEL_REVISION = "ba6d9e93695b";

let perceptionRealm: PerceptionRealm | null = null;
let perceptionBoot: { ok: boolean; error: string | null; ms: number; pin: unknown } | null = null;

async function ensurePerception(): Promise<PerceptionRealm> {
  if (perceptionRealm !== null) return perceptionRealm;
  const t0 = performance.now();
  let session: unknown = null;
  let ort: unknown = null;
  let error: string | null = null;
  let pin: unknown = null;
  try {
    ort = (globalThis as unknown as { ort?: unknown }).ort ?? null;
    if (!ort) throw new Error("ort global missing");
    const realm = await bootstrapOrtRealm("offscreen", ort as never);
    pin = realm.pin;
    const modelBytes = new Uint8Array(await (await fetch(resolvePackagedAsset("t1-ui-head.onnx"))).arrayBuffer());
    session = await createPinnedInferenceSession(ort as never, modelBytes, { executionProviders: ["wasm"] });
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    session = null;
  }
  perceptionBoot = { ok: error === null, error, ms: Math.round(performance.now() - t0), pin };
  perceptionRealm = createPerceptionRealm({
    // The worker is the only realm that can capture; it hands the frame straight back and keeps
    // no reference. See its handler for the whole of why, and what that costs.
    requestCapture: () =>
      chrome.runtime.sendMessage({ kind: "CAPTURE_FRAME" }) as Promise<
        { ok: true; dataUrl: string } | { ok: false; refused: string }
      >,
    session: session as never,
    ort: ort as never,
    modelId: MODEL_ID,
    revision: MODEL_REVISION,
    // Empty when the session did not come up: a detector with no runtime REFUSES rather than
    // returning zero detections, which is indistinguishable from a page with no controls.
    acceptedBackends: error === null ? ["wasm"] : [],
  });
  return perceptionRealm;
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
/**
 * TWO INSTANCES OF ONE AUTHORITY, separated by payload type rather than by rules.
 *
 * `valueRelease` is E6's: a synthetic canary this document holds, released to a content script.
 * `capabilities` is the product's: a release authorisation, or a question for the vault that holds
 * the page's values. The refusals, the binding and the one-shot semantics are the same code in
 * both — a second capability system would be a second set of rules about when something may be
 * handed over, which is the last thing to have two of.
 */
const valueRelease = createReleaseAuthority<string>();
const capabilities = createReleaseAuthority<CapabilityPayload>();

/** The browser's word for who is asking, reduced to what a capability is bound to. */
const askerOf = (sender: chrome.runtime.MessageSender): AttestedAsker => {
  const id = identityOf(sender);
  return { tabId: id.tabId, frameId: id.frameId, documentId: id.documentId };
};

/** EXPERIMENT E6's redemption: a canary this document holds, answered to the content script. */
const redeem = (nonce: string, target: string, sender: chrome.runtime.MessageSender): { value: string } | { refused: string } => {
  const outcome = valueRelease.redeem(nonce, target, askerOf(sender));
  return outcome.released ? { value: outcome.payload } : { refused: outcome.refused };
};

/**
 * Hand one boundary capability to the content script that came for it.
 *
 * This reply goes to the sender and to nobody else, which is the entire reason the direction is
 * inverted. What it carries is a release authorisation — a reference and a target — or text a
 * reasoner returned that the page realm is being asked to recognise. Never a page value: those are
 * in the content script already and have no reason to come here.
 */
const collect = (
  nonce: string,
  field: string,
  sender: chrome.runtime.MessageSender
): { released: true; payload: CapabilityPayload } | { released: false; refused: string } => {
  const outcome = capabilities.redeem(nonce, field, askerOf(sender));
  return outcome.released ? { released: true, payload: outcome.payload } : { released: false, refused: outcome.refused };
};

/**
 * EXPERIMENT D-E6-4: this document is the core realm (TR-9).
 *
 * It survives a service-worker restart, which the execution gate's same-realm registry of issued
 * permits needs, and it keeps the worker a router rather than a place authority lives. The control
 * plane starts nothing: it exposes the unchanged stages and the transport's constructors for an
 * evidence run to compose through the DevTools protocol, exactly as Track G and E6 are driven.
 */
/**
 * THE PRODUCT RUN, HOSTED WHERE AUTHORITY LIVES.
 *
 * One run at a time, in the realm that survives a service-worker restart. The three things this
 * realm has that no other context does are all here: the vault the privacy layer builds, the
 * capability authority, and the approval a human has not yet answered.
 *
 * NOTHING BELOW CAN APPROVE ITSELF. `askHuman` parks the request and returns a promise nothing in
 * this file resolves; only a `GRANT_DECIDE` from outside a page does, and the reasoner has no way to
 * reach it at all.
 */
let running: Promise<ExtensionRunResult> | null = null;
let pendingGrant: { request: GrantRequest; answer: (decision: GrantDecision) => void } | null = null;

/** Answer the approval currently outstanding. `false` means there was nothing to answer. */
function decideGrant(granted: boolean): boolean {
  if (pendingGrant === null) return false;
  const { answer } = pendingGrant;
  pendingGrant = null;
  answer(granted ? { granted: true } : { granted: false, reason: "DENIED" });
  return true;
}

/**
 * Carry one request to the privacy boundary in the page's own world.
 *
 * Through the worker, because an offscreen document cannot address a tab. Everything in
 * `BoundaryRequest` is value-free by construction; a capability carries only its nonce and the
 * field it names, and whatever it actually holds is collected as a reply the worker never sees.
 */
async function sendToBoundary(binding: TransportBinding, body: BoundaryRequest): Promise<BoundaryReply> {
  const reply = (await chrome.runtime.sendMessage({
    kind: "TO_PAGE_BOUNDARY",
    tabId: binding.document.tabId,
    frameId: binding.document.frameId,
    body,
  })) as BoundaryReply | undefined;
  return reply ?? { ok: false, refused: "NO_RESPONSE" };
}

async function runTask(request: ExtensionRunRequest): Promise<ExtensionRunResult> {
  if (running !== null) throw new Error("A_RUN_IS_ALREADY_IN_PROGRESS");
  const task = runExtensionTask(
    {
      relay: chromeRelay,
      capabilities,
      sendToBoundary,
      perceive: async (graph, measurement) => (await ensurePerception()).perceive(graph, measurement),
      perceptionBoot: () => perceptionBoot,
      askHuman: (grantRequest) =>
        new Promise<GrantDecision>((resolve) => {
          pendingGrant = { request: grantRequest, answer: resolve };
        }),
    },
    request
  );
  running = task;
  try {
    return await task;
  } finally {
    running = null;
    // An approval nobody answered does not outlive the run it belonged to.
    pendingGrant = null;
  }
}

installTransportControlPlane();

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const msg = raw as ToOffscreen | { target: "offscreen"; kind: "E6_ARM"; tabId: number; frameId: number; documentId: string; ref: string; selector: string; ttlMs: number } | { target: "offscreen"; kind: "E6_RELEASE"; nonce: string; target2: string }
    | { target: "offscreen"; kind: "TRANSPORT_OBSERVE"; tabId: number; frameId: number }
    | { target: "offscreen"; kind: "BOUNDARY_COLLECT"; nonce: string; field: string }
    | { target: "offscreen"; kind: "ARM_BOUNDARY_CAPABILITY"; tabId: number; frameId: number; documentId: string; field: string; ttlMs: number }
    | { target: "offscreen"; kind: "RUN_TASK"; request: ExtensionRunRequest }
    | { target: "offscreen"; kind: "GRANT_PEEK" }
    | { target: "offscreen"; kind: "GRANT_DECIDE"; granted: boolean }
    | { target: "offscreen"; kind: "REALM_PROBE" };
  if (msg?.target !== "offscreen") return false;
  if (!isFromThisExtension(sender)) {
    sendResponse({ refused: "SENDER_NOT_ACCEPTED" });
    return false;
  }
  /**
   * WHICH REALM MAY HOLD RAW PAGE PIXELS — measured here rather than assumed.
   *
   * M3's capture architecture turns entirely on one question the documentation answers and the
   * runtime settles: can an offscreen document call `chrome.tabs.captureVisibleTab`? If it can,
   * pixels can reach the realm that already holds ORT without crossing the worker. If it cannot,
   * the worker is the only context that can capture, and that is a boundary to state rather than
   * to work around.
   *
   * It reports the SHAPE of the API surface and, if a capture is attempted, the length and the
   * first bytes' signature of what came back — never the image.
   */
  if (msg.kind === "REALM_PROBE") {
    void (async () => {
      const tabs = (chrome as unknown as { tabs?: { captureVisibleTab?: unknown } }).tabs;
      const surface = {
        hasChromeTabs: typeof tabs === "object" && tabs !== null,
        hasCaptureVisibleTab: typeof tabs?.captureVisibleTab === "function",
        hasOffscreenCanvas: typeof OffscreenCanvas === "function",
        hasCreateImageBitmap: typeof createImageBitmap === "function",
        hasWebAssembly: typeof WebAssembly === "object",
        hasDocument: typeof document === "object",
      };
      let capture: unknown = { attempted: false };
      if (surface.hasCaptureVisibleTab) {
        try {
          const url = (await (tabs as { captureVisibleTab: (o: object) => Promise<string> }).captureVisibleTab({ format: "png" })) as string;
          capture = { attempted: true, ok: true, length: url.length, prefix: url.slice(0, 22) };
        } catch (e) {
          capture = { attempted: true, ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
        }
      }
      sendResponse({ realm: "offscreen", surface, capture, perceptionBoot });
    })();
    return true;
  }
  if (msg.kind === "E6_ARM") {
    if (sender.tab) {
      sendResponse({ refused: "ARM_ONLY_FROM_SERVICE_WORKER" });
      return false;
    }
    // THE NONCE IS MINTED HERE, not by the worker that carries it. A router that chose the nonce
    // could arm itself a capability; a router that only carries one cannot.
    const value = vaultStub.get(msg.ref);
    if (value === undefined) {
      sendResponse({ armed: false, refused: "UNKNOWN_REF" });
      return false;
    }
    const nonce = valueRelease.arm({ tabId: msg.tabId, frameId: msg.frameId, documentId: msg.documentId }, msg.selector, value, msg.ttlMs);
    sendResponse({ armed: true, nonce });
    return false;
  }
  if (msg.kind === "E6_RELEASE") {
    if (!sender.tab) {
      sendResponse({ refused: "RELEASE_ONLY_TO_A_CONTENT_SCRIPT" });
      return false;
    }
    sendResponse(redeem(msg.nonce, msg.target2, sender));
    return false;
  }
  /**
   * THE PRODUCT REDEMPTION. A content script presents a capability and is answered **directly**:
   * this reply goes to the sender and to nobody else, which is the one direction MV3 offers that the
   * service worker does not see. Everything that got us here — the nonce and the field — crossed the
   * worker; the value does not.
   */
  if (msg.kind === "BOUNDARY_COLLECT") {
    if (!sender.tab) {
      sendResponse({ released: false, refused: "RELEASE_ONLY_TO_A_CONTENT_SCRIPT" });
      return false;
    }
    sendResponse(collect(msg.nonce, msg.field, sender));
    return false;
  }
  if (msg.kind === "ARM_BOUNDARY_CAPABILITY") {
    // TEST-ONLY, service-worker only. Arms a release authorisation naming a reference no vault ever
    // issued, so an evidence run can present a real capability wrongly without a run in progress.
    if (sender.tab) {
      sendResponse({ refused: "ARM_ONLY_FROM_SERVICE_WORKER" });
      return false;
    }
    const nonce = capabilities.arm(
      { tabId: msg.tabId, frameId: msg.frameId, documentId: msg.documentId },
      msg.field,
      {
        kind: "RELEASE",
        ask: {
          ref: "<PII:PHONE:99>",
          target: msg.field,
          viewId: "probe",
          sessionId: "probe",
          currentDocumentId: msg.documentId,
          classOriginGrants: [],
          useGrants: [],
          now: Date.now(),
        },
      },
      msg.ttlMs
    );
    sendResponse({ nonce });
    return false;
  }
  if (msg.kind === "RUN_TASK") {
    if (sender.tab) {
      sendResponse({ refused: "RUN_ONLY_FROM_SERVICE_WORKER" });
      return false;
    }
    void runTask(msg.request)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, refused: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));
    return true;
  }
  if (msg.kind === "GRANT_PEEK") {
    sendResponse({ pending: pendingGrant === null ? null : pendingGrant.request });
    return false;
  }
  if (msg.kind === "GRANT_DECIDE") {
    if (sender.tab) {
      // A page's own content script answering the grant would be the page approving itself.
      sendResponse({ refused: "DECISION_NOT_FROM_A_PAGE" });
      return false;
    }
    sendResponse({ answered: decideGrant(msg.granted) });
    return false;
  }
  /**
   * M1: read a real page through the real transport, from the realm that will own the loop.
   *
   * This drives the unchanged `observePage` — offscreen → service worker → content script and back —
   * so an evidence run can compare the element graph the core realm actually receives against the
   * one the demo's in-process PageAdapter produces. It is the same control-plane shape as `E6_ARM`:
   * **service worker only** (`sender.tab` is refused), so a content script cannot ask the core realm
   * to observe on its behalf, and a page cannot reach it at all.
   *
   * NO PAGE VALUE CROSSES. `observePage` returns the transport's own vocabulary — selector, role,
   * accessible name, geometry, visibility — which `contracts.ts` already bounds (TR-10, INV-21).
   * There is no field for a form value here and none is read.
   */
  if (msg.kind === "TRANSPORT_OBSERVE") {
    if (sender.tab) {
      sendResponse({ refused: "OBSERVE_ONLY_FROM_SERVICE_WORKER" });
      return false;
    }
    void observePage(chromeRelay, { tabId: msg.tabId, frameId: msg.frameId })
      .then((observation) => sendResponse({ ok: true, observation }))
      .catch((error: unknown) => sendResponse({ ok: false, refused: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (msg.kind === "ECHO") {
    sendResponse({ instanceId });
    return false;
  }
  if (msg.kind === "STATE") {
    // Sizes only. The stub's values never leave this document.
    sendResponse({ instanceId, createdAt, vaultStubEntries: vaultStub.size, nonces: valueRelease.armedCount(), capabilities: capabilities.armedCount(), running: running !== null });
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
