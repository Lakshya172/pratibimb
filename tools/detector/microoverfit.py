"""
PHASE 3 GATE - the micro-overfit test.

  python tools/detector/microoverfit.py [--samples=16] [--steps=400]

A detector that cannot deliberately memorise sixteen images has a broken pipeline, and no
amount of data or epochs will fix it. This gate runs BEFORE any real training so that a
failure points at the pipeline rather than at the data.

The criterion is fixed in advance and is not adjusted to whatever the run produces:

  1. total loss falls to below 15% of its initial value
  2. classification loss falls monotonically over the last quarter (allowing noise)
  3. at least 90% of ground-truth objects are recovered at IoU >= 0.5
  4. recovered objects carry the CORRECT class
  5. every decoded box is finite, positive-extent, and inside the frame
  6. the CSS-space round trip lands back on the original label

Criterion 6 matters as much as the rest. A model can memorise perfectly in model space and
still be useless if the letterbox inverse is wrong - and that error is invisible in the
loss, because the loss never leaves model space.

IF THIS FAILS: do not increase epochs or model size. Diagnose in this order - label
generation, preprocessing, tensor layout, target assignment, loss, gradients, optimiser,
learning rate, letterboxing, postprocessing, coordinate conversion.
"""

import argparse
import json
import os
import sys
import time

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data import SplitDataset  # noqa: E402
from head import GRID, INPUT_SIZE, NUM_CLASSES, STRIDE, UiHead, decode  # noqa: E402
from targets import detector_loss, letterbox_params  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DATA = os.path.join(ROOT, "artifacts", "datasets", "t1-ui-v1")


def set_determinism(seed):
    torch.manual_seed(seed)
    np.random.seed(seed)
    torch.use_deterministic_algorithms(True, warn_only=True)


