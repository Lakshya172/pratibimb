/**
 * HIT-TEST AGREEMENT — the TOCTOU gate between VALIDATE and ACT. ADR-0007.
 *
 * VALIDATE proves a target was the right one *at the moment the graph was built*. ACT clicks a
 * point some milliseconds later. Between those two instants a page may open a modal, slide a
 * cookie banner over the control, or move a different element into the same position — and the
 * click is then dispatched successfully to something nobody validated. `page.mouse.click` does
 * not force past actionability, so the event goes to whatever is topmost, which is the honest
 * behaviour and exactly the hole this module closes.
 *
 * It answers one question, immediately before dispatch:
 *
 *     "Is the element I validated the element that is topmost at the point I am about to click?"
 *
 * THE ANSWER HAS THREE VALUES AND ONLY ONE OF THEM PERMITS A CLICK.
 *
 * `MATCH` — the topmost element agrees with the validated target.
 * `MISMATCH` — something else is topmost, or nothing is.
 * `UNKNOWN` — agreement could not be established.
 *
 * **UNKNOWN IS NOT MATCH.** An unestablished fact is not a safe one, so `UNKNOWN` refuses just
 * as hard as `MISMATCH` does. There is no re-target, no nearest candidate, no "click anyway and
 * see": the only two things a caller may do with anything other than `MATCH` are re-observe and
 * give up. That is the same fail-closed shape `validateActionFreshness` already has, for the
 * same reason.
 *
 * THE BRIDGE IS READ-ONLY AND STAYS READ-ONLY.
 *
 * `HitTestBridge` has exactly one method and it returns a description. It cannot navigate, type,
 * evaluate, store or fetch, and it is a SEPARATE interface from `PageActionBridge` on purpose:
 * the ability to ask what is under a point must not come bundled with the ability to click it,
 * and an adapter may implement one without implementing the other. No new browser authority is
 * created here — reading which element is topmost is strictly less than the click ACT already
 * performs.
 *
 * IDENTITY IS NOT THE NODE ID.
 *
 * `NodeId` is positional (`e0`, `e1`, …), so removing an element renumbers every node after it
 * and a stale claim silently rebinds to a different control — measured in MVP-1 demo E. This
 * module therefore compares the **stable DOM reference** (`domRef.selector`, with `nth` where
 * the selector is not unique), the **role**, the **accessible name** and the **geometry**, and
 * it refuses outright when the validated node carries no stable reference to compare. The node
 * id is never used to establish agreement.
 */
import {
  admitsVisualEvidence,
  iou,
  type CssBox,
  type ElementNode,
  type FrameId,
} from "@pratibimb/perception";

import { bearsFreshnessAttestation, type CssPoint, type FreshnessDecision } from "./actionFreshness.js";

/**
 * What the page reports is topmost at a point.
 *
 * Every field is already-permitted element-graph metadata — role, accessible name, geometry, a
 * selector. There is no field for a value, an inner text, an href or a screenshot, so a hit test
 * cannot become a content read.
 */
export interface TopmostElement {
  /** The frame the bridge answered from. Cross-checked; an answer about another frame is not evidence. */
  readonly frameId: FrameId;
  /** Stable DOM reference of the topmost element. */
  readonly selector: string;
  /** Index among identical siblings, where the selector alone is not unique. */
  readonly nth?: number;
  readonly role: string;
  readonly name: string;
  /** The topmost element's own full border box, in canonical CSS viewport pixels. */
  readonly box: CssBox;
}

/**
 * The entire read-only capability this stage needs.
 *
 * Deliberately not a method on `PageActionBridge`: an implementation may be able to look without
 * being able to touch, and keeping the interfaces apart is what makes that expressible.
 *
 * CONTRACT FOR IMPLEMENTERS, and the distinction is load-bearing:
 *
 * - resolve with a `TopmostElement` — "this is reliably what is on top there";
 * - resolve with `null` — "there is reliably NOTHING there" (which is a MISMATCH, not an unknown);
 * - **throw** — "I cannot answer" (which is an UNKNOWN).
 *
 * An implementation that cannot tell the difference must throw. Returning `null` for "I don't
 * know" would convert an unknown into a definite finding, which is the one direction this module
 * must never be wrong in.
 */
export interface HitTestBridge {
  /** The frame this bridge observes. Compared against the decision's frame before anything else. */
  readonly frameId: FrameId;
  /** Read-only. Which element is topmost at this CSS-viewport point, right now. */
  topmostAtCssPoint(point: CssPoint): Promise<TopmostElement | null>;
}

export type Agreement = "MATCH" | "MISMATCH" | "UNKNOWN";

/** Reliable evidence that the validated target is not what would receive the click. */
export type MismatchCause =
  | "NOTHING_AT_POINT"
  | "DIFFERENT_ELEMENT"
  | "ROLE_DISAGREES"
  | "NAME_DISAGREES"
  | "GEOMETRY_DISAGREES";

