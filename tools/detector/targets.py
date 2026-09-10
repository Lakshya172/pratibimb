"""
Target assignment, letterboxing, and loss.

This is the part that fails silently. A wrong model still trains and produces plausible
loss curves; a wrong TARGET produces a model that has confidently learned the wrong thing,
and every metric downstream is a faithful measurement of that wrong thing. So the two
decisions that matter most are written down explicitly here.

--------------------------------------------------------------------------------------
DECISION 1 - EVERY GROUND TRUTH GETS AT LEAST ONE POSITIVE CELL

The standard anchor-free rule is "cells whose centre falls inside the box are positive".
For this dataset that rule silently drops objects.

A 1024-wide viewport letterboxes to scale 0.625. A 16 px CSS checkbox becomes ~10 model
px. Cell centres are 16 px apart. A 10 px box frequently contains NO cell centre at all -
so under the standard rule it contributes nothing to the loss, the model never learns it
exists, and recall on small controls is capped by the assignment rather than by the model.

That failure is invisible: loss falls, training looks healthy, and small classes are simply
absent from the predictions.

So the rule here is: inside-cells if any, otherwise the single NEAREST cell to the box
centre. Never zero.

--------------------------------------------------------------------------------------
DECISION 2 - CANONICAL TRUTH IS CSS PIXELS; MODEL PIXELS ARE DERIVED

Labels are stored in CSS viewport pixels because that is the public perception contract.
This module converts CSS -> capture -> model at load time, using the SAME letterbox
arithmetic the browser path uses. Model space is never the source of truth; if it were,
the training set could drift from the coordinate contract with nothing to catch it.
"""

import numpy as np
import torch
import torch.nn.functional as F

from head import CLASSES, GRID, INPUT_SIZE, NUM_CLASSES, STRIDE

CLASS_INDEX = {c: i for i, c in enumerate(CLASSES)}


def letterbox_params(src_w, src_h, size=INPUT_SIZE):
    """Uniform scale then centred pad - identical to packages/perception/src/letterbox.ts."""
    scale = min(size / src_w, size / src_h)
    cw, ch = src_w * scale, src_h * scale
    return scale, (size - cw) / 2.0, (size - ch) / 2.0


def css_box_to_model(box, scale_css_to_capture, scale, pad_x, pad_y):
    """
    CSS viewport px -> capture px -> model px.

    Two hops, both explicit, mirroring the browser chain exactly. Collapsing them into one
    factor would work only while capture happens to equal CSS times DPR, and would break
    silently the moment a capture is downscaled.
    """
    x = box["x"] * scale_css_to_capture * scale + pad_x
    y = box["y"] * scale_css_to_capture * scale + pad_y
    w = box["w"] * scale_css_to_capture * scale
    h = box["h"] * scale_css_to_capture * scale
    return x, y, w, h


def assign_targets(boxes_model, class_ids):
    """
    Build per-cell targets.

    Returns
        pos_mask  [A]      bool, cells responsible for some object
        box_t     [A, 4]   cx, cy, w, h in model px, for positive cells
        cls_t     [A, C]   one-hot, for positive cells
    """
    a = GRID * GRID
    pos = np.zeros(a, dtype=bool)
    box_t = np.zeros((a, 4), dtype=np.float32)
    cls_t = np.zeros((a, NUM_CLASSES), dtype=np.float32)

    # Cell centres in model pixels.
    idx = np.arange(a)
    col = idx % GRID
    row = idx // GRID
    ccx = (col + 0.5) * STRIDE
    ccy = (row + 0.5) * STRIDE

    # Smallest-first, so that where two objects claim the same cell the SMALL one keeps it.
    # A checkbox sitting inside a card would otherwise always lose to the card, and the
    # class the evaluator flagged as most fragile would be the one systematically dropped.
    order = np.argsort([w * h for (_, _, w, h) in boxes_model])

    for k in order:
        x, y, w, h = boxes_model[k]
        cid = class_ids[k]
        if w <= 0 or h <= 0:
            continue
        inside = (ccx >= x) & (ccx <= x + w) & (ccy >= y) & (ccy <= y + h)
        if inside.any():
            cells = np.flatnonzero(inside)
        else:
            # The small-object case. Never leave an object unassigned.
            bcx, bcy = x + w / 2.0, y + h / 2.0
            cells = np.array([int(np.argmin((ccx - bcx) ** 2 + (ccy - bcy) ** 2))])

        for c in cells:
            pos[c] = True
            box_t[c] = (x + w / 2.0, y + h / 2.0, w, h)
            cls_t[c] = 0.0
            cls_t[c, cid] = 1.0

    return pos, box_t, cls_t


