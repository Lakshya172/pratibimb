/**
 * SANITIZE — the T2 tier perception was built to hand off to.
 *
 * It takes what the client observed locally, decides what each value is, puts the values that need
 * protecting into the vault, and assembles a representation in which they have been replaced by
 * opaque references and shape hints. Then it asks the verifier whether that representation is fit to
 * leave, and produces a ledger entry describing what would go.
 *
 * THE SEQUENCE, and every step is refusable:
 *   1. observe    — the caller supplies fields it read locally (this package reads no DOM)
 *   2. classify   — D1 on the field, D2 on the value, the more protective wins
 *   3. validate   — pattern plus checksum; an Aadhaar-shaped string with a bad checksum is not one
 *   4. tokenise   — a reference for each tokenisable class
 *   5. store      — the value goes to the memory-only vault, keyed by that reference
 *   6. mask       — CRITICAL classes are masked and get no reference, ever
 *   7. hint       — shape metadata: length, kind, field role
 *   8. assemble   — manifest v1.1 structure, with the goal and the redaction spans
 *   9. verify     — `verifyHandoff`, fail-closed
 *  10. ledger     — identity, digest, classes; no value
 *
 * THE PROPERTY THE WHOLE PACKAGE EXISTS FOR: **no sensitive value reaches the handoff.** Two
 * independent mechanisms enforce it, because one would be a convention:
 *   - values are never written into the draft — only references and hints are; and
 *   - the verifier scans the finished serialization against the vault's contents and refuses if
 *     anything survived, whichever code path put it there.
 *
 * ELEMENT NAMES ARE SCRUBBED TOO. An accessible name is structural text the server needs — "Mobile
 * number" — but a page can put a value in a label, and a label is text this package would otherwise
 * forward verbatim. Any name holding a detected value is replaced by a class marker before assembly.
 */
import {
  manifestVisibility,
  toBboxArray,
  type ElementGraph,
  type ElementNode,
  type SanitizedElement,
} from "@pratibimb/perception";

import { TIER_OF, type PiiClass } from "./classes.js";
import { classifyObserved, classifyValue, type Classification, type ObservedField } from "./classify.js";
import { fieldRoleOf, hintFor } from "./hints.js";
import {
  markDraft,
  verifyHandoff,
  type HandoffDraft,
  type Redaction,
  type VerificationRefusalCause,
  type VerifiedHandoff,
} from "./handoff.js";
import { createLedger, EgressLedger, type LedgerEntry } from "./ledger.js";
import { createVault, Vault } from "./vault.js";

export interface SanitizeContext {
  readonly sessionId: string;
  readonly requestId: string;
  /** The page this observation belongs to. Everything downstream is bound to it. */
  readonly origin: string;
  readonly viewport: {
    readonly w: number;
    readonly h: number;
    readonly dpr: number;
    readonly zoom: number;
    readonly scrollX: number;
    readonly scrollY: number;
  };
  readonly now?: number;
  /** Injected so date validation is not a function of when the suite runs. */
  readonly today?: Date;
  /** Declarative only: this phase has no egress client. */
  readonly destination?: string;
  /** Reuse an existing session vault instead of opening one. */
  readonly vault?: Vault;
  readonly ledger?: EgressLedger;
  readonly backend?: string;
}

/** Everything classification needs. The vault it stores into, or a new one for this session. */
export interface ClassifyContext extends Omit<SanitizeContext, "destination" | "ledger"> {}

/** What assembly needs. No vault: it decides nothing and holds nothing. */
export interface AssembleContext {
  readonly sessionId: string;
  readonly requestId: string;
  readonly origin: string;
  readonly viewport: SanitizeContext["viewport"];
  readonly now?: number;
  readonly backend?: string;
  /**
   * Which perception tiers produced the evidence in this manifest.
   *
   * `["T0", "T2"]` — structure and sanitization — is the DOM-only floor and stays the default, so a
   * client that captured nothing says so. A client that ran the visual tier passes `["T0", "T1",
   * "T2"]`, and the difference is a CLAIM: it tells the reasoner that the boxes it is reading have
   * pixel evidence behind them and not only a DOM assertion. A caller that captured nothing and
   * declared T1 would be lying to the one party that cannot check.
   */
  readonly tiersFired?: readonly string[];
  /** The captured frame's CSS-per-capture-pixel scale, when a frame was captured. */
  readonly scaleToCss?: number;
  /**
   * Where each element's evidence came from, by element id — `packages/perception`'s own fusion
   * provenance, which is a discriminated source and never a blended confidence.
   *
   * Applied at assembly rather than at classification because fusion happens in the realm that has
   * the pixels, and classification happens in the realm that has the values. Those are different
   * realms by design, and this is the join.
   */
  readonly sourceById?: Readonly<Record<string, SanitizedElement["source"]>>;
}

