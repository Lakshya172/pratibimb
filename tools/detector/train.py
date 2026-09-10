"""
Train the T1 head, export to ONNX, and emit CSS-space predictions for the QG-05 evaluator.

  python tools/detector/train.py [--steps=4000] [--batch=4]

Runs only after the micro-overfit gate passes. That gate proves the pipeline can learn;
this run asks how much it learns from the training split, and the answer is measured by the
existing QG-05 evaluator on the HELD-OUT test split - never here.

--------------------------------------------------------------------------------------
WHAT THIS SCRIPT DELIBERATELY DOES NOT DO

It does not choose a confidence threshold. It emits predictions at a low floor and lets
the sweep on DEV pick the threshold, because a threshold chosen by the script that also
produced the numbers is a threshold chosen to flatter them.

It does not touch the model registry. Adoption has a documented bar and training is one
item on it.

It does not report accuracy. It writes predictions; the evaluator scores them.
"""

import argparse
import hashlib
import json
import os
import sys
import time

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data import SplitDataset  # noqa: E402
from head import (  # noqa: E402
    CLASSES,
    GRID,
    INPUT_SIZE,
    NUM_ANCHORS,
    NUM_CLASSES,
    STRIDE,
    ExportWrapper,
    UiHead,
    decode,
)
from targets import detector_loss, letterbox_params  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DATA = os.path.join(ROOT, "artifacts", "datasets", "t1-ui-v1")
OUT = os.path.join(ROOT, "artifacts", "models", "t1-ui-head")

# Emitted at this floor so the DEV sweep has room to choose. Not a chosen threshold.
EMIT_FLOOR = 0.05


def set_determinism(seed):
    torch.manual_seed(seed)
    np.random.seed(seed)
    torch.use_deterministic_algorithms(True, warn_only=True)


def nms(boxes, scores, iou_thr=0.5, limit=300):
    """Greedy per-class NMS. Deterministic: score order, ties by index."""
    order = sorted(range(len(boxes)), key=lambda i: (-scores[i], i))
    keep = []
    for i in order:
        if len(keep) >= limit:
            break
        ok = True
        for j in keep:
            ax, ay, aw, ah = boxes[i]
            bx, by, bw, bh = boxes[j]
            ix = max(0.0, min(ax + aw / 2, bx + bw / 2) - max(ax - aw / 2, bx - bw / 2))
            iy = max(0.0, min(ay + ah / 2, by + bh / 2) - max(ay - ah / 2, by - bh / 2))
            inter = ix * iy
            union = aw * ah + bw * bh - inter
            if union > 0 and inter / union > iou_thr:
                ok = False
                break
        if ok:
            keep.append(i)
    return keep


