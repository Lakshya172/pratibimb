/**
 * M12 — QG-04 enforcement: manifest v1.2, the deterministic body, the whole-body attestation, and a
 * production sender that refuses every input before any network I/O. `fetch` is stubbed to throw: a
 * single call anywhere fails the run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEBP_QUALITY, attestMaskedFrame, buildManifestV12, canonicalManifestJson, parseManifestV12, sha256HexOfBytes, type MaskVerifiedFrame, type RgbaFrame } from "@pratibimb/privacy";

import {
  FRAME_EGRESS_STATE,
  PRODUCTION_HANDOFF_CONFIG,
  QG04_PROTOCOL,
  attestHandoffBody,
  attestedBody,
  bodyMatchesPin,
  buildHandoffBody,
  isHandoffAttestation,
  sendProductionHandoff,
  validateQg04Request,
  type ProductionHandoffConfig,
} from "../src/index.js";
import { REQUEST, SESSION, verifiedHandoff } from "./support/handoff.js";

const W = 1024;
const H = 768;
const RUNTIME = { tr01ModelSha256: "18aaccf9c9cd27656becda13bc0ef31eaa0ea3aef4d45166839f2093561575e8", ortWasmSha256: "db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea" };
const EXPECTED = { requestId: REQUEST, sessionId: SESSION };
/** A test-only configuration with an origin, used ONLY to reach the gates after it. Authentication stays NOT_CONFIGURED: no other value exists. */
const TEST_CONFIG: ProductionHandoffConfig = { origin: "https://reasoner.example.test", authentication: { state: "NOT_CONFIGURED" } };
const DEST = "https://reasoner.example.test/v1/plan";

const ascii = (s: string) => [...new TextEncoder().encode(s)];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const webp = (w = W, h = H, extra: [string, number[]][] = []) => {
  const vp8 = [0, 0, 0, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, h & 0xff, (h >> 8) & 0x3f];
  const body = [...ascii("WEBP"), ...ascii("VP8 "), ...le32(vp8.length), ...vp8];
  for (const [id, d] of extra) body.push(...ascii(id), ...le32(d.length), ...d, ...(d.length % 2 ? [0] : []));
  return Uint8Array.from([...ascii("RIFF"), ...le32(body.length), ...body]);
};
const frameRgba = (): RgbaFrame => {
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 100; y < 140; y++) for (let x = 100; x < 400; x++) rgba.set([0, 0, 0, 255], (y * W + x) * 4);
  return { width: W, height: H, rgba };
};
async function maskVerified(bytes = webp(), failClosed = false): Promise<MaskVerifiedFrame> {
  const f = frameRgba();
  const out = await attestMaskedFrame({ bytes, sanitized: f, decoded: f, regions: [{ regionId: "canvas:0", pixelRects: [{ x: 100, y: 100, w: 300, h: 40 }] }], frameId: "f", scaleToCss: 1, failClosed, reason: failClosed ? "TIMEOUT" : null, quality: WEBP_QUALITY });
  if (!out.ok) throw new Error(out.code);
  return out.frame;
}

let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw new Error("NETWORK I/O ATTEMPTED");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(fetchCalls, "no test may cause a network call").toBe(0);
});

