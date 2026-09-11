"""
QG-03b step 2 — deterministic image fixtures, and the Python reference at EVERY STAGE.

  python tools/detector/qg03b_fixtures.py

The QG-03 preprocessing measurement compared final tensors and final boxes. That told us
they disagreed; it could not tell us WHERE. A difference introduced by PNG decoding, by the
resize kernel, by padding placement and by normalisation all look identical at the end.

So this emits the reference at each stage, and the conformance harness compares them one at
a time:

  0  source PNG                    bytes
  1  decoded RGB                   uint8, HxWx3      -- isolates PNG decoding
  2  resized RGB                   uint8, nh x nw x3 -- isolates the resampling kernel
  3  letterboxed RGB               uint8, 640x640x3  -- isolates padding placement
  4  normalised tensor             float32, NCHW     -- isolates channel order and /255

Stage 1 is why the browser is handed raw pixels for the later comparisons: if decoding
already diverges, every later stage inherits it and "the resize is wrong" would be a wrong
diagnosis.

The images are generated from a seeded PRNG with hard structure -- 1px lines, sharp edges,
high-frequency checkerboards -- because a smooth gradient is exactly the image on which two
different resampling kernels agree. The fixtures are chosen to make disagreement visible,
not to look realistic.
"""

import argparse
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from head import INPUT_SIZE, PAD_VALUE  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXP = os.path.join(ROOT, "artifacts", "experiments", "W1-QG03b-letterbox-conformance")
GEN = os.path.join(EXP, "harness", "generated")

# (name, w, h) — the geometry cases from qg03b_geometry.py that actually matter for pixels,
# plus the sizes the training set uses. Kept small enough to inline into an extension.
FIXTURES = [
    ("square-exact", 640, 640),
    ("square-odd", 641, 641),
    ("wide-2x", 1280, 640),
    ("wide-canonical", 1024, 640),
    ("wide-3by2", 960, 640),
    ("wide-odd", 1153, 641),
    ("tall-3by2", 640, 960),
    ("tall-odd", 641, 1153),
    ("tiny-1px", 1, 1),
    ("tiny-3x7", 3, 7),
    ("upscale-small", 320, 200),
    ("odd-pad-split-2", 1153, 640),
    ("viewport-1152x800", 1152, 800),
]


def mulberry32(seed):
    """The same PRNG the evaluation generator uses, so a fixture is reproducible in JS too."""
    state = seed & 0xFFFFFFFF

    def rnd():
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        t &= 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return rnd