def iou_xywh(a, b):
    ax1, ay1, ax2, ay2 = a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2
    bx1, by1, bx2, by2 = b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2
    ix = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    iy = max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--steps", type=int, default=400)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--seed", type=int, default=20260910)
    args = ap.parse_args()

    set_determinism(args.seed)
    torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))

    ds = SplitDataset(DATA, "train", limit=args.samples)
    print(f"micro-overfit: {len(ds)} samples from {ds.name}@{ds.version} hash={ds.hash}")

    imgs, poss, boxts, clsts = [], [], [], []
    for i in range(len(ds)):
        x, p, bt, ct = ds[i]
        imgs.append(x)
        poss.append(p)
        boxts.append(bt)
        clsts.append(ct)
    X = torch.stack(imgs)
    P = torch.stack(poss)
    BT = torch.stack(boxts).permute(0, 2, 1)  # [N,4,A]
    CT = torch.stack(clsts).permute(0, 2, 1)  # [N,C,A]
    print(f"  tensors: X{tuple(X.shape)}  positives/sample={P.sum().item() / len(ds):.1f}")

    model = UiHead()
    nparams = sum(p.numel() for p in model.parameters())
    print(f"  parameters: {nparams:,}  ({nparams * 4 / 1e6:.2f} MB fp32)")

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.steps)

    model.train()
    history = []
    t0 = time.time()
    batch = min(4, len(ds))
    for step in range(args.steps):
        # Deterministic cycling, not random sampling: a fixed step must see fixed data.
        s = (step * batch) % len(ds)
        idx = [(s + k) % len(ds) for k in range(batch)]
        xb, pb, bb, cb = X[idx], P[idx], BT[idx], CT[idx]

        box_raw, cls_raw = model(xb)
        loss, cls_l, box_l = detector_loss(box_raw, cls_raw, pb, bb, cb)

        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 10.0)
        opt.step()
        sched.step()

        history.append((float(loss), float(cls_l), float(box_l)))
        if step % 50 == 0 or step == args.steps - 1:
            print(f"    step {step:4d}  loss {float(loss):.4f}  cls {float(cls_l):.4f}  box {float(box_l):.4f}")

    train_seconds = time.time() - t0

    # ---- evaluate the memorisation, in model space and then in CSS space ----
    model.eval()
    recovered = 0
    correct_class = 0
    total_gt = 0
    invalid = 0
    css_ok = 0
    with torch.no_grad():
        for i in range(len(ds)):
            out = decode(*model(X[i : i + 1]))[0]  # [4+C, A]
            cx, cy, w, h = out[0], out[1], out[2], out[3]
            scores = out[4:]

            # Ground truth for this sample, from the positive cells.
            pos_idx = torch.nonzero(P[i]).flatten().tolist()
            gts = {}
            for a in pos_idx:
                key = tuple(round(float(v), 2) for v in BT[i, :, a].tolist())
                gts[key] = int(torch.argmax(CT[i, :, a]))
            total_gt += len(gts)

            best_score, best_cls = scores.max(dim=0)
            keep = torch.nonzero(best_score > 0.30).flatten().tolist()

            preds = []
            for a in keep:
                bx = (float(cx[a]), float(cy[a]), float(w[a]), float(h[a]))
                if not all(np.isfinite(bx)) or bx[2] <= 0 or bx[3] <= 0:
                    invalid += 1
                    continue
                if bx[0] < -INPUT_SIZE or bx[0] > 2 * INPUT_SIZE:
                    invalid += 1
                    continue
                preds.append((bx, int(best_cls[a])))

            sample = ds.samples[i]
            cap, vp = sample["captureSize"], sample["viewportCss"]
            scale, pad_x, pad_y = letterbox_params(cap["w"], cap["h"])
            css_to_cap = cap["w"] / vp["w"]

            for gt_box, gt_cls in gts.items():
                hit = None
                for pb, pc in preds:
                    if iou_xywh(pb, gt_box) >= 0.5:
                        hit = (pb, pc)
                        break
                if hit is None:
                    continue
                recovered += 1
                if hit[1] == gt_cls:
                    correct_class += 1
                    # Criterion 6: undo the letterbox and the capture scale, and check the
                    # prediction lands on the original CSS label.
                    pb = hit[0]
                    m_x, m_y = pb[0] - pb[2] / 2, pb[1] - pb[3] / 2
                    c_x = (m_x - pad_x) / scale / css_to_cap
                    c_y = (m_y - pad_y) / scale / css_to_cap
                    c_w = pb[2] / scale / css_to_cap
                    c_h = pb[3] / scale / css_to_cap
                    g_x = (gt_box[0] - gt_box[2] / 2 - pad_x) / scale / css_to_cap
                    g_y = (gt_box[1] - gt_box[3] / 2 - pad_y) / scale / css_to_cap
                    g_w = gt_box[2] / scale / css_to_cap
                    g_h = gt_box[3] / scale / css_to_cap
                    if iou_xywh(
                        (c_x + c_w / 2, c_y + c_h / 2, c_w, c_h),
                        (g_x + g_w / 2, g_y + g_h / 2, g_w, g_h),
                    ) >= 0.5:
                        css_ok += 1

    first = np.mean([h[0] for h in history[:10]])
    last = np.mean([h[0] for h in history[-10:]])
    q = len(history) // 4
    cls_first_q = np.mean([h[1] for h in history[-2 * q : -q]]) if q else 0.0
    cls_last_q = np.mean([h[1] for h in history[-q:]]) if q else 0.0

    recall = recovered / total_gt if total_gt else 0.0
    cls_acc = correct_class / recovered if recovered else 0.0
    css_rate = css_ok / correct_class if correct_class else 0.0

    criteria = {
        "1_loss_below_15pct_of_initial": bool(last < 0.15 * first),
        "2_cls_loss_still_falling": bool(cls_last_q <= cls_first_q),
        "3_recall_at_iou50_ge_0.90": bool(recall >= 0.90),
        "4_class_correct_ge_0.90": bool(cls_acc >= 0.90),
        "5_no_invalid_boxes": bool(invalid == 0),
        "6_css_round_trip_ge_0.90": bool(css_rate >= 0.90),
    }
    passed = all(criteria.values())

    print("\n  micro-overfit result")
    print(f"    loss           {first:.4f} -> {last:.4f}  ({100 * last / first:.1f}% of initial)")
    print(f"    cls loss       last two quarters: {cls_first_q:.4f} -> {cls_last_q:.4f}")
    print(f"    recall@0.5     {recovered}/{total_gt} = {recall:.3f}")
    print(f"    class correct  {correct_class}/{recovered} = {cls_acc:.3f}")
    print(f"    invalid boxes  {invalid}")
    print(f"    CSS round trip {css_ok}/{correct_class} = {css_rate:.3f}")
    print(f"    train time     {train_seconds:.1f}s for {args.steps} steps")
    print("\n  criteria")
    for k, v in criteria.items():
        print(f"    {'PASS' if v else 'FAIL'}  {k}")
    print(f"\n  MICRO-OVERFIT: {'PASS' if passed else 'FAIL'}")

    out_dir = os.path.join(ROOT, "artifacts", "gates", "T1-detector-training")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "microoverfit.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "gate": "T1 detector micro-overfit (Phase 3)",
                "purpose": "prove the learning pipeline before training, so a failure points at the pipeline",
                "dataset": {"name": ds.name, "version": ds.version, "hash": ds.hash, "samples": len(ds)},
                "model": {"parameters": nparams, "stride": STRIDE, "grid": GRID, "classes": NUM_CLASSES},
                "config": vars(args),
                "loss_initial": float(first),
                "loss_final": float(last),
                "recall_at_iou50": recall,
                "class_accuracy": cls_acc,
                "css_round_trip_rate": css_rate,
                "invalid_boxes": invalid,
                "train_seconds": train_seconds,
                "criteria": criteria,
                "passed": passed,
            },
            f,
            indent=2,
        )
    print(f"  wrote {os.path.join(out_dir, 'microoverfit.json')}")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