/** The value-free parts a manifest is assembled from. */
export interface HandoffParts {
  readonly redactions: readonly Redaction[];
  readonly elements: readonly SanitizedElement[];
}

export type ClassifyOutcome =
  | {
      readonly ok: true;
      /** The vault the values went into. Stays in the realm that classified them. */
      readonly vault: Vault;
      readonly redactions: readonly Redaction[];
      readonly elements: readonly SanitizedElement[];
      readonly report: SanitizeReport;
    }
  | { readonly ok: false; readonly refused: "VAULT_DESTROYED" | "ORIGIN_MISMATCH" };

export interface SanitizeInput {
  /** What the client read locally. The only place raw values enter this package. */
  readonly fields: readonly ObservedField[];
}

export type SanitizeRefusalCause =
  | "EMPTY_GOAL"
  | "ORIGIN_MISMATCH"
  | "VAULT_DESTROYED"
  | `VERIFY_${VerificationRefusalCause}`;

export interface SanitizeReport {
  readonly classified: readonly {
    readonly id: string;
    readonly fieldClass: Classification["fieldClass"];
    readonly valueClass: PiiClass;
    readonly effective: PiiClass;
    readonly disagreement: boolean;
    readonly outcome: "TOKENISED" | "MASKED_NO_TOKEN" | "NOT_SENSITIVE";
    readonly ref: string | null;
  }[];
  readonly scrubbedElementNames: number;
}

/** One row of the report, mutable while the sanitizer builds it. */
type ClassifiedRow = SanitizeReport["classified"][number];

export type SanitizeOutcome =
  | {
      readonly ok: true;
      readonly handoff: VerifiedHandoff;
      readonly ledgerEntry: LedgerEntry;
      readonly vault: Vault;
      readonly ledger: EgressLedger;
      readonly report: SanitizeReport;
    }
  | { readonly ok: false; readonly refused: SanitizeRefusalCause; readonly report?: SanitizeReport };

/** A label that held a value is replaced by what it was, not by what it said. */
const classMarker = (piiClass: PiiClass): string => `⟨redacted:${piiClass}⟩`;

const projectNode = (node: ElementNode, name: string): SanitizedElement => {
  const { visible, offscreen } = manifestVisibility(node.evidence);
  const base = {
    id: node.domRef.selector,
    role: node.role,
    name,
    source: "dom" as const,
    visible,
    offscreen,
    enabled: node.enabled,
  };
  const evidence = node.evidence;
  if (offscreen || (evidence.kind !== "OBSERVED" && evidence.kind !== "CLIPPED")) return base;
  return { ...base, bbox: toBboxArray(evidence.viewportBox) };
};

/**
 * Sanitize one observation.
 *
 * `graph` is perception's element graph, `goal` is the user's own words, `ctx` binds the session and
 * page, and `input` carries the values the client read. Returns a verified handoff, a ledger entry
 * and the vault handle — or a refusal, with nothing partially sent.
 */
/**
 * CLASSIFY — steps 2 to 7, and the only part of sanitizing that needs the values.
 *
 * It reads the fields, decides what each one is, puts what needs protecting into the vault, and
 * produces the spans and the scrubbed element names that replace them. **Everything it returns is
 * value-free**: references, classes, tiers, boxes, hints and structural text. That is what makes it
 * separable — a client whose values live in another realm runs this where they are and sends the
 * result on, and there is nothing in the result to send that should not be sent.
 */
