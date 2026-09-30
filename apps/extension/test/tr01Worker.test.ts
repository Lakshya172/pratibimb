/**
 * M10.4 — the TR-01 detector worker, in Node: the packaging record, the model pin, the protocol, the
 * worker core, the offscreen host (lifecycle, the EXTERNAL 2,000 ms deadline, stale replies,
 * one-at-a-time), and what a failure becomes in the privacy planner.
 *
 * The real worker, real ORT and the real model are exercised in a browser by
 * `tests/browser/extension/run-tr01-worker.mjs`; golden equivalence on the M8.1 frames is
 * `tests/browser/support/m10-worker-golden.test.mjs`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TR01 } from "@pratibimb/perception";
import { loadVerifiedModel, ModelPinError, ORT_PIN } from "@pratibimb/security";

import { createTr01Host, type Tr01Outcome, type WorkerLike } from "../host-lib/tr01-host";
import { TR01_DEADLINE_MS, TR01_PACKAGE } from "../host-lib/tr01-pin";
import { parseTr01Reply, parseTr01Request, TR01_PROTOCOL, type Tr01Reply } from "../host-lib/tr01-protocol";
import { createTr01WorkerCore, Tr01InitError, type Tr01Session, type Tr01WorkerDeps } from "../host-lib/tr01-worker-core";

const ROOT = new URL("../../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const frame = (width = 32, height = 16) => ({ width, height, rgba: new Uint8ClampedArray(width * height * 4).fill(200) });

// ───────────────────────────── packaging ─────────────────────────────

describe("TR-01 packaging record", () => {
  it("is TR01's identity, M8.1's acquisition log, and the pinned ORT version", () => {
    expect(TR01_PACKAGE.modelId).toBe(TR01.modelId);
    expect(TR01_PACKAGE.revision).toBe(TR01.revision);
    expect(TR01_PACKAGE.onnx).toEqual({ name: TR01.asset, bytes: TR01.onnxBytes, sha256: TR01.onnxSha256 });
    expect(TR01_PACKAGE.ortVersion).toBe(ORT_PIN.version);
    const log = JSON.parse(read(TR01_PACKAGE.evidence));
    expect(log.source.revision).toBe(TR01_PACKAGE.revision);
    expect(log.source.files["inference.pdiparams"]).toMatchObject({ bytes: TR01_PACKAGE.source.bytes, sha256: TR01_PACKAGE.source.sha256 });
    expect(log.conversions.every((c: { sha256: string; bytes: number }) => c.sha256 === TR01_PACKAGE.onnx.sha256 && c.bytes === TR01_PACKAGE.onnx.bytes)).toBe(true);
  });

  it("keeps the weights out of git: the model path is ignored, and the build refuses a mismatch", () => {
    expect(TR01_PACKAGE.modelPath.startsWith("artifacts/models/")).toBe(true);
    expect(read(".gitignore")).toMatch(/^artifacts\/models\/$/m);
    const config = read("apps/extension/wxt.config.ts");
    expect(config).toContain("TR01_PACKAGE.onnx.sha256");
    expect(config).toMatch(/Refusing to package it/);
  });

  it("the deadline is the owner's 2,000 ms", () => {
    expect(TR01_DEADLINE_MS).toBe(2_000);
  });
});

// ───────────────────────────── the model pin ─────────────────────────────

describe("loadVerifiedModel — exact bytes or nothing", () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const pin = { name: "m.onnx", bytes: 5, sha256: sha };
  const serve = (body: Uint8Array | null, status = 200) =>
    (async () => (body === null ? Promise.reject(new Error("no such file")) : new Response(body as unknown as BodyInit, { status }))) as unknown as typeof fetch;
  const opts = (fetchImpl: typeof fetch, p = pin) => ({ pin: p, resolveAssetUrl: (n: string) => `chrome-extension://x/${n}`, fetchImpl });

  it("accepts the pinned bytes and reports their digest", async () => {
    const m = await loadVerifiedModel(opts(serve(bytes)));
    expect(m.sha256).toBe(sha);
    expect(Array.from(m.bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("refuses a missing model", async () => {
    await expect(loadVerifiedModel(opts(serve(null)))).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    await expect(loadVerifiedModel(opts(serve(bytes, 404)))).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });

  it("refuses a wrong model, recording expected and actual", async () => {
    const wrong = new Uint8Array([9, 9, 9, 9, 9]);
    const err = (await loadVerifiedModel(opts(serve(wrong))).catch((e) => e)) as ModelPinError;
    expect(err).toBeInstanceOf(ModelPinError);
    expect(err.code).toBe("MODEL_HASH_MISMATCH");
    expect(err.observed).toEqual({ sha256: createHash("sha256").update(wrong).digest("hex"), bytes: 5 });
    expect(err.message).toContain(sha);
  });

  it("refuses the right digest at the wrong declared length", async () => {
    await expect(loadVerifiedModel(opts(serve(bytes), { ...pin, bytes: 6 }))).rejects.toMatchObject({ code: "MODEL_HASH_MISMATCH" });
  });
});

// ───────────────────────────── the protocol ─────────────────────────────

describe("the worker protocol is strict and geometry-only", () => {
  const f = { width: 100, height: 50 };
  const result = (detections: unknown[], over: Record<string, unknown> = {}) => ({
    type: "TR01_RESULT",
    protocol: TR01_PROTOCOL,
    runId: 3,
    detections,
    ms: { preprocess: 1, infer: 2, postprocess: 3 },
    ...over,
  });

  it("accepts a DETECT carrying only pixels and dimensions", () => {
    const rgba = new Uint8ClampedArray(2 * 3 * 4);
    expect(parseTr01Request({ type: "TR01_DETECT", protocol: 1, runId: 0, width: 2, height: 3, rgba })).not.toBeNull();
  });

  it.each([
    ["a region id", { regionId: "canvas:0" }],
    ["a selector", { selector: "#chart" }],
    ["a URL", { url: "http://127.0.0.1/a.png" }],
    ["text", { text: "hello" }],
    ["a class", { piiClass: "AADHAAR" }],
  ])("refuses a DETECT carrying %s", (_n, extra) => {
    const rgba = new Uint8ClampedArray(2 * 3 * 4);
    expect(parseTr01Request({ type: "TR01_DETECT", protocol: 1, runId: 0, width: 2, height: 3, rgba, ...extra })).toBeNull();
  });

  it("refuses wrong pixel counts, non-integer sizes, plain arrays and another protocol", () => {
    expect(parseTr01Request({ type: "TR01_DETECT", protocol: 1, runId: 0, width: 2, height: 3, rgba: new Uint8ClampedArray(5) })).toBeNull();
    expect(parseTr01Request({ type: "TR01_DETECT", protocol: 1, runId: 0, width: 2.5, height: 3, rgba: new Uint8ClampedArray(30) })).toBeNull();
    expect(parseTr01Request({ type: "TR01_DETECT", protocol: 1, runId: 0, width: 1, height: 1, rgba: [0, 0, 0, 0] })).toBeNull();
    expect(parseTr01Request({ type: "TR01_INIT", protocol: 2 })).toBeNull();
  });

  it("accepts a RESULT of boxes and scores inside the frame", () => {
    expect(parseTr01Reply(result([{ x: 1, y: 2, w: 10, h: 5, score: 0.9 }]), f)).not.toBeNull();
    expect(parseTr01Reply(result([]), f)).not.toBeNull();
  });

  it.each([
    ["text", { x: 1, y: 2, w: 10, h: 5, score: 0.9, text: "7712" }],
    ["a label", { x: 1, y: 2, w: 10, h: 5, score: 0.9, label: "text-region" }],
    ["a length", { x: 1, y: 2, w: 10, h: 5, score: 0.9, length: 4 }],
    ["a class", { x: 1, y: 2, w: 10, h: 5, score: 0.9, piiClass: null }],
    ["a ref", { x: 1, y: 2, w: 10, h: 5, score: 0.9, ref: "r" }],
    ["a box outside the frame", { x: 95, y: 2, w: 10, h: 5, score: 0.9 }],
    ["a NaN", { x: NaN, y: 2, w: 10, h: 5, score: 0.9 }],
    ["an empty box", { x: 1, y: 2, w: 0, h: 5, score: 0.9 }],
    ["a score above 1", { x: 1, y: 2, w: 10, h: 5, score: 1.5 }],
  ])("refuses a RESULT whose detection carries %s", (_n, d) => {
    expect(parseTr01Reply(result([d]), f)).toBeNull();
  });

  it("refuses a RESULT with an extra top-level field, and a RESULT with no frame to check against", () => {
    expect(parseTr01Reply(result([], { transcript: "x" }), f)).toBeNull();
    expect(parseTr01Reply(result([]))).toBeNull();
  });
});

// ───────────────────────────── the worker core ─────────────────────────────

/** A fake session whose output is a probability map with one text-like blob. */
function blobSession(onInfer?: () => void): Tr01Session {
  return {
    infer: async (_t, dims) => {
      onInfer?.();
      const [, , H, W] = dims;
      const data = new Float32Array(H * W);
      for (let y = 10; y < 20; y++) for (let x = 10; x < 60; x++) data[y * W + x] = 0.9;
      return { data, dims: [1, 1, H, W] };
    },
  };
}

