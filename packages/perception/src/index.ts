/**
 * @pratibimb/perception — the perception substrate.
 *
 *   OBSERVE → CAPTURE → NORMALIZE → ELEMENT GRAPH → UI DETECTION → FUSION → PERCEPTION STATE
 *
 * Two rules run through every module here and are enforced by types rather than review:
 *
 *   1. CSS viewport pixels is canonical, and every space conversion is explicit and
 *      geometry-bearing. A raw number cannot be mistaken for a coordinate.
 *   2. Perception never claims what it did not observe. An off-screen element is
 *      structurally incapable of carrying pixel evidence.
 *
 * This package makes no network calls and compiles no WebAssembly. That is asserted by
 * test, not by convention — see `test/g5Structural.test.ts`.
 */
export {
  type CssPx, type DevicePx, type CapturePx, type DocPx,
  type Box, type CssBox, type DeviceBox, type CaptureBox, type DocBox,
  cssPx, devicePx, capturePx, docPx,
  cssBox, deviceBox, captureBox, docBox, toBboxArray,
} from "./space.js";

export {
  type Size, type ScrollOffset, type CaptureGeometry, type Containment,
  scaleToCss, assertGeometryConsistent,
  deviceToCss, cssToDevice, captureToCss, cssToCapture,
  cssToDocument, documentToCss,
  classifyContainment, clipToViewport,
} from "./coordinates.js";

export {
  type PerceptionErrorCode, type Perceived,
  PerceptionError, ok, refuse,
} from "./failure.js";

export {
  type FrameId, type VisualEvidence,
  frameId, admitsVisualEvidence, manifestVisibility,
} from "./observation.js";

export {
  type CaptureFrame, type ViewportMeasurement, type CaptureAdapter, type TabsCaptureApi,
  DEFAULT_FRAME_TTL_MS,
  geometryFrom, isStale, assertFresh, decodeDataUrl, createTabCaptureAdapter,
} from "./capture.js";

export {
  type NodeId, type DomRef, type DomMeasurement, type ElementNode, type ElementGraph,
  nodeId, buildElementGraph, classifyEvidence,
} from "./elementGraph.js";

export {
  type Backend, type DetectorRole, type Detection, type VisualDetection,
  type Detector, type Admissibility,
  DetectorRegistry, validateDetections, toVisualDetections,
} from "./detector.js";

export {
  type Provenance, type FusedElement, type FusionResult,
  FUSION_IOU_THRESHOLD, OVERLAY_SUSPICION_FLOOR,
  iou, fuse, manifestSource,
} from "./fusion.js";

export {
  type ChangeSignal, type ChangePolicy, type RefreshDecision,
  DEFAULT_CHANGE_POLICY, ChangeGate, frameHash,
} from "./changeDetection.js";

export {
  type CapabilityReport, type PerceptionState,
  type SanitizedHandoff, type SanitizedElement,
  projectElement, projectElements,
} from "./perceptionState.js";
