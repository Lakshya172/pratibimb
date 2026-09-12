"""
Track B — apply the APPR family's detail degradation, in image space.

  python artifacts/experiments/W1-TrackB-geometry-appearance/harness/apply-appearance.py

Why this is a separate step and not something the browser does: the appearance manipulation has
to be auditable. Done here it is a pure, deterministic function of bytes already on disk -- the
frame before and the frame after both exist, the transform is one line, and anyone can recompute
it. Done inside the renderer it would be entangled with layout, rasterisation and screenshot
timing, and "what exactly was degraded" would be a claim rather than a file.

THE TRANSFORM. Downsample to round(base/k) and straight back up to the base size, BILINEAR in
both directions. BILINEAR because it is the production resampler -- the preprocessing contract's
kernel -- so the detail that survives is the detail the shipped pipeline would have kept.

WHAT IT DOES NOT TOUCH. The image is the same size afterwards, so every annotation, the capture
size, the letterbox geometry and the model-space extent are all unchanged. Only the pixels move.
That is the whole point of the family: geometry is held and appearance is destroyed.

k = 1.5 is the identity cell. round(960/1.5) = 640 and round(640/1.5) = 427, so it still makes a
round trip rather than being skipped -- the baseline carries the same resampling the other cells
carry, and any effect at k = 1.5 is the round trip's own cost rather than a missing control.
"""
import hashlib
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generated")

KERNELS = {"BILINEAR": Image.BILINEAR}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    cells = sorted(
        d for d in os.listdir(GEN)
        if os.path.isdir(os.path.join(GEN, d)) and os.path.exists(os.path.join(GEN, d, "cell.json"))
    )
    if not cells:
        sys.stderr.write(f"no rendered cells under {GEN} - run render-trackb.mjs first\n")
        sys.exit(2)

    touched = 0
    for cid in cells:
        cdir = os.path.join(GEN, cid)
        meta = json.load(open(os.path.join(cdir, "cell.json"), encoding="utf-8"))
        cell = meta["cell"]
        app = cell.get("appearance")
        if app is None:
            continue
        if meta.get("appearanceApplied"):
            sys.stderr.write(f"{cid}: appearance already applied - refusing to apply it twice\n")
            sys.exit(3)
        kernel = KERNELS.get(app["kernel"])
        if kernel is None:
            sys.stderr.write(f"{cid}: unknown kernel {app['kernel']}\n")
            sys.exit(4)

        ds = json.load(open(os.path.join(cdir, "manifest.json"), encoding="utf-8"))
        rows = []
        for s in [x for x in ds["samples"] if x["split"] == "dev"]:
            path = os.path.join(cdir, s["framePath"])
            if not os.path.exists(path):
                sys.stderr.write(f"{s['id']}: missing frame {path}\n")
                sys.exit(5)
            before = open(path, "rb").read()
            img = Image.open(path).convert("RGB")
            if (img.width, img.height) != (app["up"]["w"], app["up"]["h"]):
                sys.stderr.write(
                    f"{s['id']}: frame is {img.width}x{img.height}, the transform expects "
                    f"{app['up']['w']}x{app['up']['h']}\n"
                )
                sys.exit(6)
            small = img.resize((app["down"]["w"], app["down"]["h"]), kernel)
            back = small.resize((app["up"]["w"], app["up"]["h"]), kernel)
            back.save(path, format="PNG")
            after = open(path, "rb").read()
            rows.append({
                "id": s["id"],
                "shaBefore": sha(before),
                "shaAfter": sha(after),
                "changed": sha(before) != sha(after),
            })
            touched += 1

        meta["appearanceApplied"] = True
        meta["appearanceRows"] = rows
        json.dump(meta, open(os.path.join(cdir, "cell.json"), "w", encoding="utf-8"), indent=1)
        changed = sum(1 for r in rows if r["changed"])
        print(
            f"{cid}: {len(rows)} frames -> {app['down']['w']}x{app['down']['h']} -> "
            f"{app['up']['w']}x{app['up']['h']} ({app['kernel']}), {changed} changed"
        )

    print(f"\ntransformed {touched} frames")


if __name__ == "__main__":
    main()
