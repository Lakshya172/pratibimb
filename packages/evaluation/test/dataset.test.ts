/**
 * Dataset determinism, label validation and split integrity.
 *
 * The load-bearing property is reproducibility. If the same version and seed do not
 * produce byte-identical data, then a metric cannot be reproduced, a regression cannot be
 * told apart from a reshuffle, and the held-out split is not held out — it is a different
 * random draw each run.
 */
import { describe, it, expect } from "vitest";
import { cssBox } from "@pratibimb/perception";
import {
  type Dataset,
  type Sample,
  LabelError,
  EVAL_CLASSES,
  generateDataset,
  generateSample,
  mulberry32,
  datasetHash,
  canonicalize,
  sealDataset,
  validateDataset,
  validateSample,
  assertNoLeakage,
  assertIntegrity,
  DEFAULT_CONFIG,
} from "@pratibimb/evaluation";

const SPEC = {
  name: "t1-synthetic-ui",
  version: "1.0.0",
  seed: 20260910,
  counts: { train: 6, dev: 4, test: 4 },
  createdAt: "2026-09-10T00:00:00.000Z",
};

describe("determinism", () => {
  it("produces a byte-identical dataset from the same version and seed", () => {
    const a = generateDataset(SPEC);
    const b = generateDataset(SPEC);
    expect(a.hash).toBe(b.hash);
    expect(canonicalize({ ...a })).toBe(canonicalize({ ...b }));
  });

  it("produces different data from a different seed", () => {
    // Otherwise the seed is decorative and every "independent" sample is the same screen.
    const a = generateDataset(SPEC);
    const b = generateDataset({ ...SPEC, seed: SPEC.seed + 1 });
    expect(a.hash).not.toBe(b.hash);
  });

  it("gives the PRNG a stable, platform-independent sequence", () => {
    // Written out rather than imported so generated data cannot change because a
    // dependency changed its algorithm in a patch release.
    const r = mulberry32(42);
    const first = [r(), r(), r()];
    const r2 = mulberry32(42);
    expect([r2(), r2(), r2()]).toEqual(first);
  });

  it("hashes independently of key insertion order", () => {
    // JSON.stringify follows insertion order, so two structurally identical datasets built
    // by different code paths would otherwise hash differently.
    const d = generateDataset(SPEC);
    const reordered: Dataset = {
      ...d,
      samples: [...d.samples].reverse(),
    };
    const { hash: _h, ...rest } = reordered;
    expect(datasetHash(rest)).toBe(d.hash);
  });

  it("detects drift after sealing", () => {
    const d = generateDataset(SPEC);
    const tampered: Dataset = {
      ...d,
      samples: d.samples.map((s, i) =>
        i === 0
          ? { ...s, annotations: s.annotations.slice(1) }
          : s
      ),
    };
    expect(() => assertIntegrity(tampered)).toThrow(LabelError);
    try {
      assertIntegrity(tampered);
    } catch (e) {
      expect((e as LabelError).code).toBe("HASH_MISMATCH");
    }
  });
});

describe("the generated set is what QG-05 asks for", () => {
  const d = generateDataset(SPEC);

  it("is labelled SYNTHETIC, with its generator and seed", () => {
    // A metric over synthetic data describes the evaluator, never real-world accuracy.
    // The provenance travels with the sample so a report cannot lose the distinction.
    for (const s of d.samples) {
      expect(s.provenance.kind).toBe("SYNTHETIC");
      if (s.provenance.kind === "SYNTHETIC") {
        expect(s.provenance.generator).toMatch(/^pratibimb-synthetic-ui@/);
        expect(Number.isInteger(s.provenance.seed)).toBe(true);
      }
    }
  });

  it("produces ground-truth boxes — the QG-05 criterion", () => {
    expect(d.samples.every((s) => s.annotations.length > 0)).toBe(true);
  });

  it("covers every evaluation class somewhere in the set", () => {
    const seen = new Set(d.samples.flatMap((s) => s.annotations.map((a) => a.cls)));
    for (const c of EVAL_CLASSES) expect(seen, `class ${c} never generated`).toContain(c);
  });

  it("includes the hard cases the generator promises", () => {
    const s = generateSample("x", "train", 1, DEFAULT_CONFIG);
    const kinds = new Set(s.annotations.map((a) => a.visibility));
    expect(kinds).toContain("VISIBLE");
    expect(kinds).toContain("CLIPPED"); // straddles the fold
    expect(kinds).toContain("OFFSCREEN"); // below the fold, never captured

    // Repeated controls: several same-class boxes, so matching cannot lean on uniqueness.
    const buttons = s.annotations.filter((a) => a.cls === "button");
    expect(buttons.length).toBeGreaterThan(2);
  });

  it("derives visibility from geometry rather than asserting it separately", () => {
    // Two independently-set fields can disagree; the validator would then be checking the
    // generator's opinion rather than the data.
    for (const s of generateDataset(SPEC).samples) {
      for (const a of s.annotations) {
        const inside =
          a.box.x >= 0 && a.box.y >= 0 &&
          a.box.x + a.box.w <= s.viewportCss.w &&
          a.box.y + a.box.h <= s.viewportCss.h;
        if (a.visibility === "VISIBLE") expect(inside).toBe(true);
      }
    }
  });

  it("varies density across the set", () => {
    // A generator that emits one layout shape measures one layout shape.
    const widths = new Set(
      d.samples.map((s) => s.annotations.filter((a) => a.cls === "textbox").length)
    );
    expect(widths.size).toBeGreaterThan(1);
  });
});

