/**
 * Production failure semantics for capture throttling — W1-S05-rate.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not fake a browser rate limit, and it does not assert a rate. The measured
 * behaviour lives in `artifacts/experiments/W1-S05rate-capture-limits/`; reproducing it
 * needs a headed browser and machine-sensitive timing, so a CI job pretending to measure
 * it would be a flaky test that proved nothing.
 *
 * What is testable — and what actually protects the tier — is the CONTRACT the measurement
 * justified: a throttle is a distinct, recognisable, non-fabricating refusal, the adapter
 * does not act on it, and nothing downstream is handed a frame that does not exist.
 *
 * The one real string here is the one Chromium 151 actually produced, quoted verbatim from
 * the evidence file.
 */
import { describe, it, expect, vi } from "vitest";
import {
  type ViewportMeasurement,
  type TabsCaptureApi,
  createTabCaptureAdapter,
  isThrottleSignature,
  MEASURED_CAPTURE_ENVELOPE,
  DEFAULT_CHANGE_POLICY,
} from "@pratibimb/perception";

/** Verbatim from results/s05rate-chromium.json — the only throttle string observed. */
const CHROMIUM_THROTTLE =
  "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.";

/** Also observed, on the FIRST (invalid) run. A permission failure, NOT a throttle. */
const CHROMIUM_PERMISSION =
  "Either the '<all_urls>' or 'activeTab' permission is required.";

const measurement: ViewportMeasurement = {
  dpr: 2.0,
  zoom: 1.0,
  viewportCssWidth: 1024,
  viewportCssHeight: 640,
  scrollX: 0,
  scrollY: 0,
  origin: "https://seva.gov.in",
};

const rejectingTabs = (message: string): TabsCaptureApi => ({
  captureVisibleTab: async () => {
    throw new Error(message);
  },
});

const sizeOf = (w: number, h: number) => async () => ({ width: w, height: h });

describe("throttle recognition", () => {
  it("recognises the quota string Chromium actually produced", () => {
    expect(isThrottleSignature(CHROMIUM_THROTTLE)).toBe(true);
  });

  it("does NOT treat a permission failure as a throttle", () => {
    // This is the distinction the experiment's first run turned on. 212 of 304 failures
    // were permission errors; reading them as a rate limit would have published a browser
    // limit that does not exist. A scheduler that waited for that to clear would wait
    // forever.
    expect(isThrottleSignature(CHROMIUM_PERMISSION)).toBe(false);
  });

  it.each([
    "The tab was closed.",
    "Cannot access contents of the page.",
    "Extension manifest must request permission to access this host.",
    "",
  ])("does not treat %j as a throttle", (msg) => {
    expect(isThrottleSignature(msg)).toBe(false);
  });

  it("fails in the SAFE direction on an unrecognised message", async () => {
    // An unknown failure becomes CAPTURE_FAILED, which promises nothing. The dangerous
    // error is the reverse - labelling something unrecoverable as throttling, so the
    // scheduler politely waits for a condition that will never clear.
    const r = await createTabCaptureAdapter(
      rejectingTabs("something nobody has seen before"),
      sizeOf(2048, 1280)
    ).capture(measurement);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CAPTURE_FAILED");
  });
});

