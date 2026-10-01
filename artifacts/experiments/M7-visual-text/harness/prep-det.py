"""
M7.1 — inputs and the NATIVE reference for the pinned PP-OCRv5_mobile_det.

Two inputs, one reference runtime:

  synthetic  W1-S04a-1's exact input, x[i] = ((i*37) % 255) / 255, [1,3,640,640]. Re-running it
             is how this experiment shows it is the SAME measurement S-04a-1 took before asking a
             new question.
  realistic  a screenshot of the M7 visual fixture, preprocessed as the model itself declares in
             its pinned `inference.yml` — S-04a-1a, the "realistic text-bearing input" that record
             named as never done.

Reference runtime: onnxruntime 1.29.0 on CPU — the same version as ORT Web 1.29.0, as S-04a-1
required, "so a comparison isolates the web runtime rather than a version delta".

Recorded per output, with mkref.py's exact field set: count, shape, min, max, sum, sumAbs, sumSq,
and four samples at fixed indices. sumAbs is the pass/fail statistic; nothing here judges it.

PREPROCESSING, FROM THE MODEL'S OWN inference.yml:
  DecodeImage(img_mode=BGR, channel_first=false) -> DetResizeForTest(resize_long=960)
  -> NormalizeImage(scale=1/255, mean=[.485,.456,.406], std=[.229,.224,.225], order=hwc)
  -> ToCHWImage
DetResizeForTest's resize_long branch is PaddleOCR's type-2 resize: scale the long side to 960,
then round each side UP to a multiple of 128. The mean/std are applied to the channels in BGR order,
as PaddleOCR does. Bilinear interpolation is implemented here with cv2's INTER_LINEAR convention
(half-pixel centres, no antialiasing) rather than PIL's, so no OpenCV dependency is needed and the
arithmetic is visible. These are reproductions of upstream definitions, not vendored upstream code,
and they only define what "realistic" means — WASM correctness is web-vs-native on IDENTICAL bytes.
"""
import argparse
import hashlib
import json
import os
import statistics
import time

import numpy as np
import onnxruntime as ort
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL = os.path.join(ROOT, "models", "ppocrv5_mobile_det.onnx")

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
RESIZE_LONG = 960
MAX_STRIDE = 128


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def synthetic():
    shape = [1, 3, 640, 640]
    n = int(np.prod(shape))
    a = np.array([((i * 37) % 255) / 255 for i in range(n)], dtype=np.float32).reshape(shape)
    return a, {"kind": "S-04a-1 synthetic", "formula": "x[i] = ((i*37) % 255) / 255", "shape": shape}


def bilinear(img, out_h, out_w):
    """cv2.INTER_LINEAR semantics: src = (dst + 0.5) * scale - 0.5, clamped, no antialiasing."""
    in_h, in_w = img.shape[:2]
    ys = (np.arange(out_h, dtype=np.float64) + 0.5) * (in_h / out_h) - 0.5
    xs = (np.arange(out_w, dtype=np.float64) + 0.5) * (in_w / out_w) - 0.5
    ys = np.clip(ys, 0, in_h - 1)
    xs = np.clip(xs, 0, in_w - 1)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    y1 = np.minimum(y0 + 1, in_h - 1)
    x1 = np.minimum(x0 + 1, in_w - 1)
    wy = (ys - y0)[:, None, None]
    wx = (xs - x0)[None, :, None]
    f = img.astype(np.float64)
    top = f[y0][:, x0] * (1 - wx) + f[y0][:, x1] * wx
    bottom = f[y1][:, x0] * (1 - wx) + f[y1][:, x1] * wx
    return top * (1 - wy) + bottom * wy


