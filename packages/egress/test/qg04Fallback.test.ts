/**
 * M12 — the structure-only fallback (ADR-0012 §8). Every frame problem gives an attested body with
 * `capture.format: "none"`, NO frame part and NO image byte, plus an IMAGE_WITHHELD notice. Never a
 * raw frame, never an unverified WebP. `fetch` is stubbed to throw and must never be called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEBP_QUALITY, attestMaskedFrame, type MaskVerifiedFrame, type RgbaFrame, type VerifiedHandoff } from "@pratibimb/privacy";

import { PRODUCTION_HANDOFF_CONFIG, attestedBody, parseHandoffBody, planHandoff, sendProductionHandoff } from "../src/index.js";
import { REQUEST, SESSION, verifiedHandoff } from "./support/handoff.js";

const W = 1024;
const H = 768;
const RUNTIME = { tr01ModelSha256: null, ortWasmSha256: null };
const ascii = (s: string) => [...new TextEncoder().encode(s)];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const webp = () => {
  const vp8 = [0, 0, 0, 0x9d, 0x01, 0x2a, W & 0xff, (W >> 8) & 0x3f, H & 0xff, (H >> 8) & 0x3f];
  const body = [...ascii("WEBP"), ...ascii("VP8 "), ...le32(vp8.length), ...vp8];
  return Uint8Array.from([...ascii("RIFF"), ...le32(body.length), ...body]);
};
async function maskVerified(): Promise<MaskVerifiedFrame> {
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 100; y < 140; y++) for (let x = 100; x < 400; x++) rgba.set([0, 0, 0, 255], (y * W + x) * 4);
  const f: RgbaFrame = { width: W, height: H, rgba };
  const out = await attestMaskedFrame({ bytes: webp(), sanitized: f, decoded: f, regions: [{ regionId: "img:2", pixelRects: [{ x: 100, y: 100, w: 300, h: 40 }] }], frameId: "f", scaleToCss: 1, failClosed: false, reason: null, quality: WEBP_QUALITY });
  if (!out.ok) throw new Error(out.code);
  return out.frame;
}
const verdict = (f: MaskVerifiedFrame, over: Record<string, unknown> = {}) => ({ verdict: "PASS", state: "VERIFIED", frameSha256: f.sha256, requestId: REQUEST, ...over });

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

/** Plan, then prove the body is structure-only: one manifest part, format none, no image byte. */
async function expectStructureOnly(handoff: VerifiedHandoff, frame: unknown, v: unknown, reason: string, refused = false) {
  const plan = await planHandoff({ handoff, frame, verdict: v, refused, runtime: RUNTIME });
  expect(plan.mode).toBe("STRUCTURE_ONLY");
  if (plan.mode !== "STRUCTURE_ONLY") throw new Error("not structure-only");
  expect(plan.notice).toEqual({ kind: "IMAGE_WITHHELD", reason });
  expect(plan.attestation).toMatchObject({ state: "STRUCTURE_ONLY", frameSha256: null, requestId: REQUEST, sessionId: SESSION });
  const body = attestedBody(plan.attestation)!;
  const text = new TextDecoder("latin1").decode(body);
  expect(text).not.toMatch(/RIFF|WEBP|VP8|image\/webp|name="frame"/);
  expect(body.length).toBeLessThan(W * H); // nothing frame-sized rides along
  const parsed = parseHandoffBody(body, plan.attestation.contentType);
  expect(parsed).toMatchObject({ ok: true, frame: null });
  return { plan, manifest: (parsed as { manifest: { capture: Record<string, unknown>; visual_masks: unknown[]; verified: boolean; goal: string } }).manifest };
}

