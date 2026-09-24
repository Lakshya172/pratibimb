/**
 * M4 — THE LOCAL TEXT PERCEPTION SEAM. **There is no model behind it, and that is the finding.**
 *
 * `artifacts/experiments/M4-gesture-text-perception/ocr-audit.md` is the whole reasoning. In short:
 * this repository already names an `OCRProvider` role, already pinned the revisions, already
 * verified the licence (Apache-2.0 at the revision) and already measured the cost. And
 * `PP-OCRv5_mobile_det` **fails its own stated correctness criterion on WASM** — 4.12e-02 against a
 * 2e-02 bound fixed before the run — while WASM is the only backend this extension uses.
 *
 * `agentos/workflows/model-adoption.md`, blocking rules, FROZEN, rule 2:
 *
 *   > A model that fails the WASM columns is not shipped, whatever it does on WebGPU.
 *
 * So declining is not a judgement call made here; it is the default the repository already set, and
 * adopting would need an ADR overriding a frozen rule. Nothing was downloaded.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY BUILD A SEAM FOR A MODEL THAT IS NOT COMING
 *
 * Two reasons, and neither is anticipation for its own sake.
 *
 * **An absent tier must be visible.** `createUiElementDetector(null)` refuses rather than returning
 * an empty list, because an empty list is indistinguishable from a page with no controls on it. The
 * same is true here and matters more: a client that silently produced no text findings would look
 * exactly like a client that had looked and found nothing sensitive. Every run now says which.
 *
 * **The output type is the boundary, and it can be written before the model exists.** A
 * `TextFinding` has a box, a character count and a classification. It has **no field for the
 * string**, so a future recogniser cannot hand one upward by forgetting to redact — it would have to
 * change this file, visibly. The tests exercise that with a stub recogniser that really does read
 * text, which is the only way to check a boundary whose model is absent.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE UNSOLVED PROBLEM, STATED HERE BECAUSE THIS IS WHERE IT WOULD BITE
 *
 * If a recogniser ever runs, the string it produces is in the PERCEPTION realm. The vault is in the
 * CONTENT SCRIPT's realm, because M2 put it where the page's values are. Getting a recognised
 * string into the existing vault means sending it through the worker — the exact thing M2 exists to
 * prevent, running in the other direction.
 *
 * A second vault is forbidden and would be wrong. The honest options are to move nothing and
 * **never recognise** — detect a text region and redact it unread, which needs no vault because no
 * string is produced — or to solve the realm question first. M4 does not solve it and does not
 * pretend to.
 */

/** The PII classes the privacy package already knows. Named, never widened here. */
export type TextClass = string;

/**
 * One thing the text tier found.
 *
 * NOTE THE ABSENCE: there is no `text`, no `chars`, no `value`, no `transcript`. A finding says
 * *where* something is, *how much* of it there is, and *what class* the existing classifier put it
 * in. It cannot say what it said. That is deliberate and it is the entire point of the type.
 */
export interface TextFinding {
  /** Where, in canonical CSS viewport pixels. */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** How many characters were recognised. A count is not a transcript. */
  readonly length: number;
  /** What the EXISTING privacy classifier made of it, or null for "not sensitive by its rules". */
  readonly piiClass: TextClass | null;
  /**
   * A handle the local realm can resolve and nobody else can.
   *
   * `null` today, and null is the honest value: a reference means nothing unless something holds
   * what it refers to, and the realm that would hold it is not the realm that would produce it.
   */
  readonly ref: string | null;
}

export interface TextPerceptionReport {
  readonly available: boolean;
  /** Why not. Never a quiet zero findings, which would read as "looked, saw nothing sensitive". */
  readonly refusal: { readonly code: string; readonly detail: string } | null;
  readonly findings: readonly TextFinding[];
  readonly ms: number;
}

/** A recogniser, if one is ever adopted. Given pixels, returns findings that carry no strings. */
export interface TextPerception {
  read(image: { readonly width: number; readonly height: number; readonly rgba: Uint8ClampedArray | Uint8Array }): Promise<readonly TextFinding[]>;
  readonly modelId: string;
  readonly revision: string;
}

export const TEXT_PERCEPTION_UNAVAILABLE = {
  code: "TEXT_PERCEPTION_UNAVAILABLE",
  detail:
    "No local text model is adopted. PP-OCRv5_mobile_det fails the S-04a-1 correctness criterion " +
    "on WASM (4.12e-02 against a 2e-02 bound), and model-adoption rule 2 is frozen: a model that " +
    "fails the WASM columns is not shipped whatever it does on WebGPU. See " +
    "artifacts/experiments/M4-gesture-text-perception/ocr-audit.md.",
} as const;

/** What every pass reports today: the tier is absent, and says so rather than returning nothing. */
export const textPerceptionAbsent = (): TextPerceptionReport => ({
  available: false,
  refusal: { ...TEXT_PERCEPTION_UNAVAILABLE },
  findings: [],
  ms: 0,
});

/**
 * Run the text tier, or report its absence.
 *
 * `null` is the shipped configuration. The parameter exists so the boundary can be tested with a
 * stub that genuinely recognises text — a boundary whose model is absent cannot be checked any
 * other way, and an untested boundary is a hope.
 */
export async function perceiveText(
  tier: TextPerception | null,
  image: { readonly width: number; readonly height: number; readonly rgba: Uint8ClampedArray | Uint8Array },
  now: () => number = () => Date.now()
): Promise<TextPerceptionReport> {
  if (tier === null) return textPerceptionAbsent();
  const started = now();
  try {
    const findings = await tier.read(image);
    return { available: true, refusal: null, findings, ms: now() - started };
  } catch (cause) {
    // A tier that threw did not look. It must not be reported as a tier that found nothing.
    return {
      available: false,
      refusal: { code: "TEXT_PERCEPTION_THREW", detail: String((cause as Error)?.message ?? cause) },
      findings: [],
      ms: now() - started,
    };
  }
}