def realistic(png):
    rgb = np.asarray(Image.open(png).convert("RGB"))
    h, w = rgb.shape[:2]
    bgr = rgb[:, :, ::-1]  # DecodeImage(img_mode=BGR)
    ratio = RESIZE_LONG / max(h, w)
    rh, rw = int(h * ratio), int(w * ratio)
    rh = (rh + MAX_STRIDE - 1) // MAX_STRIDE * MAX_STRIDE
    rw = (rw + MAX_STRIDE - 1) // MAX_STRIDE * MAX_STRIDE
    resized = bilinear(bgr, rh, rw)
    norm = ((resized / 255.0).astype(np.float32) - MEAN) / STD  # order=hwc, channels BGR
    chw = np.ascontiguousarray(norm.transpose(2, 0, 1)[None, ...], dtype=np.float32)
    return chw, {
        "kind": "realistic — M7 visual fixture screenshot",
        "png_sha256": sha256_bytes(open(png, "rb").read()),
        "source_hw": [h, w],
        "resized_hw": [rh, rw],
        "ratio_h": rh / h,
        "ratio_w": rw / w,
        "shape": list(chw.shape),
        "preprocess": "inference.yml: BGR, DetResizeForTest(resize_long=960, stride 128), "
        "NormalizeImage(1/255, ImageNet mean/std, hwc), ToCHW",
    }


def stats(arr):
    a = np.asarray(arr).astype(np.float64).ravel()
    idx = [0, len(a) // 3, (2 * len(a)) // 3, len(a) - 1]
    return {
        "count": int(a.size),
        "shape": list(np.asarray(arr).shape),
        "min": float(a.min()),
        "max": float(a.max()),
        "sum": float(a.sum()),
        "sumAbs": float(np.abs(a).sum()),
        "sumSq": float((a * a).sum()),
        "sampleIdx": idx,
        "sampleVals": [float(a[i]) for i in idx],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--runs", type=int, default=5)
    args = ap.parse_args()

    t0 = time.perf_counter()
    so = ort.SessionOptions()
    so.log_severity_level = 3  # the exporter leaves unused shape initializers; ORT's warning is recorded once, below
    sess = ort.InferenceSession(MODEL, sess_options=so, providers=["CPUExecutionProvider"])
    load_ms = (time.perf_counter() - t0) * 1000
    in_name = sess.get_inputs()[0].name
    out_name = sess.get_outputs()[0].name

    record = {
        "reference_runtime": "onnxruntime " + ort.__version__,
        "provider": "CPUExecutionProvider",
        "model_sha256": sha256_bytes(open(MODEL, "rb").read()),
        "session_load_ms": round(load_ms, 1),
        "input_name": in_name,
        "output_name": out_name,
        "inputs": {},
    }

    for name, (tensor, meta) in {"synthetic": synthetic(), "realistic": realistic(args.png)}.items():
        tensor = np.ascontiguousarray(tensor, dtype=np.float32)
        in_bytes = tensor.tobytes()
        with open(os.path.join(args.out_dir, f"m7.1-input-{name}.f32"), "wb") as f:
            f.write(in_bytes)

        outs, times = [], []
        for _ in range(args.runs):
            t = time.perf_counter()
            out = sess.run([out_name], {in_name: tensor})[0]
            times.append((time.perf_counter() - t) * 1000)
            outs.append(np.ascontiguousarray(out, dtype=np.float32).tobytes())
        deterministic = all(o == outs[0] for o in outs)
        with open(os.path.join(args.out_dir, f"m7.1-native-{name}.f32"), "wb") as f:
            f.write(outs[0])

        record["inputs"][name] = {
            "meta": meta,
            "input_sha256": sha256_bytes(in_bytes),
            "input_count": int(tensor.size),
            "native_output": stats(np.frombuffer(outs[0], dtype=np.float32).reshape(out.shape)),
            "native_output_sha256": sha256_bytes(outs[0]),
            "native_runs": args.runs,
            "native_deterministic": deterministic,
            "native_infer_ms": {"median": round(statistics.median(times), 1), "min": round(min(times), 1), "max": round(max(times), 1)},
        }

    with open(os.path.join(args.out_dir, "m7.1-native-reference.json"), "w", encoding="utf8") as f:
        json.dump(record, f, indent=1)
    print(json.dumps(record, indent=1))


if __name__ == "__main__":
    main()