function core(over: Partial<Tr01WorkerDeps> = {}) {
  const posted: Tr01Reply[] = [];
  const deps: Tr01WorkerDeps = {
    installRuntime: async () => {},
    loadModel: async () => ({ bytes: new Uint8Array(4), sha256: "a".repeat(64) }),
    createSession: async () => blobSession(),
    post: (r) => posted.push(r),
    now: () => 0,
    ...over,
  };
  return { c: createTr01WorkerCore(deps), posted };
}
const detectMsg = (runId: number, f = frame(128, 64)) => ({ type: "TR01_DETECT", protocol: TR01_PROTOCOL, ...f, runId });

describe("the worker core", () => {
  it("initialises runtime → verified model → session, and reports READY with the model digest", async () => {
    const order: string[] = [];
    const { c, posted } = core({
      installRuntime: async () => void order.push("runtime"),
      loadModel: async () => (order.push("model"), { bytes: new Uint8Array(7), sha256: "b".repeat(64) }),
      createSession: async () => (order.push("session"), blobSession()),
    });
    await c.handle({ type: "TR01_INIT", protocol: TR01_PROTOCOL });
    expect(order).toEqual(["runtime", "model", "session"]);
    expect(posted[0]).toMatchObject({ type: "TR01_READY", model: { sha256: "b".repeat(64), bytes: 7 } });
  });

  it.each([
    ["a missing model", new Tr01InitError("no file", "MODEL_UNAVAILABLE"), "MODEL_UNAVAILABLE"],
    ["a wrong model", new Tr01InitError("mismatch", "MODEL_HASH_MISMATCH", { sha256: "c".repeat(64), bytes: 9 }), "MODEL_HASH_MISMATCH"],
  ])("refuses to initialise on %s, and never creates a session", async (_n, error, code) => {
    let sessions = 0;
    const { c, posted } = core({ loadModel: async () => Promise.reject(error), createSession: async () => (sessions++, blobSession()) });
    await c.handle({ type: "TR01_INIT", protocol: TR01_PROTOCOL });
    expect(sessions).toBe(0);
    expect(posted[0]).toMatchObject({ type: "TR01_INIT_FAILED", code });
    await c.handle(detectMsg(1));
    expect(posted[1]).toMatchObject({ type: "TR01_REFUSED", runId: 1, code: "DETECTOR_UNAVAILABLE" });
  });

  it("returns geometry-only detections, deterministically", async () => {
    const { c, posted } = core();
    await c.handle({ type: "TR01_INIT", protocol: TR01_PROTOCOL });
    await c.handle(detectMsg(1));
    await c.handle(detectMsg(2));
    const [a, b] = posted.slice(1) as Extract<Tr01Reply, { type: "TR01_RESULT" }>[];
    expect(a!.type).toBe("TR01_RESULT");
    expect(a!.detections.length).toBeGreaterThan(0);
    expect(b!.detections).toEqual(a!.detections);
    for (const d of a!.detections) expect(Object.keys(d).sort()).toEqual(["h", "score", "w", "x", "y"]);
    expect(parseTr01Reply(a, { width: 128, height: 64 })).toEqual(a);
  });

  it("an empty map is an empty RESULT — the only way to get []", async () => {
    const { c, posted } = core({
      createSession: async () => ({ infer: async (_t, d) => ({ data: new Float32Array(d[2] * d[3]), dims: [1, 1, d[2], d[3]] }) }),
    });
    await c.handle({ type: "TR01_INIT", protocol: TR01_PROTOCOL });
    await c.handle(detectMsg(1));
    expect(posted[1]).toMatchObject({ type: "TR01_RESULT", runId: 1, detections: [] });
  });

  it("refuses malformed model output and a runtime error — never []", async () => {
    const bad = core({ createSession: async () => ({ infer: async () => ({ data: new Float32Array(3), dims: [1, 1, 1, 3] }) }) });
    await bad.c.handle({ type: "TR01_INIT", protocol: TR01_PROTOCOL });
    await bad.c.handle(detectMsg(1));
    expect(bad.posted[1]).toMatchObject({ type: "TR01_REFUSED", runId: 1, code: "MODEL_OUTPUT_MALFORMED" });

    const boom = core({ createSession: async () => ({ infer: async () => Promise.reject(new Error("wasm trap")) }) });
    await boom.c.handle({ type: "TR01_INIT", protocol: TR01_PROTOCOL });
    await boom.c.handle(detectMsg(1));
    expect(boom.posted[1]).toMatchObject({ type: "TR01_REFUSED", runId: 1, code: "DETECTOR_UNAVAILABLE" });
  });

  it("refuses a malformed request, a second INIT and a DETECT before INIT", async () => {
    const { c, posted } = core();
    await c.handle(detectMsg(1));
    await c.handle({ type: "TR01_DETECT", protocol: TR01_PROTOCOL, runId: 2, width: 1, height: 1, rgba: [0] });
    await c.handle({ type: "TR01_INIT", protocol: TR01_PROTOCOL });
    await c.handle({ type: "TR01_INIT", protocol: TR01_PROTOCOL });
    expect(posted.map((p) => (p.type === "TR01_REFUSED" ? p.code : p.type))).toEqual(["DETECTOR_UNAVAILABLE", "PROTOCOL_ERROR", "TR01_READY", "PROTOCOL_ERROR"]);
  });

  it("runs one inference at a time inside the worker too", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { c, posted } = core({
      createSession: async () => ({
        infer: async (_t, d) => {
          await gate;
          return { data: new Float32Array(d[2] * d[3]), dims: [1, 1, d[2], d[3]] };
        },
      }),
    });
    await c.handle({ type: "TR01_INIT", protocol: TR01_PROTOCOL });
    const first = c.handle(detectMsg(1));
    await c.handle(detectMsg(2));
    expect(posted[1]).toMatchObject({ type: "TR01_REFUSED", runId: 2, code: "DETECTOR_BUSY" });
    release();
    await first;
    expect(posted[2]).toMatchObject({ type: "TR01_RESULT", runId: 1 });
  });
});