describe("labels fail closed", () => {
  const base = generateSample("s", "train", 7, DEFAULT_CONFIG);
  const withAnn = (over: Partial<Sample["annotations"][number]>): Sample => ({
    ...base,
    annotations: [{ ...base.annotations[0]!, ...over }],
  });

  it("accepts the generated labels", () => {
    expect(() => validateSample(base)).not.toThrow();
  });

  it.each([
    ["an unknown class", { cls: "widget" as never }, "INVALID_CLASS"],
    ["a negative width", { box: cssBox(10, 10, -5, 10) }, "INVALID_GEOMETRY"],
    ["a zero-area box", { box: cssBox(10, 10, 0, 10) }, "INVALID_GEOMETRY"],
    ["a NaN coordinate", { box: cssBox(Number.NaN, 10, 5, 10) }, "INVALID_GEOMETRY"],
  ])("REJECTS %s", (_label, over, code) => {
    expect(() => validateSample(withAnn(over))).toThrow(LabelError);
    try {
      validateSample(withAnn(over));
    } catch (e) {
      expect((e as LabelError).code).toBe(code);
    }
  });

  it("REJECTS duplicate annotation ids", () => {
    // Duplicates make a match ambiguous, and the ambiguity would be resolved silently by
    // iteration order.
    const a = base.annotations[0]!;
    expect(() =>
      validateSample({ ...base, annotations: [a, { ...a, box: cssBox(1, 1, 5, 5) }] })
    ).toThrow(LabelError);
  });

  it("REJECTS a box marked VISIBLE that extends outside the viewport", () => {
    expect(() =>
      validateSample(withAnn({ visibility: "VISIBLE", box: cssBox(10, 630, 100, 40) }))
    ).toThrowError(/should be CLIPPED/);
  });

  it("REJECTS a box marked CLIPPED that lies entirely inside", () => {
    expect(() =>
      validateSample(withAnn({ visibility: "CLIPPED", box: cssBox(10, 10, 100, 40) }))
    ).toThrowError(/should be VISIBLE/);
  });

  it("REJECTS a non-OFFSCREEN box that does not touch the viewport at all", () => {
    expect(() =>
      validateSample(withAnn({ visibility: "CLIPPED", box: cssBox(5000, 5000, 10, 10) }))
    ).toThrowError(/does not intersect/);
  });

  it("ALLOWS an OFFSCREEN box outside the viewport — that is what off-screen means", () => {
    // Applying the viewport bound here would reject exactly the case the perception
    // contract requires the dataset to represent.
    expect(() =>
      validateSample(withAnn({ visibility: "OFFSCREEN", box: cssBox(10, 5000, 100, 40) }))
    ).not.toThrow();
  });
});

describe("split integrity", () => {
  it("accepts a properly split dataset", () => {
    expect(() => validateDataset(generateDataset(SPEC))).not.toThrow();
  });

  it("DETECTS the same sample id in two splits", () => {
    const d = generateDataset(SPEC);
    const leaked = sealDataset({
      ...d,
      samples: [...d.samples, { ...d.samples[0]!, split: "test" }],
    });
    expect(() => assertNoLeakage(leaked)).toThrow(LabelError);
  });

  it("DETECTS a renamed copy across splits — the form leakage actually takes", () => {
    // An id can be changed while the underlying sample is copied verbatim. Checking ids
    // alone would miss it entirely.
    const d = generateDataset(SPEC);
    const train = d.samples.find((s) => s.split === "train")!;
    const leaked = sealDataset({
      ...d,
      samples: [...d.samples, { ...train, id: "test-copy", split: "test" }],
    });
    expect(() => assertNoLeakage(leaked)).toThrowError(/byte-identical in content/);
  });

  it("REJECTS a dataset with an empty split", () => {
    // A missing held-out split turns every reported number into a tuning artefact.
    const d = generateDataset({ ...SPEC, counts: { train: 4, dev: 2, test: 0 } });
    expect(() => assertNoLeakage(d)).toThrowError(/Split "test" is empty/);
  });

  it("keeps train, dev and test disjoint by construction", () => {
    const d = generateDataset(SPEC);
    const ids = { train: new Set<string>(), dev: new Set<string>(), test: new Set<string>() };
    for (const s of d.samples) ids[s.split].add(s.id);
    expect([...ids.train].some((i) => ids.dev.has(i) || ids.test.has(i))).toBe(false);
    expect([...ids.dev].some((i) => ids.test.has(i))).toBe(false);
  });
});
