"""
T1 UIElementDetector - option B: the project's own lightweight head.

Constitution section 8 ranks three implementations for this role. A (OmniParser
icon_detect_v3) is licence-excluded. C is the DOM-only floor. This is B: "our own detector
head, trained on the synthetic set ... no external dependency and no licence question".

THE TENSOR CONTRACT IS NOT NEGOTIABLE HERE. It is already frozen in
packages/perception/src/uiDetectorHead.ts and tested there:

    input   [1, 3, 640, 640]  NCHW, RGB, 0..1, letterbox pad 114/255
    output  [1, 4 + C, A]     anchor-free; cx, cy, w, h in MODEL pixels, then C class
                              scores in 0..1. No objectness channel.

This file implements a model that satisfies that contract; it does not get to change it.

--------------------------------------------------------------------------------------
WHY THE NETWORK PREDICTS OFFSETS BUT THE GRAPH EMITS ABSOLUTE PIXELS

Regressing absolute cx/cy/w/h directly is badly conditioned: the target range is 0..640 and
identical objects at different positions produce completely different targets, so the net
spends its capacity learning "where am I" instead of "what is this".

So the trunk predicts, per cell:  tx, ty  (offset within the cell, through a sigmoid)
                                  tw, th  (log-size, through an exp)

and the DECODE IS PART OF THE EXPORTED GRAPH:

    cx = (col + sigmoid(tx)) * stride
    cy = (row + sigmoid(ty)) * stride
    w  = exp(tw) * stride
    h  = exp(th) * stride

The consumer therefore sees exactly the contract it was promised - absolute model pixels -
while training sees well-scaled targets. Doing the decode in Python after inference would
have broken the contract and moved a correctness-critical step outside the artifact.
"""

import math

import torch
import torch.nn as nn

INPUT_SIZE = 640
STRIDE = 8
GRID = INPUT_SIZE // STRIDE  # 40
NUM_ANCHORS = GRID * GRID  # 1600

# Must match UI_CLASSES in packages/perception/src/uiDetectorHead.ts, in order.
CLASSES = ["button", "link", "textbox", "checkbox", "radio", "select", "tab", "icon"]
NUM_CLASSES = len(CLASSES)

# Letterbox pad value, matching HEAD_CONTRACT.padValue exactly. Training and inference must
# pad identically or the model sees a distribution at inference it never saw in training.
PAD_VALUE = 114.0 / 255.0


def conv_bn(cin, cout, stride=1):
    """Conv-BN-ReLU. BN folds into the conv at export, so it costs nothing at inference."""
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, stride=stride, padding=1, bias=False),
        nn.BatchNorm2d(cout),
        nn.ReLU(inplace=True),
    )


