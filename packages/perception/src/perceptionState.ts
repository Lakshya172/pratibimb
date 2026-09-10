/**
 * PerceptionState — the assembled output of the tier, and the only thing downstream layers
 * are allowed to read.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE PRIVACY BOUNDARY IS A TYPE, NOT A CONVENTION
 *
 * `PerceptionState` holds the frame. `SanitizedHandoff` does not, and structurally cannot:
 * it has no field of any pixel-bearing type. The T2 sanitize tier is what turns one into
 * the other, and it does not exist yet.
 *
 * This matters now rather than later. The convenient thing during development is to hand
 * the reasoning layer the raw frame "just for debugging", and every such shortcut becomes
 * permanent because removing it breaks something by then. Making the handoff type
 * incapable of carrying pixels means the shortcut does not compile, so the sanitize tier
 * cannot be skipped by accident — only by a visible, reviewable change to this file.
 *
 * There is deliberately no `toHandoff()` here. Writing one would mean inventing the
 * redaction contract ahead of the tier that owns it, and QG-04 is UNSIGNED — no code may
 * make a network call until it passes. This file defines the SHAPE of the eventual handoff
 * and stops there.
 */
import type { CaptureFrame } from "./capture.js";
import type { CaptureGeometry } from "./coordinates.js";
import type { ElementGraph } from "./elementGraph.js";
import type { FusedElement, FusionResult } from "./fusion.js";
import { manifestSource } from "./fusion.js";
import { manifestVisibility } from "./observation.js";
import { toBboxArray } from "./space.js";
import type { Backend, DetectorRole } from "./detector.js";
import type { ChangeSignal } from "./changeDetection.js";
import type { PerceptionErrorCode } from "./failure.js";

/** What actually ran, so the ledger can display it and a reviewer can audit it. */
export interface CapabilityReport {
  readonly backend: Backend;
  /** Perception tiers that fired. Matches the manifest `capability.tiers_fired`. */
  readonly tiersFired: readonly ("T0" | "T1" | "T2" | "T3")[];
  /** Roles that were asked for and refused, with why. Never silently empty. */
  readonly unavailableDetectors: readonly {
    readonly role: DetectorRole;
    readonly code: PerceptionErrorCode;
    readonly detail: string;
  }[];
}

/**
 * One complete observation.
 *
 * Holds the frame, so it never leaves the perception boundary as-is.
 */
export interface PerceptionState {
  readonly frame: CaptureFrame;
  readonly geometry: CaptureGeometry;
  readonly graph: ElementGraph;
  readonly fusion: FusionResult;
  readonly capability: CapabilityReport;
  /** Why this observation was taken. */
  readonly trigger: ChangeSignal;
  readonly observedAt: number;
}

/**
 * The shape the sanitize tier will eventually produce.
 *
 * NOTE THE ABSENCE: no `frame`, no `pixels`, no `CaptureFrame`. Not optional — absent. A
 * handoff carrying raw pixels is not a redaction failure to be caught in review, it is a
 * thing that cannot be constructed.
 *
 * `elements` carries geometry and structure only. The accessible name is structural UI
 * text — a control's label, which the server must have to plan "fill the phone field" —
 * and is subject to the sanitize tier's detectors before it reaches here.
 */
export interface SanitizedHandoff {
  readonly manifestVersion: "1.1";
  /** The `capture` block: the entire coordinate contract, every field, always. */
  readonly capture: {
    readonly w: number;
    readonly h: number;
    readonly dpr: number;
    readonly zoom: number;
    readonly scale_to_css: number;
    readonly scroll: { readonly x: number; readonly y: number };
    readonly origin: string;
  };
  readonly capability: {
    readonly backend: Backend;
    readonly tiers_fired: readonly string[];
  };
  readonly elements: readonly SanitizedElement[];
  /**
   * Set by the privacy verifier, which does not exist yet.
   *
   * Typed as `false` and nothing else. The egress guard refuses to transmit unless this is
   * `true`, so until a verifier exists the only constructible value is the one that cannot
   * be sent. Fail-closed by construction rather than by a default someone can change.
   */
  readonly verified: false;
}

export interface SanitizedElement {
  readonly id: string;
  readonly role: string;
  readonly name: string;
  /** `[x, y, w, h]` in canonical CSS viewport pixels, or absent when off-screen. */
  readonly bbox?: readonly [number, number, number, number];
  readonly source: "dom" | "vision" | "dom+vision";
  readonly visible: boolean;
  readonly offscreen: boolean;
  readonly enabled: boolean;
}

/**
 * Project a fused element into its manifest form.
 *
 * The off-screen rule is enforced here at the serialization edge, which is the last place
 * it could be violated: an off-screen element gets NO `bbox` key at all. Emitting its
 * document box would hand the server a viewport-looking coordinate for something that was
 * never on screen, and the contract is explicit that off-screen elements carry *no pixel
 * evidence*. The server plans a `scroll` toward such an element by name, and the next
 * observation confirms it.
 */
export function projectElement(e: FusedElement): SanitizedElement {
  const { visible, offscreen } = manifestVisibility(e.evidence);
  const base = {
    id: e.id,
    role: e.role,
    name: e.name,
    source: manifestSource(e.provenance),
    visible,
    offscreen,
    enabled: e.enabled,
  };
  if (offscreen || e.box === null) return base;
  return { ...base, bbox: toBboxArray(e.box) };
}

/**
 * Assemble the elements block of a would-be handoff.
 *
 * Exported for testing the projection rules on their own. It is NOT a handoff constructor:
 * there is no function here that produces a complete `SanitizedHandoff`, because the tier
 * that is allowed to produce one does not exist.
 */
export function projectElements(state: PerceptionState): readonly SanitizedElement[] {
  return state.fusion.elements.map(projectElement);
}
