"""
QG-03b-2 — conformance fixtures for the LOSSY capture formats.

  python tools/detector/qg03b2_fixtures.py

--------------------------------------------------------------------------------------
THE REFERENCE HAS TO BE DEFINED CORRECTLY OR THE WHOLE MEASUREMENT IS MEANINGLESS

JPEG is lossy. A JPEG-decoded tensor will never equal the original PNG's tensor, and
reporting that as a failure would be reporting that JPEG is JPEG.

So the reference is not the original image. It is:

    THE EXACT ENCODED BYTES, decoded by the reference decoder, preprocessed by the
    reference pipeline.

Both sides start from the same file -- its SHA-256 is recorded and checked on both sides --
so any difference that remains is DECODER IMPLEMENTATION VARIANCE and nothing else. That is
the only question worth asking about a lossy format.

The compression effect is measured too, separately, as `vsPngDecoded`. It is expected,
it is reported as data, and it is never a pass/fail.

--------------------------------------------------------------------------------------
WHAT PRODUCTION ACTUALLY CAPTURES, AND WHAT IT DOES NOT

  JPEG   REAL. `chrome.tabs.captureVisibleTab({format: "jpeg", quality})` produces it, and
         `TabsCaptureApi` in capture.ts declares exactly `png | jpeg`.

  WebP   NOT a capture format. The API cannot produce it. Every WebP reference in dossier
         v4.0 is the T2 EGRESS encoding -- "Encode WebP q62, then decode the bytes back"
         is the redaction verification pass, and "the encoded WebP frame and the serialized
         manifest" is the egress payload. T2 does not exist yet.

         It is measured here anyway, because `CaptureFrame.format` permits "webp" while the
         adapter cannot produce it -- an inconsistency worth closing with evidence rather
         than an assumption -- and because the T2 verification pass will eventually decode
         WebP bytes and will want this answer already on the shelf.

--------------------------------------------------------------------------------------
ENCODER SETTINGS ARE PINNED, AND THE ENCODED BYTES ARE HASHED

An encoder is part of the fixture. Pillow's JPEG defaults change subsampling by quality,
and a different libjpeg would produce different bytes for the same settings. So every knob
is explicit, and the digest of the encoded file is committed: if a future Pillow encodes
differently, the digest check fires and says so instead of quietly re-baselining.
"""

import argparse
import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image, features

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from head import INPUT_SIZE  # noqa: E402
from qg03b_fixtures import make_image, mulberry32, pil_stages  # noqa: E402
from qg03_reference import project_to_capture, shipped_decode  # noqa: E402
from targets import letterbox_params  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXP = os.path.join(ROOT, "artifacts", "experiments", "W1-QG03b2-capture-format-conformance")
GEN = os.path.join(EXP, "harness", "generated")

# ---- the pre-registered criterion, fixed BEFORE any browser was launched ---------------
#
# PNG reached bitwise equality, so for a LOSSLESS format the bar stays exactly that.
# For a LOSSY format bitwise equality across two independent decoders is not something
# the standards require, so a bound is needed -- and it is stated in advance rather than
# fitted to whatever the first run produced.
#
# PRIMARY, and what actually decides the classification: DETECTOR OUTPUT. A tensor bound is
# diagnostic; what matters is whether the detector says the same thing. If detections move,
# a tight tensor bound would be beside the point, and if detections do not move, a loose one
# is not a problem.
#
# SECONDARY, bounding the mechanism: if decoded pixels differ by more than a couple of
# levels, the explanation is NOT ordinary IDCT variance and a specific cause must be named --
# colour management, chroma upsampling, or alpha premultiplication. ITU-T T.83 holds a
# compliant JPEG decoder to a peak error of 1 against the reference IDCT, so 2 is one level
# of slack and anything beyond it is a different phenomenon.
CRITERION = {
    "preRegistered": True,
    "preRegisteredBefore": "any browser was launched for QG-03b-2",
    "lossless": {
        "decodedPixels": "BITWISE identical",
        "why": "PNG and lossless WebP are defined to reconstruct the source exactly; a difference is a defect, not variance.",
    },
    "lossy": {
        "geometryExact": True,
        "geometryWhy": "resize extent and padding are arithmetic on dimensions, not a codec question. No tolerance.",
        "decodedMaxAbs": 2,
        "decodedMeanAbs": 0.2,
        "units": "0..255 per channel",
        "why": (
            "ITU-T T.83 holds a compliant JPEG decoder to a peak error of 1 against the reference "
            "IDCT; 2 allows one level of slack. Exceeding it means the difference is not ordinary "
            "decoder variance and a specific cause must be named."
        ),
    },
    "detector": {
        "minMatchedAtIou50": 0.95,
        "maxCountDelta": 2,
        "maxCssDisplacementPx": 2.0,
        "why": "the primary criterion — a tensor bound that does not change what the detector says is diagnostic, not decisive",
    },
}