/** Agreement could not be established. Every one of these refuses the action. */
export type UnknownCause =
  | "NOT_VALIDATED"
  | "NO_TARGET_IN_DECISION"
  | "BRIDGE_FRAME_MISMATCH"
  | "POINT_OUTSIDE_TARGET"
  | "NO_STABLE_REFERENCE"
  | "NO_COMPARISON_GEOMETRY"
  | "BRIDGE_THREW"
  | "BRIDGE_TIMEOUT"
  | "MALFORMED_TOPMOST";

export type HitTestResult =
  | {
      readonly agreement: "MATCH";
      readonly point: CssPoint;
      readonly observed: TopmostElement;
      /** Overlap between the validated element's full box and the topmost element's box. */
      readonly boxIou: number;
      readonly elapsedMs: number;
    }
  | {
      readonly agreement: "MISMATCH";
      readonly point: CssPoint;
      readonly cause: MismatchCause;
      readonly detail: string;
      /** What was topmost instead, or `null` when the page reported nothing there. */
      readonly observed: TopmostElement | null;
      readonly elapsedMs: number;
    }
  | {
      readonly agreement: "UNKNOWN";
      /** `null` when the failure happened before a point could even be derived. */
      readonly point: CssPoint | null;
      readonly cause: UnknownCause;
      readonly detail: string;
      readonly elapsedMs: number;
    };

/**
 * The attestation a result carries to prove THIS function produced it.
 *
 * Same device, same reason, and the same stated limit as `VALIDATED_BY_FRESHNESS` in
 * `actionFreshness.ts`: a `{ agreement: "MATCH" }` object literal type-checks and is otherwise
 * indistinguishable from a real hit test, including one that arrived through `JSON.parse`. The
 * symbol is module-private and never exported, so nothing outside this file can stamp it.
 *
 * It is a same-realm integrity check, not a capability. It makes accidental bypass impossible
 * and deliberate bypass unwritable by mistake — no more than that.
 */
const HIT_TESTED = Symbol("pratibimb.hittest.attested");

const attest = <T extends object>(r: T): T => {
  Object.defineProperty(r, HIT_TESTED, { value: true, enumerable: false });
  return Object.freeze(r);
};

/**
 * Which decision each attested result was established FOR.
 *
 * Module-private, keyed by object identity. It lets the execution gate refuse to mint a permit from
 * a MATCH that was obtained for a different decision — agreement that one target is topmost is not
 * agreement about another. A copy or a revived result is absent from the map, as it should be.
 */
const ESTABLISHED_FOR = new WeakMap<object, FreshnessDecision>();

/** `true` only if `hit` was produced by `establishHitAgreement` for exactly this `decision` object. */
export const hitAgreementIsFor = (hit: HitTestResult, decision: FreshnessDecision): boolean =>
  typeof hit === "object" && hit !== null && ESTABLISHED_FOR.get(hit) === decision;

/** Whether a result was produced by `establishHitAgreement` itself. */
export const bearsHitAgreement = (r: HitTestResult): boolean =>
  (r as unknown as Record<symbol, unknown>)[HIT_TESTED] === true;

/**
 * The single permission predicate. `true` only for an attested MATCH.
 *
 * Written as one expression so a caller cannot get the polarity wrong by enumerating the
 * failures: everything that is not exactly an attested MATCH is a refusal, including a value
 * this module has never heard of.
 */
export const agreesForDispatch = (r: HitTestResult): boolean =>
  r.agreement === "MATCH" && bearsHitAgreement(r);

/**
 * Minimum overlap between the validated element's box and the topmost element's box.
 *
 * **PROPOSED, not approved.** `0.8` is **borrowed** from `PROPOSED_FRESHNESS_TOLERANCE.minBoxIou`
 * rather than invented: it answers the same question ("is this the same box?") a few milliseconds
 * later, so using a second, different number would imply a distinction nothing has measured.
 * Borrowing across purposes is a proposal; an owner decision changes a call site, not a source
 * edit. See ADR-0007 §6.
 */
export interface HitTestTolerance {
  readonly minBoxIou: number;
}

export const PROPOSED_HIT_TEST_TOLERANCE: HitTestTolerance = { minBoxIou: 0.8 };

/** Default deadline for the read-only query. A bridge that never answers must not hang the loop. */
export const DEFAULT_HIT_TEST_TIMEOUT_MS = 2_000;

export interface HitTestOptions {
  readonly timeoutMs?: number;
  readonly tolerance?: HitTestTolerance;
}

const finite = (...xs: readonly number[]): boolean => xs.every((x) => Number.isFinite(x));

