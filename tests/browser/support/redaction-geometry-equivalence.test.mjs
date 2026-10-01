/**
 * ONE REDACTION GEOMETRY — the RE-1 scorer and the product's canonical geometry cannot drift apart.
 *
 * M7.3. The pre-registered RE-1 scorer (aabf558) carried its own copy of the frozen union. It now
 * imports `packages/privacy/src/redactionGeometry.ts`. `redaction-geometry.golden.json` was recorded
 * from the scorer AS PRE-REGISTERED, before that refactor, over 90 box sets derived from the frozen
 * held-out ground truth. This file requires:
 *
 *   1. the refactored scorer to reproduce every recorded score exactly — RE-1 did not move;
 *   2. the canonical product geometry, through the package's public export, to reproduce every
 *      recorded mask exactly — scorer and product compute the same rectangles;
 *   3. no second implementation of dilation or merging to exist in product source;
 *   4. the held-out set to still be what was frozen.
 *
 * Geometry only. No detector, no model output, no character anywhere in this file or its inputs.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { iou as fusionIou } from "@pratibimb/perception";
import { REDACTION_UNION, overlapRatio, redactionMask, failClosedMask } from "@pratibimb/privacy";

import { scoreImage } from "./redaction-metrics.mjs";
import { boxSetsFor, loadHeldOut } from "./redaction-golden-inputs.mjs";

const golden = JSON.parse(readFileSync(new URL("./redaction-geometry.golden.json", import.meta.url), "utf8"));
const heldOut = loadHeldOut();
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

describe("the golden record is the one recorded from the pre-registered scorer", () => {
  it("is intact, and came from aabf558", () => {
    const { note, sha256OfBody, ...body } = golden;
    expect(createHash("sha256").update(JSON.stringify(body)).digest("hex")).toBe(sha256OfBody);
    expect(golden.recordedFrom).toBe("aabf558");
    expect(golden.criterion).toBe("RE-1");
    expect(golden.cases).toHaveLength(90);
    expect(note).toMatch(/before refactoring/);
  });
});

describe("scorer and canonical product geometry agree with the pre-registered geometry, exactly", () => {
  const inputs = new Map();
  for (const image of heldOut.images) for (const [set, prediction] of boxSetsFor(image)) inputs.set(`${image.image}/${set}`, { image, prediction });

  it("regenerates the same 90 inputs from the frozen held-out truth", () => {
    expect([...inputs.keys()]).toEqual(golden.cases.map((c) => `${c.image}/${c.set}`));
  });

  for (const c of golden.cases) {
    it(`${c.image} · ${c.set}: canonical mask and scorer verdict are unchanged`, () => {
      const { image, prediction } = inputs.get(`${c.image}/${c.set}`);
      // The PRODUCT path: the package's public export, as a product caller would reach it.
      const mask = prediction.failed ? failClosedMask(image.region) : redactionMask(prediction.boxes, image.region);
      expect(mask).toEqual(c.mask);
      // The EVALUATION path: the refactored scorer, which now has no geometry of its own.
      const score = scoreImage(prediction, { region: image.region, strings: image.strings });
      expect(score).toEqual(c.score);
    });
  }
});

describe("the overlap ratio is the fusion IoU, not a second definition of it", () => {
  it("equals @pratibimb/perception's iou on 2000 deterministic box pairs", () => {
    let seed = 20260925;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < 2000; i += 1) {
      const a = { x: rnd() * 800, y: rnd() * 400, w: 1 + rnd() * 200, h: 1 + rnd() * 60 };
      const b = { x: a.x + (rnd() - 0.5) * 150, y: a.y + (rnd() - 0.5) * 50, w: 1 + rnd() * 200, h: 1 + rnd() * 60 };
      expect(overlapRatio(a, b)).toBe(fusionIou(a, b));
    }
  });

  it("quotes the frozen union constants", () => {
    expect(REDACTION_UNION).toEqual({ dilationPx: 4, mergeIou: 0.3 });
    expect(Object.isFrozen(REDACTION_UNION)).toBe(true);
  });
});

describe("there is one implementation of the union", () => {
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (["node_modules", "dist", ".output", ".wxt", "test"].includes(entry)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|mjs|js)$/.test(entry)) sources.push(full);
    }
  };
  walk(join(ROOT, "apps"));
  for (const pkg of readdirSync(join(ROOT, "packages"))) walk(join(ROOT, "packages", pkg, "src"));

  it("defines dilation and merging only in packages/privacy/src/redactionGeometry.ts", () => {
    const definers = sources.filter((f) =>
      /\b(function|const)\s+(dilate|mergeOverlapping|redactionMask|unionMask|failClosedMask)\b/.test(readFileSync(f, "utf8"))
    );
    expect(definers.map((f) => f.replace(/\\/g, "/").split("/packages/").at(-1))).toEqual(["privacy/src/redactionGeometry.ts"]);
  });

  it("leaves the scorer with metrics only, importing its geometry from the canonical file", () => {
    const scorer = readFileSync(new URL("./redaction-metrics.mjs", import.meta.url), "utf8");
    expect(scorer).toMatch(/from "\.\.\/\.\.\/\.\.\/packages\/privacy\/src\/redactionGeometry\.ts"/);
    expect(scorer).not.toMatch(/\b(function|const)\s+(dilate|bounds|unionMask|coveredArea|clip|toRect)\b/);
  });
});

describe("the held-out set is still what was frozen (geometry, not characters)", () => {
  const fonts = new Set();
  const sizes = [];
  for (const image of heldOut.images) {
    for (const s of image.strings) {
      const m = /(\d+)px (.+)$/.exec(s.font);
      sizes.push(Number(m[1]));
      fonts.add(m[2].replace(/"/g, ""));
    }
  }

  it("keeps its size: 6 images, 20 sensitive strings, 306 sensitive glyphs, 43 non-sensitive strings", () => {
    expect(heldOut.totals).toEqual({ images: 6, strings: 63, sensitiveStrings: 20, sensitiveGlyphs: 306, nonSensitiveStrings: 43 });
    const sensitive = heldOut.images.flatMap((i) => i.strings.filter((s) => s.sensitive));
    expect(sensitive).toHaveLength(20);
    expect(sensitive.reduce((n, s) => n + s.glyphs.length, 0)).toBe(306);
  });

  it("keeps five fonts and 11-30 px", () => {
    expect([...fonts].sort()).toEqual(["Arial", "Consolas", "Courier New", "Georgia", "Verdana"]);
    expect(Math.min(...sizes)).toBe(11);
    expect(Math.max(...sizes)).toBe(30);
  });

  it("has no sensitive glyph overlapping a glyph of any OTHER string", () => {
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const image of heldOut.images) {
      const glyphs = image.strings.filter((s) => s.sensitive).flatMap((s) => s.glyphs.map((g) => ({ id: s.id, g })));
      for (let i = 0; i < glyphs.length; i += 1)
        for (let j = i + 1; j < glyphs.length; j += 1)
          if (glyphs[i].id !== glyphs[j].id) expect(ov(glyphs[i].g, glyphs[j].g), `${glyphs[i].id} / ${glyphs[j].id}`).toBe(false);
    }
  });

  it("overlaps WITHIN a string only between adjacent characters, by at most 2.1 px — as measured, not repaired", () => {
    // Chrome reports each character's ink extent rounded outward, so neighbouring glyph boxes touch or
    // overlap slightly: 135 adjacent pairs, median 0.56 px, max 2.06 px. RE-1 scores each glyph on its
    // own, so this cannot change a G1 verdict; it is recorded rather than edited out of frozen truth.
    for (const image of heldOut.images) {
      for (const s of image.strings.filter((x) => x.sensitive)) {
        for (let i = 0; i < s.glyphs.length; i += 1) {
          for (let j = i + 2; j < s.glyphs.length; j += 1) {
            const a = s.glyphs[i];
            const b = s.glyphs[j];
            expect(a.x + a.w <= b.x || b.x + b.w <= a.x, `${s.id} glyphs ${i}/${j}`).toBe(true);
          }
          if (i + 1 < s.glyphs.length) expect(s.glyphs[i].x + s.glyphs[i].w - s.glyphs[i + 1].x).toBeLessThan(2.1);
        }
      }
    }
  });

  it("keeps every ink box inside its line box plus the frozen 4 px", () => {
    const d = REDACTION_UNION.dilationPx;
    for (const image of heldOut.images)
      for (const s of image.strings) {
        expect(s.ink.x).toBeGreaterThanOrEqual(s.line.x - d);
        expect(s.ink.y).toBeGreaterThanOrEqual(s.line.y - d);
        expect(s.ink.x + s.ink.w).toBeLessThanOrEqual(s.line.x + s.line.w + d);
        expect(s.ink.y + s.ink.h).toBeLessThanOrEqual(s.line.y + s.line.h + d);
      }
  });

  it("contains no characters", () => {
    const raw = JSON.stringify(heldOut);
    for (const field of ['"text"', '"chars"', '"value"', '"label"']) expect(raw).not.toContain(field);
  });
});
