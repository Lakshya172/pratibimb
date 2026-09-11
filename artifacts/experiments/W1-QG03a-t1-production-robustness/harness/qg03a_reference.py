"""
QG-03a-A — Pillow reference rasters for the production PNG path.

  python artifacts/experiments/W1-QG03a-t1-production-robustness/harness/qg03a_reference.py

The script builds two fixture sets against a single reference.

  HISTORICAL  The 13 procedural QG-03b fixtures, regenerated from their committed seed.
              Their stage digests must equal the committed ones in
              W1-QG03b-letterbox-conformance/fixtures.json. That proves this reference is
              the one QG-03b used. The two real rendered frames in that set need the
              gitignored dataset and are not regenerated.
  HOSTILE     New sizes and content chosen for QG-03a: exact-half extents, one-pixel
              padding asymmetry, extreme aspect ratios, up- and down-scaling, thin strokes,
              text-like glyphs, tiny objects flush with the frame edge, and gradients.

The reference functions are the UNMODIFIED ones in tools/detector/qg03b_fixtures.py
(make_image, pil_stages, mulberry32). That module imports tools/detector/head.py, and head.py
imports torch. These functions never use torch, and torch is not installed on workstation 2.
A stub `head` module supplies the only two constants they read, copied from head.py:
INPUT_SIZE = 640 and PAD_VALUE = 114/255. The HISTORICAL digest check proves the stub changes
nothing.

Pixel dumps go to harness/generated/ (gitignored). Only reference.json is committed.
"""
import hashlib
import json
import os
import sys
import types

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "detector"))

_head = types.ModuleType("head")
_head.INPUT_SIZE = 640  # tools/detector/head.py:44
_head.PAD_VALUE = 114.0 / 255.0  # tools/detector/head.py:55
sys.modules["head"] = _head

import qg03b_fixtures as ref  # noqa: E402

S = 640
GEN = os.path.join(HERE, "generated")
OUT = os.path.join(HERE, "reference.json")
QG03B = os.path.join(ROOT, "artifacts", "experiments", "W1-QG03b-letterbox-conformance", "fixtures.json")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def exact_half(w, h):
    """Does either resized extent land EXACTLY on .5, in the float arithmetic round() sees?"""
    s = min(S / w, S / h)
    return {"w": (w * s) % 1 == 0.5, "h": (h * s) % 1 == 0.5}