def make_image(name, w, h, seed):
    """
    Hard structure on purpose.

    A resampling difference is invisible on a smooth gradient and glaring on a 1px line.
    Since the question is whether two kernels agree, the fixtures are built from the content
    that separates them: single-pixel rules, sharp colour steps, and a checkerboard at the
    Nyquist limit.
    """
    rnd = mulberry32(seed)
    a = np.zeros((h, w, 3), dtype=np.uint8)

    # Base: coarse colour blocks, so large areas differ and the eye can locate an offset.
    bw = max(1, w // 8)
    bh = max(1, h // 8)
    for by in range(0, h, bh):
        for bx in range(0, w, bw):
            a[by : by + bh, bx : bx + bw] = [int(rnd() * 256), int(rnd() * 256), int(rnd() * 256)]

    # 1px horizontal and vertical rules — the highest-frequency content a resize can meet.
    for y in range(0, h, max(1, h // 11)):
        a[y : y + 1, :] = 255
    for x in range(0, w, max(1, w // 13)):
        a[:, x : x + 1] = 0

    # Nyquist checkerboard in one quadrant: adjacent pixels alternate.
    qh, qw = h // 2, w // 2
    if qh > 0 and qw > 0:
        ys, xs = np.mgrid[0:qh, 0:qw]
        a[0:qh, 0:qw][(ys + xs) % 2 == 0] = 255
        a[0:qh, 0:qw][(ys + xs) % 2 == 1] = 0

    # Exact corner markers, so an off-by-one in placement is unambiguous rather than subtle.
    a[0, 0] = [255, 0, 0]
    if h > 1 and w > 1:
        a[0, w - 1] = [0, 255, 0]
        a[h - 1, 0] = [0, 0, 255]
        a[h - 1, w - 1] = [255, 255, 0]
    return Image.fromarray(a, "RGB")


def pil_stages(img, size=INPUT_SIZE):
    """The reference pipeline, stage by stage — identical arithmetic to data.py."""
    w, h = img.size
    scale = min(size / w, size / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))

    decoded = np.asarray(img.convert("RGB"), dtype=np.uint8)
    resized_img = img.convert("RGB").resize((nw, nh), Image.BILINEAR)
    resized = np.asarray(resized_img, dtype=np.uint8)

    pad = int(round(PAD_VALUE * 255))
    canvas = Image.new("RGB", (size, size), (pad, pad, pad))
    left, top = (size - nw) // 2, (size - nh) // 2
    canvas.paste(resized_img, (left, top))
    letterboxed = np.asarray(canvas, dtype=np.uint8)

    tensor = (letterboxed.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
    return {
        "scale": scale,
        "resizedW": nw,
        "resizedH": nh,
        "padLeft": left,
        "padTop": top,
        "padRight": size - nw - left,
        "padBottom": size - nh - top,
        "padByte": pad,
        "decoded": decoded,
        "resized": resized,
        "letterboxed": letterboxed,
        "tensor": np.ascontiguousarray(tensor),
    }


def sha(b):
    return hashlib.sha256(b).hexdigest()


def real_frames(ids):
    """
    Real rendered dataset frames, alongside the synthetic ones.

    The synthetic fixtures are built to BREAK resamplers. These are built to be typical.
    Both are needed: passing only on hostile input would be surprising, and passing only on
    typical input would prove nothing about the cases that actually diverge.

    They also make the browser conformance measurement a PRODUCTION-PATH measurement — a
    real PNG the capture pipeline could have produced, decoded by the browser itself.
    """
    manifest_path = os.path.join(ROOT, "artifacts", "datasets", "t1-ui-v1", "manifest.json")
    if not os.path.exists(manifest_path):
        return []
    with open(manifest_path, "r", encoding="utf-8") as f:
        m = json.load(f)
    by_id = {s["id"]: s for s in m["samples"]}
    out = []
    for sid in ids:
        if sid not in by_id:
            continue
        s = by_id[sid]
        path = os.path.join(ROOT, "artifacts", "datasets", "t1-ui-v1", s["framePath"])
        if not os.path.exists(path):
            continue
        out.append((f"real-{sid}", Image.open(path).convert("RGB"), s))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20260911)
    ap.add_argument("--dev-samples", default="dev-0000,dev-0003")
    args = ap.parse_args()
    os.makedirs(GEN, exist_ok=True)

    manifest = []
    print("fixture                source     resized    pad(L,T,R,B)      stage digests")
    for i, (name, w, h) in enumerate(FIXTURES):
        img = make_image(name, w, h, args.seed + i * 1013)
        png_path = os.path.join(GEN, f"{name}.png")
        img.save(png_path, "PNG", optimize=False)
        png_bytes = open(png_path, "rb").read()

        s = pil_stages(img)
        for key, arr in (("decoded", s["decoded"]), ("resized", s["resized"]), ("letterboxed", s["letterboxed"])):
            open(os.path.join(GEN, f"{name}.{key}.u8"), "wb").write(arr.tobytes())
        open(os.path.join(GEN, f"{name}.tensor.f32"), "wb").write(s["tensor"].astype("<f4").tobytes())

        entry = {
            "name": name,
            "procedural": True,
            "source": {"w": w, "h": h},
            "pngBytes": len(png_bytes),
            "pngSha256": sha(png_bytes),
            "geometry": {
                "scale": s["scale"],
                "resizedW": s["resizedW"],
                "resizedH": s["resizedH"],
                "padLeft": s["padLeft"],
                "padTop": s["padTop"],
                "padRight": s["padRight"],
                "padBottom": s["padBottom"],
                "padByte": s["padByte"],
            },
            "digests": {
                "decoded": sha(s["decoded"].tobytes()),
                "resized": sha(s["resized"].tobytes()),
                "letterboxed": sha(s["letterboxed"].tobytes()),
                "tensor": sha(s["tensor"].astype("<f4").tobytes()),
            },
        }
        manifest.append(entry)
        print(
            f"{name:<22} {w:>4}x{h:<5} {s['resizedW']:>4}x{s['resizedH']:<5} "
            f"({s['padLeft']},{s['padTop']},{s['padRight']},{s['padBottom']})".ljust(62)
            + entry["digests"]["letterboxed"][:12]
        )

    # ---- real rendered frames, appended after the synthetic set -----------------------
    reals = real_frames([x.strip() for x in args.dev_samples.split(",") if x.strip()])
    for name, img, sample in reals:
        w, h = img.size
        png_path = os.path.join(GEN, f"{name}.png")
        img.save(png_path, "PNG", optimize=False)
        png_bytes = open(png_path, "rb").read()
        s = pil_stages(img)
        for key, arr in (("decoded", s["decoded"]), ("resized", s["resized"]), ("letterboxed", s["letterboxed"])):
            open(os.path.join(GEN, f"{name}.{key}.u8"), "wb").write(arr.tobytes())
        open(os.path.join(GEN, f"{name}.tensor.f32"), "wb").write(s["tensor"].astype("<f4").tobytes())
        manifest.append(
            {
                "name": name,
                "procedural": False,
                "sampleId": sample["id"],
                "framePath": sample["framePath"],
                "viewportCss": sample["viewportCss"],
                "captureSize": sample["captureSize"],
                "source": {"w": w, "h": h},
                "pngBytes": len(png_bytes),
                "pngSha256": sha(png_bytes),
                "geometry": {
                    "scale": s["scale"],
                    "resizedW": s["resizedW"],
                    "resizedH": s["resizedH"],
                    "padLeft": s["padLeft"],
                    "padTop": s["padTop"],
                    "padRight": s["padRight"],
                    "padBottom": s["padBottom"],
                    "padByte": s["padByte"],
                },
                "digests": {
                    "decoded": sha(s["decoded"].tobytes()),
                    "resized": sha(s["resized"].tobytes()),
                    "letterboxed": sha(s["letterboxed"].tobytes()),
                    "tensor": sha(s["tensor"].astype("<f4").tobytes()),
                },
            }
        )
        print(f"{name:<22} {w:>4}x{h:<5} {s['resizedW']:>4}x{s['resizedH']:<5} (real frame)")

    out = {
        "fixtures": manifest,
        "seed": args.seed,
        "reference": {
            "library": f"Pillow {Image.__version__}",
            "resample": "Image.BILINEAR via Image.resize",
            "padValue": PAD_VALUE,
            "padByte": int(round(PAD_VALUE * 255)),
            "inputSize": INPUT_SIZE,
            "note": "stage-by-stage reference for the browser conformance harness",
        },
    }
    path = os.path.join(EXP, "fixtures.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"\nwrote {os.path.relpath(path, ROOT)} and {len(FIXTURES)} fixtures to generated/")


if __name__ == "__main__":
    main()
