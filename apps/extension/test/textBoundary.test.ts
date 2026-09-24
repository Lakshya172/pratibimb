/**
 * M4 — A TEXT TIER THAT CANNOT HAND A STRING UPWARD, TESTED WITH ONE THAT READS.
 *
 * There is no local text model (see `ocr-audit.md`: PP-OCRv5_mobile_det fails the S-04a-1
 * correctness criterion on WASM, and model-adoption rule 2 is frozen). So the boundary these tests
 * hold has nothing behind it today — which is exactly the situation in which a boundary quietly
 * stops being one.
 *
 * The stub below genuinely recognises text: it is handed pixels and returns what it "read". If the
 * seam let a string through, these tests would see it. That is the only honest way to check a
 * boundary whose model is absent, and it is why the tests are worth having before the model is.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  perceiveText,
  textPerceptionAbsent,
  TEXT_PERCEPTION_UNAVAILABLE,
  type TextPerception,
} from "../host-lib/text-perception";

/** The synthetic identifier the M4 fixture renders into a canvas. Never a real number. */
const SECRET = "7712 4408 9931";

const image = { width: 4, height: 4, rgba: new Uint8ClampedArray(4 * 4 * 4) };

/**
 * A recogniser that really does read, so the boundary has something to stop.
 *
 * It classifies with a shape rule standing in for the privacy package's own detectors — the point
 * is not the classification, it is that the string is in scope here and must not be in scope above.
 */
const readingStub = (): TextPerception => ({
  modelId: "stub-recogniser",
  revision: "test",
  read: async () => {
    const recognised = SECRET;
    return [
      {
        box: { x: 140, y: 132, w: 220, h: 26 },
        length: recognised.length,
        piiClass: /\d{4}\s\d{4}\s\d{4}/.test(recognised) ? "AADHAAR" : null,
        ref: null,
      },
    ];
  },
});

describe("the local text tier", () => {
  it("reports its own absence rather than returning no findings", async () => {
    const report = await perceiveText(null, image);

    expect(report.available).toBe(false);
    expect(report.findings).toEqual([]);
    // "Looked and found nothing sensitive" and "never looked" must not be the same record. A
    // client that conflated them would read as having cleared a page it never examined.
    expect(report.refusal?.code).toBe("TEXT_PERCEPTION_UNAVAILABLE");
    expect(report.refusal?.detail).toContain("WASM");
  });

  it("names the frozen rule it is declining under, not a preference", () => {
    // The reason this tier is absent is a rule the repository wrote before this milestone, and the
    // refusal carries it so nobody has to go looking for why.
    expect(TEXT_PERCEPTION_UNAVAILABLE.detail).toContain("model-adoption rule 2");
    expect(TEXT_PERCEPTION_UNAVAILABLE.detail).toContain("PP-OCRv5_mobile_det");
    expect(textPerceptionAbsent().available).toBe(false);
  });

  it("lets a real recogniser run and still cannot carry what it read", async () => {
    const report = await perceiveText(readingStub(), image);

    expect(report.available).toBe(true);
    expect(report.findings).toHaveLength(1);

    // The finding says where, how much, and what class. It does not say what.
    const finding = report.findings[0]!;
    expect(finding.length).toBe(SECRET.length);
    expect(finding.piiClass).toBe("AADHAAR");
    expect(Object.keys(finding).sort()).toEqual(["box", "length", "piiClass", "ref"]);

    // The whole report, serialised, the way it would cross anything.
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain("7712");
    expect(serialised).not.toContain("4408");
  });

  it("reports a tier that threw as a tier that did not look", async () => {
    const broken: TextPerception = {
      modelId: "broken",
      revision: "test",
      read: () => Promise.reject(new Error("session gone")),
    };
    const report = await perceiveText(broken, image);

    expect(report.available).toBe(false);
    expect(report.refusal?.code).toBe("TEXT_PERCEPTION_THREW");
    expect(report.findings).toEqual([]);
  });

  it("has no field anywhere in the seam that could hold recognised characters", () => {
    // The type is the guarantee, so the type is what is asserted. A future recogniser cannot pass a
    // string upward by forgetting to redact — it would have to change the interface, visibly.
    const source = readFileSync(join(__dirname, "..", "host-lib", "text-perception.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const field of ["text", "value", "transcript", "characters", "content", "recognised"]) {
      expect(source, `the seam declares a ${field} field`).not.toMatch(new RegExp(`readonly ${field}\s*[?]?:\s*string`));
    }
  });
});