# ---- encodings. Every knob explicit; nothing left to a library default. ----------------
ENCODINGS = [
    # name,      params
    ("png", {"format": "PNG", "optimize": False}),
    ("jpeg-q95", {"format": "JPEG", "quality": 95, "subsampling": 0, "optimize": False, "progressive": False}),
    ("jpeg-q62", {"format": "JPEG", "quality": 62, "subsampling": 2, "optimize": False, "progressive": False}),
    ("webp-lossy-q62", {"format": "WEBP", "lossless": False, "quality": 62, "method": 4}),
    ("webp-lossless", {"format": "WEBP", "lossless": True, "quality": 100, "method": 4}),
]
LOSSLESS = {"png", "webp-lossless"}


def simple_image(w, h, seed):
    """Large flat regions and one soft edge. The easy case — where decoders should agree."""
    rnd = mulberry32(seed)
    a = np.zeros((h, w, 3), dtype=np.uint8)
    for i in range(4):
        c = [int(rnd() * 200) + 30 for _ in range(3)]
        a[(h * i) // 4 : (h * (i + 1)) // 4, :] = c
    a[:, : w // 3] = [240, 240, 245]
    return Image.fromarray(a, "RGB")


def small_controls_image(w, h, seed):
    """
    Checkbox- and radio-sized marks on a light ground.

    The classes the detector is worst at are the smallest ones, and chroma subsampling
    damages small saturated features most. If a format hurts anything, it should hurt here.
    """
    rnd = mulberry32(seed)
    a = np.full((h, w, 3), 248, dtype=np.uint8)
    for _ in range(40):
        s = 10 + int(rnd() * 8)
        x = int(rnd() * max(1, w - s - 2))
        y = int(rnd() * max(1, h - s - 2))
        a[y : y + s, x : x + s] = [40, 40, 45]
        if s > 4:
            a[y + 2 : y + s - 2, x + 2 : x + s - 2] = [255, 255, 255]
    return Image.fromarray(a, "RGB")


def text_edges_image(w, h, seed):
    """
    Dense 1px strokes at text-like spacing.

    High-frequency luma is exactly what a DCT discards first and what fancy chroma
    upsampling smears, so this is the fixture most likely to separate two decoders.
    """
    a = np.full((h, w, 3), 255, dtype=np.uint8)
    rnd = mulberry32(seed)
    y = 6
    while y < h - 8:
        x = 8
        while x < w - 12:
            run = 2 + int(rnd() * 9)
            for k in range(run):
                if x + k * 2 < w - 2:
                    a[y : y + 7, x + k * 2 : x + k * 2 + 1] = [20, 20, 24]
            x += run * 2 + 4 + int(rnd() * 8)
        y += 13
    return Image.fromarray(a, "RGB")


def alpha_image(w, h, seed):
    """
    RGBA with a semi-transparent band — the one case where the BROWSER pipeline is lossy.

    A canvas stores premultiplied colour; `getImageData` un-premultiplies it. That round trip
    cannot be exact for partially transparent pixels, so RGB values under alpha < 255 will
    move. Captures are opaque so this never arises in production — but "never arises" is a
    claim worth holding evidence for rather than an assumption worth relying on.
    """
    rnd = mulberry32(seed)
    a = np.zeros((h, w, 4), dtype=np.uint8)
    for by in range(0, h, max(1, h // 6)):
        c = [int(rnd() * 256) for _ in range(3)]
        a[by : by + max(1, h // 6), :, :3] = c
    a[:, :, 3] = 255
    a[h // 4 : h // 2, :, 3] = 128  # semi-transparent band
    a[h // 2 : 3 * h // 4, :, 3] = 8  # nearly transparent — worst case for the round trip
    return Image.fromarray(a, "RGBA")


SOURCES = [
    ("simple", 1024, 640, simple_image),
    ("hostile-wide", 960, 640, None),       # fractional letterbox: pad 106.667 vs 106
    ("hostile-tall", 640, 960, None),
    ("hostile-odd", 1153, 641, None),
    ("small-controls", 1024, 640, small_controls_image),
    ("text-edges", 1152, 800, text_edges_image),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def encode(img, params):
    p = dict(params)
    fmt = p.pop("format")
    buf = io.BytesIO()
    src = img
    if fmt == "JPEG" and src.mode != "RGB":
        src = src.convert("RGB")  # JPEG has no alpha channel at all
    # icc_profile is deliberately never set. A browser applies colour management from an
    # embedded profile and PIL does not, which would show up as a decoder difference while
    # actually being a colour-management difference.
    src.save(buf, format=fmt, **p)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20260912)
    ap.add_argument("--dev-samples", default="dev-0000,dev-0003")
    args = ap.parse_args()
    os.makedirs(GEN, exist_ok=True)

    sources = []
    for i, (name, w, h, fn) in enumerate(SOURCES):
        seed = args.seed + i * 1013
        img = fn(w, h, seed) if fn else make_image(name, w, h, seed)
        sources.append((name, img, None))
    sources.append(("alpha-rgba", alpha_image(960, 640, args.seed + 7001), None))

    # Real rendered UI frames — the "realistic UI fixture" case, and the only source whose
    # detections can be compared against a published reference.
    dpath = os.path.join(ROOT, "artifacts", "datasets", "t1-ui-v1", "manifest.json")
    if os.path.exists(dpath):
        with open(dpath, "r", encoding="utf-8") as f:
            m = json.load(f)
        by_id = {s["id"]: s for s in m["samples"]}
        for sid in [x.strip() for x in args.dev_samples.split(",") if x.strip()]:
            if sid in by_id:
                p = os.path.join(ROOT, "artifacts", "datasets", "t1-ui-v1", by_id[sid]["framePath"])
                if os.path.exists(p):
                    sources.append((f"real-{sid}", Image.open(p).convert("RGB"), by_id[sid]))

    # The ONNX session is optional: the conformance measurement needs no model, and the
    # artifact is gitignored so a fresh clone will not have it.
    sess = None
    onnx_path = os.path.join(ROOT, "artifacts", "models", "t1-ui-head", "t1-ui-head.onnx")
    if os.path.exists(onnx_path):
        try:
            import onnxruntime as ortpy

            so = ortpy.SessionOptions()
            so.graph_optimization_level = ortpy.GraphOptimizationLevel.ORT_ENABLE_ALL
            sess = ortpy.InferenceSession(onnx_path, so, providers=["CPUExecutionProvider"])
            print(f"reference detections: enabled ({os.path.basename(onnx_path)})")
        except Exception as e:
            print(f"reference detections: unavailable ({str(e)[:80]})")

    entries = []
    print("source            format            enc bytes   decoded vs PNG (max/mean)   letterboxed digest")
    for name, img, sample in sources:
        w, h = img.size
        png_decoded = None
        for enc_name, params in ENCODINGS:
            try:
                blob = encode(img, params)
            except Exception as e:  # a codec that is simply unavailable is recorded, not hidden
                entries.append({"source": name, "encoding": enc_name, "unavailable": str(e)[:200]})
                print(f"{name:<17} {enc_name:<17} UNAVAILABLE: {str(e)[:60]}")
                continue

            ext = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}[params["format"]]
            fname = f"{name}.{enc_name}.{ext}"
            with open(os.path.join(GEN, fname), "wb") as f:
                f.write(blob)

            # The reference: PIL decodes THESE EXACT BYTES. Not the original image.
            decoded_img = Image.open(io.BytesIO(blob))
            has_alpha = decoded_img.mode in ("RGBA", "LA", "P")
            rgb_img = decoded_img.convert("RGB")
            s = pil_stages(rgb_img, INPUT_SIZE)

            for key, arr in (("decoded", s["decoded"]), ("letterboxed", s["letterboxed"])):
                with open(os.path.join(GEN, f"{name}.{enc_name}.{key}.u8"), "wb") as f:
                    f.write(arr.tobytes())
            with open(os.path.join(GEN, f"{name}.{enc_name}.tensor.f32"), "wb") as f:
                f.write(s["tensor"].astype("<f4").tobytes())

            if enc_name == "png":
                png_decoded = s["decoded"]
            # The COMPRESSION effect, reported as data. Expected, never pass/fail.
            vs_png = None
            if png_decoded is not None and s["decoded"].shape == png_decoded.shape:
                d = np.abs(s["decoded"].astype(np.int16) - png_decoded.astype(np.int16))
                vs_png = {"maxAbs": int(d.max()), "meanAbs": float(d.mean()),
                          "fractionDiffering": float((d > 0).mean())}

            entry = {
                "source": name,
                "encoding": enc_name,
                "lossless": enc_name in LOSSLESS,
                "encoderParams": params,
                "sourceSize": {"w": w, "h": h},
                "sourceMode": img.mode,
                "file": fname,
                "encodedBytes": len(blob),
                "encodedSha256": sha(blob),
                "decodedMode": decoded_img.mode,
                "decodedHasAlpha": has_alpha,
                "decodedSize": {"w": decoded_img.size[0], "h": decoded_img.size[1]},
                "geometry": {
                    "resizedW": s["resizedW"], "resizedH": s["resizedH"],
                    "padLeft": s["padLeft"], "padTop": s["padTop"],
                    "padRight": s["padRight"], "padBottom": s["padBottom"], "padByte": s["padByte"],
                },
                "digests": {
                    "decoded": sha(s["decoded"].tobytes()),
                    "letterboxed": sha(s["letterboxed"].tobytes()),
                    "tensor": sha(s["tensor"].astype("<f4").tobytes()),
                },
                "vsPngDecoded": vs_png,
            }
            if sample:
                entry["sampleId"] = sample["id"]
                entry["viewportCss"] = sample["viewportCss"]
                entry["captureSize"] = sample["captureSize"]
            # Reference DETECTIONS for this exact encoding, so browser-vs-reference detection
            # is a MEASUREMENT rather than an inference from "the tensors matched".
            #
            # The distinction matters: comparing JPEG-derived detections against the PNG
            # reference measures how much the detector minds being compressed, which is a
            # real and separate question. Comparing them against the reference decode of the
            # SAME JPEG measures conformance. Both are recorded, and they are not the same
            # number.
            if sample is not None and sess is not None:
                o = sess.run(None, {sess.get_inputs()[0].name: s["tensor"]})[0]
                cap, vp = sample["captureSize"], sample["viewportCss"]
                sc, px, py = letterbox_params(cap["w"], cap["h"])
                boxes = project_to_capture(shipped_decode(o), sc, px, py, cap["w"] * sc, cap["h"] * sc)
                c2c = cap["w"] / vp["w"]
                entry["referenceBoxesThisEncoding"] = [
                    {"box": [round(v / c2c, 6) for v in b["box"]], "label": b["label"], "score": round(b["score"], 9)}
                    for b in boxes
                ]
            entries.append(entry)
            v = f"{vs_png['maxAbs']:>3}/{vs_png['meanAbs']:.3f}" if vs_png else "  -"
            print(f"{name:<17} {enc_name:<17} {len(blob):>9}   {v:>25}   {entry['digests']['letterboxed'][:12]}")

    out = {
        "gate": "QG-03b-2 — capture-format preprocessing conformance",
        "generatedAt": __import__("datetime").datetime.now().astimezone().isoformat(),
        "reference": {
            "decoder": f"Pillow {Image.__version__}",
            "libjpeg": features.version("jpg"),
            "libjpegTurbo": features.check_feature("libjpeg_turbo"),
            "libwebp": features.version("webp"),
            "rule": (
                "the reference decodes THE EXACT ENCODED BYTES whose sha256 is recorded here, then runs "
                "the authoritative preprocessing contract. A lossy format is never compared against the "
                "original lossless image — that would measure compression, not conformance."
            ),
            "iccProfiles": "never embedded — a browser applies colour management from one and PIL does not",
        },
        "scope": {
            "jpeg": "REAL capture format — chrome.tabs.captureVisibleTab({format:'jpeg', quality})",
            "webp": (
                "NOT a capture format. captureVisibleTab cannot produce it and TabsCaptureApi declares "
                "png|jpeg. Every WebP reference in dossier v4.0 is the T2 EGRESS encoding. Measured here "
                "because CaptureFrame.format permits 'webp' while the adapter cannot produce it, and "
                "because the T2 verification pass will decode WebP bytes later."
            ),
        },
        "criterion": CRITERION,
        "encodings": [{"name": n, "params": p, "lossless": n in LOSSLESS} for n, p in ENCODINGS],
        "fixtures": entries,
    }
    os.makedirs(EXP, exist_ok=True)
    path = os.path.join(EXP, "fixtures.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    ok = [e for e in entries if "unavailable" not in e]
    print(f"\n{len(ok)} fixture/encoding pairs from {len(sources)} sources")
    print(f"wrote {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
