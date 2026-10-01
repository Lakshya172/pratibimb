/**
 * M12 — THE REDACTION MANIFEST, v1.2 (owner-approved in M12; ADR-0012 §6). The wire form.
 *
 * v1.1 (`docs/architecture/manifest-schema.md`) could not carry M10's visual-only masks: every
 * `redactions[]` entry needs a PII class, and an unread visual region has none. v1.2 adds exactly three
 * things:
 *   - `visual_masks[]` — `{ region_id, kind, bbox, method, reason }`. The region id is positional
 *     (`canvas:N` / `img:N`), the bbox is in CSS px (INV-24), the method is always `opaque_fill`, and
 *     the reason is closed. No class, token, length or text;
 *   - `request` — `{ id, session }`, the run identity the body hash is bound to;
 *   - `capture.format` — `webp` (with `q: 62`) when a frame part follows, `none` when it does not.
 * Everything else is v1.1's, with the field shapes this code base already emits.
 *
 * THE PARSER IS STRICT. An unknown field at any depth, a wrong type, a non-finite number, an enum
 * outside its set, an encoded payload or a field named for content (`text`, `value`, `ocr`, `html`,
 * `selector`, `url`, `pixels`, …) is a refusal with a path, never a coercion.
 *
 * THE SERIALIZER IS CANONICAL: object keys sorted at every depth, no insignificant whitespace,
 * numbers as JavaScript prints them. The same manifest always gives the same bytes.
 *
 * Pure: no browser API, no network, no model.
 */
import { PII_CLASSES, type PiiClass, type Tier } from "./classes.js";
import { isVerifiedHandoff, type VerifiedHandoff } from "./handoff.js";
import { isMaskVerifiedFrame, type MaskVerifiedFrame } from "./maskedArtifact.js";

export const MANIFEST_VERSION_V12 = "1.2" as const;

interface CaptureBase {
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
  readonly zoom: number;
  readonly scale_to_css: number;
  readonly scroll: { readonly x: number; readonly y: number };
  readonly origin: string;
}
export type CaptureV12 = (CaptureBase & { readonly format: "webp"; readonly q: 62 }) | (CaptureBase & { readonly format: "none" });

export type VisualMaskReason = "DETECTED" | "FAIL_CLOSED:UNAVAILABLE" | "FAIL_CLOSED:ERROR" | "FAIL_CLOSED:TIMEOUT" | "FAIL_CLOSED:MALFORMED";
export const VISUAL_MASK_REASONS: readonly VisualMaskReason[] = ["DETECTED", "FAIL_CLOSED:UNAVAILABLE", "FAIL_CLOSED:ERROR", "FAIL_CLOSED:TIMEOUT", "FAIL_CLOSED:MALFORMED"];

export interface VisualMaskV12 {
  readonly region_id: string;
  readonly kind: "canvas" | "img";
  readonly bbox: readonly [number, number, number, number];
  readonly method: "opaque_fill";
  readonly reason: VisualMaskReason;
}

export interface RedactionV12 {
  readonly token: string;
  readonly class: PiiClass;
  readonly tier: Tier;
  readonly bbox?: readonly [number, number, number, number];
  readonly method: "token_reference" | "masked_no_token";
  readonly detectors: readonly ("D1" | "D2")[];
  readonly hint: { readonly len: number; readonly kind: "numeric" | "alpha" | "alphanumeric" | "date"; readonly field_role?: string };
  readonly targetId: string;
}

export interface ElementV12 {
  readonly id: string;
  readonly role: string;
  readonly name: string;
  readonly bbox?: readonly [number, number, number, number];
  readonly source: "dom" | "vision" | "dom+vision";
  readonly visible: boolean;
  readonly offscreen: boolean;
  readonly enabled: boolean;
}

export interface ManifestV12 {
  readonly manifest_version: "1.2";
  readonly capture: CaptureV12;
  /** The live backend; `none` when no local model ran (what `sanitize()` records then). */
  readonly capability: { readonly backend: "wasm" | "webgpu" | "none"; readonly tiers_fired: readonly string[] };
  readonly redactions: readonly RedactionV12[];
  readonly elements: readonly ElementV12[];
  readonly visual_masks: readonly VisualMaskV12[];
  /** The structure verifier's verdict, AND — when a frame is present — the frame's: true only if the frame is VERIFIED. */
  readonly verified: boolean;
  /** The user's stated goal. Never page-derived text. */
  readonly goal: string;
  readonly request: { readonly id: string; readonly session: string };
}

