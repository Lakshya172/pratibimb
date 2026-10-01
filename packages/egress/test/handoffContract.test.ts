/**
 * M11 — the production frame-handoff contract (ADR-0012, PROPOSED). Every failure fails closed:
 * STRUCTURE_ONLY (the manifest, no image) or STOP (nothing). No input produces a frame.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { WEBP_QUALITY, attestMaskedFrame, type MaskVerifiedFrame, type RgbaFrame } from "@pratibimb/privacy";

import {
  ADMISSIBLE_FRAME_STATE,
  bodyMatchesPin,
  buildHandoffBody,
  canonicalJson,
  checkManifest,
  createSentRegistry,
  decideHandoff,
  isAdmittedFrameVerdict,
  parseHandoffBody,
  type HandoffConfig,
  type HandoffInput,
} from "../src/index.js";

const W = 40;
const H = 30;
const ORIGIN = "https://reasoner.example.test";
const CONFIG: HandoffConfig = { frameEgress: "DISABLED", productionOrigin: ORIGIN };
const ascii = (s: string) => [...new TextEncoder().encode(s)];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const riff = (chunks: [string, number[]][]) => {
  const body = [...ascii("WEBP")];
  for (const [id, data] of chunks) body.push(...ascii(id), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : []));
  return Uint8Array.from([...ascii("RIFF"), ...le32(body.length), ...body]);
};
const vp8 = (w: number, h: number) => [0, 0, 0, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, h & 0xff, (h >> 8) & 0x3f];
const vp8x = (flags: number, w: number, h: number) => [flags, 0, 0, 0, (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, 0, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, 0];
function sanitized(): RgbaFrame {
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 8; y < 22; y++) for (let x = 10; x < 30; x++) rgba.set([0, 0, 0, 255], (y * W + x) * 4);
  return { width: W, height: H, rgba };
}
async function attested(bytes = riff([["VP8 ", vp8(W, H)]])): Promise<MaskVerifiedFrame> {
  const out = await attestMaskedFrame({ bytes, sanitized: sanitized(), decoded: sanitized(), regions: [{ regionId: "canvas:0", pixelRects: [{ x: 10, y: 8, w: 20, h: 14 }] }], frameId: "f", scaleToCss: 1, failClosed: false, reason: null, quality: WEBP_QUALITY });
  if (!out.ok) throw new Error(out.code);
  return out.frame;
}
const manifest = (over: Record<string, unknown> = {}) => ({
  manifest_version: "1.2",
  capture: { w: W, h: H, format: "webp", q: 62, dpr: 1, zoom: 1, scale_to_css: 1, scroll: { x: 0, y: 0 }, origin: "http://127.0.0.1:8983" },
  capability: { backend: "wasm", tiers_fired: ["T1"] },
  redactions: [{ token: "<PII:PHONE:1>", class: "PHONE", tier: "PERSONAL", bbox: [1, 2, 3, 4], method: "token_reference", detectors: ["D1"], hint: { len: 10, kind: "numeric" }, targetId: "e1" }],
  elements: [{ id: "e1", role: "textbox", name: "Phone", bbox: [1, 2, 3, 4], source: "dom", visible: true, offscreen: false, enabled: true }],
  visual_masks: [{ region_id: "canvas:0", kind: "canvas", bbox: [10, 8, 20, 14], method: "opaque_fill", reason: "DETECTED" }],
  verified: true,
  goal: "Complete the application form",
  request: { id: "req-1", session: "ses-1" },
  ...over,
});
const verdictFor = (f: MaskVerifiedFrame, over: Record<string, unknown> = {}) => ({ verdict: "PASS", state: "VERIFIED", frameSha256: f.sha256, requestId: "req-1", ...over });
const input = async (over: Partial<HandoffInput> = {}): Promise<HandoffInput> => {
  const frame = await attested();
  return { config: CONFIG, destination: `${ORIGIN}/v1/plan`, manifest: manifest(), frame, verdict: verdictFor(frame), sent: createSentRegistry(), ...over };
};
const hasImageBytes = (b: Uint8Array) => {
  const t = new TextDecoder("latin1").decode(b);
  return t.includes("RIFF") || t.includes("WEBP") || t.includes("image/webp") || t.includes('name="frame"');
};
const structureOnly = async (over: Partial<HandoffInput>, reason: string) => {
  const d = await decideHandoff(await input(over));
  expect(d.mode).toBe("STRUCTURE_ONLY");
  if (d.mode !== "STRUCTURE_ONLY") return;
  expect(d.frameRefusal).toBe(reason);
  expect(d.notice).toBe("IMAGE_WITHHELD");
  expect(d.handoff.parts).toEqual(["manifest"]);
  expect(hasImageBytes(d.handoff.body)).toBe(false);
  const parsed = parseHandoffBody(d.handoff.body, d.handoff.contentType);
  expect(parsed).toMatchObject({ ok: true, frame: null });
  expect((parsed as { manifest: { capture: { format: string } } }).manifest.capture).toMatchObject({ format: "none" });
};
const stopped = async (over: Partial<HandoffInput>, cause: string) => {
  const d = await decideHandoff(await input(over));
  expect(d).toMatchObject({ mode: "STOP", cause });
};

describe("ADR-0012 fail-closed decision: every frame failure → no frame", () => {
  it("1. a raw frame (RGBA, shaped like an artifact) → structure-only, and the fallback carries no image", async () => {
    const raw = { contentType: "image/webp", width: W, height: H, bytes: new Uint8Array(W * H * 4), sha256: "x", manifest: {} };
    await structureOnly({ frame: raw }, "FRAME_NOT_ATTESTED");
  });
  it("2. an unattested WebP → structure-only", async () => {
    await structureOnly({ frame: { contentType: "image/webp", width: W, height: H, bytes: riff([["VP8 ", vp8(W, H)]]), sha256: "x", manifest: {} } }, "FRAME_NOT_ATTESTED");
  });
  it("3. a stale attestation (the verdict names another frame) → structure-only", async () => {
    const f = await attested();
    await structureOnly({ frame: f, verdict: verdictFor(f, { frameSha256: "0".repeat(64) }) }, "STALE_ATTESTATION");
  });
  it("4. a hash mismatch (bytes changed after attestation) → structure-only", async () => {
    const f = await attested();
    const b = f.bytes as Uint8Array;
    b[b.length - 1] = (b[b.length - 1] as number) ^ 0xff;
    await structureOnly({ frame: f, verdict: verdictFor(f) }, "FRAME_HASH_MISMATCH");
  });
  it("5. payload mutation: any byte of a built body breaks its pin", async () => {
    const f = await attested();
    const built = await buildHandoffBody(manifest(), f.bytes);
    if (!built.ok) throw new Error(built.code);
    expect(await bodyMatchesPin(built.handoff.body, built.handoff.sha256)).toBe(true);
    for (const at of [0, Math.floor(built.handoff.body.length / 2), built.handoff.body.length - 1]) {
      const m = built.handoff.body.slice();
      m[at] = (m[at] as number) ^ 1;
      expect(await bodyMatchesPin(m, built.handoff.sha256)).toBe(false);
    }
  });
  it("6. a malformed manifest → STOP (nothing is sent, not even structure)", async () => {
    await stopped({ manifest: manifest({ manifest_version: "1.1" }) }, "MALFORMED_MANIFEST");
    await stopped({ manifest: manifest({ request: { id: "" } }) }, "MALFORMED_MANIFEST");
    await stopped({ manifest: manifest({ extra: 1 }) }, "MALFORMED_MANIFEST");
    await stopped({ manifest: manifest({ visual_masks: [{ region_id: "#secret-div", kind: "canvas", bbox: [0, 0, 1, 1], method: "opaque_fill", reason: "DETECTED" }] }) }, "MALFORMED_MANIFEST");
  });
  it("7. a missing goal → STOP", async () => {
    await stopped({ manifest: manifest({ goal: "  " }) }, "MISSING_GOAL");
  });
  it("8. an invalid destination → STOP", async () => {
    await stopped({ destination: "not a url" }, "INVALID_DESTINATION");
    await stopped({ destination: "file:///etc/passwd" }, "INVALID_DESTINATION");
  });
  it("9. an origin other than the configured one → STOP (loopback included)", async () => {
    await stopped({ destination: "https://evil.example/v1/plan" }, "DESTINATION_NOT_CONFIGURED_ORIGIN");
    await stopped({ destination: "http://127.0.0.1:8995/m10/frame" }, "DESTINATION_NOT_CONFIGURED_ORIGIN");
  });
  it("10. REFUSED (no sanitized artifact exists) → structure-only, never an image", async () => {
    await structureOnly({ frame: null }, "NO_SANITIZED_ARTIFACT");
  });
  it("11. a verifier BLOCK → structure-only", async () => {
    const f = await attested();
    await structureOnly({ frame: f, verdict: verdictFor(f, { verdict: "BLOCK" }) }, "VERIFIER_BLOCK");
  });
  it("12. structure-only is the manifest alone, capture.format none, built by the same builder", async () => {
    const d = await decideHandoff(await input());
    expect(d.mode).toBe("STRUCTURE_ONLY");
    if (d.mode !== "STRUCTURE_ONLY") return;
    const parsed = parseHandoffBody(d.handoff.body, d.handoff.contentType) as { ok: true; manifest: { capture: Record<string, unknown>; goal: string } };
    expect(parsed.manifest.capture.format).toBe("none");
    expect(parsed.manifest.capture).not.toHaveProperty("q");
    expect(parsed.manifest.goal).toBe("Complete the application form");
  });
  it("13. no input yields a frame: a perfect artifact with a VERIFIED-looking verdict is still refused (no admitted verdict exists; the switch is DISABLED)", async () => {
    const f = await attested();
    const d = await decideHandoff(await input({ frame: f, verdict: verdictFor(f) }));
    expect(d).toMatchObject({ mode: "STRUCTURE_ONLY", frameRefusal: "VERDICT_NOT_ADMITTED" });
    expect(isAdmittedFrameVerdict(verdictFor(f))).toBe(false);
    expect(ADMISSIBLE_FRAME_STATE).toBe("VERIFIED");
    // @ts-expect-error — the switch has one value; enabling frame egress is a reviewed change, not a config flip.
    const enabled: HandoffConfig = { frameEgress: "ENABLED", productionOrigin: ORIGIN };
    expect(enabled.frameEgress).toBe("ENABLED");
  });
  it("13b. MASK_VERIFIED and DETECTOR_VERIFIED are not admissible", async () => {
    const f = await attested();
    for (const state of ["MASKED_LOCAL", "MASK_VERIFIED", "DETECTOR_VERIFIED"]) await structureOnly({ frame: f, verdict: verdictFor(f, { state }) }, "STATE_NOT_ADMISSIBLE");
  });
  it("14. plaintext in the manifest → STOP: forbidden fields, encoded payloads, vault values", async () => {
    await stopped({ manifest: manifest({ elements: [{ id: "e1", role: "textbox", name: "Phone", text: "x" }] }) }, "PLAINTEXT_IN_MANIFEST");
    await stopped({ manifest: manifest({ capability: { backend: "wasm", tiers_fired: ["A".repeat(240)] } }) }, "PLAINTEXT_IN_MANIFEST");
    await stopped({ manifest: manifest({ capability: { backend: "data:image/png;base64,xx", tiers_fired: [] } }) }, "PLAINTEXT_IN_MANIFEST");
    const vault = { holdsLiteral: (s: string) => (s.includes("Complete") ? { held: true as const, piiClass: "NAME" as const } : { held: false as const }) };
    await stopped({ vault }, "PLAINTEXT_IN_MANIFEST");
  });
  it("15. image metadata (EXIF / ICC / XMP) in an attested frame → structure-only", async () => {
    const exif = await attested(riff([["VP8X", vp8x(0x08, W, H)], ["VP8 ", vp8(W, H)], ["EXIF", [1, 2, 3, 4]]]));
    await structureOnly({ frame: exif, verdict: verdictFor(exif) }, "FRAME_NOT_A_STILL_WEBP");
  });
  it("16. a body already sent → STOP (duplicate send)", async () => {
    const first = await decideHandoff(await input());
    if (first.mode !== "STRUCTURE_ONLY") throw new Error("expected structure-only");
    const sent = createSentRegistry();
    sent.mark(first.handoff.sha256);
    await stopped({ sent }, "DUPLICATE_SEND");
  });
  it("17. the wrong run identity → structure-only", async () => {
    const f = await attested();
    await structureOnly({ frame: f, verdict: verdictFor(f, { requestId: "req-OTHER" }) }, "WRONG_RUN_IDENTITY");
  });
  it("18. an empty payload cannot be attested, and an unattested empty one → structure-only", async () => {
    const out = await attestMaskedFrame({ bytes: new Uint8Array(0), sanitized: sanitized(), decoded: sanitized(), regions: [], frameId: "f", scaleToCss: 1, failClosed: false, reason: null, quality: WEBP_QUALITY });
    expect(out).toMatchObject({ ok: false, code: "ENCODE_EMPTY" });
    const f = await attested();
    await structureOnly({ frame: { ...f, bytes: new Uint8Array(0) } }, "FRAME_NOT_ATTESTED");
  });
  it("19. an oversized frame (larger than the pixels it encodes) → structure-only", async () => {
    const big = await attested(riff([["VP8 ", [...vp8(W, H), ...new Array(W * H * 4).fill(7)]]]));
    await structureOnly({ frame: big, verdict: verdictFor(big) }, "OVERSIZED_FRAME");
  });
  it("20. no server configuration → STOP, before anything is examined", async () => {
    await stopped({ config: { frameEgress: "DISABLED", productionOrigin: null } }, "NO_CONFIGURED_PRODUCTION_ORIGIN");
  });
  it("a frame of another size than the manifest's capture → structure-only", async () => {
    const other = await attested(riff([["VP8 ", vp8(W, H)]]));
    await structureOnly({ frame: other, verdict: verdictFor(other), manifest: manifest({ capture: { ...manifest().capture, w: W + 1 } }) }, "FRAME_SIZE_MISMATCH");
  });
});

describe("ADR-0012 §4 body: deterministic, exact, and the server's parser agrees", () => {
  it("builds manifest-then-frame, CRLF, a content-derived boundary, and round-trips exactly", async () => {
    const f = await attested();
    const a = await buildHandoffBody(manifest(), f.bytes);
    const b = await buildHandoffBody(manifest(), f.bytes);
    if (!a.ok || !b.ok) throw new Error("build");
    expect(Buffer.compare(Buffer.from(a.handoff.body), Buffer.from(b.handoff.body))).toBe(0);
    expect(a.handoff.parts).toEqual(["manifest", "frame"]);
    expect(a.handoff.boundary).toBe(`pratibimb-${a.handoff.manifestSha256.slice(0, 32)}`);
    expect(a.handoff.frameSha256).toBe(f.sha256);
    const parsed = parseHandoffBody(a.handoff.body, a.handoff.contentType);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(canonicalJson(parsed.manifest)).toBe(canonicalJson(manifest()));
    expect(Buffer.compare(Buffer.from(parsed.frame!), Buffer.from(f.bytes))).toBe(0);
  });

  it("the manifest is canonical: key order does not change the bytes", async () => {
    const reordered = Object.fromEntries(Object.entries(manifest()).reverse());
    const a = await buildHandoffBody(manifest(), null);
    const b = await buildHandoffBody(reordered, null);
    if (!a.ok || !b.ok) throw new Error("build");
    expect(a.handoff.sha256).toBe(b.handoff.sha256);
  });

  it("the server refuses a body that is not exactly the contract", async () => {
    const f = await attested();
    const built = await buildHandoffBody(manifest(), f.bytes);
    if (!built.ok) throw new Error("build");
    const { body, contentType, boundary } = built.handoff;
    expect(parseHandoffBody(body, "multipart/form-data; boundary=other")).toMatchObject({ ok: false });
    const t = new TextDecoder("latin1").decode(body);
    const extra = new TextEncoder().encode(t.replace(`--${boundary}--\r\n`, `--${boundary}\r\ncontent-disposition: form-data; name="notes"\r\ncontent-type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`));
    expect(parseHandoffBody(extra, contentType)).toMatchObject({ ok: false });
    const noFrame = await buildHandoffBody(manifest(), null);
    if (!noFrame.ok) throw new Error("build");
    expect(parseHandoffBody(noFrame.handoff.body, noFrame.handoff.contentType)).toMatchObject({ ok: false, reason: "capture.format does not match the presence of a frame" });
    const wrongSize = await buildHandoffBody(manifest(), riff([["VP8 ", vp8(W + 2, H)]]));
    if (!wrongSize.ok) throw new Error("build");
    expect(parseHandoffBody(wrongSize.handoff.body, wrongSize.handoff.contentType)).toMatchObject({ ok: false, reason: "the frame is not the manifest's capture size" });
  });

  it("checkManifest accepts the proposed v1.2 manifest", () => {
    expect(checkManifest(manifest())).toEqual({ ok: true });
  });
});

describe("ADR-0012 boundaries in source", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/handoffContract.ts", import.meta.url)), "utf8");
  it("the contract performs no network I/O and holds no admit path", () => {
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
    expect(src).not.toMatch(/ADMITTED\.add\(/);
    expect(src).toMatch(/export type FrameEgressSwitch = "DISABLED";/);
  });
  it("no product module imports the contract", () => {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const files = ["apps/extension/host/offscreen/main.ts", "apps/extension/host/background.ts", "apps/extension/host-lib/perception-realm.ts", "apps/extension/host-lib/extension-run.ts", "packages/reasoner/src/localModel.ts"];
    for (const f of files) expect(readFileSync(`${root}/${f}`, "utf8"), f).not.toMatch(/decideHandoff|buildHandoffBody|handoffContract/);
  });
});