const inside = (p: CssPoint, b: CssBox): boolean =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/**
 * The point a dispatch will land on, derived exactly as ACT derives it.
 *
 * ACT computes `decision.point ?? centre(decision.viewportBox)` privately. If this module hit
 * tested a different point from the one ACT then clicks, the whole gate would be theatre — so the
 * rule is duplicated here deliberately, exported, and pinned by a test that sweeps both
 * implementations over the same boxes (`hitTest.test.ts`, "the hit-tested point is the clicked
 * point"). The coupling is recorded in ADR-0007 §4 rather than left to be discovered.
 */
export const dispatchPointOf = (decision: FreshnessDecision): CssPoint | null => {
  if (decision.decision !== "ALLOW") return null;
  const box = decision.viewportBox;
  if (!box) return null;
  if (decision.point) return decision.point;
  return { x: (box.x + box.w / 2) as CssPoint["x"], y: (box.y + box.h / 2) as CssPoint["y"] };
};

/**
 * The box the geometry comparison must use: the element's FULL box, never the actable one.
 *
 * `AllowedAction.viewportBox` is the *actable* box — for a CLIPPED element that is only the
 * visible fragment. A bridge's `getBoundingClientRect()` reports the whole element. Comparing a
 * fragment against a whole reports a shape change that never happened, and a legitimately
 * half-scrolled button would be refused forever. `actionFreshness.ts` learned this the same way;
 * the distinction is preserved here rather than rediscovered.
 */
const comparisonBoxOf = (node: ElementNode): CssBox | null =>
  admitsVisualEvidence(node.evidence) ? node.evidence.viewportBox : null;

const sameReference = (node: ElementNode, top: TopmostElement): boolean =>
  node.domRef.selector === top.selector && (node.domRef.nth ?? null) === (top.nth ?? null);

const describe = (t: TopmostElement): string =>
  `${t.selector}${t.nth === undefined ? "" : `[${t.nth}]`} (role ${t.role}, name "${t.name}")`;

/**
 * HIT-TEST AGREEMENT. Run this immediately before ACT and act only on `MATCH`.
 *
 * Nothing may happen between this call and the dispatch — no re-planning, no awaiting an
 * unrelated promise, no second observation. The gate's whole value is the size of the window it
 * closes, and a caller that widens that window has reopened the hole. `guardedAct` is the
 * composition that gets this right; see `guardedAct.ts`.
 *
 * Fail-closed in every branch. There is exactly one `return` that produces `MATCH`, and it is
 * reached only after the frame, the point, the stable reference, the role, the name and the
 * geometry have each been positively established.
 */
export async function establishHitAgreement(
  decision: FreshnessDecision,
  bridge: HitTestBridge,
  options: HitTestOptions = {}
): Promise<HitTestResult> {
  const result = await establish(decision, bridge, options);
  ESTABLISHED_FOR.set(result, decision);
  return result;
}