export type ManifestRefusalCode = "MISSING_GOAL" | "MALFORMED_MANIFEST" | "PLAINTEXT_IN_MANIFEST";
export type ManifestParse = { readonly ok: true; readonly manifest: ManifestV12 } | { readonly ok: false; readonly code: ManifestRefusalCode; readonly path: string; readonly detail: string };

const FORBIDDEN_KEYS = new Set(["text", "value", "values", "ocr", "html", "dom", "selector", "selectors", "url", "href", "src", "pixels", "rgba", "image", "bytes", "b64", "base64", "plaintext", "secret", "literal", "markup", "innerhtml", "outerhtml"]);
const LONG_BASE64 = /[A-Za-z0-9+/]{200,}/;
const TIERS: readonly Tier[] = ["CRITICAL", "SENSITIVE", "PERSONAL", "PUBLIC"];

class Refusal extends Error {
  constructor(readonly code: ManifestRefusalCode, readonly path: string, detail: string) {
    super(detail);
  }
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (path: string, detail: string): never => {
  throw new Refusal("MALFORMED_MANIFEST", path, detail);
};
const keys = (o: Record<string, unknown>, path: string, required: readonly string[], optional: readonly string[] = []): void => {
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) bad(`${path}.${k}`, "an unknown field");
  for (const k of required) if (!(k in o)) bad(`${path}.${k}`, "a required field is missing");
};
const obj = (v: unknown, path: string): Record<string, unknown> => (isObj(v) ? v : bad(path, "not an object"));
const arr = (v: unknown, path: string): unknown[] => (Array.isArray(v) ? v : bad(path, "not a list"));
const str = (v: unknown, path: string, nonEmpty = true): string => (typeof v === "string" && (!nonEmpty || v !== "") ? v : bad(path, "not a non-empty string"));
const num = (v: unknown, path: string): number => (typeof v === "number" && Number.isFinite(v) ? v : bad(path, "not a finite number"));
const bool = (v: unknown, path: string): boolean => (typeof v === "boolean" ? v : bad(path, "not a boolean"));
const oneOf = <T extends string>(v: unknown, set: readonly T[], path: string): T => (typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T) : bad(path, "outside its set"));
const box = (v: unknown, path: string): [number, number, number, number] => {
  const a = arr(v, path);
  if (a.length !== 4) bad(path, "not four numbers");
  return [num(a[0], `${path}[0]`), num(a[1], `${path}[1]`), num(a[2], `${path}[2]`), num(a[3], `${path}[3]`)];
};

function forbidden(v: unknown, path: string): void {
  if (typeof v === "string") {
    if (LONG_BASE64.test(v) || v.startsWith("data:")) throw new Refusal("PLAINTEXT_IN_MANIFEST", path, "an encoded payload");
    return;
  }
  if (Array.isArray(v)) return v.forEach((x, i) => forbidden(x, `${path}[${i}]`));
  if (isObj(v))
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) throw new Refusal("PLAINTEXT_IN_MANIFEST", `${path}.${k}`, "a field the manifest may not carry");
      forbidden(x, `${path}.${k}`);
    }
}

