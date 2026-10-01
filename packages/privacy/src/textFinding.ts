/**
 * THE FAIL-CLOSED `TextFinding` — ADR-0011 §3, and the redaction plan it drives.
 *
 * A text finding is one of exactly two things, discriminated by `kind`:
 *
 *   UNREAD_REGION  a detector found text here and read NONE of it. The only shape a
 *                  `TextRegionDetector` (TR-01 / TR-02) may produce. It has no class, no count, no
 *                  reference and no field that could hold a character. Its treatment is the constant
 *                  REDACT_UNREAD: it is always redacted, whatever its score.
 *   READ_TEXT      the existing reading-producer shape (`box, length, piiClass, ref`), unchanged, with
 *                  its existing semantics. No reading producer is adopted, and this module exports no
 *                  constructor for it: it can only arrive through the parser.
 *
 * WHY A NEW VARIANT RATHER THAN A VALUE OF `piiClass`. Both "neutral-looking" values already mean
 * safe: `piiClass: null` is "read, and not sensitive by its rules" (the reader seam), and `UNKNOWN` is
 * tier PUBLIC (`classes.ts`), "transmitted unchanged". A detector reporting either would declare unread
 * text harmless. So UNREAD_REGION has no `piiClass` to set — not null, not UNKNOWN, not anything — and
 * the parser refuses an unread region that carries one.
 *
 * FAIL CLOSED, WHOLE. `planVisualRedaction` masks every visual-only region with the canonical
 * `redactionMask` over the boxes that must be redacted — or, when the text tier did not produce a
 * fully valid report (unavailable, error, timeout, malformed, missing), masks every region WHOLE with
 * `failClosedMask` (INV-23: "A detector that errors or times out counts as a positive"). One refused
 * finding spoils the whole report; it never degrades to "use the findings that parsed". The only way
 * to get an empty mask for a region is an OK report that found nothing there.
 *
 * THE STATED LIMITATION, unchanged (`docs/perception/visual-only-text-policy.md`): an OK report that
 * MISSES text masks nothing there. This protects against a detector that fails, not one that misses.
 *
 * GEOMETRY is the canonical `redactionGeometry.ts`, called and never re-implemented: this module
 * decides WHICH boxes and WHICH regions; the frozen union (4 px, IoU > 0.3, clip) decides the shape.
 *
 * PURE. No network, no browser API, no model, no pixels. It consumes geometry and codes.
 *
 * The behavioural oracle is M9's test-only reference model
 * (`artifacts/experiments/M9-adoption-review/contract/`). It is ported here, not imported.
 */
import { PII_CLASSES, TIER_OF, type PiiClass } from "./classes.js";
import { failClosedMask, redactionMask, type Rect } from "./redactionGeometry.js";

export const TEXT_FINDING_KIND = Object.freeze({ unread: "UNREAD_REGION", read: "READ_TEXT" } as const);

/** The one treatment an unread region has. A constant, not a variable a producer can choose. */
export const REDACT_UNREAD = "REDACT_UNREAD" as const;

/** A detected, UNREAD text region inside a visual-only area. Always redacted. */
export interface UnreadRegion {
  readonly kind: "UNREAD_REGION";
  /** CSS viewport pixels (INV-24). */
  readonly box: Rect;
  /** The detector's own score, 0..1. It gates nothing: an unread region is redacted at any score. */
  readonly score: number;
  /** The visual-only region (canvas, image) this box lies in. */
  readonly regionId: string;
  readonly treatment: typeof REDACT_UNREAD;
}

/** The existing reader shape, for a producer that READS. None is adopted. Still carries no string. */
export interface ReadText {
  readonly kind: "READ_TEXT";
  readonly box: Rect;
  /** How many characters were recognised. A count is not a transcript. */
  readonly length: number;
  /** What the existing classifier made of it, or null for "not sensitive by its rules". */
  readonly piiClass: PiiClass | null;
  readonly ref: string | null;
}

export type TextFinding = UnreadRegion | ReadText;

/** The only keys each variant may carry, in the order M9 fixed them. */
export const UNREAD_REGION_KEYS = Object.freeze(["kind", "box", "score", "regionId", "treatment"] as const);
export const READ_TEXT_KEYS = Object.freeze(["kind", "box", "length", "piiClass", "ref"] as const);