describe("manifest v1.2 (approved): built from a verified handoff, parsed strictly, serialized canonically", () => {
  it("1. structure-only: capture.format none, verified true, no q, no visual masks", async () => {
    const { handoff } = await verifiedHandoff();
    const m = buildManifestV12({ handoff, frame: null });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.manifest).toMatchObject({ manifest_version: "1.2", capture: { format: "none", w: W, h: H }, verified: true, visual_masks: [], request: { id: REQUEST, session: SESSION } });
    expect(m.manifest.capture).not.toHaveProperty("q");
  });

  it("1b. with a MASK_VERIFIED frame: format webp, q 62, verified FALSE, masks in CSS px with a closed reason", async () => {
    const { handoff } = await verifiedHandoff();
    const m = buildManifestV12({ handoff, frame: await maskVerified(webp(), true) });
    if (!m.ok) throw new Error(m.detail);
    expect(m.manifest.capture).toMatchObject({ format: "webp", q: 62, w: W, h: H });
    expect(m.manifest.verified).toBe(false);
    expect(m.manifest.visual_masks).toEqual([{ region_id: "canvas:0", kind: "canvas", bbox: [100, 100, 300, 40], method: "opaque_fill", reason: "FAIL_CLOSED:TIMEOUT" }]);
  });

  it("2. the parser round-trips what the builder made, exactly", async () => {
    const { handoff } = await verifiedHandoff();
    const m = buildManifestV12({ handoff, frame: null });
    if (!m.ok) throw new Error("build");
    const again = parseManifestV12(JSON.parse(canonicalManifestJson(m.manifest)));
    expect(again.ok && canonicalManifestJson(again.manifest)).toBe(canonicalManifestJson(m.manifest));
  });

  it("3. an unknown field is refused at any depth, with its path", async () => {
    const { handoff } = await verifiedHandoff();
    const m = buildManifestV12({ handoff, frame: null });
    if (!m.ok) throw new Error("build");
    const base = JSON.parse(canonicalManifestJson(m.manifest));
    expect(parseManifestV12({ ...base, notes: "x" })).toMatchObject({ ok: false, code: "MALFORMED_MANIFEST", path: "$.notes" });
    expect(parseManifestV12({ ...base, capture: { ...base.capture, extra: 1 } })).toMatchObject({ ok: false, path: "$.capture.extra" });
    expect(parseManifestV12({ ...base, elements: [{ ...base.elements[0], aria: "x" }] })).toMatchObject({ ok: false, path: "$.elements[0].aria" });
    expect(parseManifestV12({ ...base, request: { ...base.request, user: "x" } })).toMatchObject({ ok: false, path: "$.request.user" });
  });

  it("4. a malformed visual mask is refused: non-positional id, wrong kind, a fifth field, another method or reason", async () => {
    const { handoff } = await verifiedHandoff();
    const m = buildManifestV12({ handoff, frame: null });
    if (!m.ok) throw new Error("build");
    const base = JSON.parse(canonicalManifestJson(m.manifest));
    const mask = { region_id: "canvas:0", kind: "canvas", bbox: [1, 2, 3, 4], method: "opaque_fill", reason: "DETECTED" };
    expect(parseManifestV12({ ...base, visual_masks: [mask] })).toMatchObject({ ok: true });
    for (const bad of [{ ...mask, region_id: "#secret" }, { ...mask, region_id: "img:0" }, { ...mask, label: "x" }, { ...mask, method: "blur" }, { ...mask, reason: "WHATEVER" }, { ...mask, bbox: [1, 2, 3] }, { ...mask, bbox: [1, 2, 3, Number.NaN] }]) {
      expect(parseManifestV12({ ...base, visual_masks: [bad] }).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseManifestV12({ ...base, visual_masks: [{ ...mask, text: "SYNTH" }] })).toMatchObject({ ok: false, code: "PLAINTEXT_IN_MANIFEST" });
  });

  it("modes are exclusive: webp needs q 62; none must not carry q", async () => {
    const { handoff } = await verifiedHandoff();
    const m = buildManifestV12({ handoff, frame: null });
    if (!m.ok) throw new Error("build");
    const base = JSON.parse(canonicalManifestJson(m.manifest));
    expect(parseManifestV12({ ...base, capture: { ...base.capture, q: 62 } })).toMatchObject({ ok: false, path: "$.capture.q" });
    expect(parseManifestV12({ ...base, capture: { ...base.capture, format: "webp" } })).toMatchObject({ ok: false });
    expect(parseManifestV12({ ...base, capture: { ...base.capture, format: "png" } })).toMatchObject({ ok: false, path: "$.capture.format" });
  });

  it("5. canonical serialization: key order and object identity do not change the bytes", async () => {
    const { handoff } = await verifiedHandoff();
    const m = buildManifestV12({ handoff, frame: null });
    if (!m.ok) throw new Error("build");
    const shuffled = JSON.parse(JSON.stringify(m.manifest, Object.keys(m.manifest).reverse()));
    const parsed = parseManifestV12({ ...shuffled, ...JSON.parse(canonicalManifestJson(m.manifest)) });
    expect(parsed.ok && canonicalManifestJson(parsed.manifest)).toBe(canonicalManifestJson(m.manifest));
    expect(canonicalManifestJson(m.manifest)).not.toMatch(/\s{2}|\n/);
  });
});

