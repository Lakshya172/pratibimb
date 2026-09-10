/**
 * @pratibimb/evaluation — the QG-05 evaluation harness for the T1 UIElementDetector.
 *
 * SCOPE. QG-05 is the whole evaluation harness: five scored metrics plus task success
 * after privacy. This package implements ONE slice — the visual-context metric (25%):
 * element mAP@0.5, element recall and grounding accuracy. The other four need T2, the
 * server or the executor, none of which exist.
 *
 * The evaluator exists BEFORE any detector, deliberately. A metric invented after seeing a
 * model's output is a metric chosen to flatter it.
 *
 * This package makes no network calls, compiles no WebAssembly, and downloads nothing.
 * Asserted by test, not by convention.
 */
export {
  type EvalClass, type SampleProvenance, type Split, type Annotation,
  type Sample, type Dataset,
  canonicalize, datasetHash, sealDataset,
} from "./dataset.js";

export {
  EVAL_CLASSES, LabelError,
  validateSample, assertNoLeakage, assertIntegrity, validateDataset,
} from "./labels.js";

export {
  type GeneratorConfig, type DatasetSpec,
  GENERATOR, GENERATOR_VERSION, DEFAULT_CONFIG,
  mulberry32, generateSample, generateDataset,
} from "./generator.js";

export {
  type Figure, type Prediction, type RunContext,
  type ClassMetrics, type EvaluationResult,
  IOU_THRESHOLD, measured, iou, rejectionReason, evaluate, sweepThreshold,
} from "./evaluator.js";

export {
  BASELINE_MODEL,
  perfectBaseline, emptyBaseline, shiftedBaseline, classSwappedBaseline,
} from "./baselines.js";

export { type RenderSpec, makeSpec, specToHtml } from "./renderSpec.js";