/** What a detector-only producer supplies. Nothing else can be passed, and nothing else is kept. */
export interface UnreadRegionInput {
  readonly box: Rect;
  readonly score: number;
  readonly regionId: string;
}

export type TextFindingParse =
  | { readonly ok: true; readonly finding: TextFinding }
  | { readonly ok: false; readonly code: string };

const BOX_KEYS = ["x", "y", "w", "h"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Own keys, symbols included, as strings. A symbol key is a key the allowlist does not name. */
const ownKeys = (v: object): string[] => Reflect.ownKeys(v).map((k) => (typeof k === "string" ? k : String(k)));

/** Keys outside `allowed`, and keys of `allowed` that are absent. Absence is never a default. */
function keyDiff(v: object, allowed: readonly string[]): { extra: string[]; missing: string[] } {
  const keys = ownKeys(v);
  return {
    extra: keys.filter((k) => !allowed.includes(k)).sort(),
    missing: allowed.filter((k) => !keys.includes(k)),
  };
}

/** A finite, positive-extent box with exactly x, y, w, h — a copy, so nothing else rides along. */
function parseBox(b: unknown): Rect | null {
  if (!isRecord(b)) return null;
  const { extra, missing } = keyDiff(b, BOX_KEYS);
  if (extra.length || missing.length) return null;
  const [x, y, w, h] = BOX_KEYS.map((k) => b[k]);
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if ((w as number) <= 0 || (h as number) <= 0) return null;
  return Object.freeze({ x: x as number, y: y as number, w: w as number, h: h as number });
}

const isPiiClass = (v: unknown): v is PiiClass => typeof v === "string" && (PII_CLASSES as readonly string[]).includes(v);

function parseUnread(v: Record<string, unknown>): TextFindingParse {
  const { extra, missing } = keyDiff(v, UNREAD_REGION_KEYS);
  if (extra.length) return { ok: false, code: `UNREAD_REGION_EXTRA_FIELD:${extra.join(",")}` };
  if (missing.length) return { ok: false, code: `UNREAD_REGION_MISSING_FIELD:${missing.join(",")}` };
  if (v["treatment"] !== REDACT_UNREAD) return { ok: false, code: "UNREAD_REGION_TREATMENT" };
  const box = parseBox(v["box"]);
  if (!box) return { ok: false, code: "UNREAD_REGION_GEOMETRY" };
  const score = v["score"];
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
    return { ok: false, code: "UNREAD_REGION_SCORE" };
  }
  const regionId = v["regionId"];
  if (typeof regionId !== "string" || regionId.length === 0) return { ok: false, code: "UNREAD_REGION_REGION" };
  return {
    ok: true,
    finding: Object.freeze({ kind: TEXT_FINDING_KIND.unread, box, score, regionId, treatment: REDACT_UNREAD }),
  };
}

function parseRead(v: Record<string, unknown>): TextFindingParse {
  const { extra, missing } = keyDiff(v, READ_TEXT_KEYS);
  if (extra.length) return { ok: false, code: `READ_TEXT_EXTRA_FIELD:${extra.join(",")}` };
  if (missing.length) return { ok: false, code: `READ_TEXT_MISSING_FIELD:${missing.join(",")}` };
  const box = parseBox(v["box"]);
  if (!box) return { ok: false, code: "READ_TEXT_GEOMETRY" };
  const length = v["length"];
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) return { ok: false, code: "READ_TEXT_LENGTH" };
  const piiClass = v["piiClass"];
  if (piiClass !== null && !isPiiClass(piiClass)) return { ok: false, code: "READ_TEXT_UNKNOWN_CLASS" };
  const ref = v["ref"];
  if (ref !== null && typeof ref !== "string") return { ok: false, code: "READ_TEXT_REF" };
  return { ok: true, finding: Object.freeze({ kind: TEXT_FINDING_KIND.read, box, length, piiClass, ref }) };
}

/**
 * Parse one finding from untrusted data — anything that crossed, or could have crossed, a realm.
 *
 * Refuses: a non-object, a missing or unknown `kind`, any key outside the variant's allowlist (so an
 * unread region carrying `piiClass`, `length`, `ref` or `text` is refused, whatever the value), any
 * missing key, a box that is not exactly four finite numbers with positive extent, a score outside
 * 0..1, an empty region id, a treatment other than REDACT_UNREAD, and a class the classifier does not
 * know. The result is a fresh frozen copy; the input is never retained.
 */