def predict_split(sess, ds, model_id, revision):
    """
    Run inference THROUGH THE EXPORTED ARTIFACT and project to CSS viewport pixels.

    The first version of this ran the torch model. That was wrong: the ONNX file is what
    ships, so the ONNX file is what must be measured. Any divergence between the two would
    otherwise sit silently between the evidence and the artifact, and every reported metric
    would describe a model that is not the one loaded in the browser.
    """
    preds = []
    if True:
        for i in range(len(ds)):
            x, _, _, _ = ds[i]
            out = sess.run(None, {"images": x.unsqueeze(0).numpy()})[0][0]  # [4+C, A]
            cx, cy, w, h = (out[k] for k in range(4))
            scores = out[4:]  # [C, A]

            s = ds.samples[i]
            cap, vp = s["captureSize"], s["viewportCss"]
            scale, pad_x, pad_y = letterbox_params(cap["w"], cap["h"])
            css_to_cap = cap["w"] / vp["w"]

            for c in range(NUM_CLASSES):
                sc = scores[c]
                idx = np.flatnonzero(sc >= EMIT_FLOOR)
                if idx.size == 0:
                    continue
                boxes = [(float(cx[a]), float(cy[a]), float(w[a]), float(h[a])) for a in idx]
                keep = nms(boxes, [float(sc[a]) for a in idx])
                for k in keep:
                    mcx, mcy, mw, mh = boxes[k]
                    # model px -> capture px -> CSS px. Both hops explicit, matching the
                    # browser chain; the un-pad happens before the un-scale.
                    x0 = ((mcx - mw / 2) - pad_x) / scale / css_to_cap
                    y0 = ((mcy - mh / 2) - pad_y) / scale / css_to_cap
                    bw = mw / scale / css_to_cap
                    bh = mh / scale / css_to_cap
                    # Predictions entirely outside the viewport describe nothing the
                    # detector could have seen; the evaluator would reject them anyway,
                    # and emitting them would inflate the rejected count meaninglessly.
                    if x0 >= vp["w"] or y0 >= vp["h"] or x0 + bw <= 0 or y0 + bh <= 0:
                        continue
                    preds.append(
                        {
                            "sampleId": s["id"],
                            "cls": CLASSES[c],
                            "box": {"x": x0, "y": y0, "w": bw, "h": bh},
                            "confidence": float(sc[idx[k]]),
                            "frameId": f"train-{s['id']}",
                            "modelId": model_id,
                            "revision": revision,
                        }
                    )
    return preds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=4000)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--seed", type=int, default=20260910)
    args = ap.parse_args()

    set_determinism(args.seed)
    torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
    os.makedirs(OUT, exist_ok=True)

    train = SplitDataset(DATA, "train")
    print(f"dataset {train.name}@{train.version} hash={train.hash}")
    print(f"  train {len(train)} samples, {args.steps} steps, batch {args.batch}")

    # Preloaded: 120 letterboxed 640x640 tensors is about 590 MB, which fits, and re-decoding
    # a PNG every step would dominate the run time on CPU.
    X, P, BT, CT = [], [], [], []
    for i in range(len(train)):
        x, p, bt, ct = train[i]
        X.append(x)
        P.append(p)
        BT.append(bt)
        CT.append(ct)
    X = torch.stack(X)
    P = torch.stack(P)
    BT = torch.stack(BT).permute(0, 2, 1)
    CT = torch.stack(CT).permute(0, 2, 1)

    model = UiHead()
    nparams = sum(p.numel() for p in model.parameters())
    print(f"  model: {nparams:,} params, stride {STRIDE}, {NUM_ANCHORS} anchors")

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.steps)

    # Deterministic shuffling: a seeded permutation per epoch, not a random sampler.
    rng = np.random.default_rng(args.seed)
    order = rng.permutation(len(train))
    cursor = 0

    model.train()
    t0 = time.time()
    hist = []
    for step in range(args.steps):
        if cursor + args.batch > len(order):
            order = rng.permutation(len(train))
            cursor = 0
        idx = order[cursor : cursor + args.batch].tolist()
        cursor += args.batch

        box_raw, cls_raw = model(X[idx])
        loss, cls_l, box_l = detector_loss(box_raw, cls_raw, P[idx], BT[idx], CT[idx])
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 10.0)
        opt.step()
        sched.step()
        hist.append(float(loss.detach()))
        if step % 250 == 0 or step == args.steps - 1:
            print(
                f"    step {step:5d}  loss {float(loss.detach()):.4f}  "
                f"cls {float(cls_l):.4f}  box {float(box_l):.4f}  "
                f"({time.time() - t0:.0f}s)"
            )
    train_seconds = time.time() - t0

    # ---- export: trunk + decode, so the artifact honours the contract itself ----
    model.eval()
    onnx_path = os.path.join(OUT, "t1-ui-head.onnx")
    torch.onnx.export(
        ExportWrapper(model),
        torch.zeros(1, 3, INPUT_SIZE, INPUT_SIZE),
        onnx_path,
        input_names=["images"],
        output_names=["output"],
        opset_version=17,
        dynamo=False,
    )
    torch.save(model.state_dict(), os.path.join(OUT, "t1-ui-head.pt"))
    with open(onnx_path, "rb") as f:
        blob = f.read()
    sha256 = hashlib.sha256(blob).hexdigest()
    size_bytes = len(blob)
    print(f"\n  exported {onnx_path}")
    print(f"    sha256 {sha256}")
    print(f"    bytes  {size_bytes:,} ({size_bytes / 1e6:.2f} MB)")

    # ---- verify the ARTIFACT numerically matches the trained model ----
    # An export that silently diverges would make every downstream metric describe a model
    # that is not the one shipping.
    import onnxruntime as ort

    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    probe = X[:1].numpy()
    ort_out = sess.run(None, {"images": probe})[0]

    # eval() AGAIN, AFTER the export, and asserted.
    #
    # torch.onnx.export restores the module's original training mode when it finishes -
    # and the module it was handed is ExportWrapper(model), constructed one line earlier
    # and therefore defaulting to training=True. Restoring the wrapper to train mode
    # propagates into the inner model, so the reference below silently ran with
    # BatchNorm using BATCH statistics instead of running statistics.
    #
    # That reported max |ORT - torch| = 40.4 with class channels off by 0.30, which reads
    # exactly like a broken export. It was not: in eval mode the same comparison gives
    # 3.4e-03 overall and 1.3e-05 on the class channels. The artifact was correct and the
    # VERIFICATION was wrong - the most expensive kind of false alarm, because the obvious
    # response is to distrust the artifact.
    model.eval()
    assert not model.training, "reference must run in eval mode or BatchNorm uses batch stats"
    with torch.no_grad():
        torch_out = decode(*model(X[:1])).numpy()
    max_abs = float(np.max(np.abs(ort_out - torch_out)))
    shape_ok = list(ort_out.shape) == [1, 4 + NUM_CLASSES, NUM_ANCHORS]
    print(f"    ORT output shape {ort_out.shape}  expected [1, {4 + NUM_CLASSES}, {NUM_ANCHORS}]  ok={shape_ok}")
    print(f"    max |ORT - torch| = {max_abs:.3e}")

    # Per-channel, because a single max hides where the divergence lives. The box channels
    # pass through exp(), which amplifies any upstream difference exponentially; the class
    # channels pass through sigmoid(), which compresses it. A large box diff beside a tiny
    # class diff is arithmetic, not a broken export.
    per_channel = {}
    names = ["cx", "cy", "w", "h"] + [f"cls{i}" for i in range(NUM_CLASSES)]
    for ci, nm in enumerate(names):
        d = float(np.max(np.abs(ort_out[0, ci] - torch_out[0, ci])))
        scale = float(np.max(np.abs(torch_out[0, ci]))) or 1.0
        per_channel[nm] = {"maxAbs": d, "maxRel": d / scale}
    print("    per-channel max |ORT - torch| (abs, rel):")
    for nm, v in per_channel.items():
        print(f"      {nm:5s} {v['maxAbs']:12.4e}  {v['maxRel']:.2e}")
    cls_max_rel = max(v["maxRel"] for k, v in per_channel.items() if k.startswith("cls"))
    print(f"    class-channel max relative diff = {cls_max_rel:.2e}")

    revision = sha256[:12]
    model_id = "pratibimb-t1-ui-head"

    # ---- predictions for the evaluator: dev for tuning, test for the claim ----
    preds = {}
    for split in ("dev", "test"):
        ds = SplitDataset(DATA, split)
        p = predict_split(sess, ds, model_id, revision)
        preds[split] = p
        print(f"  {split}: {len(ds)} samples -> {len(p)} predictions (floor {EMIT_FLOOR})")

    with open(os.path.join(OUT, "predictions.json"), "w", encoding="utf-8") as f:
        json.dump(preds, f)

    meta = {
        "modelId": model_id,
        "revision": revision,
        "license": "project-owned (option B: trained on the project's own synthetic set)",
        "source": "tools/detector/ - trained in this repository, not downloaded",
        "architecture": {
            "type": "anchor-free single-level conv detector",
            "trunk": "4x conv-bn-relu, three stride-2, to stride 8",
            "parameters": nparams,
            "stride": STRIDE,
            "grid": GRID,
            "anchors": NUM_ANCHORS,
            "classes": CLASSES,
        },
        "tensorContract": {
            "input": [1, 3, INPUT_SIZE, INPUT_SIZE],
            "layout": "NCHW",
            "channelOrder": "RGB",
            "normalization": "0..1",
            "padValue": 114 / 255,
            "output": [1, 4 + NUM_CLASSES, NUM_ANCHORS],
            "boxEncoding": "cx,cy,w,h in MODEL pixels (decode inside the graph)",
        },
        "preprocessing": "letterbox to 640 square, BILINEAR, centred pad 114/255, RGB, /255",
        "postprocessing": f"per-class greedy NMS at IoU 0.5, emit floor {EMIT_FLOOR}, model->capture->CSS",
        "training": {
            "seed": args.seed,
            "steps": args.steps,
            "batch": args.batch,
            "lr": args.lr,
            "optimizer": "AdamW(weight_decay=1e-4)",
            "schedule": "CosineAnnealingLR",
            "loss": "focal(alpha=0.25, gamma=2) over all cells + 5.0 * (1-IoU) over positives",
            "augmentation": "none",
            "seconds": train_seconds,
            "lossFirst": float(np.mean(hist[:10])),
            "lossLast": float(np.mean(hist[-10:])),
        },
        "dataset": {"name": train.name, "version": train.version, "hash": train.hash, "trainSamples": len(train)},
        "artifact": {"path": "t1-ui-head.onnx", "sha256": sha256, "bytes": size_bytes},
        "exportVerification": {
            "shapeOk": shape_ok,
            "maxAbsDiffVsTorch": max_abs,
            "perChannel": per_channel,
            "classChannelMaxRelDiff": cls_max_rel,
            "predictionsGeneratedFrom": "the exported ONNX artifact, via onnxruntime",
        },
        "adopted": False,
        "adoptionNote": "NOT adopted. The model registry is unchanged. Adoption requires the "
        "full documented bar, of which training is one item.",
    }
    with open(os.path.join(OUT, "model-card.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"  wrote {os.path.join(OUT, 'model-card.json')}")


if __name__ == "__main__":
    main()