def ui_like(w, h, seed):
    """Production-like hostile content: gradients, text-like strokes, tiny controls at the edges."""
    rnd = ref.mulberry32(seed)
    ys, xs = np.mgrid[0:h, 0:w]
    a = np.zeros((h, w, 3), dtype=np.uint8)
    a[..., 0] = (xs * 255 // max(1, w - 1)).astype(np.uint8)
    a[..., 1] = (ys * 255 // max(1, h - 1)).astype(np.uint8)
    a[..., 2] = 200
    # Text-like rows: short 1-2 px strokes at a text-ish pitch.
    for row in range(8, max(8, h - 8), 18):
        x = 6
        while x < w - 10:
            gw = 1 + int(rnd() * 6)
            thick = 1 + int(rnd() * 2)
            a[row : row + 9, x : x + thick] = 20
            a[row + int(rnd() * 8), x : x + gw] = 20
            x += gw + 2 + int(rnd() * 3)
    # Tiny controls, deliberately flush with every edge of the frame.
    for k in range(24):
        sz = 3 + int(rnd() * 10)
        cx = int(rnd() * max(1, w - sz))
        cy = int(rnd() * max(1, h - sz))
        if k % 4 == 0:
            cx = 0
        if k % 4 == 1:
            cx = max(0, w - sz)
        if k % 4 == 2:
            cy = 0
        if k % 4 == 3:
            cy = max(0, h - sz)
        a[cy : cy + sz, cx : cx + sz] = [int(rnd() * 256), 255, 0]
        a[cy : cy + sz, cx : cx + 1] = 0
    # A one-pixel diagonal: the other content that resamplers disagree on.
    n = min(w, h)
    a[np.arange(n), np.arange(n)] = 255
    return Image.fromarray(a, "RGB")


# (name, w, h, content). Each size is chosen for the failure it targets, not for coverage.
HOSTILE = [
    # Exact-half extents where Python round() (half to even) and JS Math.round (half up) differ.
    ("tie-1280x641", 1280, 641, "grid"),
    ("tie-1280x721", 1280, 721, "ui"),
    ("tie-1024x644", 1024, 644, "ui"),
    ("tie-2560x1442", 2560, 1442, "grid"),
    ("tie-641x1280", 641, 1280, "grid"),
    ("tie-1280x5", 1280, 5, "grid"),
    # Exact-half extents where both rules agree, because the lower integer is odd.
    ("tie-agree-1024x652", 1024, 652, "ui"),
    ("tie-agree-1280x3", 1280, 3, "grid"),
    # Common real capture sizes.
    ("cap-1366x768", 1366, 768, "ui"),
    ("cap-1536x864", 1536, 864, "ui"),
    ("cap-1920x1080", 1920, 1080, "ui"),
    ("cap-1264x800", 1264, 800, "ui"),
    ("cap-1440x900", 1440, 900, "grid"),
    ("cap-2560x1600", 2560, 1600, "ui"),
    ("cap-390x844", 390, 844, "ui"),
    ("cap-3840x2160", 3840, 2160, "grid"),
    # One-pixel padding asymmetry, odd and even.
    ("asym-639x641", 639, 641, "grid"),
    ("asym-641x639", 641, 639, "grid"),
    ("asym-1153x640", 1153, 640, "ui"),
    ("asym-1151x641", 1151, 641, "grid"),
    # Extreme aspect ratios and degenerate strips.
    ("aspect-4000x100", 4000, 100, "grid"),
    ("aspect-100x4000", 100, 4000, "grid"),
    ("strip-640x1", 640, 1, "grid"),
    ("strip-1x640", 1, 640, "grid"),
    ("tiny-7x3", 7, 3, "grid"),
    # Upscaling.
    ("up-320x200", 320, 200, "ui"),
    ("up-333x111", 333, 111, "grid"),
]


def emit(name, img, extra):
    png_path = os.path.join(GEN, f"{name}.png")
    img.save(png_path, "PNG", optimize=False)
    png_bytes = open(png_path, "rb").read()
    # Stages are computed from the DECODED PNG, the same bytes the browser will decode.
    decoded_img = Image.open(png_path)
    decoded_img.load()
    s = ref.pil_stages(decoded_img)
    for key in ("decoded", "resized", "letterboxed"):
        open(os.path.join(GEN, f"{name}.{key}.u8"), "wb").write(s[key].tobytes())
    w, h = decoded_img.size
    return {
        "name": name,
        **extra,
        "source": {"w": w, "h": h},
        "pngBytes": len(png_bytes),
        "pngSha256": sha(png_bytes),
        "exactHalf": exact_half(w, h),
        "geometry": {
            k: int(s[k]) for k in ("resizedW", "resizedH", "padLeft", "padTop", "padRight", "padBottom", "padByte")
        },
        "digests": {
            "decoded": sha(s["decoded"].tobytes()),
            "resized": sha(s["resized"].tobytes()),
            "letterboxed": sha(s["letterboxed"].tobytes()),
            "tensor": sha(s["tensor"].astype("<f4").tobytes()),
        },
    }


def main():
    os.makedirs(GEN, exist_ok=True)
    with open(QG03B, "r", encoding="utf-8") as f:
        committed = json.load(f)
    by_name = {f["name"]: f for f in committed["fixtures"]}

    fixtures, hist_ok = [], 0
    for i, (name, w, h) in enumerate(ref.FIXTURES):
        img = ref.make_image(name, w, h, committed["seed"] + i * 1013)
        e = emit(f"hist-{name}", img, {"set": "HISTORICAL", "historicalName": name})
        e["matchesCommittedQG03b"] = e["digests"] == by_name[name]["digests"]
        hist_ok += int(e["matchesCommittedQG03b"])
        fixtures.append(e)
        print(f"HISTORICAL {name:<20} matches committed QG-03b digests: {e['matchesCommittedQG03b']}")

    for j, (name, w, h, content) in enumerate(HOSTILE):
        seed = 20260911 + 7919 * (j + 1)
        img = ref.make_image(name, w, h, seed) if content == "grid" else ui_like(w, h, seed)
        e = emit(name, img, {"set": "HOSTILE", "content": content, "seed": seed})
        fixtures.append(e)
        g = e["geometry"]
        print(f"HOSTILE    {name:<20} {w}x{h} -> {g['resizedW']}x{g['resizedH']} pad L{g['padLeft']} T{g['padTop']}  exactHalf={e['exactHalf']}")

    out = {
        "experiment": "W1-QG03a-t1-production-robustness / A (preprocessing)",
        "reference": {
            "library": f"Pillow {Image.__version__}",
            "numpy": np.__version__,
            "python": sys.version.split()[0],
            "functions": "tools/detector/qg03b_fixtures.py :: make_image, pil_stages, mulberry32 (unmodified)",
            "rounding": "Python built-in round() on the resized extent (half to EVEN), exactly as tools/detector/data.py",
            "inputSize": S,
            "padByte": 114,
        },
        "historicalCheck": {"fixtures": len(ref.FIXTURES), "matchCommittedDigests": hist_ok},
        "fixtures": fixtures,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print(f"\nhistorical digests reproduced: {hist_ok}/{len(ref.FIXTURES)}")
    print(f"wrote {os.path.relpath(OUT, ROOT)} ({len(fixtures)} fixtures) and pixel dumps to generated/")


if __name__ == "__main__":
    main()
