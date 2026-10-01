"""
M8.1 — model inputs and the NATIVE reference for one screening candidate.

Generalises M7.1's prep-det.py to several inputs and to each candidate's OWN declared preprocessing.
Nothing here is chosen after seeing a result: the preprocessing is what each pinned inference.yml
declares, and where it declares an operator without arguments the operator's upstream defaults
apply, read from PaddleOCR `ppocr/data/imaug/operators.py` at dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf.

  TR-01 PP-OCRv4_mobile_det  DetResizeForTest(resize_long=960)  -> type 2: long side to 960, each
                             side rounded UP to a multiple of 128
  TR-02 PP-OCRv3_mobile_det  DetResizeForTest()                 -> type 0 defaults: limit_side_len
                             736, limit_type "min"; each side rounded to the NEAREST multiple of 32
                             (Python round) and at least 32; max_side_limit 4000
  both                       DecodeImage(BGR) -> NormalizeImage(scale 1/255, ImageNet mean/std,
                             hwc, applied in BGR channel order) -> ToCHW

Bilinear resampling follows cv2.INTER_LINEAR (half-pixel centres, no antialiasing), exactly as M7.1.
These definitions only fix what the model is fed. WASM correctness is web-vs-native on IDENTICAL bytes.

Inputs: the S-04a-1 synthetic tensor (diagnostic, recorded, not deciding) and any number of
realistic screenshots. Reference runtime: onnxruntime 1.29.0 CPU, the same version as ORT Web.
Per output: count, shape, min, max, sum, sumAbs, sumSq and four fixed samples; `runs` inferences,
byte-compared for determinism.

Usage (measurement venv python):
  python prep-native.py --candidate TR-01 --model <onnx> --out-dir <dir> --runs 5 name=png [name=png ...]
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

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

RESIZE = {
    "TR-01": {"type": 2, "resize_long": 960, "stride": 128},
    "TR-02": {"type": 0, "limit_side_len": 736, "limit_type": "min", "stride": 32, "max_side_limit": 4000},
}


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def synthetic():
    shape = [1, 3, 640, 640]
    n = int(np.prod(shape))
    a = np.array([((i * 37) % 255) / 255 for i in range(n)], dtype=np.float32).reshape(shape)
    return a, {"kind": "S-04a-1 synthetic (diagnostic)", "formula": "x[i] = ((i*37) % 255) / 255", "shape": shape}


def bilinear(img, out_h, out_w):
    """cv2.INTER_LINEAR semantics: src = (dst + 0.5) * scale - 0.5, clamped, no antialiasing."""
    in_h, in_w = img.shape[:2]
    ys = np.clip((np.arange(out_h, dtype=np.float64) + 0.5) * (in_h / out_h) - 0.5, 0, in_h - 1)
    xs = np.clip((np.arange(out_w, dtype=np.float64) + 0.5) * (in_w / out_w) - 0.5, 0, in_w - 1)
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


def target_size(cfg, h, w):
    if cfg["type"] == 2:
        ratio = cfg["resize_long"] / (h if h > w else w)
        rh, rw = int(h * ratio), int(w * ratio)
        s = cfg["stride"]
        return (rh + s - 1) // s * s, (rw + s - 1) // s * s
    # type 0, limit_type "min"
    limit = cfg["limit_side_len"]
    if min(h, w) < limit:
        ratio = float(limit) / h if h < w else float(limit) / w
    else:
        ratio = 1.0
    rh, rw = int(h * ratio), int(w * ratio)
    if max(rh, rw) > cfg["max_side_limit"]:
        ratio = float(cfg["max_side_limit"]) / max(rh, rw)
        rh, rw = int(rh * ratio), int(rw * ratio)
    s = cfg["stride"]
    return max(int(round(rh / s) * s), s), max(int(round(rw / s) * s), s)


def realistic(cfg, png):
    raw = open(png, "rb").read()
    rgb = np.asarray(Image.open(png).convert("RGB"))
    h, w = rgb.shape[:2]
    bgr = rgb[:, :, ::-1]
    rh, rw = target_size(cfg, h, w)
    norm = ((bilinear(bgr, rh, rw) / 255.0).astype(np.float32) - MEAN) / STD
    chw = np.ascontiguousarray(norm.transpose(2, 0, 1)[None, ...], dtype=np.float32)
    return chw, {
        "kind": "realistic",
        "png_sha256": sha256_bytes(raw),
        "source_hw": [h, w],
        "resized_hw": [rh, rw],
        "ratio_h": rh / h,
        "ratio_w": rw / w,
        "shape": list(chw.shape),
        "preprocess": cfg,
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
    ap.add_argument("--candidate", required=True, choices=sorted(RESIZE))
    ap.add_argument("--model", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("pngs", nargs="*")
    args = ap.parse_args()
    cfg = RESIZE[args.candidate]

    t0 = time.perf_counter()
    so = ort.SessionOptions()
    so.log_severity_level = 3
    sess = ort.InferenceSession(args.model, sess_options=so, providers=["CPUExecutionProvider"])
    load_ms = (time.perf_counter() - t0) * 1000
    ins, outs_meta = sess.get_inputs(), sess.get_outputs()
    record = {
        "candidate": args.candidate,
        "reference_runtime": "onnxruntime " + ort.__version__,
        "provider": "CPUExecutionProvider",
        "model_sha256": sha256_bytes(open(args.model, "rb").read()),
        "session_load_ms": round(load_ms, 1),
        "graph_inputs": [{"name": i.name, "type": i.type, "shape": i.shape} for i in ins],
        "graph_outputs": [{"name": o.name, "type": o.type, "shape": o.shape} for o in outs_meta],
        "inputs": {},
    }
    in_name = ins[0].name
    out_names = [o.name for o in outs_meta]

    todo = {"synthetic": synthetic()}
    for spec in args.pngs:
        name, png = spec.split("=", 1)
        todo[name] = realistic(cfg, png)

    for name, (tensor, meta) in todo.items():
        tensor = np.ascontiguousarray(tensor, dtype=np.float32)
        in_bytes = tensor.tobytes()
        with open(os.path.join(args.out_dir, f"input-{name}.f32"), "wb") as f:
            f.write(in_bytes)
        runs, times = [], []
        for _ in range(args.runs):
            t = time.perf_counter()
            res = sess.run(out_names, {in_name: tensor})
            times.append((time.perf_counter() - t) * 1000)
            runs.append([np.ascontiguousarray(r, dtype=np.float32).tobytes() for r in res])
        deterministic = all(r == runs[0] for r in runs)
        with open(os.path.join(args.out_dir, f"native-{name}.f32"), "wb") as f:
            f.write(runs[0][0])
        record["inputs"][name] = {
            "meta": meta,
            "input_sha256": sha256_bytes(in_bytes),
            "input_count": int(tensor.size),
            "output_count": len(res),
            "native_output": stats(np.frombuffer(runs[0][0], dtype=np.float32).reshape(res[0].shape)),
            "native_output_sha256": sha256_bytes(runs[0][0]),
            "native_runs": args.runs,
            "native_deterministic": deterministic,
            "native_infer_ms": {"median": round(statistics.median(times), 1), "min": round(min(times), 1), "max": round(max(times), 1)},
        }

    with open(os.path.join(args.out_dir, "native-reference.json"), "w", encoding="utf8") as f:
        json.dump(record, f, indent=1)
    print(json.dumps({k: {"shape": v["native_output"]["shape"], "sumAbs": v["native_output"]["sumAbs"], "deterministic": v["native_deterministic"]} for k, v in record["inputs"].items()}, indent=1))


if __name__ == "__main__":
    main()
