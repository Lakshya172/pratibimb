#!/usr/bin/env bash
# S-04a model acquisition. Weights are NEVER committed - this script is the record.
#
#   model     face_detection_yunet_2023mar.onnx  (YuNet face detector)
#   source    opencv/opencv_zoo, models/face_detection_yunet/
#   revision  47534e27c9851bb1128ccc0102f1145e27f23f98   (opencv_zoo HEAD at fetch time)
#   licence   Apache License 2.0, read FROM THAT REVISION
#   size      232589 bytes
#   sha256    8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4
#
# Verify the hash before use. A mismatch means the artifact is not the one measured.
set -e
REV=47534e27c9851bb1128ccc0102f1145e27f23f98
F=face_detection_yunet_2023mar.onnx
EXPECT=8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4
mkdir -p models
curl -sSL --max-time 300 -o "models/$F" \
  "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/$F"
GOT=$(sha256sum "models/$F" | cut -d' ' -f1)
echo "expected $EXPECT"
echo "got      $GOT"
[ "$GOT" = "$EXPECT" ] || { echo "HASH MISMATCH - refusing"; exit 1; }
echo "licence (Apache-2.0) at the pinned revision:"
curl -sSL --max-time 60 "https://raw.githubusercontent.com/opencv/opencv_zoo/$REV/LICENSE" | head -2