// ───────────────────────────── the host ─────────────────────────────

/** Deterministic timers: nothing fires until the test says so. */
function manualTimers() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => (timers.set(++id, { at: now + ms, fn }), id),
    clearTimer: (h: unknown) => void timers.delete(h as number),
    advance(ms: number) {
      now += ms;
      for (const [k, t] of [...timers]) if (t.at <= now) (timers.delete(k), t.fn());
    },
    pending: () => timers.size,
  };
}

type Script = { init?: "ready" | "fail" | "silent" | "error"; run?: "result" | "silent" | "refused" | "malformed" | "text" };

/** A fake worker driven by a script, recording everything that happens to it. */
function fakeWorkers(scripts: Script[]) {
  const made: (WorkerLike & { terminated: boolean; posts: unknown[]; reply: (m: unknown) => void })[] = [];
  const spawn = (): WorkerLike => {
    const script = scripts[made.length] ?? { init: "ready", run: "result" };
    const w = {
      terminated: false,
      posts: [] as unknown[],
      onmessage: null as WorkerLike["onmessage"],
      onerror: null as WorkerLike["onerror"],
      onmessageerror: null as WorkerLike["onmessageerror"],
      reply(m: unknown) {
        if (!w.terminated) queueMicrotask(() => w.onmessage?.({ data: m }));
      },
      terminate() {
        w.terminated = true;
      },
      postMessage(m: unknown) {
        w.posts.push(m);
        const msg = m as { type: string; runId?: number; width?: number; height?: number };
        if (msg.type === "TR01_INIT") {
          if (script.init === "silent") return;
          if (script.init === "error") return void queueMicrotask(() => w.onerror?.(new Error("boom")));
          w.reply(
            script.init === "fail"
              ? { type: "TR01_INIT_FAILED", protocol: 1, code: "MODEL_HASH_MISMATCH", detail: "mismatch", observed: { sha256: "c".repeat(64), bytes: 9 } }
              : { type: "TR01_READY", protocol: 1, model: { sha256: TR01.onnxSha256, bytes: TR01.onnxBytes }, ms: { runtime: 1, model: 2, session: 3 } }
          );
        }
        if (msg.type === "TR01_DETECT") {
          const run = script.run ?? "result";
          if (run === "silent") return;
          if (run === "refused") return w.reply({ type: "TR01_REFUSED", protocol: 1, runId: msg.runId, code: "DETECTOR_UNAVAILABLE", detail: "trap" });
          const d = run === "text" ? { x: 1, y: 1, w: 2, h: 2, score: 0.9, text: "7712" } : run === "malformed" ? { x: 1, y: 1, w: 999, h: 2, score: 0.9 } : { x: 1, y: 1, w: 2, h: 2, score: 0.9 };
          w.reply({ type: "TR01_RESULT", protocol: 1, runId: msg.runId, detections: [d], ms: { preprocess: 1, infer: 1, postprocess: 1 } });
        }
      },
    };
    made.push(w);
    return w;
  };
  return { spawn, made };
}