export function parseTextFinding(value: unknown): TextFindingParse {
  if (!isRecord(value)) return { ok: false, code: "NOT_AN_OBJECT" };
  if (!Object.hasOwn(value, "kind")) return { ok: false, code: "MISSING_KIND" };
  if (value["kind"] === TEXT_FINDING_KIND.unread) return parseUnread(value);
  if (value["kind"] === TEXT_FINDING_KIND.read) return parseRead(value);
  return { ok: false, code: "UNKNOWN_KIND" };
}

/**
 * The detector's constructor: box, score and region in; an UNREAD_REGION out. There is no parameter
 * for a class, a count or a reference, and nothing it produces can be READ_TEXT. Throws on anything
 * that is not valid geometry, so an invalid detector box is refused rather than masked as nothing.
 */
export function unreadRegion(input: UnreadRegionInput): UnreadRegion {
  const parsed = parseTextFinding({
    kind: TEXT_FINDING_KIND.unread,
    box: input.box,
    score: input.score,
    regionId: input.regionId,
    treatment: REDACT_UNREAD,
  });
  if (!parsed.ok || parsed.finding.kind !== TEXT_FINDING_KIND.unread) {
    throw new TypeError(`Not a valid unread text region: ${parsed.ok ? "WRONG_KIND" : parsed.code}.`);
  }
  return parsed.finding;
}

const unreachable = (x: never): never => {
  throw new TypeError(`Unhandled text finding kind: ${JSON.stringify(x)}`);
};

/**
 * Does a well-typed finding's area have to be masked?
 *
 *   UNREAD_REGION  always.
 *   READ_TEXT      as the existing classifier says: masked unless it found no class (null) or a
 *                  PUBLIC one (UNKNOWN). Unchanged reader semantics, for a producer that reads.
 */
export function findingRequiresRedaction(finding: TextFinding): boolean {
  switch (finding.kind) {
    case "UNREAD_REGION":
      return true;
    case "READ_TEXT":
      return finding.piiClass !== null && TIER_OF[finding.piiClass] !== "PUBLIC";
    default:
      return unreachable(finding);
  }
}

/** The same question about untrusted data: anything that does not parse is redacted. */
export const mustRedact = (value: unknown): boolean => {
  const parsed = parseTextFinding(value);
  return parsed.ok ? findingRequiresRedaction(parsed.finding) : true;
};

// ─────────────────────────────── redaction planning ───────────────────────────────

/**
 * What the text tier reported for one pass, before it is trusted. The planner re-validates every
 * field at runtime, because by the time this is wired the report will have crossed a realm, and a
 * static type is not evidence.
 *
 * The wiring maps the detector's refusals here: DETECTOR_UNAVAILABLE / DETECTOR_BACKEND_UNSUPPORTED
 * → UNAVAILABLE, DETECTOR_TIMEOUT → TIMEOUT, MODEL_OUTPUT_MALFORMED → MALFORMED, anything else → ERROR.
 * Every one of them plans identically: the whole region is masked.
 */
export type TextRegionReport =
  | { readonly status: "OK"; readonly findings: readonly TextFinding[] }
  | { readonly status: TextRegionFailureStatus };

export type TextRegionFailureStatus = "UNAVAILABLE" | "ERROR" | "TIMEOUT" | "MALFORMED";

const FAILURE_STATUSES: readonly string[] = ["UNAVAILABLE", "ERROR", "TIMEOUT", "MALFORMED"];

/** A visual-only area of the frame — pixels the DOM cannot describe — in CSS viewport pixels. */
export interface VisualRegion {
  readonly id: string;
  readonly rect: Rect;
}

export interface RegionMask {
  readonly regionId: string;
  readonly region: Rect;
  /** The rectangles to fill opaquely. Their union is the mask. */
  readonly mask: readonly Rect[];
}

