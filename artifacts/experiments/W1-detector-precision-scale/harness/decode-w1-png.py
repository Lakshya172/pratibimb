"""
W-1 — decode the rendered PNGs to raw RGBA with Pillow.

  python artifacts/experiments/W1-detector-precision-scale/harness/decode-w1-png.py

Why Pillow and not the browser: QG-03b and QG-03b-2 measured browser PNG decode against Pillow's
on real captures and found them **bitwise identical** (max abs 0), so either decoder is the same
bytes, and Pillow keeps this stage out of the browser entirely. The shipped preprocessing then runs
on these RGBA bytes in Node, which is the stage W-1 is actually about.

Refuses, rather than guessing, when: a frame is missing, its pixel size is not the sample's
captureSize, or the decoded buffer is not exactly w*h*4 bytes.
"""
import glob
import hashlib
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generated")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    manifests = sorted(glob.glob(os.path.join(GEN, "*", "manifest.json")))
    if not manifests:
        sys.stderr.write(f"no manifests under {GEN} - run render-arm-b.mjs or build-dataset first\n")
        sys.exit(2)
    total = 0
    for mpath in manifests:
        cell_dir = os.path.dirname(mpath)
        cell = os.path.basename(cell_dir)
        ds = json.load(open(mpath, encoding="utf-8"))
        out_dir = os.path.join(cell_dir, "rgba")
        os.makedirs(out_dir, exist_ok=True)
        rows = []
        # dev only: the train/test rows are unrendered placeholders that exist solely to satisfy
        # the frozen validator's non-empty-split rule, and they are never evidence.
        for s in [x for x in ds["samples"] if x["split"] == "dev"]:
            frame = os.path.join(cell_dir, s["framePath"])
            if not os.path.exists(frame):
                sys.stderr.write(f"{s['id']}: missing frame {frame}\n")
                sys.exit(3)
            png = open(frame, "rb").read()
            img = Image.open(frame)
            img.load()
            cap = s["captureSize"]
            if img.size != (cap["w"], cap["h"]):
                sys.stderr.write(f"{s['id']}: frame is {img.size[0]}x{img.size[1]}, captureSize says {cap['w']}x{cap['h']}\n")
                sys.exit(4)
            rgba = img.convert("RGBA").tobytes()
            expected = cap["w"] * cap["h"] * 4
            if len(rgba) != expected:
                sys.stderr.write(f"{s['id']}: decoded {len(rgba)} bytes, expected {expected}\n")
                sys.exit(5)
            open(os.path.join(out_dir, f"{s['id']}.rgba"), "wb").write(rgba)
            rows.append({
                "id": s["id"],
                "w": cap["w"],
                "h": cap["h"],
                "pngBytes": len(png),
                "pngSha256": sha(png),
                "rgbaBytes": len(rgba),
                "rgbaSha256": sha(rgba),
            })
            total += 1
        json.dump(
            {
                "cell": cell,
                "decoder": f"Pillow {Image.__version__}",
                "python": sys.version.split()[0],
                "datasetName": ds["name"],
                "datasetHash": ds["hash"],
                "samples": rows,
            },
            open(os.path.join(cell_dir, "decode.json"), "w", encoding="utf-8"),
            indent=1,
        )
        print(f"{cell}: decoded {len(rows)} frames ({ds['name']}@{ds['hash']})")
    print(f"decoded {total} frames with Pillow {Image.__version__}")


if __name__ == "__main__":
    main()