const hostWith = (scripts: Script[]) => {
  const t = manualTimers();
  const w = fakeWorkers(scripts);
  const host = createTr01Host({ spawn: w.spawn, now: t.now, setTimer: t.setTimer, clearTimer: t.clearTimer });
  return { host, t, w };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the host: lifecycle", () => {
  it("creates nothing until asked, then one worker, initialised once", async () => {
    const { host, w } = hostWith([{}]);
    expect(host.status().state).toBe("idle");
    expect(w.made).toHaveLength(0);
    const a = await host.detect(frame());
    const b = await host.detect(frame());
    expect(a.ok && b.ok).toBe(true);
    expect(w.made).toHaveLength(1);
    expect(w.made[0]!.posts.filter((p) => (p as { type: string }).type === "TR01_INIT")).toHaveLength(1);
    expect(host.status()).toMatchObject({ state: "ready", workersCreated: 1, lastInit: { ok: true } });
  });

  it("an initialisation failure is UNAVAILABLE for the document's life — no retry", async () => {
    const { host, w } = hostWith([{ init: "fail" }, {}]);
    const a = await host.detect(frame());
    expect(a).toMatchObject({ ok: false, code: "DETECTOR_UNAVAILABLE" });
    expect(host.status()).toMatchObject({ state: "unavailable", lastInit: { ok: false, code: "MODEL_HASH_MISMATCH", observed: { bytes: 9 } } });
    const b = await host.detect(frame());
    expect(b).toMatchObject({ ok: false, code: "DETECTOR_UNAVAILABLE" });
    expect(w.made).toHaveLength(1);
    expect(w.made[0]!.terminated).toBe(true);
  });

  it("a worker error during initialisation is UNAVAILABLE", async () => {
    const { host } = hostWith([{ init: "error" }]);
    expect(await host.detect(frame())).toMatchObject({ ok: false, code: "DETECTOR_UNAVAILABLE" });
    expect(host.status().state).toBe("unavailable");
  });

  it("a hung initialisation is UNAVAILABLE after the init deadline, and the worker is terminated", async () => {
    const { host, t, w } = hostWith([{ init: "silent" }]);
    const pending = host.detect(frame());
    await flush();
    t.advance(30_000);
    expect(await pending).toMatchObject({ ok: false, code: "DETECTOR_UNAVAILABLE" });
    expect(w.made[0]!.terminated).toBe(true);
    expect(host.status().lastInit).toMatchObject({ ok: false, code: "INIT_TIMEOUT" });
  });

  it("prepare() initialises without a run; dispose() terminates and refuses afterwards", async () => {
    const { host, w } = hostWith([{}]);
    expect(await host.prepare()).toBe(true);
    expect(host.status().state).toBe("ready");
    host.dispose();
    expect(w.made[0]!.terminated).toBe(true);
    expect(await host.detect(frame())).toMatchObject({ ok: false, code: "DETECTOR_DISPOSED" });
  });

  it("sends a COPY of the pixels, so the realm keeps its own frame", async () => {
    const { host } = hostWith([{}]);
    const f = frame();
    await host.detect(f);
    expect(f.rgba.length).toBe(32 * 16 * 4);
    expect(f.rgba[0]).toBe(200);
  });
});