describe("the body and its attestation", () => {
  it("6. the same manifest + frame + request identity give byte-identical bodies; a different request id changes them", async () => {
    const { handoff } = await verifiedHandoff();
    const frame = await maskVerified();
    const a = await attestHandoffBody({ handoff, frame, runtime: RUNTIME });
    const b = await attestHandoffBody({ handoff, frame, runtime: RUNTIME });
    if (!a.ok || !b.ok) throw new Error("attest");
    expect(a.attestation.bodySha256).toBe(b.attestation.bodySha256);
    expect(Buffer.compare(Buffer.from(attestedBody(a.attestation)!), Buffer.from(attestedBody(b.attestation)!))).toBe(0);
    const other = await verifiedHandoff({ requestId: "egress-request-2" });
    const c = await attestHandoffBody({ handoff: other.handoff, frame, runtime: RUNTIME });
    if (!c.ok) throw new Error("attest");
    expect(c.attestation.bodySha256).not.toBe(a.attestation.bodySha256);
  });

  it("7–8. the attestation binds the exact body and everything about it", async () => {
    const { handoff } = await verifiedHandoff();
    const frame = await maskVerified();
    const a = await attestHandoffBody({ handoff, frame, runtime: RUNTIME });
    if (!a.ok) throw new Error(a.code);
    const body = attestedBody(a.attestation)!;
    expect(await sha256HexOfBytes(body)).toBe(a.attestation.bodySha256);
    expect(a.attestation).toMatchObject({ protocol: QG04_PROTOCOL, manifestVersion: "1.2", bodyBytes: body.length, frameSha256: frame.sha256, width: W, height: H, requestId: REQUEST, sessionId: SESSION, state: "MASK_VERIFIED", runtime: RUNTIME });
    expect(isHandoffAttestation(a.attestation)).toBe(true);
    expect(Object.isFrozen(a.attestation)).toBe(true);
    const valid = await validateQg04Request({ contentType: a.attestation.contentType, payloadSha256: a.attestation.bodySha256, requestId: REQUEST, body });
    expect(valid.ok).toBe(true);
  });

  it("9. mutation: the returned body is a copy, a forged attestation is not one, and a changed frame cannot be attested", async () => {
    const { handoff } = await verifiedHandoff();
    const frame = await maskVerified();
    const a = await attestHandoffBody({ handoff, frame, runtime: RUNTIME });
    if (!a.ok) throw new Error(a.code);
    const copy = attestedBody(a.attestation)!;
    copy[copy.length - 10] = (copy[copy.length - 10] as number) ^ 0xff;
    expect(await bodyMatchesPin(copy, a.attestation.bodySha256)).toBe(false);
    expect(await bodyMatchesPin(attestedBody(a.attestation)!, a.attestation.bodySha256)).toBe(true);
    const forged = { ...a.attestation, bodySha256: await sha256HexOfBytes(copy) };
    expect(await sendProductionHandoff({ attestation: forged, expected: EXPECTED, destination: DEST, config: TEST_CONFIG })).toMatchObject({ cause: "NOT_ATTESTED" });
    const changed = await maskVerified();
    const bytes = changed.bytes as Uint8Array;
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 1;
    expect(await attestHandoffBody({ handoff, frame: changed, runtime: RUNTIME })).toMatchObject({ ok: false, code: "FRAME_HASH_MISMATCH" });
  });

  it("10. stale: an attestation is used once", async () => {
    const { handoff } = await verifiedHandoff();
    const a = await attestHandoffBody({ handoff, frame: null, runtime: RUNTIME });
    if (!a.ok) throw new Error(a.code);
    expect((await sendProductionHandoff({ attestation: a.attestation, expected: EXPECTED, destination: DEST, config: TEST_CONFIG })).cause).not.toBe("ATTESTATION_SPENT");
    expect(await sendProductionHandoff({ attestation: a.attestation, expected: EXPECTED, destination: DEST, config: TEST_CONFIG })).toMatchObject({ cause: "ATTESTATION_SPENT" });
  });

  it("11. wrong run identity", async () => {
    const { handoff } = await verifiedHandoff();
    const a = await attestHandoffBody({ handoff, frame: null, runtime: RUNTIME });
    if (!a.ok) throw new Error(a.code);
    expect(await sendProductionHandoff({ attestation: a.attestation, expected: { requestId: "another-run", sessionId: SESSION }, destination: DEST, config: TEST_CONFIG })).toMatchObject({ stage: "IDENTITY", cause: "RUN_IDENTITY_MISMATCH" });
  });

  it("raw frames, unattested WebP and metadata never become an attested body", async () => {
    const { handoff } = await verifiedHandoff();
    const raw = { contentType: "image/webp", width: W, height: H, bytes: new Uint8Array(W * H * 4), sha256: "x", manifest: {} };
    expect(await attestHandoffBody({ handoff, frame: raw as unknown as MaskVerifiedFrame, runtime: RUNTIME })).toMatchObject({ ok: false, code: "FRAME_NOT_MASK_VERIFIED" });
    const exif = await maskVerified(webp(W, H, [["EXIF", [1, 2, 3, 4]]]));
    expect(await attestHandoffBody({ handoff, frame: exif, runtime: RUNTIME })).toMatchObject({ ok: false, code: "FRAME_NOT_A_STILL_WEBP" });
    const small = await maskVerified(webp(W / 2, H / 2));
    expect(await attestHandoffBody({ handoff, frame: small, runtime: RUNTIME })).toMatchObject({ ok: false, code: "FRAME_SIZE_MISMATCH" });
  });
});

