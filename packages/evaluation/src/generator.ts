/**
 * The synthetic UI generator — QG-05's *"synthetic generator produces ground-truth boxes"*.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * SYNTHETIC MEANS SYNTHETIC
 *
 * Every sample is stamped `provenance.kind === "SYNTHETIC"` with its generator and seed.
 * A metric over this data is evidence about the EVALUATOR — that it computes what it says
 * it computes — and is **never** evidence about how a detector performs on a real
 * government portal. The dossier's evidence source for that is ScreenSpot-v2 plus 300
 * self-labelled screens, and neither exists.
 *
 * The distinction is carried in the type so a downstream report cannot lose it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * DETERMINISM IS THE WHOLE POINT
 *
 * Same version + seed + config ⇒ byte-identical labels and manifest hash. Without that, a
 * metric cannot be reproduced, a regression cannot be distinguished from a reshuffle, and
 * the held-out split is not held out — it is merely a different random draw each run.
 *
 * The PRNG is a local, explicit mulberry32. `Math.random()` is unseedable and would make
 * every one of those properties false.
 */
import { cssBox, type CssBox } from "@pratibimb/perception";
import type { Annotation, Dataset, EvalClass, Sample, Split } from "./dataset.js";
import { sealDataset } from "./dataset.js";

/**
 * mulberry32 — small, fast, and above all REPRODUCIBLE across platforms.
 *
 * Written out rather than imported so the generated data cannot change because a
 * dependency changed its algorithm in a patch release.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratorConfig {
  readonly viewportCss: { readonly w: number; readonly h: number };
  readonly dpr: number;
  readonly zoom: number;
  readonly scrollY: number;
  /** Controls how crowded the layout is — density is a real source of detector error. */
  readonly density: "sparse" | "normal" | "dense";
}

export const DEFAULT_CONFIG: GeneratorConfig = {
  viewportCss: { w: 1024, h: 640 },
  dpr: 2.0,
  zoom: 1.0,
  scrollY: 0,
  density: "normal",
};

/** Generator identity and version. Bumped when generation changes in any metric-moving way. */
export const GENERATOR = "pratibimb-synthetic-ui";
export const GENERATOR_VERSION = "1.0.0";

const round = (n: number) => Number(n.toFixed(3));

/**
 * Build one synthetic screen.
 *
 * The layout is assembled from the shapes that make detection and fusion hard, because a
 * generator that only emits well-separated rectangles measures nothing worth measuring:
 *
 *   repeated controls      a card row — matching cannot lean on uniqueness
 *   visually similar       two same-size buttons differing only by label
 *   nested controls        a checkbox inside its own clickable label
 *   varying density        crowding, which is a real source of error
 *   partial clipping       something straddling the fold
 *   off-screen             below the fold, DOM-known, never captured
 */