export function classifyObservation(
  graph: ElementGraph,
  ctx: ClassifyContext,
  input: SanitizeInput
): ClassifyOutcome {
  const now = ctx.now ?? Date.now();
  const today = ctx.today ?? new Date(now);
  const vault = ctx.vault ?? createVault({ sessionId: ctx.sessionId, origin: ctx.origin, now: () => now });

  if (vault.isDestroyed) return { ok: false, refused: "VAULT_DESTROYED" };
  if (!vault.enforceOrigin(ctx.origin)) return { ok: false, refused: "ORIGIN_MISMATCH" };

  const redactions: Redaction[] = [];
  const classified: ClassifiedRow[] = [];
  const nodeBySelector = new Map<string, ElementNode>(graph.nodes.map((node) => [node.domRef.selector, node]));

  // ── 2-7: classify, validate, tokenise or mask, hint ───────────────────────────────────────
  for (const field of input.fields) {
    if (field.origin !== undefined && field.origin !== ctx.origin) {
      return { ok: false, refused: "ORIGIN_MISMATCH" };
    }
    const classification = classifyObserved(field, today);
    const piiClass = classification.effective;
    const node = nodeBySelector.get(field.id);
    const bbox =
      node && (node.evidence.kind === "OBSERVED" || node.evidence.kind === "CLIPPED")
        ? toBboxArray(node.evidence.viewportBox)
        : undefined;
    const hint = hintFor(piiClass, field.value, fieldRoleOf(field));
    const detectors: ("D1" | "D2")[] = [];
    if (classification.fieldClass !== "UNKNOWN" && classification.fieldClass !== "FREE_TEXT") detectors.push("D1");
    if (classification.valueClass !== "UNKNOWN") detectors.push("D2");

    if (piiClass === "UNKNOWN") {
      classified.push({ ...summaryOf(field, classification), outcome: "NOT_SENSITIVE", ref: null });
      continue;
    }

    if (TIER_OF[piiClass] === "CRITICAL") {
      // OTP: masked, never tokenised, no vault entry — so there is nothing to rehydrate later.
      redactions.push({
        token: "",
        class: piiClass,
        tier: TIER_OF[piiClass],
        ...(bbox ? { bbox } : {}),
        method: "masked_no_token",
        detectors,
        hint,
        targetId: field.id,
      });
      classified.push({ ...summaryOf(field, classification), outcome: "MASKED_NO_TOKEN", ref: null });
      continue;
    }

    const stored = vault.store({
      piiClass,
      value: field.value,
      target: field.id,
      ...(node ? { fingerprint: fingerprintOf(field.id, node.role, node.name) } : {}),
    });
    if (!stored.issued) {
      // The only refusals left are CRITICAL and UNKNOWN, both handled above; an empty value is
      // simply not sensitive.
      classified.push({ ...summaryOf(field, classification), outcome: "NOT_SENSITIVE", ref: null });
      continue;
    }
    redactions.push({
      token: stored.ref,
      class: piiClass,
      tier: stored.tier,
      ...(bbox ? { bbox } : {}),
      method: "token_reference",
      detectors,
      hint,
      targetId: field.id,
    });
    classified.push({ ...summaryOf(field, classification), outcome: "TOKENISED", ref: stored.ref });
  }

  // ── element names: structural text, scrubbed when it holds a value ────────────────────────
  let scrubbedElementNames = 0;
  const elements = graph.nodes.map((node) => {
    const heldValue = vault.holdsLiteral(node.name);
    if (heldValue.held) {
      scrubbedElementNames += 1;
      return projectNode(node, classMarker(heldValue.piiClass));
    }
    const nameClass = classifyValue(node.name, today);
    if (nameClass !== "UNKNOWN") {
      scrubbedElementNames += 1;
      return projectNode(node, classMarker(nameClass));
    }
    return projectNode(node, node.name);
  });

  const report: SanitizeReport = { classified, scrubbedElementNames };

  return { ok: true, vault, redactions, elements, report };
}