describe("the production sender: every gate refuses before any network I/O", () => {
  it("12–14. a frame needs VERIFIED: a genuine MASK_VERIFIED body is refused, and nothing can attest DETECTOR_VERIFIED, MASKED_LOCAL or VERIFIED", async () => {
    expect(FRAME_EGRESS_STATE).toBe("VERIFIED");
    const { handoff } = await verifiedHandoff();
    const a = await attestHandoffBody({ handoff, frame: await maskVerified(), runtime: RUNTIME });
    if (!a.ok) throw new Error(a.code);
    expect(await sendProductionHandoff({ attestation: a.attestation, expected: EXPECTED, destination: DEST, config: TEST_CONFIG })).toMatchObject({ stage: "STATE", cause: "STATE_NOT_ADMISSIBLE" });
    for (const state of ["DETECTOR_VERIFIED", "MASKED_LOCAL", "MASK_VERIFIED", "VERIFIED"]) {
      const forged = { ...a.attestation, state };
      expect(await sendProductionHandoff({ attestation: forged as never, expected: EXPECTED, destination: DEST, config: TEST_CONFIG }), state).toMatchObject({ cause: "NOT_ATTESTED" });
    }
  });

  it("15. no production origin (THE configuration) → CONFIGURATION_MISSING", async () => {
    expect(PRODUCTION_HANDOFF_CONFIG).toEqual({ origin: null, authentication: { state: "NOT_CONFIGURED" } });
    expect(Object.isFrozen(PRODUCTION_HANDOFF_CONFIG)).toBe(true);
    const { handoff } = await verifiedHandoff();
    const a = await attestHandoffBody({ handoff, frame: null, runtime: RUNTIME });
    if (!a.ok) throw new Error(a.code);
    expect(await sendProductionHandoff({ attestation: a.attestation, expected: EXPECTED, destination: DEST, config: PRODUCTION_HANDOFF_CONFIG })).toMatchObject({ stage: "CONFIGURATION", cause: "CONFIGURATION_MISSING" });
  });

  it("16. no authentication → AUTHENTICATION_NOT_CONFIGURED; and there is no transport behind it", async () => {
    const { handoff } = await verifiedHandoff();
    const a = await attestHandoffBody({ handoff, frame: null, runtime: RUNTIME });
    if (!a.ok) throw new Error(a.code);
    expect(await sendProductionHandoff({ attestation: a.attestation, expected: EXPECTED, destination: DEST, config: TEST_CONFIG })).toMatchObject({ stage: "AUTHENTICATION", cause: "AUTHENTICATION_NOT_CONFIGURED" });
    // @ts-expect-error — authentication has one state; a "CONFIGURED" one is not representable.
    const configured: ProductionHandoffConfig = { origin: TEST_CONFIG.origin, authentication: { state: "CONFIGURED" } };
    const b = await attestHandoffBody({ handoff, frame: null, runtime: RUNTIME });
    if (!b.ok) throw new Error(b.code);
    expect(await sendProductionHandoff({ attestation: b.attestation, expected: EXPECTED, destination: DEST, config: configured })).toMatchObject({ stage: "TRANSPORT", cause: "PRODUCTION_TRANSPORT_ABSENT" });
  });

  it("22. destination: loopback, http, a placeholder-free mismatch and garbage are all refused", async () => {
    const { handoff } = await verifiedHandoff();
    const attempt = async (config: ProductionHandoffConfig, destination: string) => {
      const a = await attestHandoffBody({ handoff, frame: null, runtime: RUNTIME });
      if (!a.ok) throw new Error(a.code);
      return sendProductionHandoff({ attestation: a.attestation, expected: EXPECTED, destination, config });
    };
    for (const origin of ["http://127.0.0.1:8995", "https://localhost", "http://reasoner.example.test", "https://reasoner.example.test/path", "not a url"]) {
      expect(await attempt({ origin, authentication: { state: "NOT_CONFIGURED" } }, DEST), origin).toMatchObject({ cause: "CONFIGURATION_INVALID" });
    }
    for (const d of ["https://evil.example/v1/plan", "http://127.0.0.1:8995/m10/frame", "nonsense"]) expect(await attempt(TEST_CONFIG, d), d).toMatchObject({ cause: "DESTINATION_NOT_CONFIGURED_ORIGIN" });
  });
});