/** Parse and validate a v1.2 manifest. Strict; a refusal names the path. */
export function parseManifestV12(input: unknown): ManifestParse {
  try {
    const m = obj(input, "$");
    if (typeof m["goal"] !== "string" || m["goal"].trim() === "") throw new Refusal("MISSING_GOAL", "$.goal", "the user's goal is missing");
    forbidden(m, "$");
    keys(m, "$", ["manifest_version", "capture", "capability", "redactions", "elements", "visual_masks", "verified", "goal", "request"]);
    if (m["manifest_version"] !== MANIFEST_VERSION_V12) bad("$.manifest_version", "not 1.2");

    const c = obj(m["capture"], "$.capture");
    const format = oneOf(c["format"], ["webp", "none"] as const, "$.capture.format");
    keys(c, "$.capture", ["w", "h", "dpr", "zoom", "scale_to_css", "scroll", "origin", "format", ...(format === "webp" ? ["q"] : [])]);
    if (format === "webp" && c["q"] !== 62) bad("$.capture.q", "a webp capture declares q 62");
    const scroll = obj(c["scroll"], "$.capture.scroll");
    keys(scroll, "$.capture.scroll", ["x", "y"]);
    const w = num(c["w"], "$.capture.w");
    const h = num(c["h"], "$.capture.h");
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) bad("$.capture", "w and h are not positive integers");
    const capture = { w, h, dpr: num(c["dpr"], "$.capture.dpr"), zoom: num(c["zoom"], "$.capture.zoom"), scale_to_css: num(c["scale_to_css"], "$.capture.scale_to_css"), scroll: { x: num(scroll["x"], "$.capture.scroll.x"), y: num(scroll["y"], "$.capture.scroll.y") }, origin: str(c["origin"], "$.capture.origin") };

    const cap = obj(m["capability"], "$.capability");
    keys(cap, "$.capability", ["backend", "tiers_fired"]);
    const capability = { backend: oneOf(cap["backend"], ["wasm", "webgpu", "none"] as const, "$.capability.backend"), tiers_fired: arr(cap["tiers_fired"], "$.capability.tiers_fired").map((t, i) => str(t, `$.capability.tiers_fired[${i}]`)) };

    const redactions = arr(m["redactions"], "$.redactions").map((r0, i): RedactionV12 => {
      const p = `$.redactions[${i}]`;
      const r = obj(r0, p);
      keys(r, p, ["token", "class", "tier", "method", "detectors", "hint", "targetId"], ["bbox"]);
      const hint0 = obj(r["hint"], `${p}.hint`);
      keys(hint0, `${p}.hint`, ["len", "kind"], ["field_role"]);
      const hint = { len: num(hint0["len"], `${p}.hint.len`), kind: oneOf(hint0["kind"], ["numeric", "alpha", "alphanumeric", "date"] as const, `${p}.hint.kind`), ...(hint0["field_role"] === undefined ? {} : { field_role: str(hint0["field_role"], `${p}.hint.field_role`) }) };
      const method = oneOf(r["method"], ["token_reference", "masked_no_token"] as const, `${p}.method`);
      const token = str(r["token"], `${p}.token`, false);
      if (method === "token_reference" && !/^<PII:[A-Z]+:\d+>$/.test(token)) bad(`${p}.token`, "not a reference token");
      if (method === "masked_no_token" && token !== "") bad(`${p}.token`, "a masked span carries no reference");
      return {
        token,
        class: oneOf(r["class"], PII_CLASSES, `${p}.class`),
        tier: oneOf(r["tier"], TIERS, `${p}.tier`),
        ...(r["bbox"] === undefined ? {} : { bbox: box(r["bbox"], `${p}.bbox`) }),
        method,
        detectors: arr(r["detectors"], `${p}.detectors`).map((d, j) => oneOf(d, ["D1", "D2"] as const, `${p}.detectors[${j}]`)),
        hint,
        targetId: str(r["targetId"], `${p}.targetId`),
      };
    });

    const elements = arr(m["elements"], "$.elements").map((e0, i): ElementV12 => {
      const p = `$.elements[${i}]`;
      const e = obj(e0, p);
      keys(e, p, ["id", "role", "name", "source", "visible", "offscreen", "enabled"], ["bbox"]);
      return {
        id: str(e["id"], `${p}.id`),
        role: str(e["role"], `${p}.role`),
        name: str(e["name"], `${p}.name`, false),
        ...(e["bbox"] === undefined ? {} : { bbox: box(e["bbox"], `${p}.bbox`) }),
        source: oneOf(e["source"], ["dom", "vision", "dom+vision"] as const, `${p}.source`),
        visible: bool(e["visible"], `${p}.visible`),
        offscreen: bool(e["offscreen"], `${p}.offscreen`),
        enabled: bool(e["enabled"], `${p}.enabled`),
      };
    });

    const visual_masks = arr(m["visual_masks"], "$.visual_masks").map((v0, i): VisualMaskV12 => {
      const p = `$.visual_masks[${i}]`;
      const v = obj(v0, p);
      keys(v, p, ["region_id", "kind", "bbox", "method", "reason"]);
      const region_id = str(v["region_id"], `${p}.region_id`);
      const kind = oneOf(v["kind"], ["canvas", "img"] as const, `${p}.kind`);
      if (!new RegExp(`^${kind}:\\d+$`).test(region_id)) bad(`${p}.region_id`, "not a positional id of its kind");
      if (v["method"] !== "opaque_fill") bad(`${p}.method`, "not opaque_fill");
      return { region_id, kind, bbox: box(v["bbox"], `${p}.bbox`), method: "opaque_fill", reason: oneOf(v["reason"], VISUAL_MASK_REASONS, `${p}.reason`) };
    });

    const req = obj(m["request"], "$.request");
    keys(req, "$.request", ["id", "session"]);
    const manifest: ManifestV12 = {
      manifest_version: "1.2",
      capture: format === "webp" ? { ...capture, format: "webp", q: 62 } : { ...capture, format: "none" },
      capability,
      redactions,
      elements,
      visual_masks,
      verified: bool(m["verified"], "$.verified"),
      goal: m["goal"] as string,
      request: { id: str(req["id"], "$.request.id"), session: str(req["session"], "$.request.session") },
    };
    return { ok: true, manifest };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, code: e.code, path: e.path, detail: e.message };
    return { ok: false, code: "MALFORMED_MANIFEST", path: "$", detail: "unparseable" };
  }
}

