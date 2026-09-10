/**
 * QG-05 dataset contract for the T1 `UIElementDetector`.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS AND IS NOT
 *
 * QG-05 is the whole evaluation harness — five scored metrics plus task success after
 * privacy. This package implements **one slice**: the visual-context metric (25%), which
 * is element mAP@0.5, element recall and grounding accuracy. The other four metrics need
 * T2, the server, or the executor, none of which exist.
 *
 * The dossier's evidence source for that metric is *"ScreenSpot-v2 web subset plus 300
 * self-labelled Indian government and banking screens"*. **Neither exists yet.** So this
 * dataset is SYNTHETIC, is labelled `SYNTHETIC` in its own manifest, and its numbers are
 * evidence about the EVALUATOR, never about real-world detector accuracy. That distinction
 * is carried in the type, not left to a reader's memory.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * COORDINATE SPACE — ONE MODEL, NOT TWO
 *
 * Ground-truth boxes are stored in **CSS viewport pixels**, the canonical public space of
 * the perception contract. Not capture pixels, not model pixels. A dataset in its own
 * private space would be a second competing coordinate model, and every comparison against
 * a detector would need a conversion that nobody would test.
 */
import type { CssBox } from "@pratibimb/perception";

/** The classes the T1 head is defined over. Kept in sync by test, not by hope. */
export type EvalClass =
  | "button"
  | "link"
  | "textbox"
  | "checkbox"
  | "radio"
  | "select"
  | "tab"
  | "icon";

/**
 * Where a sample came from. `SYNTHETIC` is a load-bearing value.
 *
 * A metric computed over synthetic data says how the evaluator behaves; it says nothing
 * about how a detector will behave on a government portal. The two must never be reported
 * as the same kind of claim, so the provenance travels with the sample.
 */
export type SampleProvenance =
  | { readonly kind: "SYNTHETIC"; readonly generator: string; readonly seed: number }
  | { readonly kind: "REAL_LABELLED"; readonly source: string; readonly annotator: string }
  | { readonly kind: "SCREENSPOT_V2"; readonly subset: string; readonly originalId: string };

/** Which split a sample belongs to. Enforced, not advisory — see `assertNoLeakage`. */
export type Split = "train" | "dev" | "test";

/** One ground-truth annotation. */
export interface Annotation {
  readonly id: string;
  readonly cls: EvalClass;
  /** CSS viewport pixels. The canonical space, always. */
  readonly box: CssBox;
  /**
   * Whether the element is fully inside the captured viewport, partly clipped, or known
   * from the DOM but never captured.
   *
   * An `OFFSCREEN` annotation is NOT a detection target: no detector can see it, so
   * counting it as a miss would penalise a perfect detector for the laws of optics. The
   * evaluator excludes them and reports how many it excluded.
   */
  readonly visibility: "VISIBLE" | "CLIPPED" | "OFFSCREEN";
}

/** One evaluation sample: a frame, its geometry, and its ground truth. */
export interface Sample {
  readonly id: string;
  readonly split: Split;
  readonly provenance: SampleProvenance;
  /** Viewport size in CSS px — the space annotations live in. */
  readonly viewportCss: { readonly w: number; readonly h: number };
  /** Effective devicePixelRatio, already including zoom. Never multiplied by zoom. */
  readonly dpr: number;
  /** Browser zoom, recorded for provenance. NEVER a multiplier. */
  readonly zoom: number;
  /** Capture dimensions in device px, as the frame actually exists. */
  readonly captureSize: { readonly w: number; readonly h: number };
  readonly scroll: { readonly x: number; readonly y: number };
  readonly annotations: readonly Annotation[];
  /** Present only where a rendered frame exists; the generator produces labels alone. */
  readonly framePath?: string;
}

/** The dataset, plus everything needed to say which dataset a number came from. */
export interface Dataset {
  /** Stable identity. A metric without this is a number with no referent. */
  readonly name: string;
  /** Bumped whenever generation changes in any way that could move a metric. */
  readonly version: string;
  readonly createdAt: string;
  readonly samples: readonly Sample[];
  /** Content hash over the canonical serialization. See `datasetHash`. */
  readonly hash: string;
}

/**
 * Canonical serialization — the input to the integrity hash.
 *
 * Every key is emitted in a FIXED order and every number is rounded to 6 decimal places.
 * Both matter: `JSON.stringify` follows insertion order, so two structurally identical
 * datasets built by different code paths would otherwise hash differently, and float
 * formatting differs enough across platforms to break a hash that should be stable.
 *
 * The point of the hash is to make "which dataset produced this metric" answerable months
 * later. A hash that drifts for cosmetic reasons answers nothing.
 */
export function canonicalize(dataset: Omit<Dataset, "hash">): string {
  const n = (v: number) => Number(v.toFixed(6));
  return JSON.stringify({
    name: dataset.name,
    version: dataset.version,
    samples: [...dataset.samples]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((s) => ({
        id: s.id,
        split: s.split,
        provenance: s.provenance,
        viewportCss: { w: n(s.viewportCss.w), h: n(s.viewportCss.h) },
        dpr: n(s.dpr),
        zoom: n(s.zoom),
        captureSize: { w: n(s.captureSize.w), h: n(s.captureSize.h) },
        scroll: { x: n(s.scroll.x), y: n(s.scroll.y) },
        annotations: [...s.annotations]
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((a) => ({
            id: a.id,
            cls: a.cls,
            box: { x: n(a.box.x), y: n(a.box.y), w: n(a.box.w), h: n(a.box.h) },
            visibility: a.visibility,
          })),
      })),
  });
}

/**
 * FNV-1a over the canonical form.
 *
 * Not cryptographic and not claimed to be. Its job is drift detection — "is this the
 * dataset that produced that number" — and it runs locally with no dependency. The payload
 * hash pin that Invariant E rests on is a SHA-256 in the egress module and is an entirely
 * separate mechanism; this must never be mistaken for it.
 */
export function datasetHash(dataset: Omit<Dataset, "hash">): string {
  const s = canonicalize(dataset);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function sealDataset(dataset: Omit<Dataset, "hash">): Dataset {
  return { ...dataset, hash: datasetHash(dataset) };
}
