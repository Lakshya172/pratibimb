"""
S-04a-1b -- LAYER-WISE INSTRUMENTATION of the SmolVLM int8 vision encoder.

Task section 4: do not compare only the final output; find the FIRST point of divergence.

This promotes a set of intermediate tensors to graph outputs so CPU, WASM and WebGPU can be
compared at each checkpoint. Checkpoints are the natural boundaries: the embedding output,
the residual Add at the end of each of the 12 encoder layers, and the post-layernorm.

KNOWN CONFOUND, stated up front: adding graph outputs changes what ORT may fuse and how the
WebGPU EP partitions the graph, so an instrumented run is not bit-identical in principle to an
uninstrumented one. That is why a candidate found here is confirmed afterwards with a
standalone minimal subgraph (section 5) rather than trusted on its own.

Nothing is committed -- the instrumented model is generated from the pinned original.

Throwaway spike code.
"""
import json
import os
import re

import onnx

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "models", "smolvlm_vision_encoder_int8.onnx")
OUT_DIR = os.path.join(HERE, "sliced")
os.makedirs(OUT_DIR, exist_ok=True)

m = onnx.load(SRC)
g = m.graph

produced = {}
for n in g.node:
    for o in n.output:
        produced[o] = n.op_type

checkpoints = []

# pre-encoder: the embedding output feeding layer 0
emb = [o for o in produced if o.startswith("/vision_model/embeddings/") and produced[o] == "Add"]
if emb:
    checkpoints.append(("embeddings", emb[-1]))

# each encoder layer's final residual Add
for i in range(12):
    name = "/vision_model/encoder/layers.%d/Add_1_output_0" % i
    if name in produced:
        checkpoints.append(("layer_%02d" % i, name))

# post layernorm, and the connector reshape just before the final quantised projection
for label, nm in [("post_layernorm", "/vision_model/post_layernorm/Add_1_output_0"),
                  ("connector_reshape3", "/connector/Reshape_3_output_0")]:
    if nm in produced:
        checkpoints.append((label, nm))

existing = {o.name for o in g.output}
added = []
for label, tensor in checkpoints:
    if tensor in existing:
        continue
    # ValueInfoProto with no declared type/shape: ORT infers it. Declaring a wrong shape
    # would be worse than declaring none.
    vi = onnx.helper.ValueInfoProto()
    vi.name = tensor
    g.output.append(vi)
    added.append((label, tensor))

dst = os.path.join(OUT_DIR, "vision_encoder_int8_instrumented.onnx")
onnx.save(m, dst, save_as_external_data=False)
print("instrumented model: %s  (%.2f MB)" % (os.path.basename(dst), os.path.getsize(dst) / 1048576))
print("checkpoints promoted to outputs:", len(added))
for label, t in added:
    print("   %-20s %s" % (label, t))

with open(os.path.join(HERE, "checkpoints.json"), "w", encoding="utf8") as f:
    json.dump({"checkpoints": [{"label": l, "tensor": t} for l, t in checkpoints],
               "final_output": "image_features"}, f, indent=1)
print("\nwrote checkpoints.json")
