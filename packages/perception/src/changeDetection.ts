/**
 * T0 — the change gate.
 *
 * Frozen constitution §7: *"Change gate — structural signal plus bounded visual polling.
 * Sub-millisecond for the structural half. No model."* Roughly 100 evaluations to about 8
 * captures on a ten-step form task — so the gate's job is to be the thing that says NO
 * ninety-two times.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * MUTATIONOBSERVER IS A STRUCTURAL SIGNAL. IT IS NOT CHANGE DETECTION.
 *
 * It fires on DOM edits. It does not fire on a CSS animation finishing, a `<canvas>`
 * repainting, a video advancing, an image finally decoding, or a cross-origin iframe
 * changing its own content — and the dossier's demonstration is required to include
 * content where the DOM is empty by construction. Treating it as universal change
 * detection means the agent goes blind precisely on the material that justifies having a
 * vision tier at all.
 *
 * So it is one of two inputs. The other is a **low-rate** full-frame hash: the safety net
 * that catches what structure cannot see. Low-rate is not a performance compromise, it is
 * the design — a high-frequency full-frame hash would be a capture loop, and capture is
 * the expensive operation this tier exists to avoid.
 *
 * *"T0 is a debounce, not an avoidance strategy."*
 */
import type { CaptureFrame } from "./capture.js";

/** Why a refresh is being proposed. Never collapsed into a bare boolean. */
export type ChangeSignal =
  | {
      /** DOM mutations observed. Cheap, precise about WHERE, blind to pixels. */
      readonly kind: "STRUCTURAL";
      readonly mutationCount: number;
      /** Selectors of mutated subtrees, so T2 can be scoped to dirty regions only. */
      readonly dirtySubtrees: readonly string[];
    }
  | {
      /** Full-frame hash differs. The safety net; knows THAT, not where. */
      readonly kind: "VISUAL";
      readonly previousHash: string;
      readonly currentHash: string;
    }
  | {
      /** A region under bounded polling changed. */
      readonly kind: "DYNAMIC_REGION";
      readonly regionId: string;
    }
  | {
      /** First observation of a page. Nothing to compare against. */
      readonly kind: "INITIAL";
    };

/**
 * Policy for the change gate.
 *
 * Defaults are conservative and are expected to be tuned once S-05 measures the real
 * `captureVisibleTab` rate limit under `activeTab` — which is still UNKNOWN in the
 * feasibility matrix. They are named constants with tests attached rather than inline
 * numbers so that tuning is one edit, not an archaeology exercise.
 */
export interface ChangePolicy {
  /** Minimum gap between captures. The floor that keeps this a debounce. */
  readonly minCaptureIntervalMs: number;
  /** Full-frame hash cadence — the SAFETY NET, deliberately slow. */
  readonly fullFrameHashIntervalMs: number;
  /** Poll interval for regions registered as dynamic. */
  readonly dynamicRegionPollMs: number;
  /** Hard ceiling on registered dynamic regions, so "bounded" is enforced not intended. */
  readonly maxDynamicRegions: number;
}

/**
 * Which of these are bounded by evidence, and which are still policy.
 *
 * W1-S05-rate measured `captureVisibleTab` on Chromium 151 and Firefox 155. It bounds
 * exactly ONE of the four constants below. The others remain policy decisions, and saying
 * so is the point — a benchmark can rule a value out, but it cannot choose a cadence.
 *
 *   minCaptureIntervalMs      BOUNDED BELOW BY EVIDENCE. Was 250 ms, which is 4 Hz.
 *                             Chromium succeeded at only 50-67% at 4 Hz across 6 ladder
 *                             passes in 2 runs, while 500 ms succeeded 12/12 in every
 *                             pass and 40/40 sustained, twice. 250 ms was a value the
 *                             browser refuses to honour. 500 ms is the measured floor,
 *                             NOT a tuned optimum.
 *
 *   fullFrameHashIntervalMs   POLICY. 2000 ms is 0.5 Hz, far inside the safe envelope, so
 *                             the measurement neither justifies nor forbids it. It is set
 *                             by the cost of hashing and the tolerable blindness window.
 *
 *   dynamicRegionPollMs       POLICY, with a caveat. Polling a region is not itself a
 *                             capture; it only becomes one when it drives a refresh. The
 *                             debounce above is what keeps the resulting capture cadence
 *                             legal, so this value must never be treated as a capture
 *                             rate in its own right.
 *
 *   maxDynamicRegions         POLICY. Unrelated to capture rate; it bounds fan-out.
 *
 * Firefox showed no limit at or below 10 Hz, so nothing here is bound by Firefox. Tuning
 * to Firefox's headroom would be throttled on Chromium; the floor is set by the stricter
 * engine, which is the only way a single cadence can be correct on both.
 */