describe("the host: the 2,000 ms deadline is enforced from outside", () => {
  it("normal inference inside the deadline is a valid result", async () => {
    const { host, t } = hostWith([{}]);
    const out = await host.detect(frame());
    expect(out.ok).toBe(true);
    expect(t.pending()).toBe(0);
  });

  it("the deadline starts AFTER initialisation", async () => {
    const { host, t, w } = hostWith([{ run: "silent" }]);
    const pending = host.detect(frame());
    await flush();
    expect(host.status().state).toBe("running");
    t.advance(TR01_DEADLINE_MS - 1);
    await flush();
    expect(w.made[0]!.terminated).toBe(false);
    t.advance(1);
    const out = await pending;
    expect(out).toMatchObject({ ok: false, code: "DETECTOR_TIMEOUT" });
  });

  it("a caller may tighten the deadline for one run, never loosen it", async () => {
    const tight = hostWith([{ run: "silent" }]);
    const p = tight.host.detect(frame(), { deadlineMs: 50 });
    await flush();
    tight.t.advance(50);
    expect(await p).toMatchObject({ ok: false, code: "DETECTOR_TIMEOUT" });

    const loose = hostWith([{ run: "silent" }]);
    const q = loose.host.detect(frame(), { deadlineMs: 60_000 });
    await flush();
    loose.t.advance(TR01_DEADLINE_MS);
    expect(await q).toMatchObject({ ok: false, code: "DETECTOR_TIMEOUT" });
  });

  it("timeout → the worker is TERMINATED → DETECTOR_TIMEOUT, which is not an empty list", async () => {
    const { host, t, w } = hostWith([{ run: "silent" }, {}]);
    const pending = host.detect(frame());
    await flush();
    t.advance(TR01_DEADLINE_MS);
    const out = (await pending) as Extract<Tr01Outcome, { ok: false }>;
    expect(out.ok).toBe(false);
    expect(out.code).toBe("DETECTOR_TIMEOUT");
    expect(out).not.toHaveProperty("detections");
    expect(w.made[0]!.terminated).toBe(true);
    expect(host.status()).toMatchObject({ state: "idle", terminations: 1 });
  });

  it("timeout → recreate → the next run succeeds on a fresh worker", async () => {
    const { host, t, w } = hostWith([{ run: "silent" }, {}]);
    const first = host.detect(frame());
    await flush();
    t.advance(TR01_DEADLINE_MS);
    expect((await first).ok).toBe(false);
    const second = await host.detect(frame());
    expect(second.ok).toBe(true);
    expect(w.made).toHaveLength(2);
    expect(host.status()).toMatchObject({ state: "ready", generation: 2, workersCreated: 2 });
  });

  it("a reply that arrives after the timeout is dropped, never accepted as a result", async () => {
    const { host, t, w } = hostWith([{ run: "silent" }, {}]);
    const first = host.detect(frame());
    await flush();
    t.advance(TR01_DEADLINE_MS);
    expect((await first).ok).toBe(false);
    const late = w.made[0]!;
    const next = host.detect(frame());
    // The terminated worker's handlers were detached; a late RESULT for run 1 cannot reach the host.
    expect(late.onmessage).toBeNull();
    const out = await next;
    expect(out.ok && out.runId).toBe(2);
  });

  it("a stale reply from a previous worker generation is counted and dropped", async () => {
    const { host, t, w } = hostWith([{ run: "silent" }, { run: "silent" }]);
    const first = host.detect(frame());
    await flush();
    const oldHandler = w.made[0]!.onmessage!;
    t.advance(TR01_DEADLINE_MS);
    await first;
    const second = host.detect(frame());
    await flush();
    // Simulate the old worker's message landing anyway (a handler kept by a buggy caller).
    oldHandler({ data: { type: "TR01_RESULT", protocol: 1, runId: 1, detections: [], ms: { preprocess: 0, infer: 0, postprocess: 0 } } });
    expect(host.status().staleDropped).toBe(1);
    t.advance(TR01_DEADLINE_MS);
    expect(await second).toMatchObject({ ok: false, code: "DETECTOR_TIMEOUT", runId: 2 });
  });

  it("a reply naming another run id is dropped; the current run still times out", async () => {
    const { host, t, w } = hostWith([{ run: "silent" }]);
    const p = host.detect(frame());
    await flush();
    w.made[0]!.onmessage!({ data: { type: "TR01_RESULT", protocol: 1, runId: 99, detections: [], ms: { preprocess: 0, infer: 0, postprocess: 0 } } });
    expect(host.status().staleDropped).toBe(1);
    t.advance(TR01_DEADLINE_MS);
    expect(await p).toMatchObject({ ok: false, code: "DETECTOR_TIMEOUT" });
  });
});

