"""
QG-03b-2a — the reference side for frames Chromium itself encoded.

  python tools/detector/qg03b2a_fixtures.py

--------------------------------------------------------------------------------------
WHAT IS DIFFERENT ABOUT THIS ONE

QG-03b-2 answered "does the browser decode a JPEG the way Pillow does" using JPEGs that
PILLOW WROTE. It came out bitwise identical on every format — and it had to be read with
one caveat attached, because Pillow's encoder and the browser's decoder are both
libjpeg-turbo. Agreement between two halves of the same library family is weaker evidence
than it looks.

Here the bytes come from `chrome.tabs.captureVisibleTab`, Chromium's own encoder, and
Pillow meets them for the first time as a decoder. That removes the shared-provenance
caveat, and it also exposes real encoder choices the synthetic fixtures never contained:
4:2:0 chroma subsampling and an embedded ICC profile (see the capture manifest).

This script does NOT encode anything. It reads `harness/captured/`, verifies each file's
SHA-256 against what the browser reported at capture time, and builds the reference.

--------------------------------------------------------------------------------------
THE REFERENCE RULE IS UNCHANGED, AND IT IS THE WHOLE EXPERIMENT

    the reference decodes THE EXACT CAPTURED BYTES, then runs the authoritative
    preprocessing contract.

The JPEG capture is never compared against the PNG capture to decide conformance. Those
two files are different images of the same paint, and their difference is compression —
a real quantity, measured below as `vsPngDecoded`, reported as data, never a verdict.
"""

import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image, features
from PIL.JpegImagePlugin import get_sampling

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from head import INPUT_SIZE  # noqa: E402
from qg03b_fixtures import pil_stages  # noqa: E402
from qg03_reference import project_to_capture, shipped_decode  # noqa: E402
from targets import letterbox_params  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXP = os.path.join(ROOT, "artifacts", "experiments", "W1-QG03b2a-chromium-jpeg-capture")
CAPTURED = os.path.join(EXP, "harness", "captured")
GEN = os.path.join(EXP, "harness", "generated")

