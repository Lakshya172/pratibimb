import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { MAX_ROUNDS, NOT_RUN, REDILATION_PX, mayHandOff, redilate, survivorsOf, verifyArtifact } from "./artifact-verifier.mjs";

const W = 200;
const H = 100;
const ascii = (s) => [...Buffer.from(s, "latin1")];
const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const webp = (w = W, h = H, salt = 0) => {
  const vp8 = [0, 0, salt, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, h & 0xff, (h >> 8) & 0x3f];
  const body = [...ascii("WEBP"), ...ascii("VP8 "), ...le32(vp8.length), ...vp8];
  return Buffer.from([...ascii("RIFF"), ...le32(body.length), ...body]);
};
const sha = (b) => createHash("sha256").update(b).digest("hex");
const attest = (b, w = W, h = H) => ({ sha256: sha(b), width: w, height: h });
const REGIONS = [
  { id: "canvas:0", rect: { x: 10, y: 10, w: 80, h: 60 } },
  { id: "img:0", rect: { x: 120, y: 10, w: 60, h: 40 } },
];
const frame = () => ({ width: W, height: H, rgba: new Uint8Array(W * H * 4).fill(255) });
/** A re-read that returns, round by round, the given box lists (the last one repeats). */
const reReadSeq = (...lists) => {
  let i = 0;
  return vi.fn(async () => ({ boxes: lists[Math.min(i++, lists.length - 1)], ms: { total: 1 } }));
};
const base = (over = {}) => {
  const bytes = webp();
  return { bytes, attestation: attest(bytes), visualRegions: REGIONS, scaleToCss: 1, decode: vi.fn(async () => frame()), encode: vi.fn(async () => webp(W, H, 7)), reRead: reReadSeq([]), ...over };
};
const OUTSIDE = { x: 100, y: 80, w: 60, h: 10, score: 0.7 }; // between and below the regions
const INSIDE = { x: 20, y: 20, w: 40, h: 12, score: 0.9 };

describe("M10.8 verifier: identity first", () => {
  it("a mutated payload is BLOCKED before anything is decoded", async () => {
    const b = base();
    const mutated = Buffer.from(b.bytes);
    mutated[mutated.length - 1] ^= 0xff;
    const v = await verifyArtifact({ ...b, bytes: mutated });
    expect(v).toMatchObject({ verdict: "BLOCK", status: "BLOCKED", reason: "IDENTITY_MISMATCH" });
    expect(b.decode).not.toHaveBeenCalled();
    expect(b.reRead).not.toHaveBeenCalled();
  });

  it("a valid payload with ANOTHER artifact's attestation (stale or replaced) is BLOCKED", async () => {
    const other = webp(W, H, 9);
    const v = await verifyArtifact({ ...base(), attestation: attest(other) });
    expect(v).toMatchObject({ verdict: "BLOCK", reason: "IDENTITY_MISMATCH" });
  });

  it("no attestation at all is BLOCKED", async () => {
    expect(await verifyArtifact({ ...base(), attestation: null })).toMatchObject({ verdict: "BLOCK", reason: "IDENTITY_MISMATCH" });
  });

  it("bytes that hash right but are not a still WebP of the attested size are BLOCKED", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(20).fill(0)]);
    expect(await verifyArtifact({ ...base(), bytes: png, attestation: attest(png) })).toMatchObject({ verdict: "BLOCK", reason: "NOT_THE_ATTESTED_STILL_WEBP" });
    const big = webp(W + 1, H);
    expect(await verifyArtifact({ ...base(), bytes: big, attestation: attest(big) })).toMatchObject({ reason: "NOT_THE_ATTESTED_STILL_WEBP" });
  });
});

