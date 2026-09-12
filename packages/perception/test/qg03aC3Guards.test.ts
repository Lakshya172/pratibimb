/**
 * QG-03a-C3 — the harness guards, tested on their own.
 *
 * Harness: artifacts/experiments/W1-QG03a-C3-label-raster-generalisation/harness/
 *
 * C3 measures whether the label/raster nuisance mapping generalises off the training grid. Its
 * value depends entirely on nothing having been chosen after the numbers were seen, so the
 * pre-registered constants and every fail-closed path are pinned here. These tests render nothing,
 * load no model and need no browser.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HARNESS = join(REPO, "artifacts/experiments/W1-QG03a-C3-label-raster-generalisation/harness");

let G: any;
beforeAll(async () => {
  G = await import(pathToFileURL(join(HARNESS, "c3-guards.mjs")).href);
});

/** A cell dataset that passes every guard, so each test can break exactly one thing. */
function validCellDataset(cellId: string) {
  const cell = G.cellById(cellId);
  const cap = G.captureSizeFor(cell);
  const sample = (i: number) => ({
    id: G.sampleIdFor(cell.id, i),
    split: "dev",
    provenance: { kind: "SYNTHETIC", generator: "t1-ui-renderer@1.0.0", seed: G.seedFor(i) },
    viewportCss: { ...cell.viewport },
    dpr: cell.dpr,
    zoom: 1.0,
    captureSize: { ...cap },
    scroll: { x: 0, y: 0 },
    annotations: [{ id: `a-${i}`, cls: "button", box: { x: 1, y: 1, w: 20, h: 12 }, visibility: "VISIBLE" }],
    framePath: `frames/${G.sampleIdFor(cell.id, i)}.png`,
  });
  const placeholder = (split: string, n: number, extent: number) => ({
    id: `c3-${cell.id}-placeholder-${split}`,
    split,
    provenance: { kind: "SYNTHETIC", generator: "t1-ui-renderer@1.0.0", seed: G.PLACEHOLDER_SEED_BASE + n },
    viewportCss: { ...cell.viewport },
    dpr: cell.dpr,
    zoom: 1.0,
    captureSize: { ...cap },
    scroll: { x: 0, y: 0 },
    annotations: [{ id: `ph-${split}`, cls: "button", box: { x: 0, y: 0, w: extent, h: extent }, visibility: "VISIBLE" }],
    framePath: G.PLACEHOLDER_FRAME,
  });
  const samples = [
    ...Array.from({ length: G.SAMPLES_PER_CELL }, (_, i) => sample(i)),
    placeholder("train", 1, 10),
    placeholder("test", 2, 12),
  ];
  return { name: G.datasetNameFor(cell.id), version: G.DATASET_VERSION, createdAt: G.DATASET_CREATED_AT, hash: "deadbeef", samples };
}

describe("QG-03a-C3 — pre-registered constants", () => {
  it("pins the exact artifact, the ORT version and the shapes", () => {
    expect(G.MODEL.sha256).toBe("ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0");
    expect(G.MODEL.bytes).toBe(302960);
    expect(G.ORT_VERSION).toBe("1.29.0");
    expect(G.INPUT_DIMS).toEqual([1, 3, 640, 640]);
    expect(G.OUTPUT_DIMS).toEqual([1, 12, 6400]);
  });

  it("pins the frozen operating point and the shipped score floor, and sweeps neither", () => {
    expect(G.OPERATING_POINT).toBe(0.55);
    expect(G.SHIPPED_SCORE_FLOOR).toBe(0.25);
    expect(G.VIEWS).toEqual(["op055", "shipped"]);
  });

  it("defines six cells, four off the training grid and two on it, paired by shared seeds", () => {
    expect(G.CELLS).toHaveLength(6);
    const a = G.CELLS.filter((c: any) => c.kind === "A");
    const b = G.CELLS.filter((c: any) => c.kind === "B");
    expect(a).toHaveLength(4);
    expect(b).toHaveLength(2);
    for (const c of a) expect(G.isTrainingGeometry(c), `${c.id} must be off the training grid`).toBe(false);
    for (const c of b) expect(G.isTrainingGeometry(c), `${c.id} must be on the training grid`).toBe(true);
    // the same seeds in every cell is what makes the comparison paired rather than anecdotal
    expect(G.seedFor(0)).toBe(G.BASE_SEED);
    expect(G.seedFor(19)).toBe(G.BASE_SEED + 19);
  });

  it("derives capture size from viewport and DPR, including the DPR 1.5 cell", () => {
    expect(G.captureSizeFor(G.cellById("a1"))).toEqual({ w: 1264, h: 800 });
    expect(G.captureSizeFor(G.cellById("a2"))).toEqual({ w: 2880, h: 1443 });
    expect(G.captureSizeFor(G.cellById("b1"))).toEqual({ w: 960, h: 640 });
  });
});

