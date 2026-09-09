"""
S-04a-1b -- FINE instrumentation inside the pre-encoder embedding region.

The coarse pass put the first divergence at the very first checkpoint,
/vision_model/embeddings/Add_3_output_0, with a distinctive signature: most elements correct,
the tail garbage, max 3.69e8. That looks like an out-of-range read, not arithmetic error.

The embedding region is SigLIP's variable-resolution position-embedding logic --
NonZero -> ... -> ScatterND -> Gather(position_embedding) -> DequantizeLinear -> Add. These
checkpoints split that path so the failing node can be named rather than guessed.

Throwaway spike code.
"""
import json
import os

import onnx

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "models", "smolvlm_vision_encoder_int8.onnx")
OUT_DIR = os.path.join(HERE, "sliced")
os.makedirs(OUT_DIR, exist_ok=True)

# Ordered along the two paths that meet at the final Add:
#   A. the patch-embedding path   (image -> ConvInteger -> reshape/transpose)
#   B. the position-id path       (mask -> NonZero/Where/ScatterND -> Gather -> Dequantize)
WANT = [
    ("A1_gathernd_pixels", "/GatherND_output_0"),
    ("A2_conv_out", "/vision_model/embeddings/patch_embedding/Conv_output_0"),
    ("A3_reshape", "/vision_model/embeddings/Reshape_output_0"),
    ("A4_transpose", "/vision_model/embeddings/Transpose_output_0"),
    ("B1_nonzero", "/vision_model/embeddings/NonZero_output_0"),
    ("B2_reshape3", "/vision_model/embeddings/Reshape_3_output_0"),
    ("B3_flatten", "/vision_model/embeddings/Flatten_output_0"),
    ("B4_flatten1", "/vision_model/embeddings/Flatten_1_output_0"),
    ("B5_gather6", "/vision_model/embeddings/Gather_6_output_0"),
    ("B6_reshape4", "/vision_model/embeddings/Reshape_4_output_0"),
    ("B7_scatternd", "/vision_model/embeddings/ScatterND_output_0"),
    ("B8_posemb_gather", None),   # resolved below by prefix
    ("B9_posemb_dequant", None),
    ("C_add3", "/vision_model/embeddings/Add_3_output_0"),
]

m = onnx.load(SRC)
g = m.graph
produced = {o: n.op_type for n in g.node for o in n.output}

# resolve the two position_embedding tensors by prefix + op type
pos = [o for o in produced if o.startswith("/vision_model/embeddings/position_embedding/")]
gather_pos = [o for o in pos if produced[o] == "Gather"]
deq_pos = [o for o in pos if produced[o] == "DequantizeLinear"]

resolved = []
for label, t in WANT:
    if t is None:
        if label == "B8_posemb_gather" and gather_pos:
            t = gather_pos[0]
        elif label == "B9_posemb_dequant" and deq_pos:
            t = deq_pos[0]
        else:
            continue
    if t in produced:
        resolved.append((label, t))
    else:
        print("  (skipped, not in graph) %-22s %s" % (label, t))

# ORT Web drops promoted outputs that carry no type information -- native ORT infers them,
# ORT Web does not, and the first fine run silently returned 5 of 15 outputs because of it.
# Running shape inference first and copying the inferred ValueInfo fixes that.
inferred = onnx.shape_inference.infer_shapes(m, strict_mode=False, data_prop=True)
vinfo = {vi.name: vi for vi in inferred.graph.value_info}
for vi in list(inferred.graph.output) + list(inferred.graph.input):
    vinfo[vi.name] = vi

existing = {o.name for o in g.output}
missing_type = []
for label, t in resolved:
    if t in existing:
        continue
    if t in vinfo:
        g.output.append(vinfo[t])
    else:
        missing_type.append((label, t))
        vi = onnx.helper.ValueInfoProto()
        vi.name = t
        g.output.append(vi)
if missing_type:
    print("  WARNING: no inferred type for:", [l for l, _ in missing_type])

dst = os.path.join(OUT_DIR, "vision_encoder_int8_instrumented.onnx")
onnx.save(m, dst, save_as_external_data=False)
print("fine-instrumented model: %.2f MB" % (os.path.getsize(dst) / 1048576))
print("checkpoints:", len(resolved))
for label, t in resolved:
    print("   %-22s %-14s %s" % (label, produced[t], t))

with open(os.path.join(HERE, "checkpoints.json"), "w", encoding="utf8") as f:
    json.dump({"checkpoints": [{"label": l, "tensor": t, "op": produced[t]} for l, t in resolved],
               "final_output": "image_features"}, f, indent=1)
print("\nwrote checkpoints.json")
