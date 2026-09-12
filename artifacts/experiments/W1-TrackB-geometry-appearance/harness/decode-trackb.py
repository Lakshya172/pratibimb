"""
Track B — decode the rendered PNGs to raw RGBA.

  python artifacts/experiments/W1-TrackB-geometry-appearance/harness/decode-trackb.py

This does NOT contain a decoder. It loads the merged W-1 decoder and points it at Track B's
generated tree by overriding the one module-level constant that decides where it looks.

Copying decode-w1-png.py would have been three lines shorter and wrong: the two experiments would
then have two decoders that are identical until the day someone edits one of them, and the whole
reason Track B waited for PR #52 was to score against the same governed code. Reusing the module
means a change there is a change here, visibly.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GOVERNED = os.path.join(
    HERE, "..", "..", "W1-detector-precision-scale", "harness", "decode-w1-png.py"
)

if not os.path.exists(GOVERNED):
    sys.stderr.write(f"the governed decoder is missing at {GOVERNED}\n")
    sys.exit(2)

spec = importlib.util.spec_from_file_location("w1_decode", GOVERNED)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

# The only thing Track B changes: which tree is decoded.
mod.GEN = os.path.join(HERE, "generated")
print(f"governed decoder: {os.path.normpath(GOVERNED)}")
print(f"tree            : {mod.GEN}\n")
mod.main()