describe("the host: failure semantics", () => {
  it.each([
    ["a worker refusal", "refused", "DETECTOR_ERROR"],
    ["a box outside the frame", "malformed", "MODEL_OUTPUT_MALFORMED"],
    ["a detection carrying text", "text", "MODEL_OUTPUT_MALFORMED"],
  ] as const)("%s → %s, never []", async (_n, run, code) => {
    const { host } = hostWith([{ run }]);
    const out = await host.detect(frame());
    expect(out).toMatchObject({ ok: false, code });
    expect(out).not.toHaveProperty("detections");
  });

  it("a malformed reply replaces the worker", async () => {
    const { host, w } = hostWith([{ run: "text" }, {}]);
    await host.detect(frame());
    expect(w.made[0]!.terminated).toBe(true);
    expect((await host.detect(frame())).ok).toBe(true);
  });

  it("a worker crash mid-run is DETECTOR_ERROR, and the next run recreates it", async () => {
    const { host, w } = hostWith([{ run: "silent" }, {}]);
    const p = host.detect(frame());
    await flush();
    w.made[0]!.onerror!(new Error("crash"));
    expect(await p).toMatchObject({ ok: false, code: "DETECTOR_ERROR" });
    expect((await host.detect(frame())).ok).toBe(true);
    expect(w.made).toHaveLength(2);
  });

  it("an undeserialisable message is DETECTOR_ERROR", async () => {
    const { host, w } = hostWith([{ run: "silent" }]);
    const p = host.detect(frame());
    await flush();
    w.made[0]!.onmessageerror!(new Error("clone"));
    expect(await p).toMatchObject({ ok: false, code: "DETECTOR_ERROR" });
  });
});

