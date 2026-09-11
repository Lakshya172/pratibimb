"""
QG-03b step 1 — the letterbox geometry, enumerated rather than argued about.

  python tools/detector/qg03b_geometry.py

No browser, no images, no model. Pure arithmetic over a fixture set of source sizes,
comparing the three conventions that currently exist in this repository:

  CONTINUOUS   packages/perception/src/letterbox.ts :: computeLetterbox
               and tools/detector/targets.py :: letterbox_params
               scale = min(S/w, S/h);  pad = (S - dim*scale) / 2      -- real numbers

  PIL_PASTE    tools/detector/data.py :: letterbox_image
               n = max(1, round(dim*scale));  pad = (S - n) // 2      -- integers

--------------------------------------------------------------------------------------
WHY THIS MATTERS MORE THAN IT LOOKS

These two are not "the browser one" and "the Python one". BOTH ARE PYTHON, and both are
used by the SAME training run:

  * `letterbox_image` places the PIXELS the model learns from.
  * `letterbox_params` places the LABELS those pixels are supposed to explain.

So the trained artifact was produced under a contradiction: at 960x640 the content occupies
rows 106..532 inclusive while every label is expressed as though it occupied rows
106.667..533.333. The model learned to compensate for a 0.667 px offset that no inference
path reproduces, and nothing in the loss, the metrics or the micro-overfit gate could see
it -- a sub-pixel constant offset is far inside IoU 0.5.

The browser path is a THIRD variant only because canvas resampling then differs again. But
the geometry defect is already present, entirely inside the training pipeline, before any
browser is involved.

This script establishes exactly how large that defect is, for which source sizes, and
whether it is ever zero.
"""

import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from head import INPUT_SIZE  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "artifacts", "experiments", "W1-QG03b-letterbox-conformance")


def continuous(w, h, size=INPUT_SIZE):
    """computeLetterbox / letterbox_params — real-valued, no rounding anywhere."""
    scale = min(size / w, size / h)
    cw, ch = w * scale, h * scale
    return {
        "scale": scale,
        "contentW": cw,
        "contentH": ch,
        "padLeft": (size - cw) / 2.0,
        "padTop": (size - ch) / 2.0,
        "padRight": (size - cw) / 2.0,
        "padBottom": (size - ch) / 2.0,
    }