async function establish(
  decision: FreshnessDecision,
  bridge: HitTestBridge,
  options: HitTestOptions
): Promise<HitTestResult> {
  const started = Date.now();
  const since = (): number => Date.now() - started;
  const unknown = (cause: UnknownCause, detail: string, point: CssPoint | null = null): HitTestResult =>
    attest({ agreement: "UNKNOWN" as const, point, cause, detail, elapsedMs: since() });

  // 0 — only an attested ALLOW may be hit tested. A decision this repository's validator did not
  //     produce is not evidence about anything, and an unvalidated target has nothing to agree with.
  if (decision.decision !== "ALLOW" || !bearsFreshnessAttestation(decision)) {
    return unknown(
      "NOT_VALIDATED",
      `the decision handed to the hit test is ${String(decision.decision)}` +
        (decision.decision === "ALLOW" ? " but carries no freshness attestation" : "") +
        ". There is no validated target to agree with, so agreement is UNKNOWN — never MATCH."
    );
  }

  // 1 — a targeted decision, or there is nothing under a point to compare.
  const node = decision.node;
  const actable = decision.viewportBox;
  if (!node || !actable) {
    return unknown("NO_TARGET_IN_DECISION", "the ALLOW carries no node or no box, so no point can be hit tested.");
  }

  // 2 — frame first. A bridge pointed at another frame cannot testify about this one.
  if (decision.frameId === undefined || decision.frameId !== bridge.frameId) {
    return unknown(
      "BRIDGE_FRAME_MISMATCH",
      `the decision is valid for frame ${String(decision.frameId)} but the hit-test bridge observes frame ` +
        `${String(bridge.frameId)}. An answer about a different frame is not evidence about this one.`
    );
  }

  // 3 — the point ACT will actually use.
  const point = dispatchPointOf(decision);
  if (!point || !finite(point.x, point.y)) {
    return unknown("NO_TARGET_IN_DECISION", "no dispatch point could be derived from the decision.");
  }
  if (!inside(point, actable)) {
    return unknown(
      "POINT_OUTSIDE_TARGET",
      `the dispatch point (${point.x}, ${point.y}) is not inside the validated actionable box.`,
      point
    );
  }

  // 4 — identity must rest on something stable. No stable reference is a refusal, NOT a fallback
  //     to the positional node id: rebinding is exactly the failure this gate exists to catch.
  if (!node.domRef.selector) {
    return unknown(
      "NO_STABLE_REFERENCE",
      `node ${node.id} carries no DOM selector, so the topmost element cannot be compared to it by ` +
        "anything except its positional id — which rebinds when an earlier element is removed.",
      point
    );
  }
  const mine = comparisonBoxOf(node);
  if (!mine || !finite(mine.x, mine.y, mine.w, mine.h) || mine.w <= 0 || mine.h <= 0) {
    return unknown(
      "NO_COMPARISON_GEOMETRY",
      `node ${node.id} has ${node.evidence.kind} evidence, which supports no geometric comparison.`,
      point
    );
  }

  // 5 — ask the page. A throw is "cannot answer"; a null is "reliably nothing".
  const timeoutMs = options.timeoutMs ?? DEFAULT_HIT_TEST_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let top: TopmostElement | null;
  try {
    const deadline = new Promise<"TIMEOUT">((resolve) => {
      timer = setTimeout(() => resolve("TIMEOUT"), timeoutMs);
    });
    const answer = await Promise.race([
      bridge.topmostAtCssPoint(point).then((t) => ({ ok: t }) as const),
      deadline,
    ]);
    if (answer === "TIMEOUT") {
      return unknown("BRIDGE_TIMEOUT", `the hit-test bridge did not answer within ${timeoutMs} ms.`, point);
    }
    top = answer.ok;
  } catch (e) {
    // The message is dropped, not the failure: a bridge message can quote page markup, and
    // INV-21's rule against logging page-derived content outranks a richer string.
    return unknown(
      "BRIDGE_THREW",
      `the hit-test bridge threw ${e instanceof Error ? e.name : typeof e}; agreement is unestablished.`,
      point
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  const mismatch = (cause: MismatchCause, detail: string, observed: TopmostElement | null): HitTestResult =>
    attest({ agreement: "MISMATCH" as const, point, cause, detail, observed, elapsedMs: since() });

  // 6 — nothing there. Reliable, and it means the click would land on the document, not the target.
  if (top === null || top === undefined) {
    return mismatch(
      "NOTHING_AT_POINT",
      `the page reports no element at (${point.x}, ${point.y}); the validated target is not there.`,
      null
    );
  }

  // 7 — an answer this module cannot read is an unknown, never a match.
  if (
    typeof top.selector !== "string" ||
    typeof top.role !== "string" ||
    typeof top.name !== "string" ||
    !top.box ||
    !finite(top.box.x, top.box.y, top.box.w, top.box.h)
  ) {
    return unknown("MALFORMED_TOPMOST", "the hit-test bridge returned an unusable description.", point);
  }
  if (top.frameId !== decision.frameId) {
    return unknown(
      "BRIDGE_FRAME_MISMATCH",
      `the topmost element was reported from frame ${String(top.frameId)}, not ${String(decision.frameId)}.`,
      point
    );
  }

  // 8 — the stable reference. This is the check that catches an overlay, a modal and a swap.
  if (!sameReference(node, top)) {
    return mismatch(
      "DIFFERENT_ELEMENT",
      `${describe(top)} is topmost at (${point.x}, ${point.y}), not the validated ` +
        `${node.domRef.selector}${node.domRef.nth === undefined ? "" : `[${node.domRef.nth}]`}.`,
      top
    );
  }

  // 9, 10 — identity, exactly, as VALIDATE compares it. A same-selector element whose role or name
  //         changed in the interval is not the thing that was validated.
  if (top.role !== node.role) {
    return mismatch("ROLE_DISAGREES", `the topmost element's role is "${top.role}", not "${node.role}".`, top);
  }
  if (top.name !== node.name) {
    return mismatch("NAME_DISAGREES", `the topmost element is named "${top.name}", not "${node.name}".`, top);
  }

  // 11 — geometry, because a selector need not be unique. The harness's own DOM probe falls back to
  //      a tag name when an element has no id, so `button` can describe several controls; role, name
  //      and box are what separate them.
  const overlap = iou(mine, top.box);
  const floor = (options.tolerance ?? PROPOSED_HIT_TEST_TOLERANCE).minBoxIou;
  if (!(overlap >= floor)) {
    return mismatch(
      "GEOMETRY_DISAGREES",
      `the topmost element overlaps the validated element at IoU ${overlap.toFixed(4)}, below the ${floor} floor.`,
      top
    );
  }

  return attest({
    agreement: "MATCH" as const,
    point,
    observed: top,
    boxIou: overlap,
    elapsedMs: since(),
  });
}