describe("the host: one run at a time, explicitly", () => {
  it("request B while A runs is REFUSED (DETECTOR_BUSY), not queued; A completes", async () => {
    const { host, w } = hostWith([{}]);
    await host.prepare();
    const a = host.detect(frame());
    const b = await host.detect(frame());
    expect(b).toMatchObject({ ok: false, code: "DETECTOR_BUSY" });
    expect((await a).ok).toBe(true);
    const detects = w.made[0]!.posts.filter((p) => (p as { type: string }).type === "TR01_DETECT");
    expect(detects).toHaveLength(1);
  });

  it("a request during initialisation is also refused", async () => {
    const { host } = hostWith([{}]);
    const a = host.detect(frame());
    expect(await host.detect(frame())).toMatchObject({ ok: false, code: "DETECTOR_BUSY" });
    expect((await a).ok).toBe(true);
  });
});

// ───────────────────────────── the boundary, structurally ─────────────────────────────

describe("the worker and its host: no network, no text, no OCR, no egress, no actions", () => {
  const files = {
    worker: strip(read("apps/extension/host/tr01-worker.ts")),
    core: strip(read("apps/extension/host-lib/tr01-worker-core.ts")),
    host: strip(read("apps/extension/host-lib/tr01-host.ts")),
    protocol: strip(read("apps/extension/host-lib/tr01-protocol.ts")),
    redaction: strip(read("apps/extension/host-lib/visual-redaction.ts")),
  };

  it.each(Object.entries(files))("%s: no network API other than the pinned package fetches", (_n, src) => {
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|chrome\.runtime\.sendMessage|connect\(/);
  });

  it.each(Object.entries(files))("%s: no OCR, recognition or text handling", (_n, src) => {
    expect(src).not.toMatch(/OCRProvider|recogni[sz]|ppocrv5.*rec|_rec\b|TextDecoder|textContent|innerText|transcript/i);
  });

  it.each(Object.entries(files))("%s: no egress, encode, capture or action", (_n, src) => {
    expect(src).not.toMatch(/@pratibimb\/egress|sendVerified|convertToBlob|toDataURL|image\/webp|captureVisibleTab|getUserMedia|tabCapture|guardedAct|dispatchEvent|\.click\(/);
  });

  it("the worker imports only the runtime pin, the model pin and its own core", () => {
    const imports = [...files.worker.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["#tr01-instrument", "../entrypoints/ortRuntime", "../host-lib/tr01-pin", "../host-lib/tr01-protocol", "../host-lib/tr01-worker-core", "@pratibimb/security"]);
  });

  it("the worker never names a region, a selector or a page", () => {
    for (const src of [files.worker, files.core, files.protocol]) expect(src).not.toMatch(/regionId|selector|documentId|origin:\s*string|href\b(?!\))/);
  });

  it("nothing in the product calls the host yet — only the test-build probe does", () => {
    const main = strip(read("apps/extension/host/offscreen/main.ts"));
    expect(main).not.toMatch(/createTr01Host|spawnTr01Worker|tr01-host/);
    expect(main).toContain('from "#tr01-probe"');
    const absent = strip(read("apps/extension/probe/tr01-absent.ts"));
    expect(absent).not.toMatch(/createTr01Host|Worker/);
  });
});