describe("the adapter surfaces throttling and does not act on it", () => {
  it("reports CAPTURE_THROTTLED, distinctly from CAPTURE_FAILED", async () => {
    const r = await createTabCaptureAdapter(
      rejectingTabs(CHROMIUM_THROTTLE),
      sizeOf(2048, 1280)
    ).capture(measurement);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("CAPTURE_THROTTLED");
      // The browser's own words survive to the caller, so a future change in the string is
      // diagnosable rather than merely a silent reclassification.
      expect(r.detail).toContain("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND");
    }
  });

  it("reports CAPTURE_FAILED for a permission refusal", async () => {
    const r = await createTabCaptureAdapter(
      rejectingTabs(CHROMIUM_PERMISSION),
      sizeOf(2048, 1280)
    ).capture(measurement);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CAPTURE_FAILED");
  });

  it("CALLS THE BROWSER EXACTLY ONCE — no retry, no backoff, no queueing", async () => {
    // The measurement showed recovery takes ~1.15 s on Chromium. That is a real number and
    // it is precisely the kind of number that invites a sleep() inside the adapter. It
    // stays out: a retry here would make the capture cadence a property of the adapter,
    // invisible to the refresh scheduler that owns it, and untestable from outside.
    const captureVisibleTab = vi.fn(async () => {
      throw new Error(CHROMIUM_THROTTLE);
    });
    const started = Date.now();
    const r = await createTabCaptureAdapter({ captureVisibleTab }, sizeOf(2048, 1280)).capture(
      measurement
    );
    expect(captureVisibleTab).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    // And it returns immediately rather than sleeping toward the recovery window.
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe("a refused capture fabricates nothing", () => {
  it("returns no frame at all — not an empty one, not a stale one", async () => {
    const r = await createTabCaptureAdapter(
      rejectingTabs(CHROMIUM_THROTTLE),
      sizeOf(2048, 1280)
    ).capture(measurement);
    // The Perceived union has no value on the refusal branch, so there is no frame-shaped
    // object for a caller to mistake for one.
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("value");
  });

  it("does not relabel the previous frame as current", async () => {
    // The failure mode this guards: a throttled refresh silently reusing the last frame,
    // so the tier reports a fresh observation of a page that has since changed.
    const good = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let call = 0;
    const tabs: TabsCaptureApi = {
      captureVisibleTab: async () => {
        call += 1;
        if (call === 1) return good;
        throw new Error(CHROMIUM_THROTTLE);
      },
    };
    let t = 1000;
    const adapter = createTabCaptureAdapter(tabs, sizeOf(2048, 1280), () => (t += 100));

    const first = await adapter.capture(measurement);
    expect(first.ok).toBe(true);
    const firstId = first.ok ? first.value.id : null;

    const second = await adapter.capture(measurement);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("CAPTURE_THROTTLED");

    // A third, successful capture must be a genuinely new frame, not the first one again.
    call = 0;
    const third = await adapter.capture(measurement);
    expect(third.ok).toBe(true);
    if (third.ok) {
      expect(third.value.id).not.toBe(firstId);
      expect(third.value.capturedAt).toBeGreaterThan(1000);
    }
  });

  it("keeps frame identity, timestamp and dimensions internally consistent", async () => {
    const good = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let t = 5000;
    const r = await createTabCaptureAdapter(
      { captureVisibleTab: async () => good },
      sizeOf(2048, 1280),
      () => t
    ).capture(measurement);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.capturedAt).toBe(5000);
    expect(r.value.id).toContain("5000");
    // The geometry describes THIS frame, measured from it, not assumed from the viewport.
    expect(r.value.geometry.captureSize).toEqual({ w: 2048, h: 1280 });
    expect(r.value.geometry.viewportCss).toEqual({ w: 1024, h: 640 });
  });
});

describe("the change policy reflects the measurement", () => {
  it("does not permit a capture cadence Chromium refuses", () => {
    // 250 ms - the value shipped before this experiment - is 4 Hz, where Chromium
    // succeeded at only 50-67% across 6 ladder passes in 2 independent runs. 500 ms
    // succeeded 12/12 in every pass and 40/40 sustained, twice.
    expect(DEFAULT_CHANGE_POLICY.minCaptureIntervalMs).toBeGreaterThanOrEqual(
      MEASURED_CAPTURE_ENVELOPE.chromium.safeIntervalMs
    );
  });

  it("records the envelope as CONDITIONAL, with activeTab unmeasured", () => {
    // The dossier says capture is rate-limited "particularly under activeTab" - the cell
    // most likely to be MORE restrictive is the one still open. If this ever reads ACCEPT
    // without activeTab appearing in a measured cell, the classification has drifted.
    expect(MEASURED_CAPTURE_ENVELOPE.verdict).toBe("CONDITIONAL");
    expect(MEASURED_CAPTURE_ENVELOPE.notMeasured).toContain("activeTab permission path");
  });

  it("bounds the floor by the stricter engine, not the permissive one", () => {
    // Firefox showed no limit at or below 10 Hz. Tuning to that headroom would be
    // throttled on Chromium, so the floor comes from Chromium.
    expect(MEASURED_CAPTURE_ENVELOPE.chromium.safeIntervalMs).toBe(500);
    expect(MEASURED_CAPTURE_ENVELOPE.firefox.note).toMatch(/not a proof of absence/i);
  });
});