describe("21. the server's request check", () => {
  it("accepts the exact attested body with its headers, and refuses a wrong hash, request id, part or emptiness", async () => {
    const { handoff } = await verifiedHandoff();
    const a = await attestHandoffBody({ handoff, frame: await maskVerified(), runtime: RUNTIME });
    if (!a.ok) throw new Error(a.code);
    const body = attestedBody(a.attestation)!;
    const ok = { contentType: a.attestation.contentType, payloadSha256: a.attestation.bodySha256, requestId: REQUEST, body };
    expect((await validateQg04Request(ok)).ok).toBe(true);
    expect(await validateQg04Request({ ...ok, payloadSha256: "0".repeat(64) })).toMatchObject({ ok: false });
    expect(await validateQg04Request({ ...ok, payloadSha256: null })).toMatchObject({ ok: false });
    expect(await validateQg04Request({ ...ok, requestId: "other" })).toMatchObject({ ok: false, reason: "the request-id header is not the manifest's" });
    expect(await validateQg04Request({ ...ok, body: new Uint8Array(0), payloadSha256: await sha256HexOfBytes(new Uint8Array(0)) })).toMatchObject({ ok: false, reason: "empty body" });
    const tampered = body.slice();
    tampered[200] = (tampered[200] as number) ^ 1;
    expect(await validateQg04Request({ ...ok, body: tampered })).toMatchObject({ ok: false });
    const structure = await buildHandoffBody(JSON.parse(new TextDecoder().decode(body).split("\r\n\r\n")[1]!.split("\r\n--")[0]!), null);
    expect(structure).toMatchObject({ ok: true }); // a webp manifest without its frame builds…
    if (!structure.ok) return;
    expect(await validateQg04Request({ contentType: structure.handoff.contentType, payloadSha256: structure.handoff.sha256, requestId: REQUEST, body: structure.handoff.body })).toMatchObject({ ok: false, reason: "capture.format does not match the presence of a frame" }); // …and the server refuses it
  });
});
