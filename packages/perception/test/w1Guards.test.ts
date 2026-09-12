/**
 * W-1 harness guards — the refusals and the decode replica.
 *
 * The harness lives under artifacts/experiments/, so these tests reach into it the same way
 * the QG-03a-B3 and C3 guard tests do. They cover the parts that decide whether a number is
 * admissible: the dataset identity gate, the dev-only rule that keeps the consumed held-out
 * split closed, the shipped-constant assertion, the frozen-path write refusal, the scale
 * arithmetic, and the suppression variants — including that V0 is the shipped rule.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";

const H = await import(
  fileURLToPath(new URL("../../../artifacts/experiments/W1-detector-precision-scale/harness/w1-guards.mjs", import.meta.url))
);

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const sample = (over: Record<string, unknown> = {}) => ({
  id: "s",
  split: "dev",
  provenance: { kind: "SYNTHETIC", generator: "g", seed: H.SCALE_SEED_BASE },
  viewportCss: { w: 960, h: 640 },
  dpr: 1,
  zoom: 1,
  captureSize: { w: 960, h: 640 },
  scroll: { x: 0, y: 0 },
  annotations: [],
  ...over,
});

describe("W-1 pre-registered constants", () => {
  it("pins the artifact, the runtime and the operating point", () => {
    expect(H.MODEL.sha256).toBe("ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0");
    expect(H.MODEL.bytes).toBe(302960);
    expect(H.ORT_VERSION).toBe("1.29.0");
    expect(H.OPERATING_POINT).toBe(0.55);
    expect(H.SHIPPED).toEqual({ score: 0.25, nmsIou: 0.5, maxDetections: 300 });
  });

  it("declares exactly four decode variants, with V0 as the shipped rule", () => {
    expect(H.VARIANTS).toHaveLength(4);
    expect(H.VARIANTS[0].id).toBe("V0");
    expect(H.VARIANTS[0].kind).toBe("per-class");
    expect(H.VARIANTS[0].nmsIou).toBe(H.SHIPPED.nmsIou);
    expect(H.VARIANTS.map((v: { id: string }) => v.id)).toEqual(["V0", "V1", "V2", "V3"]);
  });

  it("declares ten arm-B cells, eight scale levels plus two emptiness controls", () => {
    expect(H.CELLS).toHaveLength(10);
    expect(H.CELLS.filter((c: { tiled: boolean }) => !c.tiled)).toHaveLength(8);
    expect(H.CELLS.filter((c: { tiled: boolean }) => c.tiled).map((c: { id: string }) => c.id)).toEqual(["t300", "t400"]);
  });

  it("every cell's CSS px per model px is the pre-registered value, recomputed", () => {
    for (const cell of H.CELLS) {
      expect(H.cssPerModelOf(cell)).toBeCloseTo(cell.cssPerModel, 9);
      // width-dominant, which is what makes the ratio viewport width / 640
      expect(cell.viewport.w).toBeGreaterThan(cell.viewport.h);
      expect(cell.viewport.w / 640).toBeCloseTo(cell.cssPerModel, 9);
    }
  });

  it("the tiled controls tile, and the scale cells do not", () => {
    expect(H.tileGrid(H.CELLS.find((c: { id: string }) => c.id === "s300"))).toEqual({ cols: 1, rows: 1 });
    expect(H.tileGrid(H.CELLS.find((c: { id: string }) => c.id === "t300"))).toEqual({ cols: 2, rows: 2 });
  });
});

describe("W-1 refusals", () => {
  it("refuses a model that is not the pinned artifact", () => {
    expect(() => H.assertModelIdentity(Buffer.alloc(10))).toThrow(/302960/);
    const right = Buffer.alloc(H.MODEL.bytes);
    expect(() => H.assertModelIdentity(right)).toThrow(/sha256/);
  });

  it("refuses an ORT version other than the pin", () => {
    expect(() => H.assertOrtVersion("1.28.0", "test")).toThrow(/1\.29\.0/);
    expect(H.assertOrtVersion("1.29.0", "test")).toBe("1.29.0");
  });

  it("refuses a changed shipped constant, so the experiment cannot retune the product", () => {
    expect(() => H.assertShippedConstants({ PROVISIONAL_THRESHOLDS: { score: 0.3, nmsIou: 0.5, maxDetections: 300 } })).toThrow(/score/);
    expect(() => H.assertShippedConstants({})).toThrow(/missing/);
    expect(H.assertShippedConstants({ PROVISIONAL_THRESHOLDS: { score: 0.25, nmsIou: 0.5, maxDetections: 300 } })).toBeTruthy();
  });

  it("refuses a regenerated dataset whose hash is not the pinned one", () => {
    const ds = { name: "t1-ui-rendered", version: "1.0.0", hash: "deadbeef", samples: [] };
    expect(() => H.assertDevsetIdentity(ds)).toThrow(/is NOT the dev split/);
  });

  it("accepts the pinned dataset only with the right dev count", () => {
    const mk = (n: number) => ({
      name: "t1-ui-rendered",
      version: "1.0.0",
      hash: "4bbc57de",
      samples: Array.from({ length: n }, (_, i) => sample({ id: `d${i}` })),
    });
    expect(() => H.assertDevsetIdentity(mk(39))).toThrow(/39 samples/);
    expect(H.assertDevsetIdentity(mk(40))).toHaveLength(40);
  });

  it("refuses any non-dev sample, which is what keeps the consumed test split closed", () => {
    const mixed = [sample({ id: "a" }), sample({ id: "b", split: "test" })];
    expect(() => H.assertDevOnly(mixed, "arm A")).toThrow(/non-dev sample/);
    expect(H.assertDevOnly([sample()], "arm A")).toHaveLength(1);
  });

  it("refuses a malformed tensor, including a non-finite value", () => {
    expect(() => H.assertTensor([1, 2], new Float32Array(2), [1, 3], "t")).toThrow(/dims/);
    expect(() => H.assertTensor([1, 2], new Float32Array(1), [1, 2], "t")).toThrow(/expected 2/);
    const bad = new Float32Array([1, Number.NaN]);
    expect(() => H.assertTensor([1, 2], bad, [1, 2], "t")).toThrow(/non-finite/);
    expect(H.assertTensor([1, 2], new Float32Array([1, 2]), [1, 2], "t")).toBe(true);
  });

  it("refuses to write into frozen evidence", () => {
    for (const p of ["artifacts/datasets/x", "artifacts/gates/y", "artifacts/models/z"]) {
      expect(() => H.assertWritablePath(ROOT, `${ROOT}/${p}`)).toThrow(/refusing to write/);
    }
    expect(H.assertWritablePath(ROOT, `${ROOT}/artifacts/experiments/W1-detector-precision-scale/logs`)).toContain("logs");
  });
});

describe("W-1 decode replica", () => {
  const classes = ["button", "link"];
  /** Two anchors, one class channel each: a tiny output in the shipped layout. */
  const out = (boxes: readonly [number, number, number, number, number, number][]) => {
    const a = boxes.length;
    const data = new Float32Array(6 * a);
    boxes.forEach((b, i) => {
      for (let c = 0; c < 6; c += 1) data[c * a + i] = b[c]!;
    });
    return { data, dims: [1, 6, a] };
  };

  it("applies the 0.25 floor and skips non-positive boxes", () => {
    // [cx, cy, w, h, buttonScore, linkScore]
    const o = out([
      [10, 10, 8, 8, 0.9, 0],
      [20, 20, 8, 8, 0.1, 0], // below the floor
      [30, 30, 0, 8, 0.9, 0], // non-positive width
    ]);
    expect(H.candidatesFrom(o, classes)).toHaveLength(1);
  });

  it("refuses a score above 1 and a non-finite value", () => {
    expect(() => H.candidatesFrom(out([[10, 10, 8, 8, 1.5, 0]]), classes)).toThrow(/above 1/);
    expect(() => H.candidatesFrom(out([[Number.NaN, 10, 8, 8, 0.9, 0]]), classes)).toThrow(/non-finite/);
  });

  it("V0 suppresses same-class overlap above 0.5 and leaves other classes alone", () => {
    const items = [
      { box: { x: 0, y: 0, w: 10, h: 10 }, label: "button", score: 0.9 },
      { box: { x: 1, y: 1, w: 10, h: 10 }, label: "button", score: 0.8 },
      { box: { x: 1, y: 1, w: 10, h: 10 }, label: "link", score: 0.7 },
    ];
    const kept = H.suppress(items, H.VARIANTS[0]);
    expect(kept.map((k: { label: string }) => k.label)).toEqual(["button", "link"]);
  });

  it("V1 is strictly more aggressive than V0 at the same overlap", () => {
    const items = [
      { box: { x: 0, y: 0, w: 10, h: 10 }, label: "button", score: 0.9 },
      { box: { x: 4, y: 0, w: 10, h: 10 }, label: "button", score: 0.8 }, // IoU 0.4286: survives V0 (>0.5), dies under V1 (>0.3)
    ];
    expect(H.suppress(items, H.VARIANTS[0])).toHaveLength(2);
    expect(H.suppress(items, H.VARIANTS[1])).toHaveLength(1);
  });

  it("V2 suppresses across classes where V0 cannot", () => {
    const items = [
      { box: { x: 0, y: 0, w: 10, h: 10 }, label: "button", score: 0.9 },
      { box: { x: 0, y: 0, w: 10, h: 10 }, label: "link", score: 0.8 },
    ];
    expect(H.suppress(items, H.VARIANTS[0])).toHaveLength(2);
    expect(H.suppress(items, H.VARIANTS[2])).toHaveLength(1);
  });

  it("V3 removes a nested duplicate that IoU NMS cannot see", () => {
    // a 2x2 box wholly inside a 20x20 box: IoU 0.01, containment 1.0
    const items = [
      { box: { x: 0, y: 0, w: 20, h: 20 }, label: "button", score: 0.9 },
      { box: { x: 5, y: 5, w: 2, h: 2 }, label: "button", score: 0.8 },
    ];
    expect(H.boxIou(items[0]!.box, items[1]!.box)).toBeLessThan(0.05);
    expect(H.intersectionOverSelf(items[1]!.box, items[0]!.box)).toBe(1);
    expect(H.suppress(items, H.VARIANTS[0])).toHaveLength(2);
    expect(H.suppress(items, H.VARIANTS[3])).toHaveLength(1);
  });

  it("suppression is deterministic, and ties break by original index", () => {
    const items = [
      { box: { x: 0, y: 0, w: 10, h: 10 }, label: "button", score: 0.5 },
      { box: { x: 0, y: 0, w: 10, h: 10 }, label: "button", score: 0.5 },
    ];
    const a = H.suppress(items, H.VARIANTS[0]);
    const b = H.suppress(items, H.VARIANTS[0]);
    expect(a).toHaveLength(1);
    expect(H.sameDetections(a, b)).toBe(true);
  });

  it("sameDetections notices a changed count, class, box or score", () => {
    const base = [{ box: { x: 0, y: 0, w: 1, h: 1 }, label: "button", score: 0.5 }];
    expect(H.sameDetections(base, base)).toBe(true);
    expect(H.sameDetections(base, [])).toBe(false);
    expect(H.sameDetections(base, [{ box: { x: 0, y: 0, w: 1, h: 1 }, label: "link", score: 0.5 }])).toBe(false);
    expect(H.sameDetections(base, [{ box: { x: 0, y: 0, w: 1, h: 2 }, label: "button", score: 0.5 }])).toBe(false);
    expect(H.sameDetections(base, [{ box: { x: 0, y: 0, w: 1, h: 1 }, label: "button", score: 0.6 }])).toBe(false);
  });
});