export function generateSample(id: string, split: Split, seed: number, config: GeneratorConfig): Sample {
  const rand = mulberry32(seed);
  const { w: vw, h: vh } = config.viewportCss;
  const annotations: Annotation[] = [];
  let counter = 0;

  const push = (cls: EvalClass, box: CssBox) => {
    counter += 1;
    // Visibility is DERIVED from the geometry, never asserted alongside it. Two fields
    // that can be set independently can disagree, and the validator would then be
    // checking the generator's opinion rather than the data.
    const fullyInside = box.x >= 0 && box.y >= 0 && box.x + box.w <= vw && box.y + box.h <= vh;
    const intersects = box.x < vw && box.y < vh && box.x + box.w > 0 && box.y + box.h > 0;
    annotations.push({
      id: `${id}-a${counter}`,
      cls,
      box,
      visibility: fullyInside ? "VISIBLE" : intersects ? "CLIPPED" : "OFFSCREEN",
    });
  };

  const jitter = (span: number) => round((rand() - 0.5) * span);

  // ── repeated controls: a card row ────────────────────────────────────────────────
  const cardCount = config.density === "dense" ? 4 : config.density === "sparse" ? 2 : 3;
  const cardW = 220;
  for (let i = 0; i < cardCount; i += 1) {
    const x = round(40 + i * (cardW + 24) + jitter(6));
    push("button", cssBox(x + 12, round(140 + jitter(4)), 110, 30));
    push("link", cssBox(x + 12, round(180 + jitter(4)), 90, 16));
  }

  // ── visually similar: same size, adjacent, different meaning ─────────────────────
  const simY = round(240 + jitter(6));
  push("button", cssBox(40, simY, 130, 36));
  push("button", cssBox(190, simY, 130, 36));

  // ── text inputs, varying width ───────────────────────────────────────────────────
  const inputCount = config.density === "dense" ? 4 : 2;
  for (let i = 0; i < inputCount; i += 1) {
    push("textbox", cssBox(40, round(310 + i * 44 + jitter(3)), round(280 + rand() * 80), 32));
  }

  // ── nested: a checkbox inside its label's clickable region ───────────────────────
  const nestY = round(310 + inputCount * 44 + 20);
  push("checkbox", cssBox(44, nestY + 4, 16, 16));
  push("radio", cssBox(140, nestY + 4, 16, 16));
  push("select", cssBox(240, nestY, 180, 28));
  push("icon", cssBox(round(vw - 60 + jitter(2)), 20, 24, 24));
  push("tab", cssBox(440, 96, 90, 28));

  // ── partial clipping: straddles the fold ─────────────────────────────────────────
  push("button", cssBox(40, round(vh - 20 + jitter(4)), 200, 44));

  // ── off-screen: below the fold, DOM-known, never captured ────────────────────────
  push("button", cssBox(40, round(vh + 520), 160, 44));
  push("link", cssBox(40, round(vh + 700), 200, 18));

  return {
    id,
    split,
    provenance: { kind: "SYNTHETIC", generator: `${GENERATOR}@${GENERATOR_VERSION}`, seed },
    viewportCss: config.viewportCss,
    dpr: config.dpr,
    zoom: config.zoom,
    captureSize: {
      w: Math.round(config.viewportCss.w * config.dpr),
      h: Math.round(config.viewportCss.h * config.dpr),
    },
    scroll: { x: 0, y: config.scrollY },
    annotations,
  };
}

export interface DatasetSpec {
  readonly name: string;
  readonly version: string;
  /** Base seed. Each sample derives its own from this plus its index. */
  readonly seed: number;
  readonly counts: { readonly train: number; readonly dev: number; readonly test: number };
  readonly config?: Partial<GeneratorConfig>;
  /** Fixed timestamp; passing `now()` would make the hash change every run. */
  readonly createdAt: string;
}

/**
 * Build a full dataset with explicit splits.
 *
 * Seeds are derived as `seed + splitOffset + index`, with a large per-split offset, so the
 * three splits can never draw the same sample. Deriving them from a shared running counter
 * would make split membership depend on generation order — and reordering the splits would
 * silently move samples between train and test.
 */
export function generateDataset(spec: DatasetSpec): Dataset {
  const config = { ...DEFAULT_CONFIG, ...spec.config };
  const samples: Sample[] = [];

  const OFFSETS: Record<Split, number> = { train: 0, dev: 1_000_000, test: 2_000_000 };

  for (const split of ["train", "dev", "test"] as const) {
    const n = spec.counts[split];
    for (let i = 0; i < n; i += 1) {
      const seed = spec.seed + OFFSETS[split] + i;
      // Density varies across the set so the evaluator is not tuned to one layout shape.
      const density: GeneratorConfig["density"] =
        i % 3 === 0 ? "sparse" : i % 3 === 1 ? "normal" : "dense";
      samples.push(
        generateSample(`${split}-${String(i).padStart(4, "0")}`, split, seed, { ...config, density })
      );
    }
  }

  return sealDataset({
    name: spec.name,
    version: spec.version,
    createdAt: spec.createdAt,
    samples,
  });
}
