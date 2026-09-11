/**
 * QG-03b-2 — the capture-format conformance evidence, guarded as data.
 *
 * The decoding itself can only happen in a browser: Node has no JPEG or WebP decoder without
 * a dependency, and the question is specifically what the BROWSER's decoder does. So the
 * measurement lives in `W1-QG03b-2` and this file enforces that the committed evidence stays
 * internally consistent and that no format can be marked ACCEPT on weaker grounds than the
 * pre-registered criterion.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS PROTECTS AGAINST
 *
 * JPEG is lossy, so a JPEG-decoded tensor can never equal the original PNG's tensor. It is
 * very easy to write a "conformance" test that either compares the wrong things and always
 * fails, or quietly widens its tolerance until it passes. Both produce a green suite that
 * means nothing.
 *
 * The evidence therefore has to show that BOTH SIDES DECODED THE SAME FILE — the encoded
 * bytes' SHA-256, verified in the browser — and the tests below refuse any classification
 * that is not backed by that.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEAD_CONTRACT, rasterLetterbox } from "@pratibimb/perception";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const EXP = join(REPO, "artifacts/experiments/W1-QG03b2-capture-format-conformance");
const FIXTURES = join(EXP, "fixtures.json");
const METRICS = join(EXP, "metrics.json");

const fx = existsSync(FIXTURES) ? JSON.parse(readFileSync(FIXTURES, "utf8")) : null;
const metrics = existsSync(METRICS) ? JSON.parse(readFileSync(METRICS, "utf8")) : null;
const cells = metrics?.cells ?? [];

const CAPTURE_FORMATS = ["png", "jpeg-q95", "jpeg-q62"];
const LOSSLESS = ["png", "webp-lossless"];

describe("the fixture set covers what the capture path can actually produce", () => {
  it("fixtures.json is committed", () => {
    expect(fx, `${FIXTURES} missing — run: python tools/detector/qg03b2_fixtures.py`).toBeTruthy();
  });

  it("every real capture format is present, and WebP is present but scoped as NOT one", () => {
    const encodings = fx.encodings.map((e: { name: string }) => e.name);
    for (const f of CAPTURE_FORMATS) expect(encodings, `missing ${f}`).toContain(f);
    expect(encodings).toContain("webp-lossy-q62");
    expect(encodings).toContain("webp-lossless");
    // The scope note must say plainly that WebP is not a capture format. Without it a later
    // reader would reasonably conclude the capture path can emit WebP, and it cannot.
    expect(fx.scope.webp).toMatch(/NOT a capture format/);
    expect(fx.scope.jpeg).toMatch(/captureVisibleTab/);
  });

  it("the fixture sources cover the brief's categories", () => {
    const sources = [...new Set(fx.fixtures.map((f: { source: string }) => f.source))].join(" ");
    for (const required of ["simple", "wide", "tall", "odd", "small-controls", "text-edges", "real-", "alpha"]) {
      expect(sources, `no ${required} fixture`).toContain(required);
    }
  });

  it("at least one source produces fractional letterbox padding", () => {
    // 960x640 gives pad 106.667 continuous against 106 raster — the case the old contract
    // could not express, and the one most likely to expose a geometry mistake.
    const fractional = fx.fixtures.filter((f: { sourceSize: { w: number; h: number } }) => {
      const s = Math.min(640 / f.sourceSize.w, 640 / f.sourceSize.h);
      return Math.abs((640 - f.sourceSize.h * s) / 2 - Math.floor((640 - Math.round(f.sourceSize.h * s)) / 2)) > 1e-9;
    });
    expect(fractional.length).toBeGreaterThan(0);
  });

  it("the criterion was pre-registered, with different bars for lossless and lossy", () => {
    expect(fx.criterion.preRegistered).toBe(true);
    expect(fx.criterion.preRegisteredBefore).toMatch(/before any browser|any browser was launched/i);
    expect(fx.criterion.lossless.decodedPixels).toMatch(/BITWISE/);
    expect(typeof fx.criterion.lossy.decodedMaxAbs).toBe("number");
    expect(fx.criterion.lossy.geometryExact).toBe(true);
    // The primary criterion is the detector's output, not the tensor bound.
    expect(fx.criterion.detector.minMatchedAtIou50).toBeGreaterThanOrEqual(0.95);
  });

  it("the reference decodes the encoded bytes, not the original image", () => {
    // The single most important sentence in the fixture manifest. Comparing a JPEG against
    // the lossless original would measure compression and call it conformance.
    expect(fx.reference.rule).toMatch(/EXACT ENCODED BYTES/);
    expect(fx.reference.rule).toMatch(/never compared against the original/i);
    expect(fx.reference.iccProfiles).toMatch(/never embedded/);
  });

  it("every fixture records the digest of the bytes that were encoded", () => {
    for (const f of fx.fixtures) {
      if (f.unavailable) continue;
      expect(f.encodedSha256, `${f.source}/${f.encoding}`).toMatch(/^[0-9a-f]{64}$/);
      expect(f.encodedBytes).toBeGreaterThan(0);
    }
  });

  it("the raster geometry agrees with the shipped implementation for every fixture", () => {
    // Pure arithmetic, so it runs everywhere and needs no browser.
    for (const f of fx.fixtures) {
      if (f.unavailable) continue;
      const t = rasterLetterbox(f.decodedSize, HEAD_CONTRACT.inputSize, HEAD_CONTRACT.padValue);
      expect(t.resizedW, `${f.source}/${f.encoding}`).toBe(f.geometry.resizedW);
      expect(t.resizedH).toBe(f.geometry.resizedH);
      expect(t.padLeft).toBe(f.geometry.padLeft);
      expect(t.padTop).toBe(f.geometry.padTop);
      expect(t.padRight).toBe(f.geometry.padRight);
      expect(t.padBottom).toBe(f.geometry.padBottom);
    }
  });
});

describe("the browser evidence is internally consistent", () => {
  it("metrics.json is committed with at least one cell", () => {
    expect(metrics, `${METRICS} missing — run the harness, then aggregate-qg03b2.mjs`).toBeTruthy();
    expect(cells.length).toBeGreaterThan(0);
  });

  it("every cell names browser, backend and display mode", () => {
    for (const c of cells) {
      expect(c.browser).toBeTruthy();
      expect(c.backend).toBeTruthy();
      expect(["headful", "headless"]).toContain(c.display);
    }
  });

  it("every cell verified that it decoded the reference's own bytes", () => {
    // Without this the comparison is between two different files and every number is noise.
    for (const c of cells) {
      for (const [fmt, v] of Object.entries<Record<string, unknown>>(c.byFormat)) {
        expect(v.encodedBytesVerified, `${c.browser}/${c.display}/${fmt} did not verify the encoded bytes`).toBe(true);
      }
    }
  });

  it("geometry is exact in every cell and every format — no tolerance anywhere", () => {
    for (const c of cells) {
      for (const [fmt, v] of Object.entries<Record<string, unknown>>(c.byFormat)) {
        expect(v.geometryAlwaysExact, `${c.browser}/${c.display}/${fmt}`).toBe(true);
      }
    }
  });
});

describe("a format cannot reach ACCEPT on weak grounds", () => {
  it("ACCEPT requires every fixture of every run to conform", () => {
    for (const c of cells) {
      for (const [fmt, v] of Object.entries<Record<string, unknown>>(c.byFormat)) {
        if (v.classification !== "ACCEPT") continue;
        expect(v.allConformant, `${c.browser}/${c.display}/${fmt} is ACCEPT but not all fixtures conform`).toBe(true);
        expect(v.conformant).toBe(v.fixtures);
      }
    }
  });

  it("a LOSSLESS format marked ACCEPT must be bitwise identical, not merely within tolerance", () => {
    for (const c of cells) {
      for (const fmt of LOSSLESS) {
        const v = c.byFormat[fmt];
        if (!v || v.classification !== "ACCEPT") continue;
        expect(
          v.bitwiseIdenticalToReference,
          `${c.browser}/${c.display}/${fmt}: a lossless format is defined to reconstruct exactly — ` +
            "a tolerance here would be hiding a defect"
        ).toBe(true);
        expect(v.worstDecodedMaxAbs).toBe(0);
      }
    }
  });

  it("a LOSSY format marked ACCEPT must be inside the pre-registered bound", () => {
    for (const c of cells) {
      for (const [fmt, v] of Object.entries<Record<string, number | string | boolean | null>>(c.byFormat)) {
        if (v.classification !== "ACCEPT" || LOSSLESS.includes(fmt)) continue;
        expect(v.worstDecodedMaxAbs as number).toBeLessThanOrEqual(fx.criterion.lossy.decodedMaxAbs);
        expect(v.worstDecodedMeanAbs as number).toBeLessThanOrEqual(fx.criterion.lossy.decodedMeanAbs);
      }
    }
  });

  it("PNG has not regressed from the bitwise result QG-03b established", () => {
    // QG-03b is closed. If a later change makes PNG merely "close", this says so rather
    // than letting a lossy-format tolerance quietly cover a lossless regression.
    for (const c of cells) {
      const v = c.byFormat.png;
      if (!v) continue;
      expect(v.bitwiseIdenticalToReference, `${c.browser}/${c.display}: PNG regressed`).toBe(true);
      expect(v.worstDecodedMaxAbs).toBe(0);
    }
  });

  it("detector CONFORMANCE — browser against the reference decode of the SAME bytes", () => {
    // The tensor bound is diagnostic; what the detector says is decisive. This compares the
    // browser's detections against the Python detections for THE SAME ENCODED FILE, which is
    // the question QG-03b-2 asks.
    for (const c of cells) {
      for (const [fmt, d] of Object.entries<{ conformance: Record<string, number | boolean> }>(c.detection ?? {})) {
        if (!d.conformance?.measured) continue;
        expect(d.conformance.allMeet, `${c.browser}/${c.display}/${fmt}: detections outside the criterion`).toBe(true);
        expect(d.conformance.worstAgreement as number).toBeGreaterThanOrEqual(fx.criterion.detector.minMatchedAtIou50);
        expect(d.conformance.worstCssPx as number).toBeLessThanOrEqual(fx.criterion.detector.maxCssDisplacementPx);
      }
    }
  });

  it("compression sensitivity is recorded SEPARATELY and never used to classify", () => {
    // Comparing a JPEG's detections against the LOSSLESS frame's measures how much the
    // detector minds being compressed. It is a real finding and it is NOT conformance --
    // merging the two would turn an exact browser agreement into an apparent failure, which
    // is precisely the trap a lossy-format conformance test falls into.
    //
    // So it must be present, must be distinct from conformance, and must not gate anything.
    let sawLossySensitivity = false;
    for (const c of cells) {
      for (const [fmt, d] of Object.entries<{
        conformance: Record<string, number | boolean>;
        compressionSensitivity: Record<string, number | boolean>;
      }>(c.detection ?? {})) {
        if (!d.compressionSensitivity?.measured) continue;
        expect(d.compressionSensitivity).not.toHaveProperty("allMeet");
        if (!LOSSLESS.includes(fmt)) sawLossySensitivity = true;
        // And the format's classification must come from conformance, not from this.
        const v = c.byFormat[fmt];
        if (v?.classification === "ACCEPT") expect(v.allConformant).toBe(true);
      }
    }
    expect(sawLossySensitivity, "no lossy format reported compression sensitivity — the measurement was lost").toBe(true);
  });
});

describe("a harness failure can never be published as a product verdict", () => {
  it("any format with a harness error is UNKNOWN, never REJECT", () => {
    // This nearly went wrong. Firefox aborted same-origin reference reads under sustained
    // IO load — the harness fetching the same 1.2 MB file three times per fixture — and the
    // first aggregation scored the aborted fixture as non-conformant, which would have
    // published a Firefox WebP decoding defect that does not exist.
    //
    // "The evidence is missing" and "the thing is wrong" are different claims. The
    // aggregator must never turn the first into the second.
    for (const c of cells) {
      for (const [fmt, v] of Object.entries<Record<string, unknown>>(c.byFormat)) {
        if (((v.harnessErrors as number) ?? 0) > 0) {
          expect(
            v.classification,
            `${c.browser}/${c.display}/${fmt} had ${v.harnessErrors} harness errors but was classified ${v.classification}`
          ).toBe("UNKNOWN");
        }
      }
    }
  });

  it("every published ACCEPT rests on runs with no harness errors at all", () => {
    for (const c of cells) {
      for (const [fmt, v] of Object.entries<Record<string, unknown>>(c.byFormat)) {
        if (v.classification !== "ACCEPT") continue;
        expect((v.harnessErrors as number) ?? 0, `${c.browser}/${c.display}/${fmt}`).toBe(0);
      }
    }
  });
});

describe("the non-opaque finding is recorded rather than smoothed away", () => {
  it("the alpha fixture is REFUSED, in every format that can carry alpha", () => {
    // JPEG has no alpha channel, so it is not expected to refuse. PNG and both WebP
    // variants are. A zero here would mean the guard stopped firing.
    for (const c of cells) {
      for (const fmt of ["png", "webp-lossless", "webp-lossy-q62"]) {
        const v = c.byFormat[fmt];
        if (!v) continue;
        // One alpha fixture per run, so the count scales with runs rather than being 1.
        expect(
          v.refusedNotOpaque,
          `${c.browser}/${c.display}/${fmt}: expected one refusal per run — is the guard still there?`
        ).toBe(c.runs);
      }
    }
  });

  it("JPEG refuses nothing, because JPEG cannot carry alpha", () => {
    for (const c of cells) {
      for (const fmt of ["jpeg-q95", "jpeg-q62"]) {
        const v = c.byFormat[fmt];
        if (!v) continue;
        expect(v.refusedNotOpaque ?? 0).toBe(0);
      }
    }
  });

  it("the cause was attributed, not merely observed", () => {
    // Colour management and premultiplication were isolated with separate decode variants.
    // Recording which one fired is what turns a divergence into an explanation.
    for (const c of cells) {
      expect(typeof c.attribution.colourManagementEverAffects).toBe("boolean");
      expect(typeof c.attribution.premultiplyEverAffects).toBe("boolean");
    }
    expect(
      cells.some((c: { attribution: { premultiplyEverAffects: boolean } }) => c.attribution.premultiplyEverAffects),
      "premultiplication was measured as the cause; if no cell reports it the attribution was lost"
    ).toBe(true);
  });

  it("the contract documents the opacity requirement and its measured cost", () => {
    const doc = readFileSync(join(REPO, "docs/architecture/preprocessing-contract.md"), "utf8");
    expect(doc).toMatch(/FULLY OPAQUE/);
    expect(doc).toMatch(/FRAME_NOT_OPAQUE/);
    expect(doc, "the measured error must be stated, not just the rule").toMatch(/15\/255/);
    expect(doc, "WebP's second premultiply must be recorded").toMatch(/second premultiply/i);
  });
});