# ---- the criterion, inherited deliberately rather than restated -----------------------
#
# These are QG-03b-2's numbers, unchanged. Restating them here with fresh values would let
# a bar drift to fit a result, so the only edit permitted is the one the tests enforce:
# they must stay equal to QG-03b-2's, and `inheritedFrom` says so out loud.
#
# The one ADDITION is `losslessNote`. A PNG capture is lossless with respect to the paint
# Chromium encoded, so its decode must still be bitwise — the fact that it came from a
# browser instead of Pillow changes nothing about what PNG guarantees.
CRITERION = {
    "preRegistered": True,
    "preRegisteredBefore": "any Chromium capture was decoded by the reference",
    "inheritedFrom": "QG-03b-2 — identical numbers, so the two results are directly comparable",
    "lossless": {
        "decodedPixels": "BITWISE identical",
        "why": "PNG reconstructs exactly whatever was encoded. A capture being the source changes nothing.",
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


def sha(b):
    return hashlib.sha256(b).hexdigest()


def jpeg_characteristics(blob):
    """
    Read the encoder's choices out of the file, rather than assuming them.

    The DQT tables ARE the quality setting: libjpeg scales the Annex K tables by a factor
    derived from the quality number, so the tables recover it exactly. Reporting the tables
    as primary and the implied quality as derived keeps the measurement honest — if a future
    Chromium changes tables without changing the implied number, the tables show it.
    """
    im = Image.open(io.BytesIO(blob))
    icc = im.info.get("icc_profile") or b""
    out = {
        "size": {"w": im.size[0], "h": im.size[1]},
        "mode": im.mode,
        "iccProfileBytes": len(icc),
        "iccProfileSha256": sha(icc) if icc else None,
        "progressive": bool(im.info.get("progressive")),
    }
    if im.format != "JPEG":
        out["format"] = im.format
        return out
    out["format"] = "JPEG"
    out["subsampling"] = get_sampling(im)
    out["subsamplingName"] = {0: "4:4:4", 1: "4:2:2", 2: "4:2:0"}.get(get_sampling(im), "other")
    q = im.quantization
    out["quantTables"] = {str(k): list(v) for k, v in q.items()}
    out["quantTableCount"] = len(q)
    out["impliedIjgQuality"] = implied_quality(q.get(0))
    if icc:
        try:
            from PIL import ImageCms

            p = ImageCms.getOpenProfile(io.BytesIO(icc))
            out["iccDescription"] = ImageCms.getProfileDescription(p).strip()
            # Does applying the profile change anything? If the profile is sRGB-identity the
            # answer is no, and then colour management cannot be a source of divergence.
            rgb = im.convert("RGB")
            conv = ImageCms.profileToProfile(rgb, p, ImageCms.createProfile("sRGB"), outputMode="RGB")
            d = np.abs(np.asarray(rgb, np.int16) - np.asarray(conv, np.int16))
            out["iccToSrgbMaxAbs"] = int(d.max())
            out["iccIsIdentityToSrgb"] = int(d.max()) == 0
        except Exception as e:  # a missing littleCMS is recorded, not silently skipped
            out["iccInspectionError"] = str(e)[:120]
    return out


# The IJG Annex K luminance table. libjpeg scales it; dividing recovers the scale factor.
ANNEX_K_LUMA = [
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99,
]


def implied_quality(table):
    """
    The IJG quality integer whose scaled Annex K table reproduces `table` exactly.

    Returned as a range when several qualities produce the same table (they do at the top
    of the scale), and None when no quality reproduces it — which would mean the encoder
    does not use Annex K at all, a finding in itself rather than something to approximate.
    """
    if not table:
        return None
    # PIL returns the table in zig-zag order for some files; compare against both.
    want = list(table)
    hits = []
    for quality in range(1, 101):
        scale = 5000 // quality if quality < 50 else 200 - quality * 2
        scaled = [min(255, max(1, (v * scale + 50) // 100)) for v in ANNEX_K_LUMA]
        if scaled == want:
            hits.append(quality)
    if not hits:
        return {"exactMatch": False, "note": "no IJG Annex K quality reproduces this table"}
    return {"exactMatch": True, "qualities": hits, "single": hits[0] if len(hits) == 1 else None}


def main():
    manifest_path = os.path.join(CAPTURED, "manifest.json")
    if not os.path.exists(manifest_path):
        print(f"missing {manifest_path}\n  run: node {os.path.relpath(os.path.join(EXP, 'harness', 'capture-chromium.mjs'), ROOT)}")
        sys.exit(1)
    with open(manifest_path, "r", encoding="utf-8") as f:
        cap = json.load(f)
    os.makedirs(GEN, exist_ok=True)

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
    else:
        print("reference detections: model artifact absent (gitignored) — conformance still measurable")

    # One record per (page, display, format). Repeats are byte-identical (the capture phase
    # verifies that), so repeat 1 is the fixture and the rest are the determinism evidence.
    entries = []
    per_page_png = {}
    print("\npage                  display  format  enc bytes   decoded vs PNG capture      letterboxed digest")
    for rec in cap["captures"]:
        if rec["repeat"] != 1:
            continue
        for fmeta in rec["files"]:
            if "file" not in fmeta:
                continue
            path = os.path.join(CAPTURED, fmeta["file"])
            with open(path, "rb") as f:
                blob = f.read()

            # Both sides must be looking at the same file. Checked here against what the
            # BROWSER reported at capture time, not merely recomputed from the same bytes.
            digest = sha(blob)
            if digest != fmeta["sha256"]:
                print(f"REFUSED: {fmeta['file']} digest {digest[:12]} != manifest {fmeta['sha256'][:12]}")
                sys.exit(1)

            fmt = "png" if fmeta["mime"] == "image/png" else "jpeg"
            enc_name = f"capture-{fmt}"
            key = f"{rec['page']}.{rec['display']}"

            decoded_img = Image.open(io.BytesIO(blob))
            rgb_img = decoded_img.convert("RGB")
            s = pil_stages(rgb_img, INPUT_SIZE)

            base = f"{key}.{enc_name}"
            for label, arr in (("decoded", s["decoded"]), ("letterboxed", s["letterboxed"])):
                with open(os.path.join(GEN, f"{base}.{label}.u8"), "wb") as f:
                    f.write(arr.tobytes())
            with open(os.path.join(GEN, f"{base}.tensor.f32"), "wb") as f:
                f.write(s["tensor"].astype("<f4").tobytes())

            if fmt == "png":
                per_page_png[key] = s["decoded"]
            vs_png = None
            ref_png = per_page_png.get(key)
            if ref_png is not None and s["decoded"].shape == ref_png.shape:
                d = np.abs(s["decoded"].astype(np.int16) - ref_png.astype(np.int16))
                vs_png = {
                    "maxAbs": int(d.max()),
                    "meanAbs": float(d.mean()),
                    "fractionDiffering": float((d > 0).mean()),
                }

            entry = {
                "source": key,
                "page": rec["page"],
                "category": rec["category"],
                "display": rec["display"],
                "encoding": enc_name,
                "lossless": fmt == "png",
                "producedBy": "chrome.tabs.captureVisibleTab",
                "requestedOptions": fmeta["requested"],
                "mime": fmeta["mime"],
                "dataUrlHeader": fmeta["dataUrlHeader"],
                "magic": fmeta["magic"],
                "file": fmeta["file"],
                "sourceSize": rec["achievedCssSize"] and {"w": rec["achievedCssSize"]["w"], "h": rec["achievedCssSize"]["h"]},
                "encodedBytes": len(blob),
                "encodedSha256": digest,
                "encoder": jpeg_characteristics(blob),
                "decodedMode": decoded_img.mode,
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
                "refDecoded": f"refs/{base}.decoded.u8",
                "refLetterboxed": f"refs/{base}.letterboxed.u8",
            }

            # A capture IS the viewport, and the runner forced DPR 1, so CSS size and capture
            # size are the same number here. Stated explicitly rather than left implied,
            # because every coordinate below is projected through it.
            cap_size = {"w": decoded_img.size[0], "h": decoded_img.size[1]}
            entry["captureSize"] = cap_size
            entry["viewportCss"] = cap_size
            entry["dpr"] = 1

            if sess is not None:
                o = sess.run(None, {sess.get_inputs()[0].name: s["tensor"]})[0]
                sc, px, py = letterbox_params(cap_size["w"], cap_size["h"])
                boxes = project_to_capture(shipped_decode(o), sc, px, py, cap_size["w"] * sc, cap_size["h"] * sc)
                entry["referenceBoxesThisEncoding"] = [
                    {"box": [round(v, 6) for v in b["box"]], "label": b["label"], "score": round(b["score"], 9)}
                    for b in boxes
                ]

            entries.append(entry)
            v = f"{vs_png['maxAbs']:>3}/{vs_png['meanAbs']:.3f}" if vs_png else "  (is the PNG)"
            print(
                f"{rec['page']:<21} {rec['display']:<8} {fmt:<6} {len(blob):>9}   {v:>24}   "
                f"{entry['digests']['letterboxed'][:12]}"
            )

    # The PNG capture is the lossless reference for the compression question. Attach its
    # detections to each JPEG entry so the browser can measure compression sensitivity
    # against the same baseline the reference used.
    png_boxes = {e["source"]: e.get("referenceBoxesThisEncoding") for e in entries if e["lossless"]}
    for e in entries:
        if not e["lossless"] and png_boxes.get(e["source"]):
            e["referenceBoxesPng"] = png_boxes[e["source"]]

    out = {
        "gate": "QG-03b-2a — real Chromium captureVisibleTab JPEG conformance",
        "generatedAt": __import__("datetime").datetime.now().astimezone().isoformat(),
        "capturePhase": {
            "browser": cap["captures"][0]["browserVersion"],
            "userAgent": cap["captures"][0]["userAgent"],
            "apiBinding": cap["captures"][0]["apiBinding"],
            "api": "chrome.tabs.captureVisibleTab",
            "note": "no image encoder exists anywhere in the capture harness; every byte came from the browser",
        },
        "reference": {
            "decoder": f"Pillow {Image.__version__}",
            "libjpeg": features.version("jpg"),
            "libjpegTurbo": features.check_feature("libjpeg_turbo"),
            "rule": (
                "the reference decodes THE EXACT ENCODED BYTES whose sha256 is recorded here, then runs "
                "the authoritative preprocessing contract. The JPEG capture is never compared against the "
                "PNG capture to decide conformance — that would measure compression, not conformance."
            ),
            "iccProfiles": (
                "PRESENT in every Chromium JPEG and absent from every Chromium PNG. Pillow does not apply "
                "an embedded profile on decode, so whether this matters is measured per file "
                "(`encoder.iccIsIdentityToSrgb`) rather than assumed either way."
            ),
        },
        "scope": {
            "jpeg": "REAL capture format — produced here by chrome.tabs.captureVisibleTab({format:'jpeg'})",
            "webp": (
                "NOT a capture format, and now refused by the API itself rather than merely absent from "
                "the type: Chromium 151 rejects {format:'webp'} at schema validation. See the capture "
                "manifest's apiSurface."
            ),
            "chromiumOnly": "Firefox is deliberately out of scope; the question is Chromium's encoder.",
        },
        "criterion": CRITERION,
        "encodings": [
            {"name": "capture-png", "lossless": True, "params": {"format": "png"}},
            {"name": "capture-jpeg", "lossless": False, "params": {"format": "jpeg", "quality": "browser default"}},
        ],
        "fixtures": entries,
    }
    os.makedirs(EXP, exist_ok=True)
    path = os.path.join(EXP, "fixtures.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"\n{len(entries)} fixture/encoding pairs")
    print(f"wrote {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
