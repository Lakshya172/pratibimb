/**
 * QG-03a — T1 production-path robustness, pinned by test.
 *
 * Evidence: artifacts/experiments/W1-QG03a-t1-production-robustness/
 *
 * A — the raster geometry must equal the TRAINING pipeline's, including on exact-half
 *     extents, where Python's round() (half to even) and Math.round (half up) disagree.
 *     Expected values come from Pillow via qg03a_reference.py (reference.json), not from
 *     the code under test.
 * B — CHARACTERISATION of the shipped decode's near-tie behaviour. These tests pin what the
 *     decode DOES today, which is not what it should do, so that any future mitigation has
 *     to change them deliberately. They are not an endorsement.
 */
import { describe, it, expect } from "vitest";
import {
  rasterLetterbox,
  decodeHeadOutput,
  HEAD_CONTRACT,
  UI_CLASSES,
  type HeadOutput,
} from "@pratibimb/perception";

const S = HEAD_CONTRACT.inputSize;
const PAD = HEAD_CONTRACT.padValue;

describe("A — raster geometry equals the training pipeline's (Python round, half to even)", () => {
  // [w, h] -> [resizedW, resizedH, padLeft, padTop], from Pillow (reference.json).
  const EXACT_HALF: readonly [number, number, number, number, number, number][] = [
    [1280, 641, 640, 320, 0, 160],
    [1280, 721, 640, 360, 0, 140],
    [1024, 644, 640, 402, 0, 119],
    [2560, 1442, 640, 360, 0, 140],
    [641, 1280, 320, 640, 160, 0],
    [1280, 5, 640, 2, 0, 319],
    // Exact halves where half-up and half-even agree, because the lower integer is odd.
    [1024, 652, 640, 408, 0, 116],
    [1280, 3, 640, 2, 0, 319],
  ];

  it.each(EXACT_HALF)("exact-half extent %ix%i rasterises exactly as training did", (w, h, rw, rh, pl, pt) => {
    const t = rasterLetterbox({ w, h }, S, PAD);
    expect([t.resizedW, t.resizedH, t.padLeft, t.padTop]).toEqual([rw, rh, pl, pt]);
    // Padding still sums to S, with any extra pixel on the right/bottom.
    expect(t.padLeft + t.resizedW + t.padRight).toBe(S);
    expect(t.padTop + t.resizedH + t.padBottom).toBe(S);
    expect(t.padRight - t.padLeft).toBeGreaterThanOrEqual(0);
    expect(t.padBottom - t.padTop).toBeGreaterThanOrEqual(0);
  });

  it("every training-set capture size is unchanged by the rounding rule", () => {
    // The 16 viewport sizes makeSpec draws from at DPR 1. None of them lands on .5, which is
    // why the defect was invisible to training and to every previous conformance fixture.
    const TRAINING: readonly [number, number, number, number][] = [
      [960, 600, 400, 120], [960, 640, 427, 106], [960, 720, 480, 80], [960, 800, 533, 53],
      [1024, 600, 375, 132], [1024, 640, 400, 120], [1024, 720, 450, 95], [1024, 800, 500, 70],
      [1152, 600, 333, 153], [1152, 640, 356, 142], [1152, 720, 400, 120], [1152, 800, 444, 98],
      [1280, 600, 300, 170], [1280, 640, 320, 160], [1280, 720, 360, 140], [1280, 800, 400, 120],
    ];
    for (const [w, h, rh, pt] of TRAINING) {
      const t = rasterLetterbox({ w, h }, S, PAD);
      expect([t.resizedW, t.resizedH, t.padLeft, t.padTop], `${w}x${h}`).toEqual([640, rh, 0, pt]);
    }
  });

  it("extents are the nearest integer, and an exact .5 goes to the EVEN neighbour", () => {
    let ties = 0;
    for (let w = 1000; w <= 1400; w += 1) {
      for (const h of [641, 643, 644, 652, 720, 721, 799]) {
        const t = rasterLetterbox({ w, h }, S, PAD);
        const s = Math.min(S / w, S / h);
        for (const [dim, got] of [[w, t.resizedW], [h, t.resizedH]] as const) {
          const v = dim * s;
          const f = Math.floor(v);
          if (v - f === 0.5) {
            ties += 1;
            expect(got % 2, `${w}x${h}: ${v} must round to the even neighbour`).toBe(0);
            expect([f, f + 1]).toContain(got);
          } else {
            expect(got).toBe(Math.max(1, v - f < 0.5 ? f : f + 1));
          }
        }
      }
    }
    // The sweep must actually exercise ties, or it proves nothing about them.
    expect(ties).toBeGreaterThan(0);
  });
});

describe("B — CHARACTERISATION: the shipped decode is discontinuous at score near-ties", () => {
  const C = UI_CLASSES.length;
  /** Two 140x40 same-class boxes 40 model px apart (IoU 0.556): NMS keeps exactly one. */
  function pair(scoreB: number, f32: boolean): HeadOutput {
    const A = 2;
    const data = new Array<number>((4 + C) * A).fill(0.01);
    const put = (ch: number, a: number, v: number) => (data[ch * A + a] = v);
    [[200, 0.9], [240, scoreB]].forEach(([cx, s], a) => {
      put(0, a, cx!);
      put(1, a, 200);
      put(2, a, 140);
      put(3, a, 40);
      put(4, a, s!);
    });
    return { data: f32 ? Float32Array.from(data) : data, dims: [1, 4 + C, A] };
  }
  const survivorCx = (o: HeadOutput) => {
    const r = decodeHeadOutput(o);
    if (!r.ok) throw new Error(r.detail);
    expect(r.value).toHaveLength(1);
    return r.value[0]!.box.x + r.value[0]!.box.w / 2;
  };

  it("an EXACT tie is resolved by anchor index, so identical input gives identical output", () => {
    expect(survivorCx(pair(0.9, false))).toBe(200);
    expect(survivorCx(pair(0.9, false))).toBe(200);
  });

  it("any representable score difference swaps the survivor — 40 model px here (unresolved, QG-03a-B)", () => {
    expect(survivorCx(pair(0.9 + 1e-9, false))).toBe(240);
    expect(survivorCx(pair(0.9 - 1e-9, false))).toBe(200);
  });

  it("a float32 output cannot carry a difference below its rounding step, so the swap needs a visible one", () => {
    // Why the historical 1e-8 control "perturbed" nothing: float32 absorbed it.
    expect(survivorCx(pair(0.9 + 1e-9, true))).toBe(200);
    expect(survivorCx(pair(0.9 + 1e-7, true))).toBe(240);
  });

  it("the swapped survivor's centre lies inside the box it displaced (the click point stays on the element)", () => {
    const a = { x: 130, w: 140 };
    const bCentre = survivorCx(pair(0.9 + 1e-6, false));
    expect(bCentre).toBeGreaterThanOrEqual(a.x);
    expect(bCentre).toBeLessThanOrEqual(a.x + a.w);
  });
});

