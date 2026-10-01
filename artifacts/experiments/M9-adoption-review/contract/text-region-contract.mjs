/**
 * M9 — REFERENCE MODEL of the proposed detector-only text contract (ADR-0011). TEST-ONLY.
 *
 * This is not product code and nothing in the product imports it. It exists so the fail-closed
 * semantics the ADR proposes are executable and tested BEFORE integration, and so the integration
 * milestone has a behavioural oracle to port: any product implementation must pass the same cases.
 *
 * It encodes four rules, each traceable to frozen text:
 *
 *   1. A detector-only finding is UNREAD_REGION. It has no `piiClass`, no `length`, no `ref`, and no
 *      field that can hold a character sequence. Its treatment is fixed: REDACT_UNREAD.
 *      (visual-only-text-policy.md: "Every detected text region in a visual-only area is classified
 *      sensitive"; the seam must "say 'unread, therefore sensitive'".)
 *   2. Neither `piiClass: null` nor `"UNKNOWN"` can express "unread". In the existing classifier
 *      `null` means "not sensitive by its rules" and `UNKNOWN` maps to tier PUBLIC (classes.ts), so
 *      both would declare unread text safe. The parser refuses a region carrying either.
 *   3. Anything malformed or unrecognised is protective: an unknown kind, a missing kind, a
 *      non-finite coordinate or an extra field makes the whole report unusable, and the region is
 *      masked whole (INV-23: "A detector that errors or times out counts as a positive").
 *   4. Redaction uses the canonical geometry and nothing else: `redactionMask` for detected
 *      regions, `failClosedMask` when the tier did not produce a usable report.
 */
import { failClosedMask, redactionMask } from "../../../../packages/privacy/src/redactionGeometry.ts";

export const FINDING_KIND = Object.freeze({ unread: "UNREAD_REGION", read: "READ_TEXT" });
export const TREATMENT = Object.freeze({ redactUnread: "REDACT_UNREAD" });

/** The only keys an UNREAD_REGION may carry. No text, no count, no class, no reference. */
export const UNREAD_KEYS = Object.freeze(["kind", "box", "score", "regionId", "treatment"]);
/**
 * READ_TEXT is the existing reading-producer shape, kept for compatibility. No reading producer is
 * adopted (PP-OCRv5_mobile_rec stays REJECTED for this role); it still carries no string.
 */
export const READ_KEYS = Object.freeze(["kind", "box", "length", "piiClass", "ref"]);

/** Tier of each PII class, as packages/privacy/src/classes.ts defines it (UNKNOWN is PUBLIC). */
const TIER = Object.freeze({ OTP: "CRITICAL", AADHAAR: "SENSITIVE", PHONE: "PERSONAL", DOB: "PERSONAL", NAME: "PERSONAL", UNKNOWN: "PUBLIC" });

const finiteBox = (b) =>
  b !== null && typeof b === "object" && ["x", "y", "w", "h"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k])) && b.w > 0 && b.h > 0;

/** Build an UNREAD_REGION from a detector box. Throws on anything that is not finite geometry. */
export function unreadRegion({ box, score, regionId }) {
  if (!finiteBox(box)) throw new Error("UNREAD_REGION needs a finite, positive box");
  if (typeof score !== "number" || !Number.isFinite(score)) throw new Error("UNREAD_REGION needs a finite score");
  if (typeof regionId !== "string" || regionId.length === 0) throw new Error("UNREAD_REGION needs its visual-only region");
  return Object.freeze({ kind: FINDING_KIND.unread, box: Object.freeze({ ...box }), score, regionId, treatment: TREATMENT.redactUnread });
}

/**
 * Parse one serialized finding. Returns { ok: true, finding } or { ok: false, code }.
 * Any refusal makes the caller treat the whole report as unusable (rule 3).
 */
export function parseFinding(value) {
  if (value === null || typeof value !== "object") return { ok: false, code: "NOT_AN_OBJECT" };
  const keys = Object.keys(value);
  if (value.kind === FINDING_KIND.unread) {
    const extra = keys.filter((k) => !UNREAD_KEYS.includes(k));
    if (extra.length) return { ok: false, code: `UNREAD_REGION_EXTRA_FIELD:${extra.sort().join(",")}` };
    if (value.treatment !== TREATMENT.redactUnread) return { ok: false, code: "UNREAD_REGION_TREATMENT" };
    try {
      return { ok: true, finding: unreadRegion(value) };
    } catch {
      return { ok: false, code: "UNREAD_REGION_GEOMETRY" };
    }
  }
  if (value.kind === FINDING_KIND.read) {
    const extra = keys.filter((k) => !READ_KEYS.includes(k));
    if (extra.length) return { ok: false, code: `READ_TEXT_EXTRA_FIELD:${extra.sort().join(",")}` };
    if (!finiteBox(value.box)) return { ok: false, code: "READ_TEXT_GEOMETRY" };
    if (value.piiClass !== null && !(value.piiClass in TIER)) return { ok: false, code: "READ_TEXT_UNKNOWN_CLASS" };
    return { ok: true, finding: Object.freeze({ ...value }) };
  }
  return { ok: false, code: value.kind === undefined ? "MISSING_KIND" : "UNKNOWN_KIND" };
}

/**
 * Must this finding's area be masked?
 *   UNREAD_REGION  always (rule 1)
 *   READ_TEXT      as the existing classifier says: masked unless the reader found no class or a
 *                  PUBLIC one — the pre-existing semantics, unchanged, for a producer that READS
 *   anything else  yes (rule 3)
 */
export function mustRedact(finding) {
  if (finding?.kind === FINDING_KIND.unread) return true;
  if (finding?.kind === FINDING_KIND.read) return finding.piiClass !== null && TIER[finding.piiClass] !== "PUBLIC";
  return true;
}

/**
 * Plan the mask for one pass.
 *
 * `regions`: the visual-only regions of the frame, [{ id, rect }], CSS pixels.
 * `report`:  { status: "OK" | "ERROR" | "TIMEOUT" | "UNAVAILABLE", findings: unknown[] }.
 *
 * Anything but a fully parseable OK report masks EVERY region whole (INV-23). Otherwise each region
 * gets `redactionMask` over the boxes of its own findings that must be redacted. A finding naming a
 * region that is not in the frame is malformed, and also masks everything.
 */
export function planRedaction(regions, report) {
  const whole = (reason) => ({ failClosed: true, reason, masks: Object.fromEntries(regions.map((r) => [r.id, failClosedMask(r.rect)])) });
  if (!report || report.status !== "OK") return whole(report?.status ?? "NO_REPORT");
  const parsed = [];
  for (const f of report.findings ?? []) {
    const p = parseFinding(f);
    if (!p.ok) return whole(`MALFORMED:${p.code}`);
    parsed.push(p.finding);
  }
  const ids = new Set(regions.map((r) => r.id));
  if (parsed.some((f) => f.kind === FINDING_KIND.unread && !ids.has(f.regionId))) return whole("MALFORMED:UNKNOWN_REGION");
  const masks = {};
  for (const r of regions) {
    const boxes = parsed.filter((f) => mustRedact(f) && (f.kind !== FINDING_KIND.unread || f.regionId === r.id)).map((f) => f.box);
    masks[r.id] = redactionMask(boxes, r.rect);
  }
  return { failClosed: false, reason: null, masks };
}