export const DEFAULT_CHANGE_POLICY: ChangePolicy = {
  /** Measured floor, Chromium. See the note above — do not lower without new evidence. */
  minCaptureIntervalMs: 500,
  fullFrameHashIntervalMs: 2_000,
  dynamicRegionPollMs: 500,
  maxDynamicRegions: 8,
};

/**
 * The safe operating envelope W1-S05-rate observed, kept next to the policy that depends
 * on it so the two cannot drift apart silently.
 *
 * `CONDITIONAL`: the `activeTab` permission path is NOT MEASURED, and the dossier states
 * capture is rate-limited "particularly under activeTab". If PratiBimb ships under
 * `activeTab` rather than a host permission, this envelope must be re-measured before it
 * is relied upon.
 */
export const MEASURED_CAPTURE_ENVELOPE = {
  experiment: "W1-S05-rate",
  verdict: "CONDITIONAL",
  chromium: {
    version: "151",
    safeIntervalMs: 500,
    observedSuccessesPerSecond: 1.7,
    onsetBetweenHz: [2, 3],
    burstAllowanceObserved: 2,
    recoveryMs: 1150,
  },
  firefox: {
    version: "155",
    note: "No throttle observed at or below 10 Hz, 8-deep bursts, 5-way concurrency. " +
      "This is an absence of observation, not a proof of absence.",
  },
  notMeasured: ["activeTab permission path", "Linux", "macOS", "rates above 10 Hz"],
} as const;

export type RefreshDecision =
  | { readonly refresh: true; readonly signal: ChangeSignal }
  | { readonly refresh: false; readonly reason: "DEBOUNCED" | "NO_CHANGE" };

/**
 * The gate.
 *
 * Deliberately synchronous and model-free — the structural half must stay sub-millisecond,
 * and anything awaited here would be on the hot path of every DOM mutation on the page.
 */
export class ChangeGate {
  private lastCaptureAt = 0;
  private lastFullHashAt = 0;
  private lastHash: string | null = null;
  private readonly dynamicRegions = new Set<string>();

  constructor(private readonly policy: ChangePolicy = DEFAULT_CHANGE_POLICY) {}

  /**
   * Register a region for bounded polling.
   *
   * Returns false when the ceiling is reached rather than growing the set. An unbounded
   * poll set becomes a high-frequency capture loop by accretion, one region at a time,
   * with no single change responsible for it.
   */
  registerDynamicRegion(id: string): boolean {
    if (this.dynamicRegions.size >= this.policy.maxDynamicRegions) return false;
    this.dynamicRegions.add(id);
    return true;
  }

  get dynamicRegionCount(): number {
    return this.dynamicRegions.size;
  }

  /** Should a full-frame hash be taken now? Rate-limited by policy. */
  shouldHashFullFrame(now: number): boolean {
    return now - this.lastFullHashAt >= this.policy.fullFrameHashIntervalMs;
  }

  /**
   * Offer a signal and get a decision.
   *
   * The debounce applies to every signal kind including VISUAL. A frame hash that changes
   * faster than the capture floor is an animation, and chasing it would turn the safety
   * net into the capture loop it exists to prevent.
   */
  evaluate(signal: ChangeSignal, now: number): RefreshDecision {
    if (signal.kind === "INITIAL") {
      this.lastCaptureAt = now;
      return { refresh: true, signal };
    }

    if (now - this.lastCaptureAt < this.policy.minCaptureIntervalMs) {
      return { refresh: false, reason: "DEBOUNCED" };
    }

    if (signal.kind === "STRUCTURAL" && signal.mutationCount === 0) {
      return { refresh: false, reason: "NO_CHANGE" };
    }

    if (signal.kind === "VISUAL") {
      this.lastFullHashAt = now;
      if (signal.previousHash === signal.currentHash) {
        return { refresh: false, reason: "NO_CHANGE" };
      }
      this.lastHash = signal.currentHash;
    }

    this.lastCaptureAt = now;
    return { refresh: true, signal };
  }

  /** Record a hash taken outside `evaluate`, e.g. the first frame of a page. */
  noteHash(hash: string, now: number): void {
    this.lastHash = hash;
    this.lastFullHashAt = now;
  }

  get currentHash(): string | null {
    return this.lastHash;
  }
}

/**
 * Frame identity hash.
 *
 * FNV-1a over the encoded bytes. Not cryptographic and not claimed to be: its only job is
 * "did these pixels change", it runs at a low rate on the client, and nothing security-
 * critical depends on it. The payload hash pin that Invariant E rests on is a SHA-256 in
 * the egress module and is an entirely separate mechanism — this must never be mistaken
 * for it.
 */
export function frameHash(frame: CaptureFrame): string {
  let h = 0x811c9dc5;
  const bytes = frame.pixels;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