/**
 * ASSEMBLE — step 8. The manifest, built from parts that carry no value.
 *
 * Pure, and deliberately so. It has no vault, nothing to decide and nothing to refuse: it arranges
 * what classification produced into manifest v1.1 and marks the result as something the sanitizer
 * built. **The marking is why this is here rather than inlined** — `verifyHandoff`'s first check is
 * that a draft came from this package, and a draft assembled in the realm that will verify it keeps
 * that check meaningful. A client whose values are elsewhere assembles here, from parts, and
 * verifies here too; nothing has to be taken on trust across the crossing.
 */
export function buildHandoffDraft(parts: HandoffParts, goal: string, ctx: AssembleContext): HandoffDraft {
  return markDraft<HandoffDraft>({
    manifestVersion: "1.1",
    capture: {
      w: ctx.viewport.w,
      h: ctx.viewport.h,
      dpr: ctx.viewport.dpr,
      zoom: ctx.viewport.zoom,
      // 1 on the structural path, where no frame was captured and no capture-pixel conversion is
      // performed anywhere. A client that captured a frame passes the scale its geometry derived —
      // measured from the frame's real dimensions, never assumed to be `viewportCss * dpr`, which
      // is exactly what CAPTURE_DIMENSION_MISMATCH exists to catch.
      scale_to_css: ctx.scaleToCss ?? 1,
      scroll: { x: ctx.viewport.scrollX, y: ctx.viewport.scrollY },
      origin: ctx.origin,
    },
    capability: { backend: (ctx.backend ?? "none") as never, tiers_fired: ctx.tiersFired ?? ["T0", "T2"] },
    elements:
      ctx.sourceById === undefined
        ? parts.elements
        : parts.elements.map((element) => {
            const source = ctx.sourceById?.[element.id];
            return source === undefined || source === element.source ? element : { ...element, source };
          }),
    goal,
    redactions: parts.redactions,
    request: { requestId: ctx.requestId, sessionId: ctx.sessionId, issuedAt: ctx.now ?? Date.now() },
    verified: false,
  });
}

export async function sanitize(
  graph: ElementGraph,
  goal: string,
  ctx: SanitizeContext,
  input: SanitizeInput
): Promise<SanitizeOutcome> {
  const now = ctx.now ?? Date.now();
  const vault = ctx.vault ?? createVault({ sessionId: ctx.sessionId, origin: ctx.origin, now: () => now });
  const ledger = ctx.ledger ?? createLedger();

  if (goal.trim() === "") return { ok: false, refused: "EMPTY_GOAL" };

  const classifyOutcome = classifyObservation(graph, { ...ctx, vault, now }, input);
  if (!classifyOutcome.ok) return { ok: false, refused: classifyOutcome.refused };
  const { redactions, elements, report } = classifyOutcome;

  // ── 8: assemble ───────────────────────────────────────────────────────────────────────────
  const draft = buildHandoffDraft({ redactions, elements }, goal, { ...ctx, now });

  // ── 9: verify ─────────────────────────────────────────────────────────────────────────────
  const verification = verifyHandoff(draft, {
    sessionId: ctx.sessionId,
    requestId: ctx.requestId,
    origin: ctx.origin,
    vault,
  });
  if (!verification.verified) return { ok: false, refused: `VERIFY_${verification.cause}`, report };

  // ── 10: ledger ────────────────────────────────────────────────────────────────────────────
  const recorded = await ledger.record(verification.handoff, {
    destination: ctx.destination ?? "(no egress client in this phase)",
    at: now,
  });
  if (!recorded.recorded) return { ok: false, refused: "VERIFY_NOT_FROM_SANITIZER", report };

  return { ok: true, handoff: verification.handoff, ledgerEntry: recorded.entry, vault, ledger, report };
}

const summaryOf = (field: ObservedField, classification: Classification) => ({
  id: field.id,
  fieldClass: classification.fieldClass,
  valueClass: classification.valueClass,
  effective: classification.effective,
  disagreement: classification.disagreement,
});

/**
 * A stable fingerprint of the element a value came from.
 *
 * Selector, role and accessible name — the same identity VALIDATE and HIT-TEST compare. It is built
 * from the element, never from the value.
 */
export const fingerprintOf = (selector: string, role: string, name: string): string =>
  `${selector}|${role}|${name}`;