describe("QG-03a-C3 — identity and tensor guards", () => {
  it("refuses a wrong model size or digest", () => {
    const bytes = Buffer.alloc(32, 3);
    expect(G.assertModelIdentity(bytes, { bytes: 32, sha256: createHash("sha256").update(bytes).digest("hex") })).toHaveLength(64);
    expect(() => G.assertModelIdentity(Buffer.alloc(31))).toThrow(/MODEL_MISMATCH/);
    expect(() => G.assertModelIdentity(Buffer.alloc(302960, 9))).toThrow(/MODEL_MISMATCH/);
  });

  it("refuses any ORT version but 1.29.0", () => {
    expect(() => G.assertOrtVersion("1.29.0", "test")).not.toThrow();
    expect(() => G.assertOrtVersion("1.20.1", "test")).toThrow(/ORT_VERSION_MISMATCH/);
    expect(() => G.assertOrtVersion(undefined, "test")).toThrow(/ORT_VERSION_MISMATCH/);
  });

  it("refuses a wrong shape, a wrong length or a non-finite value", () => {
    const ok = new Float32Array(12 * 6400);
    expect(() => G.assertTensor([1, 12, 6400], ok, G.OUTPUT_DIMS, "out")).not.toThrow();
    expect(() => G.assertTensor([1, 12, 6399], ok, G.OUTPUT_DIMS, "out")).toThrow(/TENSOR_SHAPE_MISMATCH/);
    expect(() => G.assertTensor([1, 12, 6400], new Float32Array(5), G.OUTPUT_DIMS, "out")).toThrow(/TENSOR_LENGTH_MISMATCH/);
    const nan = new Float32Array(ok.length);
    nan[7] = Number.POSITIVE_INFINITY;
    expect(() => G.assertTensor([1, 12, 6400], nan, G.OUTPUT_DIMS, "out")).toThrow(/TENSOR_NON_FINITE/);
  });

  it("refuses to write anywhere the frozen evidence lives", () => {
    expect(() => G.assertWritablePath(REPO, join(REPO, "artifacts/datasets/t1-ui-v1/manifest.json"))).toThrow(/FROZEN_PATH/);
    expect(() => G.assertWritablePath(REPO, join(REPO, "artifacts/gates/T1-detector-training/regression-baseline.json"))).toThrow(/FROZEN_PATH/);
    expect(() => G.assertWritablePath(REPO, join(HARNESS, "generated"))).not.toThrow();
  });

  it("refuses if the shipped decode constants are not the pre-registered ones", () => {
    expect(G.assertShippedConstants({ PROVISIONAL_THRESHOLDS: { score: 0.25, iou: 0.5, maxDetections: 300 } })).toMatchObject({ score: 0.25 });
    expect(() => G.assertShippedConstants({ PROVISIONAL_THRESHOLDS: { score: 0.05 } })).toThrow(/SHIPPED_CONSTANTS/);
    expect(() => G.assertShippedConstants({})).toThrow(/SHIPPED_CONSTANTS/);
  });
});

describe("QG-03a-C3 — a cell dataset is accepted only when it is this cell's own evidence", () => {
  it("accepts a complete cell", () => {
    for (const c of G.CELLS) expect(() => G.assertCellDataset(validCellDataset(c.id), c), c.id).not.toThrow();
  });

  it("fails closed on every way the dataset could stop being C3 evidence", () => {
    const cell = G.cellById("a1");
    const broken: [string, (d: any) => void, RegExp][] = [
      ["the frozen training dataset's name", (d) => { d.name = "t1-ui-rendered"; }, /name is t1-ui-rendered/],
      ["another cell's name", (d) => { d.name = "t1-ui-c3-b1"; }, /name is/],
      ["an unsealed dataset", (d) => { d.hash = ""; }, /no sealed hash/],
      ["a missing dev sample", (d) => { d.samples = d.samples.filter((s: any) => s.id !== "c3-a1-0007"); }, /19 dev samples/],
      ["no placeholders, so the frozen validator was bypassed", (d) => { d.samples = d.samples.filter((s: any) => s.split === "dev"); }, /0 placeholder samples/],
      ["a placeholder that was actually rendered", (d) => { d.samples.at(-1).framePath = "frames/real.png"; }, /must never be rendered/],
      ["a broken seed pairing", (d) => { d.samples[3].provenance.seed = 1; }, /cells are paired by seed/],
      ["a sample from another cell's geometry", (d) => { d.samples[0].viewportCss = { w: 800, h: 600 }; }, /viewport does not match its cell/],
      ["a wrong capture size", (d) => { d.samples[0].captureSize = { w: 1, h: 1 }; }, /captureSize/],
      ["a sample promoted out of dev", (d) => { d.samples[0].split = "test"; }, /dev samples/],
      ["annotations stripped", (d) => { d.samples[0].annotations = []; }, /no annotations/],
      ["an annotation with no visibility", (d) => { delete d.samples[0].annotations[0].visibility; }, /incomplete/],
      ["a non-synthetic provenance claim", (d) => { d.samples[0].provenance.kind = "REAL"; }, /SYNTHETIC/],
    ];
    for (const [what, breakIt, expected] of broken) {
      const d = validCellDataset("a1");
      breakIt(d);
      expect(() => G.assertCellDataset(d, cell), what).toThrow(expected);
    }
  });
});