describe("M10.8 verifier: re-read, survivors, 12 px re-dilation, decision", () => {
  it("PASS: no re-detected text inside any visual-only region (text outside them does not count)", async () => {
    const b = base({ reRead: reReadSeq([OUTSIDE]) });
    const v = await verifyArtifact(b);
    expect(v).toMatchObject({ verdict: "PASS", status: "DETECTOR_VERIFIED", reason: null, rounds: [{ round: 0, detections: 1, outsideRegions: 1, survivors: [] }] });
    expect(mayHandOff(v)).toBe(true);
    expect(b.encode).not.toHaveBeenCalled();
  });

  it("survivors cleared by one 12 px round: the ORIGINAL is still BLOCKED, and the reason says so", async () => {
    const b = base({ reRead: reReadSeq([INSIDE, OUTSIDE], [OUTSIDE]) });
    const v = await verifyArtifact(b);
    expect(v).toMatchObject({ verdict: "BLOCK", reason: `SURVIVORS_CLEARED_ONLY_BY_${REDILATION_PX}PX_REDILATION`, clearedAtRound: 1 });
    expect(v.rounds[0].survivors).toEqual([{ box: { x: 20, y: 20, w: 40, h: 12 }, score: 0.9, regions: ["canvas:0"] }]);
    expect(v.rounds[0].redilatedFills).toEqual([{ x: 10, y: 10, w: 62, h: 34 }]); // x 8..72, y 8..44, clipped to canvas:0 (x 10..90, y 10..70)
    expect(b.encode).toHaveBeenCalledTimes(1);
    expect(mayHandOff(v)).toBe(false);
  });

  it(`survivors after ${MAX_ROUNDS} re-dilation rounds: the frozen BLOCK`, async () => {
    const b = base({ reRead: reReadSeq([INSIDE]) });
    const v = await verifyArtifact(b);
    expect(v).toMatchObject({ verdict: "BLOCK", reason: `SURVIVORS_PERSIST_AFTER_${MAX_ROUNDS}_ROUNDS` });
    expect(b.reRead).toHaveBeenCalledTimes(MAX_ROUNDS + 1);
    expect(b.encode).toHaveBeenCalledTimes(MAX_ROUNDS);
    expect(v.rounds).toHaveLength(MAX_ROUNDS + 1);
  });

  it("re-dilation fills a COPY: the decoded frame the verifier was given is not altered", async () => {
    const decoded = frame();
    const before = sha(decoded.rgba);
    let filled = null;
    await verifyArtifact(base({ decode: vi.fn(async () => decoded), reRead: reReadSeq([INSIDE], []), encode: vi.fn(async (f) => ((filled = f), webp(W, H, 3))) }));
    expect(sha(decoded.rgba)).toBe(before);
    expect(filled.rgba).not.toBe(decoded.rgba);
    expect(filled.rgba[(20 * W + 20) * 4]).toBe(0);
  });

  it("a verifier that cannot run BLOCKS: decode failure, re-read failure, a decode of another size", async () => {
    expect(await verifyArtifact(base({ decode: vi.fn(async () => Promise.reject(new Error("x"))) }))).toMatchObject({ verdict: "BLOCK", reason: "DECODE_FAILED" });
    expect(await verifyArtifact(base({ reRead: vi.fn(async () => Promise.reject(new Error("x"))) }))).toMatchObject({ verdict: "BLOCK", reason: "RE_READ_FAILED" });
    expect(await verifyArtifact(base({ decode: vi.fn(async () => ({ width: W, height: H - 1, rgba: new Uint8Array(W * (H - 1) * 4) })) }))).toMatchObject({ verdict: "BLOCK", reason: "DECODED_SIZE_MISMATCH" });
  });

  it("regions are mapped from CSS with the frame's scale, rounded outward", () => {
    const s = survivorsOf([{ x: 39, y: 5, w: 2, h: 2, score: 1 }], [{ id: "r", px: { x: 40, y: 0, w: 10, h: 10 } }]);
    expect(s).toHaveLength(1);
    expect(redilate({ box: { x: 0.5, y: 0.5, w: 1, h: 1 }, regions: ["r"] }, [{ id: "r", px: { x: 0, y: 0, w: 100, h: 100 } }])).toEqual([{ x: 0, y: 0, w: 14, h: 14 }]);
  });

  it("steps 4–5 as frozen are recorded as NOT RUN, with the reason", async () => {
    const v = await verifyArtifact(base());
    expect(Object.keys(v.notRun)).toEqual(["ocrReRead", "d2d3OverRecoveredText", "vaultValueCheck"]);
    expect(v.notRun).toBe(NOT_RUN);
  });
});

describe("M10.8 verifier: what its output may carry", () => {
  it("is deterministic for the same inputs", async () => {
    const strip = (v) => JSON.stringify({ ...v, ms: null });
    const a = await verifyArtifact(base({ reRead: reReadSeq([INSIDE, OUTSIDE], []) }));
    const b = await verifyArtifact(base({ reRead: reReadSeq([INSIDE, OUTSIDE], []) }));
    expect(strip(a)).toBe(strip(b));
  });

  it("carries verdicts, counts, ids, rectangles and hashes — no pixels, no text", async () => {
    const v = await verifyArtifact(base({ reRead: reReadSeq([INSIDE], []) }));
    const text = JSON.stringify(v);
    expect(text).not.toMatch(/[A-Za-z0-9+/]{200,}/);
    expect(Object.keys(v).sort()).toEqual(["clearedAtRound", "identity", "ms", "notRun", "reason", "rounds", "status", "verdict"].sort());
    expect(Object.keys(v.identity).sort()).toEqual(["attestedSha256", "decodedSha256", "receivedSha256"]);
  });

  it("mayHandOff is true for PASS only", () => {
    expect(mayHandOff({ verdict: "PASS", status: "DETECTOR_VERIFIED" })).toBe(true);
    for (const v of [{ verdict: "BLOCK", status: "BLOCKED" }, { verdict: "PASS", status: "BLOCKED" }, null, undefined, {}]) expect(mayHandOff(v)).toBe(false);
  });
});