class UiHead(nn.Module):
    """
    The smallest trunk that reaches stride 16 with enough capacity to separate eight
    control classes.

    STRIDE 8, AND THE FIRST ATTEMPT AT STRIDE 16 IS WHY.

    The QG-05 evaluator had already established that small controls dominate localisation
    error. The first version of this head reasoned from that to stride 16, on the claim
    that a ~10 model-px checkbox "occupies most of a cell". That arithmetic was simply
    wrong - 10 px is smaller than ONE 16 px cell, not most of it - and the micro-overfit
    gate measured the consequence exactly:

        tiny (<16 px)   recall 0.326        checkbox  0/15
        medium / large  recall 0.92 - 0.96  radio     0/15

    with 30 of 45 misses showing NO OVERLAP AT ALL, i.e. the model was not predicting
    anything near them rather than predicting them badly.

    At stride 8 a 10 px control spans one to two cells and is representable. The trunk is
    also SMALLER than the stride-16 version (61K parameters against 163K): the deep 96
    channel block it used to spend capacity on could not see small objects anyway, so the
    parameters were buying nothing.

    The exported contract is unaffected. `[1, 4+C, A]` reads A from the tensor dims, so
    the anchor count moving from 1600 to 6400 needs no change on the TypeScript side.
    """

    def __init__(self, num_classes=NUM_CLASSES, width=(16, 32, 64)):
        super().__init__()
        c1, c2, c3 = width
        self.stem = nn.Sequential(
            conv_bn(3, c1, stride=2),    # 320
            conv_bn(c1, c2, stride=2),   # 160
            conv_bn(c2, c3, stride=2),   # 80  -> stride 8
            conv_bn(c3, c3),
        )
        # Separate heads: box regression and classification do not want shared last-layer
        # statistics, and keeping them apart makes the micro-overfit diagnosis far easier -
        # a stuck box loss with a falling class loss localises the bug immediately.
        self.box = nn.Conv2d(c3, 4, 1)
        self.cls = nn.Conv2d(c3, num_classes, 1)

        # Classification bias initialised to a low prior probability. With ~1600 anchors and
        # a handful of objects, over 99% of cells are negative; starting at p=0.5 makes the
        # first steps dominated by suppressing background, which is the classic reason a
        # from-scratch detector appears not to learn at all.
        prior = 0.01
        nn.init.constant_(self.cls.bias, -math.log((1 - prior) / prior))

    def forward(self, x):
        f = self.stem(x)
        return self.box(f), self.cls(f)  # [N,4,80,80], [N,C,80,80]


def cell_grid(device, dtype=torch.float32):
    """Column and row index of every cell, flattened in row-major order."""
    ys, xs = torch.meshgrid(
        torch.arange(GRID, device=device, dtype=dtype),
        torch.arange(GRID, device=device, dtype=dtype),
        indexing="ij",
    )
    return xs.reshape(-1), ys.reshape(-1)  # [A], [A]


def decode(box_raw, cls_raw):
    """
    Raw trunk output -> the contract's [N, 4+C, A].

    Exported as part of the ONNX graph, so the artifact itself honours the contract.
    """
    n = box_raw.shape[0]
    box = box_raw.reshape(n, 4, -1)  # [N,4,A]
    cls = cls_raw.reshape(n, cls_raw.shape[1], -1)  # [N,C,A]
    xs, ys = cell_grid(box.device, box.dtype)

    # DISTANCE TO THE FOUR EDGES from this cell's centre, in stride units.
    #
    # The first implementation predicted the centre as (col + sigmoid(tx)) * stride, which
    # constrains a cell to place its box centre INSIDE ITSELF. Measured on the training
    # set, 76% of objects span more than one cell (mean 5.5, max 30) - so under that
    # parameterisation roughly four of every five positive cells were structurally
    # incapable of fitting their own target, and box loss floored at ~0.31 (mean IoU 0.69)
    # no matter how long it trained. The micro-overfit gate caught exactly this.
    #
    # With l, t, r, b every cell inside a box can describe that box exactly.
    ccx = (xs.unsqueeze(0) + 0.5) * STRIDE
    ccy = (ys.unsqueeze(0) + 0.5) * STRIDE
    # Clamped before exp: an unclamped exp on an early, badly-scaled activation produces inf
    # and poisons every downstream number with NaN.
    l = torch.exp(torch.clamp(box[:, 0], max=6.0)) * STRIDE
    t = torch.exp(torch.clamp(box[:, 1], max=6.0)) * STRIDE
    r = torch.exp(torch.clamp(box[:, 2], max=6.0)) * STRIDE
    b = torch.exp(torch.clamp(box[:, 3], max=6.0)) * STRIDE
    cx = ccx + (r - l) * 0.5
    cy = ccy + (b - t) * 0.5
    w = l + r
    h = t + b

    scores = torch.sigmoid(cls)
    return torch.cat([cx.unsqueeze(1), cy.unsqueeze(1), w.unsqueeze(1), h.unsqueeze(1), scores], dim=1)


class ExportWrapper(nn.Module):
    """Trunk + decode, so the ONNX artifact emits the contract directly."""

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, x):
        b, c = self.model(x)
        return decode(b, c)