describe("W-1 scoring helpers", () => {
  it("reports the IoU distribution rather than one order statistic", () => {
    const q = H.quantiles([0.5, 0.6, 0.7, 0.8, 0.9]);
    expect(q).toMatchObject({ n: 5, min: 0.5, max: 0.9, median: 0.7 });
    expect(H.quantiles([])).toBeNull();
  });

  it("the taxonomy separates a duplicate from a class confusion from a spurious box", () => {
    const s = sample({
      id: "x",
      annotations: [{ id: "a0", cls: "button", box: { x: 0, y: 0, w: 20, h: 20 }, visibility: "VISIBLE" }],
    });
    const preds = [
      { sampleId: "x", cls: "button", box: { x: 0, y: 0, w: 20, h: 20 }, confidence: 0.9 }, // TP
      { sampleId: "x", cls: "button", box: { x: 1, y: 1, w: 20, h: 20 }, confidence: 0.8 }, // duplicate
      { sampleId: "x", cls: "link", box: { x: 0, y: 0, w: 20, h: 20 }, confidence: 0.7 }, // class confusion
      { sampleId: "x", cls: "button", box: { x: 500, y: 500, w: 20, h: 20 }, confidence: 0.6 }, // spurious
    ];
    const tx = H.taxonomy([s], new Map([["x", preds]]));
    expect(tx.matchedGt).toBe(1);
    expect(tx.totalGt).toBe(1);
    expect(tx.fp).toEqual({ duplicate: 1, classConfusion: 1, localization: 0, spurious: 1 });
    expect(tx.matchedIou).toHaveLength(1);
  });

  it("buckets recall by MODEL-space size, using the cell's scale", () => {
    const s = {
      ...sample({ annotations: [{ id: "a0", cls: "button", box: { x: 0, y: 0, w: 12, h: 12 }, visibility: "VISIBLE" }] }),
      cssPerModel: 4,
    };
    const tx = H.taxonomy([s], new Map());
    // 12 CSS px at 4 CSS px per model px is 3 model px
    expect(Object.keys(tx.bySize)).toEqual(["model<4px"]);
  });

  it("the clipping ceiling is 1.0 when every annotation is fully visible", () => {
    const s = sample({ annotations: [{ id: "a0", cls: "button", box: { x: 0, y: 0, w: 10, h: 10 }, visibility: "VISIBLE" }] });
    expect(H.clippingCeiling([s]).ceiling).toBe(1);
  });

  it("the ceiling falls below 1.0 for a clipped annotation that cannot reach IoU 0.5", () => {
    const s = sample({
      annotations: [{ id: "a0", cls: "button", box: { x: -80, y: 0, w: 100, h: 10 }, visibility: "CLIPPED" }],
    });
    const c = H.clippingCeiling([s]);
    expect(c.clipped).toBe(1);
    expect(c.unreachable).toBe(1);
    expect(c.ceiling).toBe(0);
  });
});
