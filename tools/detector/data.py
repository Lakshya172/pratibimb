"""
Dataset loading: manifest + rendered PNG -> letterboxed tensor + per-cell targets.

Deterministic throughout. No augmentation in this first pipeline - augmentation changes
what the model sees between runs, and the immediate goal is a pipeline whose behaviour is
attributable. Once micro-overfit passes and a baseline exists, augmentation can be added
as a measurable change rather than an untested assumption.
"""

import json
import os

import numpy as np
import torch
from PIL import Image

from head import INPUT_SIZE, PAD_VALUE
from targets import CLASS_INDEX, assign_targets, css_box_to_model, letterbox_params


def load_manifest(root):
    with open(os.path.join(root, "manifest.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def letterbox_image(img, size=INPUT_SIZE):
    """
    Uniform scale, then centre-pad with the contract's pad value.

    BILINEAR, not NEAREST: nearest-neighbour aliases thin borders, and a one-pixel control
    border is most of the visual evidence that a textbox is a textbox.
    """
    w, h = img.size
    scale = min(size / w, size / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    resized = img.convert("RGB").resize((nw, nh), Image.BILINEAR)

    pad = int(round(PAD_VALUE * 255))
    canvas = Image.new("RGB", (size, size), (pad, pad, pad))
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def sample_to_tensors(root, sample):
    """One manifest sample -> (image [3,640,640], pos [A], box_t [A,4], cls_t [A,C])."""
    img = Image.open(os.path.join(root, sample["framePath"]))
    canvas = letterbox_image(img)

    x = np.asarray(canvas, dtype=np.float32) / 255.0  # HWC, 0..1
    x = np.transpose(x, (2, 0, 1))  # CHW, matching the NCHW contract

    cap = sample["captureSize"]
    vp = sample["viewportCss"]
    # CSS -> capture. Kept explicit rather than assumed equal to dpr, so a downscaled
    # capture would still convert correctly.
    css_to_cap = cap["w"] / vp["w"]
    scale, pad_x, pad_y = letterbox_params(cap["w"], cap["h"])

    boxes, class_ids = [], []
    for a in sample["annotations"]:
        # OFFSCREEN elements are not visible in the frame. Training on them would teach the
        # model to hallucinate controls in empty space - the exact fabrication the
        # perception contract forbids.
        if a["visibility"] == "OFFSCREEN":
            continue
        if a["cls"] not in CLASS_INDEX:
            continue
        bx = css_box_to_model(a["box"], css_to_cap, scale, pad_x, pad_y)
        # Clip to the letterboxed content; a clipped control is still a real target, but
        # only the part that exists in the frame is.
        cx0, cy0 = max(bx[0], pad_x), max(bx[1], pad_y)
        cx1 = min(bx[0] + bx[2], INPUT_SIZE - pad_x)
        cy1 = min(bx[1] + bx[3], INPUT_SIZE - pad_y)
        if cx1 - cx0 <= 1.0 or cy1 - cy0 <= 1.0:
            continue
        boxes.append((cx0, cy0, cx1 - cx0, cy1 - cy0))
        class_ids.append(CLASS_INDEX[a["cls"]])

    pos, box_t, cls_t = assign_targets(boxes, class_ids)
    return (
        torch.from_numpy(x),
        torch.from_numpy(pos),
        torch.from_numpy(box_t),
        torch.from_numpy(cls_t),
    )


class SplitDataset(torch.utils.data.Dataset):
    def __init__(self, root, split, limit=None):
        self.root = root
        manifest = load_manifest(root)
        self.name = manifest["name"]
        self.version = manifest["version"]
        self.hash = manifest["hash"]
        self.samples = [s for s in manifest["samples"] if s["split"] == split]
        if limit is not None:
            # Deterministic prefix, never a random subset: a "small run" must be the same
            # small run every time or its results cannot be compared.
            self.samples = self.samples[:limit]

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, i):
        return sample_to_tensors(self.root, self.samples[i])