def decode_for_loss(box_raw):
    """Same decode as the exported graph, kept in one place so they cannot diverge."""
    n = box_raw.shape[0]
    b = box_raw.reshape(n, 4, -1)
    ys, xs = torch.meshgrid(
        torch.arange(GRID, device=b.device, dtype=b.dtype),
        torch.arange(GRID, device=b.device, dtype=b.dtype),
        indexing="ij",
    )
    xs = xs.reshape(-1).unsqueeze(0)
    ys = ys.reshape(-1).unsqueeze(0)
    # Must stay byte-identical in behaviour to head.decode - see the note there on why this
    # is distance-to-edges and not a cell-relative centre.
    ccx = (xs + 0.5) * STRIDE
    ccy = (ys + 0.5) * STRIDE
    l = torch.exp(torch.clamp(b[:, 0], max=6.0)) * STRIDE
    t = torch.exp(torch.clamp(b[:, 1], max=6.0)) * STRIDE
    r = torch.exp(torch.clamp(b[:, 2], max=6.0)) * STRIDE
    bo = torch.exp(torch.clamp(b[:, 3], max=6.0)) * STRIDE
    cx = ccx + (r - l) * 0.5
    cy = ccy + (bo - t) * 0.5
    w = l + r
    h = t + bo
    return torch.stack([cx, cy, w, h], dim=1)  # [N,4,A]


def ciou_free_iou(pred, tgt, eps=1e-7):
    """Plain IoU between cx,cy,w,h boxes. [N,4,A] against [N,4,A] -> [N,A]."""
    px, py, pw, ph = pred[:, 0], pred[:, 1], pred[:, 2], pred[:, 3]
    tx, ty, tw, th = tgt[:, 0], tgt[:, 1], tgt[:, 2], tgt[:, 3]
    p_x1, p_y1, p_x2, p_y2 = px - pw / 2, py - ph / 2, px + pw / 2, py + ph / 2
    t_x1, t_y1, t_x2, t_y2 = tx - tw / 2, ty - th / 2, tx + tw / 2, ty + th / 2
    ix = (torch.min(p_x2, t_x2) - torch.max(p_x1, t_x1)).clamp(min=0)
    iy = (torch.min(p_y2, t_y2) - torch.max(p_y1, t_y1)).clamp(min=0)
    inter = ix * iy
    union = pw * ph + tw * th - inter
    return inter / (union + eps)


def detector_loss(box_raw, cls_raw, pos_mask, box_t, cls_t, box_weight=5.0):
    """
    Focal-style classification over all cells + IoU box loss over positives.

    Classification uses focal loss because the balance here is roughly 1600 cells to a
    dozen objects. Plain BCE lets the background term dominate, and the model converges to
    "predict nothing", which looks exactly like a broken pipeline while being a correct
    optimum of the wrong objective.

    Box loss is IoU rather than L1 on purpose: L1 on cx, cy, w, h weights a 5 px error on a
    200 px button the same as on a 10 px checkbox, when the second destroys the match and
    the first is harmless. IoU is the quantity the QG-05 metric actually scores, so it is
    the quantity optimised.
    """
    n = box_raw.shape[0]
    cls_logits = cls_raw.reshape(n, NUM_CLASSES, -1)  # [N,C,A]

    # ---- classification, all cells ----
    p = torch.sigmoid(cls_logits)
    ce = F.binary_cross_entropy_with_logits(cls_logits, cls_t, reduction="none")
    p_t = p * cls_t + (1 - p) * (1 - cls_t)
    alpha_t = 0.25 * cls_t + 0.75 * (1 - cls_t)
    focal = alpha_t * ((1 - p_t) ** 2.0) * ce
    num_pos = pos_mask.sum().clamp(min=1).to(focal.dtype)
    cls_loss = focal.sum() / num_pos

    # ---- box, positives only ----
    pred = decode_for_loss(box_raw)
    iou = ciou_free_iou(pred, box_t)  # [N,A]
    box_loss = ((1.0 - iou) * pos_mask.to(iou.dtype)).sum() / num_pos

    return cls_loss + box_weight * box_loss, cls_loss.detach(), box_loss.detach()