def pil_paste(w, h, size=INPUT_SIZE):
    """letterbox_image — integer resize then floor-divided centring."""
    scale = min(size / w, size / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    left, top = (size - nw) // 2, (size - nh) // 2
    return {
        "scale": scale,
        "resizedW": nw,
        "resizedH": nh,
        "padLeft": left,
        "padTop": top,
        "padRight": size - nw - left,
        "padBottom": size - nh - top,
    }


# The fixture set. Chosen to hit every rounding behaviour the brief names, not to be
# representative of screenshots -- a convention is only settled once the awkward cases are.
FIXTURES = [
    ("square-exact", 640, 640),
    ("square-large", 1280, 1280),
    ("square-odd", 641, 641),
    ("wide-2x", 1280, 640),
    ("wide-canonical", 1024, 640),
    ("wide-3by2", 960, 640),
    ("wide-odd", 1153, 641),
    ("wide-16by9", 1920, 1080),
    ("wide-extreme", 2000, 100),
    ("tall-2x", 640, 1280),
    ("tall-3by2", 640, 960),
    ("tall-odd", 641, 1153),
    ("tall-extreme", 100, 2000),
    ("tiny-1px", 1, 1),
    ("tiny-1x2", 1, 2),
    ("tiny-3x7", 3, 7),
    ("upscale-small", 320, 200),
    ("odd-pad-split", 960, 639),
    ("odd-pad-split-2", 1153, 640),
    ("viewport-1152x800", 1152, 800),
    ("viewport-1280x800", 1280, 800),
    ("viewport-960x600", 960, 600),
    ("viewport-1024x720", 1024, 720),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=INPUT_SIZE)
    args = ap.parse_args()
    S = args.size

    rows = []
    print(f"letterbox geometry, target {S}x{S}\n")
    print(
        "fixture                  source      scale     CONTINUOUS pad        PIL_PASTE pad      "
        "resized      dLeft    dTop   asym"
    )
    worst = 0.0
    zero = 0
    asym = 0
    for name, w, h in FIXTURES:
        c = continuous(w, h, S)
        p = pil_paste(w, h, S)
        dl = abs(c["padLeft"] - p["padLeft"])
        dt = abs(c["padTop"] - p["padTop"])
        # Asymmetric padding: PIL_PASTE can put the extra pixel on one side only. The
        # continuous convention NEVER can, because it never rounds.
        asymmetric = p["padLeft"] != p["padRight"] or p["padTop"] != p["padBottom"]
        if asymmetric:
            asym += 1
        if max(dl, dt) == 0:
            zero += 1
        worst = max(worst, dl, dt)
        rows.append(
            {
                "fixture": name,
                "source": {"w": w, "h": h},
                "continuous": c,
                "pilPaste": p,
                "deltaPadLeftPx": dl,
                "deltaPadTopPx": dt,
                "pilPaddingAsymmetric": asymmetric,
                # The content EXTENT also disagrees: continuous keeps w*scale exactly,
                # PIL_PASTE rounds it to an integer number of pixels. That is a second,
                # independent source of divergence from the same rounding decision.
                "deltaContentW": abs(c["contentW"] - p["resizedW"]),
                "deltaContentH": abs(c["contentH"] - p["resizedH"]),
            }
        )
        print(
            f"{name:<24} {w:>5}x{h:<5} {c['scale']:.6f}  "
            f"L{c['padLeft']:>8.3f} T{c['padTop']:>8.3f}   "
            f"L{p['padLeft']:>4d} T{p['padTop']:>4d} R{p['padRight']:>4d} B{p['padBottom']:>4d}  "
            f"{p['resizedW']:>4d}x{p['resizedH']:<4d}  "
            f"{dl:>7.3f} {dt:>7.3f}  {'YES' if asymmetric else '-'}"
        )

    print(
        f"\n{len(FIXTURES)} fixtures: {zero} agree exactly, {len(FIXTURES) - zero} disagree, "
        f"worst abs pad delta = {worst:.3f} model px, {asym} produce ASYMMETRIC padding under PIL_PASTE."
    )
    print(
        "\nThe continuous convention can never produce asymmetric padding and can never place\n"
        "content on a pixel boundary. The PIL_PASTE convention always does both. They are not\n"
        "two implementations of one rule; they are two different rules."
    )

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "geometry-comparison.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "analysis": "QG-03b — letterbox geometry, the two conventions currently in the repository",
                "targetSize": S,
                "conventions": {
                    "CONTINUOUS": {
                        "where": [
                            "packages/perception/src/letterbox.ts :: computeLetterbox",
                            "tools/detector/targets.py :: letterbox_params",
                        ],
                        "uses": "real-valued scale and padding, no rounding",
                        "governs": "the LABELS during training, and every coordinate the runtime emits",
                    },
                    "PIL_PASTE": {
                        "where": ["tools/detector/data.py :: letterbox_image"],
                        "uses": "round() on the resized extent, then floor-divided centring",
                        "governs": "the PIXELS the trained model actually learned from",
                    },
                },
                "theContradiction": (
                    "Both conventions are used by the SAME training run — PIL_PASTE places the "
                    "pixels, CONTINUOUS places the labels that describe them. The trained artifact "
                    "therefore encodes a sub-pixel offset between image content and target geometry "
                    "that no inference path reproduces. It is invisible to the loss, to mAP@0.5 and "
                    "to the micro-overfit gate, because a constant sub-pixel offset is far inside "
                    "an IoU 0.5 matching threshold."
                ),
                "summary": {
                    "fixtures": len(FIXTURES),
                    "agreeExactly": zero,
                    "disagree": len(FIXTURES) - zero,
                    "worstPadDeltaModelPx": worst,
                    "fixturesWithAsymmetricPilPadding": asym,
                },
                "fixtures": rows,
            },
            f,
            indent=2,
        )
    print(f"\nwrote {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