describe("ADR-0012 §8: a frame that cannot go → the structure-only body, never an image", () => {
  it("17. a verifier BLOCK → structure-only; the masks are described, not shown", async () => {
    const { handoff } = await verifiedHandoff();
    const f = await maskVerified();
    const { manifest } = await expectStructureOnly(handoff, f, verdict(f, { verdict: "BLOCK" }), "VERIFIER_BLOCK");
    expect(manifest.capture.format).toBe("none");
    expect(manifest.verified).toBe(true);
    expect(manifest.visual_masks).toEqual([{ region_id: "img:2", kind: "img", bbox: [100, 100, 300, 40], method: "opaque_fill", reason: "DETECTED" }]);
    expect(manifest.goal).toBe("Submit my application with my registered mobile number.");
  });

  it("18. REFUSED → structure-only, and nothing about a frame (none ever existed)", async () => {
    const { handoff } = await verifiedHandoff();
    const { manifest } = await expectStructureOnly(handoff, null, null, "REFUSED", true);
    expect(manifest.visual_masks).toEqual([]);
  });

  it("19. a raw frame (RGBA shaped like an artifact) → structure-only; its bytes never enter the body", async () => {
    const { handoff } = await verifiedHandoff();
    const raw = { contentType: "image/webp", width: W, height: H, bytes: new Uint8Array(W * H * 4).fill(0x5a), sha256: "x", manifest: {} };
    const { plan, manifest } = await expectStructureOnly(handoff, raw, null, "FRAME_NOT_MASK_VERIFIED");
    expect(manifest.visual_masks).toEqual([]);
    expect(new TextDecoder("latin1").decode(attestedBody(plan.attestation)!)).not.toContain("ZZZZZZZZ");
  });

  it.each([
    ["MASK_VERIFIED", "STATE_NOT_ADMISSIBLE"],
    ["DETECTOR_VERIFIED", "STATE_NOT_ADMISSIBLE"],
    ["MASKED_LOCAL", "STATE_NOT_ADMISSIBLE"],
  ])("a verdict of %s → structure-only (%s)", async (state, reason) => {
    const { handoff } = await verifiedHandoff();
    const f = await maskVerified();
    await expectStructureOnly(handoff, f, verdict(f, { state }), reason);
  });

  it("stale, wrong-run and unadmitted VERIFIED-looking verdicts → structure-only", async () => {
    const { handoff } = await verifiedHandoff();
    const f = await maskVerified();
    await expectStructureOnly(handoff, f, verdict(f, { frameSha256: "0".repeat(64) }), "STALE_VERDICT");
    await expectStructureOnly(handoff, f, verdict(f, { requestId: "other" }), "WRONG_RUN_IDENTITY");
    await expectStructureOnly(handoff, f, verdict(f), "VERDICT_NOT_ADMITTED");
    await expectStructureOnly(handoff, f, null, "NO_VERDICT");
  });

  it("a tampered frame → structure-only, and its masks are not trusted to describe anything", async () => {
    const { handoff } = await verifiedHandoff();
    const f = await maskVerified();
    const b = f.bytes as Uint8Array;
    b[b.length - 1] = (b[b.length - 1] as number) ^ 1;
    const { manifest } = await expectStructureOnly(handoff, f, verdict(f), "FRAME_HASH_MISMATCH");
    expect(manifest.visual_masks).toEqual([]);
  });

  it("no sanitized artifact → structure-only", async () => {
    const { handoff } = await verifiedHandoff();
    await expectStructureOnly(handoff, null, null, "NO_SANITIZED_ARTIFACT");
  });

  it("a handoff the privacy verifier did not produce → STOP, nothing built", async () => {
    const { handoff } = await verifiedHandoff();
    expect(await planHandoff({ handoff: { ...handoff } as VerifiedHandoff, frame: null, verdict: null, runtime: RUNTIME })).toMatchObject({ mode: "STOP", cause: "HANDOFF_NOT_VERIFIED" });
  });

  it("20. the structure-only body is attested, deterministic, and still cannot leave in production (no origin)", async () => {
    const { handoff } = await verifiedHandoff();
    const f = await maskVerified();
    const a = await planHandoff({ handoff, frame: f, verdict: null, runtime: RUNTIME });
    const b = await planHandoff({ handoff, frame: f, verdict: null, runtime: RUNTIME });
    if (a.mode !== "STRUCTURE_ONLY" || b.mode !== "STRUCTURE_ONLY") throw new Error("plan");
    expect(a.attestation.bodySha256).toBe(b.attestation.bodySha256);
    expect(await sendProductionHandoff({ attestation: a.attestation, expected: { requestId: REQUEST, sessionId: SESSION }, destination: "https://anywhere.example/v1/plan", config: PRODUCTION_HANDOFF_CONFIG })).toMatchObject({ sent: false, cause: "CONFIGURATION_MISSING" });
  });
});