describe("QG-03a-C3 — the frozen CLIPPED ceiling is reported, never fixed", () => {
  it("computes the visible fraction of a label box", () => {
    const vp = { w: 100, h: 100 };
    expect(G.visibleFraction({ x: 0, y: 0, w: 10, h: 10 }, vp)).toBe(1);
    expect(G.visibleFraction({ x: 95, y: 0, w: 10, h: 10 }, vp)).toBeCloseTo(0.5);
    expect(G.visibleFraction({ x: 200, y: 0, w: 10, h: 10 }, vp)).toBe(0);
  });

  it("reports the arithmetic ceiling the frozen definition imposes", () => {
    const vp = { w: 100, h: 100 };
    const samples = [{
      viewportCss: vp,
      annotations: [
        { cls: "button", box: { x: 0, y: 0, w: 10, h: 10 }, visibility: "VISIBLE" },
        { cls: "button", box: { x: 96, y: 0, w: 10, h: 10 }, visibility: "CLIPPED" }, // 40% visible: unreachable
        { cls: "button", box: { x: 500, y: 0, w: 10, h: 10 }, visibility: "OFFSCREEN" }, // excluded
      ],
    }];
    const c = G.clippingCeiling(samples);
    expect(c).toMatchObject({ evaluatable: 2, reachable: 1, clipped: 1, offscreen: 1 });
    expect(c.ceiling).toBeCloseTo(0.5);
  });
});

describe("QG-03a-C3 — match quality uses the B2/B3-1 matcher", () => {
  const vp = { viewportCss: { w: 1000, h: 1000 } };
  const labels = (n: number) => Array.from({ length: n }, (_, i) => ({ cls: "button", box: { x: i * 50, y: 0, w: 20, h: 20 }, visibility: "VISIBLE" }));

  it("reports perfect agreement as IoU 1 and zero displacement", () => {
    const s = [{ ...vp, id: "s1", annotations: labels(3) }];
    const preds = new Map([["s1", labels(3).map((l) => ({ cls: l.cls, box: l.box }))]]);
    expect(G.matchQuality(s, preds)).toMatchObject({ labels: 3, matched: 3, minMatchedIou: 1, worstMatchedDispCss: 0, smallestMatchedLabelPx: 20 });
  });

  it("reports the worst displacement and the minimum matched IoU", () => {
    const s = [{ ...vp, id: "s1", annotations: labels(2) }];
    const preds = new Map([["s1", [{ cls: "button", box: { x: 1.5, y: 0, w: 20, h: 20 } }, { cls: "button", box: { x: 50, y: 0, w: 20, h: 20 } }]]]);
    const q = G.matchQuality(s, preds);
    expect(q.matched).toBe(2);
    expect(q.worstMatchedDispCss).toBeCloseTo(1.5);
    expect(q.minMatchedIou).toBeGreaterThan(0.5);
    expect(q.minMatchedIou).toBeLessThan(1);
  });

  it("counts an unmatched or wrong-class label as unmatched rather than silently dropping it", () => {
    const s = [{ ...vp, id: "s1", annotations: labels(2) }];
    expect(G.matchQuality(s, new Map([["s1", []]]))).toMatchObject({ labels: 2, matched: 0 });
    const wrongClass = new Map([["s1", labels(2).map((l) => ({ cls: "link", box: l.box }))]]);
    expect(G.matchQuality(s, wrongClass)).toMatchObject({ labels: 2, matched: 0 });
  });

  it("ignores OFFSCREEN labels, exactly as the evaluator does", () => {
    const s = [{ ...vp, id: "s1", annotations: [...labels(1), { cls: "button", box: { x: 5000, y: 0, w: 20, h: 20 }, visibility: "OFFSCREEN" }] }];
    expect(G.matchQuality(s, new Map([["s1", labels(1).map((l) => ({ cls: l.cls, box: l.box }))]]))).toMatchObject({ labels: 1, matched: 1 });
  });
});