/**
 * The plan for one pass.
 *
 *   PLANNED, failClosed false  a valid OK report: each region masked over the boxes that must be.
 *   PLANNED, failClosed true   anything else about the report: every region masked whole (INV-23).
 *   REFUSED                    a visual-only region itself has no usable position, so no mask can be
 *                              computed for it. Nothing about that frame may leave: there is no mask
 *                              to apply, and an unmasked region is not an option.
 */
export type VisualRedactionPlan =
  | {
      readonly outcome: "PLANNED";
      readonly failClosed: false;
      readonly reason: null;
      readonly regions: readonly RegionMask[];
    }
  | {
      readonly outcome: "PLANNED";
      readonly failClosed: true;
      readonly reason: string;
      readonly regions: readonly RegionMask[];
    }
  | { readonly outcome: "REFUSED"; readonly code: "REGION_INVALID"; readonly detail: string };

function checkRegions(regions: unknown): string | null {
  if (!Array.isArray(regions)) return "regions is not an array";
  const seen = new Set<string>();
  for (const [i, r] of regions.entries()) {
    if (!isRecord(r)) return `region ${i} is not an object`;
    const id = r["id"];
    if (typeof id !== "string" || id.length === 0) return `region ${i} has no id`;
    if (seen.has(id)) return `region id ${JSON.stringify(id)} is duplicated`;
    seen.add(id);
    if (!parseBox(r["rect"])) return `region ${JSON.stringify(id)} has no finite, positive rectangle`;
  }
  return null;
}

const copyRect = (r: Rect): Rect => Object.freeze({ x: r.x, y: r.y, w: r.w, h: r.h });

/**
 * Plan the visual redaction for one pass. Pure.
 *
 * `report` is `unknown` on purpose: whatever its static type, it is re-parsed here. Anything but an
 * object `{ status: "OK", findings: [...] }` whose every finding parses and whose every unread region
 * names a region of this frame plans the WHOLE of every region. There is no generic "failure" that
 * returns an empty mask.
 */
export function planVisualRedaction(regions: readonly VisualRegion[], report: unknown): VisualRedactionPlan {
  const bad = checkRegions(regions);
  if (bad) return Object.freeze({ outcome: "REFUSED", code: "REGION_INVALID", detail: bad });

  const whole = (reason: string): VisualRedactionPlan =>
    Object.freeze({
      outcome: "PLANNED",
      failClosed: true,
      reason,
      regions: Object.freeze(
        regions.map((r) =>
          Object.freeze({ regionId: r.id, region: copyRect(r.rect), mask: Object.freeze(failClosedMask(r.rect).map(copyRect)) })
        )
      ),
    });

  if (report === undefined || report === null) return whole("NO_REPORT");
  if (!isRecord(report)) return whole("MALFORMED:REPORT_NOT_AN_OBJECT");
  const status = report["status"];
  if (typeof status === "string" && FAILURE_STATUSES.includes(status)) return whole(status);
  if (status !== "OK") return whole("MALFORMED:REPORT_STATUS");
  const { extra, missing } = keyDiff(report, ["status", "findings"]);
  if (extra.length) return whole(`MALFORMED:REPORT_EXTRA_FIELD:${extra.join(",")}`);
  if (missing.length) return whole(`MALFORMED:REPORT_MISSING_FIELD:${missing.join(",")}`);
  const raw = report["findings"];
  if (!Array.isArray(raw)) return whole("MALFORMED:FINDINGS_NOT_ARRAY");

  const findings: TextFinding[] = [];
  for (const f of raw) {
    const p = parseTextFinding(f);
    if (!p.ok) return whole(`MALFORMED:${p.code}`);
    findings.push(p.finding);
  }
  const ids = new Set(regions.map((r) => r.id));
  if (findings.some((f) => f.kind === "UNREAD_REGION" && !ids.has(f.regionId))) return whole("MALFORMED:UNKNOWN_REGION");

  return Object.freeze({
    outcome: "PLANNED",
    failClosed: false,
    reason: null,
    regions: Object.freeze(
      regions.map((r) => {
        const boxes = findings
          .filter((f) => findingRequiresRedaction(f) && (f.kind === "READ_TEXT" || f.regionId === r.id))
          .map((f) => f.box);
        return Object.freeze({
          regionId: r.id,
          region: copyRect(r.rect),
          mask: Object.freeze(redactionMask(boxes, r.rect).map(copyRect)),
        });
      })
    ),
  });
}
