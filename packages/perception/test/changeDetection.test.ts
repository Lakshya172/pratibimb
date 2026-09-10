/**
 * T0 — the change gate.
 *
 * The rule under test: MutationObserver is a STRUCTURAL signal, not universal visual
 * change detection, and the full-frame hash is a LOW-RATE safety net rather than a polling
 * loop. Getting this wrong in either direction is expensive — treat structure as complete
 * and the agent goes blind on canvas and video; poll frames quickly and T0 becomes the
 * capture cost it exists to avoid.
 */
import { describe, it, expect } from "vitest";
import {
  ChangeGate,
  DEFAULT_CHANGE_POLICY,
  frameHash,
  frameId,
  type CaptureFrame,
  type ChangeSignal,
} from "@pratibimb/perception";

const structural = (n: number, dirty: string[] = []): ChangeSignal => ({
  kind: "STRUCTURAL",
  mutationCount: n,
  dirtySubtrees: dirty,
});

const visual = (prev: string, cur: string): ChangeSignal => ({
  kind: "VISUAL",
  previousHash: prev,
  currentHash: cur,
});

describe("structural signals", () => {
  it("refreshes on real DOM mutations", () => {
    const gate = new ChangeGate();
    gate.evaluate({ kind: "INITIAL" }, 0);
    const d = gate.evaluate(structural(3, ["#form"]), 1000);
    expect(d.refresh).toBe(true);
    if (d.refresh) expect(d.signal.kind).toBe("STRUCTURAL");
  });

  it("does not refresh on an empty mutation batch", () => {
    const gate = new ChangeGate();
    gate.evaluate({ kind: "INITIAL" }, 0);
    const d = gate.evaluate(structural(0), 1000);
    expect(d.refresh).toBe(false);
    if (!d.refresh) expect(d.reason).toBe("NO_CHANGE");
  });

  it("carries dirty subtrees so T2 can be scoped rather than run whole-page", () => {
    const gate = new ChangeGate();
    gate.evaluate({ kind: "INITIAL" }, 0);
    const d = gate.evaluate(structural(2, ["#address", "#phone"]), 1000);
    if (d.refresh && d.signal.kind === "STRUCTURAL") {
      expect(d.signal.dirtySubtrees).toEqual(["#address", "#phone"]);
    }
  });
});

describe("visual signals are a separate channel", () => {
  it("refreshes when the frame hash changes with NO DOM mutation", () => {
    // The case that proves structure is not sufficient: a canvas repaint, a video frame,
    // a CSS animation settling. MutationObserver sees none of these.
    const gate = new ChangeGate();
    gate.evaluate({ kind: "INITIAL" }, 0);
    const d = gate.evaluate(visual("aaaa1111", "bbbb2222"), 3000);
    expect(d.refresh).toBe(true);
    if (d.refresh) expect(d.signal.kind).toBe("VISUAL");
  });

  it("does not refresh when the hash is unchanged", () => {
    const gate = new ChangeGate();
    gate.evaluate({ kind: "INITIAL" }, 0);
    const d = gate.evaluate(visual("aaaa1111", "aaaa1111"), 3000);
    expect(d.refresh).toBe(false);
    if (!d.refresh) expect(d.reason).toBe("NO_CHANGE");
  });

  it("keeps the two signal kinds distinguishable in the result", () => {
    // Never collapsed to a boolean: the ledger and T2 both need to know which channel
    // fired, because they scope their work differently.
    const gate = new ChangeGate();
    gate.evaluate({ kind: "INITIAL" }, 0);
    const s = gate.evaluate(structural(1), 1000);
    const gate2 = new ChangeGate();
    gate2.evaluate({ kind: "INITIAL" }, 0);
    const v = gate2.evaluate(visual("a", "b"), 1000);
    if (s.refresh && v.refresh) expect(s.signal.kind).not.toBe(v.signal.kind);
  });
});

describe("T0 is a debounce", () => {
  it("debounces bursts below the minimum capture interval", () => {
    const gate = new ChangeGate();
    gate.evaluate({ kind: "INITIAL" }, 0);
    // A form that re-renders on every keystroke produces exactly this burst.
    expect(gate.evaluate(structural(1), 10).refresh).toBe(false);
    expect(gate.evaluate(structural(1), 100).refresh).toBe(false);
    expect(gate.evaluate(structural(1), 300).refresh).toBe(true);
  });

  it("debounces VISUAL signals too", () => {
    // Otherwise an animation would drive the safety net into a capture loop — the exact
    // failure the low rate exists to prevent.
    const gate = new ChangeGate();
    gate.evaluate({ kind: "INITIAL" }, 0);
    expect(gate.evaluate(visual("a", "b"), 50).refresh).toBe(false);
  });

  it("always refreshes on the first observation of a page", () => {
    const gate = new ChangeGate();
    const d = gate.evaluate({ kind: "INITIAL" }, 0);
    expect(d.refresh).toBe(true);
  });
});

describe("the full-frame hash is low-rate by policy", () => {
  it("is not eligible again immediately", () => {
    const gate = new ChangeGate();
    gate.noteHash("aaaa", 1000);
    expect(gate.shouldHashFullFrame(1500)).toBe(false);
    expect(gate.shouldHashFullFrame(1000 + DEFAULT_CHANGE_POLICY.fullFrameHashIntervalMs)).toBe(true);
  });

  it("keeps the safety-net interval well above the debounce floor", () => {
    // If these converged, the "safety net" would be a poll loop.
    expect(DEFAULT_CHANGE_POLICY.fullFrameHashIntervalMs).toBeGreaterThan(
      DEFAULT_CHANGE_POLICY.minCaptureIntervalMs * 4
    );
  });
});

describe("dynamic regions are bounded, not merely intended to be", () => {
  it("accepts registrations up to the ceiling and then refuses", () => {
    const gate = new ChangeGate();
    for (let i = 0; i < DEFAULT_CHANGE_POLICY.maxDynamicRegions; i += 1) {
      expect(gate.registerDynamicRegion(`r${i}`)).toBe(true);
    }
    // An unbounded poll set becomes a capture loop by accretion, with no single change
    // responsible for it.
    expect(gate.registerDynamicRegion("one-too-many")).toBe(false);
    expect(gate.dynamicRegionCount).toBe(DEFAULT_CHANGE_POLICY.maxDynamicRegions);
  });
});

describe("frame hashing", () => {
  const frame = (bytes: number[]): CaptureFrame => ({
    id: frameId("f"),
    capturedAt: 0,
    pixels: new Uint8Array(bytes),
    format: "png",
    geometry: {
      dpr: 1,
      zoom: 1,
      viewportCss: { w: 10, h: 10 },
      captureSize: { w: 10, h: 10 },
      scroll: { x: 0, y: 0 },
      origin: "https://x.test",
    },
  });

  it("is stable for identical pixels and differs for changed pixels", () => {
    expect(frameHash(frame([1, 2, 3]))).toBe(frameHash(frame([1, 2, 3])));
    expect(frameHash(frame([1, 2, 3]))).not.toBe(frameHash(frame([1, 2, 4])));
  });

  it("is a change signal, not a security hash", () => {
    // Documented as FNV-1a and deliberately not SHA-256. Invariant E's payload pin is a
    // separate mechanism in the egress module and must never be confused with this.
    expect(frameHash(frame([1]))).toMatch(/^[0-9a-f]{8}$/);
  });
});
