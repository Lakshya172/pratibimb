/**
 * QG-03b-2a — the real-capture evidence, guarded as data, plus the one shipped-source
 * regression this experiment turned up.
 *
 * The measurement itself needs a browser: only Chromium can call `captureVisibleTab`, and
 * only a browser can decode what it returns. So the numbers live in
 * `artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture` and this file enforces that they
 * stay internally consistent and that nothing can be classified on weaker grounds than the
 * criterion that was registered before any capture happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS PROTECTS AGAINST
 *
 * QG-03b-2 proved the browser decodes a JPEG the way Pillow does — using JPEGs PILLOW WROTE.
 * Both are libjpeg-turbo, so that agreement was partly structural. The obvious way to
 * "extend" that result is to assume it covers the browser's own encoder too. It does not,
 * and the assumption is invisible once made.
 *
 * These tests therefore refuse any claim whose evidence does not say, in the committed
 * artifacts, that the bytes came out of `chrome.tabs.captureVisibleTab`.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT TESTED HERE
 *
 * The captured files' hashes are MACHINE-BOUND. Font rasterisation is a property of the
 * installed fonts and the compositor, so re-rendering a fixture page on another machine
 * produces different bytes. No test below re-renders anything or re-captures anything; they
 * read committed evidence and shipped source. An experimental stress test turned into a CI
 * test is a flaky CI test, and a flaky test that guards a security-relevant path is worse
 * than no test because it trains people to ignore it.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEAD_CONTRACT, rasterLetterbox, decodeDataUrl, PerceptionError } from "@pratibimb/perception";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const EXP = join(REPO, "artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture");
const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

const fx = read(join(EXP, "fixtures.json"));
const metrics = read(join(EXP, "metrics.json"));
const controls = read(join(EXP, "negative-controls.json"));
const saturation = read(join(EXP, "saturation-control.json"));
const cells = metrics?.cells ?? [];

interface FormatCell {
  lossless: boolean;
  fixtures: number;
  conformant: number;
  allConformant: boolean;
  bitwiseIdenticalToReference: boolean;
  worstDecodedMaxAbs: number | null;
  worstDecodedMeanAbs: number | null;
  geometryAlwaysExact: boolean;
  encodedBytesVerified: boolean;
  magicMatchesDeclaredMime: boolean;
  tensorDigestAlwaysMatches: boolean;
  harnessErrors: number;
  pathClassification: string;
  detectorCriterionMet: boolean | null;
  classification: string;
  condition?: string;
}
const formats = (c: { byFormat: Record<string, FormatCell> }) => Object.entries(c.byFormat);

// ═══════════════════════════════════════════════════════════════════════════════════════
// The shipped adapter. This is the only test here that guards PRODUCTION code, and it is
// the most important one in the file.
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("the capture adapter asks for the format it means to get", () => {
  const source = readFileSync(join(REPO, "packages/perception/src/capture.ts"), "utf8");

  it("captureVisibleTab is called with an EXPLICIT format", () => {
    // MEASURED, not assumed: with `format` omitted entirely, Chromium 151 returns
    // image/jpeg — byte-identical to an explicit {format:"jpeg"}. See metrics.json's
    // capture.apiSurface, entry "omitted".
    //
    // So dropping the option would not fall back to "no compression" or raise; it would
    // silently switch the whole product to lossy capture at quality 90 with 4:2:0 chroma
    // subsampling, and every downstream measurement would still look plausible.
    expect(source, "the format argument must be explicit — the API default is JPEG").toMatch(
      /captureVisibleTab\(\{\s*format:\s*"(png|jpeg)"/
    );
  });

  it("and that format is png", () => {
    // A deliberate product choice, and one this experiment supports on its own evidence:
    // PNG is lossless, and it was smaller than the default JPEG on 9 of the 10 fixtures.
    // Changing it is a capture-policy decision, not a refactor, so it should fail here first.
    expect(source).toMatch(/captureVisibleTab\(\{\s*format:\s*"png"\s*\}\)/);
  });

  it("the declared API surface does not promise a format the API rejects", () => {
    // TabsCaptureApi declares png|jpeg. Chromium 151 rejects {format:"webp"} at schema
    // validation, so the declaration is correct — checked here so a future widening has to
    // be accompanied by evidence that the browser accepts it.
    expect(source).toMatch(/format:\s*"png"\s*\|\s*"jpeg";\s*quality\?:\s*number/);
  });

  it("decodeDataUrl accepts exactly the two formats the API can produce", () => {
    const png = decodeDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(png.format).toBe("png");
    const jpeg = decodeDataUrl("data:image/jpeg;base64,/9j/4AAQ");
    expect(jpeg.format).toBe("jpeg");
    // WebP is in CaptureFrame.format but cannot come from the adapter, and the decoder
    // refuses it rather than inventing a path for it.
    expect(() => decodeDataUrl("data:image/webp;base64,UklGRg==")).toThrow(PerceptionError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// The evidence.
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("the fixtures came out of the browser, and say so", () => {
  it("fixtures.json is committed", () => {
    expect(fx, `${join(EXP, "fixtures.json")} missing — run the capture phase, then qg03b2a_fixtures.py`).toBeTruthy();
  });

  it("every fixture is attributed to chrome.tabs.captureVisibleTab", () => {
    // The single claim the whole experiment rests on. A fixture produced any other way
    // would make this a test of some encoder nobody ships.
    for (const f of fx.fixtures) {
      expect(f.producedBy, `${f.source}/${f.encoding}`).toBe("chrome.tabs.captureVisibleTab");
    }
    expect(fx.capturePhase.api).toBe("chrome.tabs.captureVisibleTab");
    expect(fx.capturePhase.note).toMatch(/no image encoder exists anywhere in the capture harness/);
  });

  it("the API binding was verified to be native, not a stand-in", () => {
    expect(fx.capturePhase.apiBinding.source).toMatch(/\[native code\]/);
  });

  it("the capture harness contains no encoder of its own", () => {
    // The failure mode this forbids is subtle and easy: a canvas `toDataURL` would still
    // produce a real browser JPEG, but from a DIFFERENT component with a different
    // configuration, and the result would read as if it were about captureVisibleTab.
    const bg = readFileSync(join(EXP, "harness/capture-ext/background.js"), "utf8");
    // CODE only. The file's own header names `canvas.toDataURL()` as the thing it must
    // never grow, and a naive grep matches that sentence and fails on the documentation of
    // the very rule it is enforcing.
    //
    // Line-based rather than a block-comment regex: this file contains regex literals and
    // division, and a `/*...*/` matcher run over JavaScript source will eventually pair the
    // wrong delimiters. Dropping comment-shaped LINES is duller and cannot misfire.
    const code = bg
      .split(/\r?\n/)
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
      })
      .join("\n");
    expect(code).not.toMatch(/toDataURL|toBlob|convertToBlob|OffscreenCanvas|createImageBitmap/);
    expect(code).toMatch(/chrome\.tabs\.captureVisibleTab/);
    // The escaped form, because in the source the brackets belong to a regex literal:
    // `if (!/\[native code\]/.test(src))`. Matching the unescaped text instead would have
    // been satisfied by the comment above it explaining the rule — which is how the first
    // version of this assertion passed while testing nothing.
    expect(code, "the native-binding assertion must still be there").toMatch(/\\\[native code\\\]/);
    expect(code, "and it must actually be called before any capture").toMatch(/assertRealCaptureApi\(\)/);
  });

  it("the fixture set covers every category the brief named", () => {
    const cats = [...new Set(fx.fixtures.map((f: { category: string }) => f.category))].join(" | ");
    for (const required of [
      "text-heavy",
      "buttons and controls",
      "small controls",
      "dense UI",
      "gradients",
      "wide",
      "tall",
      "odd dimensions",
      "fractional letterbox",
      "realistic mixed UI",
    ]) {
      expect(cats, `no "${required}" fixture`).toContain(required);
    }
  });

  it("at least one fixture produces fractional letterbox padding", () => {
    // 960x640 gives continuous pad 106.667 against raster 106 — the disagreement QG-03b was
    // opened to settle, here on a frame the browser actually produced.
    const fractional = fx.fixtures.filter((f: { sourceSize: { w: number; h: number } }) => {
      const s = Math.min(640 / f.sourceSize.w, 640 / f.sourceSize.h);
      return Math.abs((640 - f.sourceSize.h * s) / 2 - Math.floor((640 - Math.round(f.sourceSize.h * s)) / 2)) > 1e-9;
    });
    expect(fractional.length).toBeGreaterThan(0);
  });

  it("both display modes were captured and neither was dropped", () => {
    const displays = new Set(fx.fixtures.map((f: { display: string }) => f.display));
    expect(displays).toContain("headful");
    expect(displays).toContain("headless");
  });

  it("every fixture records the digest and byte count of what was captured", () => {
    for (const f of fx.fixtures) {
      expect(f.encodedSha256, `${f.source}/${f.encoding}`).toMatch(/^[0-9a-f]{64}$/);
      expect(f.encodedBytes).toBeGreaterThan(0);
      expect(f.dataUrlHeader).toMatch(/^data:image\/(png|jpeg);base64$/);
    }
  });

  it("the declared MIME agrees with the magic bytes recorded at capture time", () => {
    for (const f of fx.fixtures) {
      if (f.mime === "image/png") expect(f.magic, f.source).toBe("89 50 4e 47");
      else expect(f.magic, f.source).toMatch(/^ff d8 ff/);
    }
  });

  it("the reference decodes the captured bytes, never the PNG capture", () => {
    // The sentence that keeps this from measuring compression and calling it conformance.
    expect(fx.reference.rule).toMatch(/EXACT ENCODED BYTES/);
    expect(fx.reference.rule).toMatch(/never compared against the\s*PNG capture/i);
  });

  it("the criterion is QG-03b-2's, unchanged, so the two results are comparable", () => {
    // A criterion restated with fresh values could drift to fit whatever came back. These
    // numbers are inherited and the inheritance is asserted.
    expect(fx.criterion.preRegistered).toBe(true);
    expect(fx.criterion.inheritedFrom).toMatch(/QG-03b-2/);
    expect(fx.criterion.lossy.decodedMaxAbs).toBe(2);
    expect(fx.criterion.lossy.decodedMeanAbs).toBe(0.2);
    expect(fx.criterion.lossy.geometryExact).toBe(true);
    expect(fx.criterion.detector.minMatchedAtIou50).toBe(0.95);
    expect(fx.criterion.detector.maxCssDisplacementPx).toBe(2.0);

    const prior = read(join(REPO, "artifacts/experiments/W1-QG03b2-capture-format-conformance/fixtures.json"));
    if (prior) {
      expect(fx.criterion.lossy.decodedMaxAbs).toBe(prior.criterion.lossy.decodedMaxAbs);
      expect(fx.criterion.lossy.decodedMeanAbs).toBe(prior.criterion.lossy.decodedMeanAbs);
      expect(fx.criterion.detector.maxCssDisplacementPx).toBe(prior.criterion.detector.maxCssDisplacementPx);
    }
  });

  it("the raster geometry agrees with the shipped implementation for every capture", () => {
    // Pure arithmetic, so it runs everywhere and needs no browser.
    for (const f of fx.fixtures) {
      const t = rasterLetterbox(f.decodedSize, HEAD_CONTRACT.inputSize, HEAD_CONTRACT.padValue);
      expect(t.resizedW, `${f.source}/${f.encoding}`).toBe(f.geometry.resizedW);
      expect(t.resizedH).toBe(f.geometry.resizedH);
      expect(t.padLeft).toBe(f.geometry.padLeft);
      expect(t.padTop).toBe(f.geometry.padTop);
      expect(t.padRight).toBe(f.geometry.padRight);
      expect(t.padBottom).toBe(f.geometry.padBottom);
    }
  });

  it("a capture's decoded size is its capture size — no DPR scaling crept in", () => {
    for (const f of fx.fixtures) {
      expect(f.dpr, `${f.source}: the runner forces DPR 1 so CSS px and capture px coincide`).toBe(1);
      expect(f.decodedSize).toEqual(f.captureSize);
      expect(f.viewportCss).toEqual(f.captureSize);
    }
  });
});

describe("what the encoder actually does, read from the files rather than assumed", () => {
  it("metrics.json records measured encoder characteristics", () => {
    expect(metrics, `${join(EXP, "metrics.json")} missing — run aggregate-qg03b2a.mjs`).toBeTruthy();
    const e = metrics.encoder.jpeg;
    expect(e.subsampling).toEqual(["4:2:0"]);
    expect(e.progressive).toEqual([false]);
    expect(e.quantTableCount).toEqual([2]);
    expect(e.note).toMatch(/DERIVED from the tables, not assumed/);
  });

  it("the JPEG quality is derived from the quantization tables, and is unambiguous", () => {
    // Recovered by matching the scaled IJG Annex K tables exactly. If a future Chromium
    // changes tables, `exactMatch` goes false and this fails rather than silently reporting
    // a nearest guess.
    for (const f of fx.fixtures) {
      if (f.encoding !== "capture-jpeg") continue;
      expect(f.encoder.impliedIjgQuality.exactMatch, f.source).toBe(true);
      expect(f.encoder.impliedIjgQuality.qualities).toEqual([90]);
    }
  });

  it("every Chromium JPEG carries an ICC profile and every Chromium PNG does not", () => {
    // QG-03b-2's fixtures deliberately embedded none, so this is new surface that experiment
    // never exercised. It is recorded because a browser applies an embedded profile and PIL
    // does not — whether that matters is measured below, not assumed either way.
    expect(metrics.encoder.jpeg.iccProfileBytes).toEqual([456]);
    expect(metrics.encoder.jpeg.iccDescription).toEqual(["sRGB"]);
    expect(metrics.encoder.png.iccProfileBytes).toEqual([0]);
  });

  it("colour management is measured, and is not the cause of anything here", () => {
    // The `no-colorspace` decode variant exists precisely to answer this. If the profile
    // ever stops being sRGB-identity this flips, and the attribution is already in place.
    for (const c of cells) {
      expect(c.colourManagementEverAffects, `${c.backend}/${c.display}`).toBe(false);
    }
    expect(metrics.encoder.jpeg.iccIdentityToSrgb.worstMaxAbs).toBeLessThanOrEqual(1);
  });

  it("the API surface probe recorded what the browser accepts and refuses", () => {
    const s = metrics.capture.apiSurface;
    expect(s.png.mime).toBe("image/png");
    expect(s.jpeg.mime).toBe("image/jpeg");
    // Two findings that are easy to assume the other way round.
    expect(s.omitted.mime, "omitting `format` yields JPEG, not PNG").toBe("image/jpeg");
    expect(s.webp.rejected, "Chromium refuses webp at schema validation").toBeTruthy();
    expect(s["png-q50"].bytes, "`quality` is ignored for PNG").toBe(s.png.bytes);
  });
});

describe("the browser evidence is internally consistent", () => {
  it("every cell names backend and display, and had its backend OBSERVED", () => {
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.browser).toBe("chromium");
      expect(["wasm", "webgpu"]).toContain(c.backend);
      expect(["headful", "headless"]).toContain(c.display);
      // ORT falls back without raising, so a configured backend is not a measured one.
      expect(c.backendLabelVerified, `${c.backend}/${c.display}`).toBe(true);
      if (c.backend === "webgpu") expect(c.gpuSubmits.min).toBeGreaterThan(0);
      else expect(c.gpuSubmits.max).toBe(0);
    }
  });

  it("no Firefox cell exists — this experiment is about Chromium's encoder", () => {
    // Firefox has no captureVisibleTab output of its own to test here. A Firefox row would
    // be a different question wearing this one's label.
    expect(cells.every((c: { browser: string }) => c.browser === "chromium")).toBe(true);
    expect(fx.scope.chromiumOnly).toMatch(/Firefox is deliberately out of scope/);
  });

  it("every cell verified it decoded the reference's own bytes", () => {
    for (const c of cells) {
      for (const [fmt, v] of formats(c)) {
        expect(v.encodedBytesVerified, `${c.backend}/${c.display}/${fmt}`).toBe(true);
        expect(v.magicMatchesDeclaredMime, `${c.backend}/${c.display}/${fmt}`).toBe(true);
      }
    }
  });

  it("geometry is exact in every cell and every format — no tolerance anywhere", () => {
    for (const c of cells) {
      for (const [fmt, v] of formats(c)) {
        expect(v.geometryAlwaysExact, `${c.backend}/${c.display}/${fmt}`).toBe(true);
      }
    }
  });
});

describe("a format cannot reach ACCEPT on weak grounds", () => {
  it("the capture path is scored on its own, before the detector is consulted", () => {
    // Keeping the two separate is what let this experiment attribute its one failure
    // correctly instead of blaming the format.
    for (const c of cells) {
      for (const [fmt, v] of formats(c)) {
        expect(["ACCEPT", "REJECT", "UNKNOWN"], `${fmt}`).toContain(v.pathClassification);
      }
    }
  });

  it("ACCEPT requires every fixture of every run to conform AND the detector bound to hold", () => {
    for (const c of cells) {
      for (const [fmt, v] of formats(c)) {
        if (v.classification !== "ACCEPT") continue;
        expect(v.allConformant, `${c.backend}/${c.display}/${fmt} is ACCEPT but not all fixtures conform`).toBe(true);
        expect(v.conformant).toBe(v.fixtures);
        expect(v.detectorCriterionMet, `${c.backend}/${c.display}/${fmt} is ACCEPT without meeting the detector bound`).toBe(true);
        expect(v.harnessErrors).toBe(0);
      }
    }
  });

  it("a LOSSLESS capture marked ACCEPT must be bitwise identical, not merely within tolerance", () => {
    for (const c of cells) {
      for (const [fmt, v] of formats(c)) {
        if (!v.lossless || v.classification !== "ACCEPT") continue;
        expect(v.bitwiseIdenticalToReference, `${c.backend}/${c.display}/${fmt}`).toBe(true);
        expect(v.worstDecodedMaxAbs).toBe(0);
      }
    }
  });

  it("a LOSSY capture must be inside the pre-registered bound wherever its path was ACCEPTed", () => {
    for (const c of cells) {
      for (const [fmt, v] of formats(c)) {
        if (v.lossless || v.pathClassification !== "ACCEPT") continue;
        expect(v.worstDecodedMaxAbs as number).toBeLessThanOrEqual(fx.criterion.lossy.decodedMaxAbs);
        expect(v.worstDecodedMeanAbs as number).toBeLessThanOrEqual(fx.criterion.lossy.decodedMeanAbs);
      }
    }
  });

  it("a CONDITIONAL cell states its condition", () => {
    // A verdict without a stated condition is a verdict nobody can act on or retire.
    for (const c of cells) {
      for (const [fmt, v] of formats(c)) {
        if (v.classification !== "CONDITIONAL") continue;
        expect(v.condition, `${c.backend}/${c.display}/${fmt} is CONDITIONAL with no condition`).toBeTruthy();
        expect(v.condition).toMatch(/bitwise-exact/);
      }
    }
  });

  it("the overall classification is the WEAKEST cell, never an average", () => {
    const all: string[] = cells.flatMap((c: { byFormat: Record<string, FormatCell> }) =>
      Object.values(c.byFormat).map((v) => v.classification)
    );
    const expected = all.includes("REJECT")
      ? "REJECT"
      : all.includes("UNKNOWN")
        ? "UNKNOWN"
        : all.includes("CONDITIONAL")
          ? "CONDITIONAL"
          : "ACCEPT";
    expect(metrics.overall.classification).toBe(expected);
  });

  it("a harness error is UNKNOWN, never REJECT", () => {
    // QG-03b-2 nearly published a Firefox WebP defect that did not exist because a
    // same-origin read aborted under IO load and the aggregation scored it as a verdict.
    // "The evidence is missing" and "the thing is wrong" are different claims.
    for (const c of cells) {
      for (const [fmt, v] of formats(c)) {
        if (v.harnessErrors > 0) {
          expect(v.classification, `${c.backend}/${c.display}/${fmt}`).toBe("UNKNOWN");
        }
      }
    }
  });
});

describe("conformance and compression sensitivity stay apart", () => {
  it("detector conformance compares the browser against the reference decode of the SAME bytes", () => {
    for (const c of cells) {
      for (const [fmt, d] of Object.entries<{
        conformance: { measured: boolean; worstAgreement: number; worstCountDelta: number };
      }>(c.detection ?? {})) {
        if (!d.conformance?.measured) continue;
        // Agreement and count must hold everywhere. The DISPLACEMENT bound is where the one
        // condition lives, and it is asserted per-cell below rather than waived here.
        expect(d.conformance.worstAgreement, `${c.backend}/${c.display}/${fmt}`).toBeGreaterThanOrEqual(
          fx.criterion.detector.minMatchedAtIou50
        );
        expect(d.conformance.worstCountDelta).toBeLessThanOrEqual(fx.criterion.detector.maxCountDelta);
      }
    }
  });

  it("a cell whose displacement bound holds is ACCEPT, and one whose does not is CONDITIONAL", () => {
    for (const c of cells) {
      for (const [fmt, d] of Object.entries<{ conformance: { measured: boolean; worstCssPx: number } }>(c.detection ?? {})) {
        if (!d.conformance?.measured) continue;
        const v = c.byFormat[fmt];
        const within = d.conformance.worstCssPx <= fx.criterion.detector.maxCssDisplacementPx;
        expect(v.classification, `${c.backend}/${c.display}/${fmt} worst ${d.conformance.worstCssPx}px`).toBe(
          within ? "ACCEPT" : "CONDITIONAL"
        );
      }
    }
  });

  it("compression sensitivity is recorded separately and never classifies anything", () => {
    // JPEG-vs-PNG measures what the encoding costs. It is a real finding, it belongs to
    // QG-03a, and merging it into conformance would turn an exact browser agreement into an
    // apparent failure — the trap a lossy conformance test exists to avoid.
    let sawLossy = false;
    for (const c of cells) {
      for (const [fmt, d] of Object.entries<{
        compressionSensitivity: { measured: boolean };
      }>(c.detection ?? {})) {
        if (!d.compressionSensitivity?.measured) continue;
        expect(d.compressionSensitivity).not.toHaveProperty("allMeet");
        if (fmt === "capture-jpeg") sawLossy = true;
      }
    }
    expect(sawLossy, "no lossy format reported compression sensitivity — the measurement was lost").toBe(true);
    expect(metrics.compressionSensitivity.note).toMatch(/NOT a conformance measurement/);
    expect(metrics.compressionSensitivity.perFixture.length).toBeGreaterThan(0);
  });

  it("the compression cost is real and is not zero, so nobody can call JPEG free", () => {
    const worst = Math.max(
      ...metrics.compressionSensitivity.perFixture.map((r: { decodedMaxAbs: number }) => r.decodedMaxAbs)
    );
    expect(worst, "JPEG q90 that changed no pixel would mean the measurement is broken").toBeGreaterThan(2);
  });
});

describe("the one CONDITIONAL is attributed, not excused", () => {
  it("the saturation control is committed and reached a verdict", () => {
    expect(saturation, "saturation-control.json missing — run qg03b2a_saturation_control.py").toBeTruthy();
    expect(saturation.verdict.answer).toBe("NO");
    expect(saturation.verdict.belongsTo).toMatch(/QG-03a/);
    expect(saturation.verdict.doesNotJustify).toMatch(/retraining/);
  });

  it("the attribution rests on the tensor having matched bitwise", () => {
    // This is the load-bearing fact: if the tensor is identical, the capture path has
    // already finished agreeing and nothing after it can be charged to the format.
    expect(saturation.verdict.decisive.join(" ")).toMatch(/BITWISE/);
    for (const c of cells) {
      for (const [fmt, v] of formats(c)) {
        expect(v.tensorDigestAlwaysMatches, `${c.backend}/${c.display}/${fmt}`).toBe(true);
      }
    }
  });

  it("and on the same input giving different answers on different backends", () => {
    expect(saturation.verdict.decisive.join(" ")).toMatch(/WASM.*WebGPU|WebGPU.*WASM/);
    const wasm = cells.filter((c: { backend: string }) => c.backend === "wasm");
    const webgpu = cells.filter((c: { backend: string }) => c.backend === "webgpu");
    expect(wasm.length).toBeGreaterThan(0);
    expect(webgpu.length).toBeGreaterThan(0);
  });

  it("the tidy hypothesis that the control killed is kept, not quietly replaced", () => {
    // "The 300-detection cap is the mechanism" was wrong: `controls` emits 147 boxes and is
    // just as unstable. Keeping the dead hypothesis visible is what stops it being
    // rediscovered and believed.
    expect(saturation.verdict.unstableWithoutSaturating.length).toBeGreaterThan(0);
    expect(saturation.verdict.mechanism).toMatch(/NOT the cause/);
  });
});

describe("the harness was shown to be capable of failing", () => {
  it("the negative controls are committed and all three fired", () => {
    expect(controls, "negative-controls.json missing — run negative-controls.mjs").toBeTruthy();
    expect(controls.allFired).toBe(true);
    expect(controls.controls.length).toBe(3);
  });

  it("each control fired the guard that owns its failure, not merely something", () => {
    const by = Object.fromEntries(controls.controls.map((c: { control: string }) => [c.control, c]));
    expect(by["corrupted-bytes"].observed.encodedSha256Matches).toBe(false);
    // Corruption is missing evidence, not a browser defect.
    expect(by["corrupted-bytes"].wouldClassifyAs).toBe("UNKNOWN");
    expect(by["mislabelled-type"].observed.magicMatchesDeclaredMime).toBe(false);
    expect(by["swapped-reference"].observed.conformant).toBe(false);
    // The one that proves the MEASUREMENT works rather than an integrity check: it must
    // have compared pixels, not escaped through a length mismatch.
    expect(by["swapped-reference"].observed.lengthMismatch).toBe(false);
    expect(by["swapped-reference"].observed.maxAbs).toBeGreaterThan(0);
  });
});