/** Canonical JSON: keys sorted at every depth, no insignificant whitespace. Deterministic. */
export function canonicalManifestJson(manifest: ManifestV12): string {
  const norm = (x: unknown): unknown => (Array.isArray(x) ? x.map(norm) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, norm(x[k])])) : x);
  return JSON.stringify(norm(manifest));
}

const reasonOf = (failClosed: boolean, reason: string | null): VisualMaskReason => {
  if (!failClosed) return "DETECTED";
  const r = `FAIL_CLOSED:${reason ?? "ERROR"}`;
  return (VISUAL_MASK_REASONS as readonly string[]).includes(r) ? (r as VisualMaskReason) : "FAIL_CLOSED:ERROR";
};

export type BuildManifestOutcome = { readonly ok: true; readonly manifest: ManifestV12 } | { readonly ok: false; readonly code: "HANDOFF_NOT_VERIFIED" | "FRAME_NOT_MASK_VERIFIED" | ManifestRefusalCode; readonly detail: string };

/**
 * Build the wire manifest from a VERIFIED handoff, with or without the frame it describes.
 *
 * - With a frame (`capture.format: "webp"`): the frame must be a MASK_VERIFIED artifact. Its masks
 *   become `visual_masks[]`, each pixel rectangle mapped back to CSS px. `verified` is **false**,
 *   because a MASK_VERIFIED frame is not a VERIFIED one.
 * - Without (`capture.format: "none"`, structure-only): `verified` is the structure verifier's `true`.
 *   Visual masks still describe what was masked, if a frame was masked.
 * The result is passed back through the parser, so the builder can never emit what the parser refuses.
 */
export function buildManifestV12(input: { readonly handoff: VerifiedHandoff; readonly frame: MaskVerifiedFrame | null; readonly masksFrom?: MaskVerifiedFrame | null }): BuildManifestOutcome {
  if (!isVerifiedHandoff(input.handoff)) return { ok: false, code: "HANDOFF_NOT_VERIFIED", detail: "the handoff was not produced by the privacy verifier" };
  if (input.frame !== null && !isMaskVerifiedFrame(input.frame)) return { ok: false, code: "FRAME_NOT_MASK_VERIFIED", detail: "the frame was not attested" };
  const h = input.handoff;
  const source = input.frame ?? input.masksFrom ?? null;
  const visual_masks: VisualMaskV12[] = source
    ? source.manifest.regions.flatMap((r) =>
        r.pixelRects.map((p) => ({
          region_id: r.regionId,
          kind: (r.regionId.startsWith("img:") ? "img" : "canvas") as "canvas" | "img",
          bbox: [p.x * source.manifest.scaleToCss, p.y * source.manifest.scaleToCss, p.w * source.manifest.scaleToCss, p.h * source.manifest.scaleToCss] as [number, number, number, number],
          method: "opaque_fill" as const,
          reason: reasonOf(source.manifest.failClosed, source.manifest.reason),
        }))
      )
    : [];
  const base = { w: input.frame ? input.frame.width : h.capture.w, h: input.frame ? input.frame.height : h.capture.h, dpr: h.capture.dpr, zoom: h.capture.zoom, scale_to_css: h.capture.scale_to_css, scroll: { x: h.capture.scroll.x, y: h.capture.scroll.y }, origin: h.capture.origin };
  const candidate = {
    manifest_version: "1.2",
    capture: input.frame ? { ...base, format: "webp", q: 62 } : { ...base, format: "none" },
    capability: { backend: h.capability.backend, tiers_fired: [...h.capability.tiers_fired] },
    redactions: h.redactions.map((r) => ({ token: r.token, class: r.class, tier: r.tier, ...(r.bbox ? { bbox: [...r.bbox] } : {}), method: r.method, detectors: [...r.detectors], hint: { len: r.hint.len, kind: r.hint.kind, ...(r.hint.field_role === undefined ? {} : { field_role: r.hint.field_role }) }, targetId: r.targetId })),
    elements: h.elements.map((e) => ({ id: e.id, role: e.role, name: e.name, ...(e.bbox ? { bbox: [...e.bbox] } : {}), source: e.source, visible: e.visible, offscreen: e.offscreen, enabled: e.enabled })),
    visual_masks,
    verified: input.frame === null,
    goal: h.goal,
    request: { id: h.request.requestId, session: h.request.sessionId },
  };
  const parsed = parseManifestV12(candidate);
  return parsed.ok ? { ok: true, manifest: parsed.manifest } : { ok: false, code: parsed.code, detail: `${parsed.path}: ${parsed.detail}` };
}
