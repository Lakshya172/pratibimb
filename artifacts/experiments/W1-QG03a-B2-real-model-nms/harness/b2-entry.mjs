// Bundle entry for run-b2-browser.mjs. It re-exports the SHIPPED compiled code, unchanged:
// the production preprocessing, the shipped decode, and the production ORT runtime pin and
// session factory (the same calls apps/extension/entrypoints/ortRuntime.ts makes).
export { preprocessToTensor, HEAD_CONTRACT, decodeHeadOutput } from "../../../../packages/perception/dist/src/index.js";
export {
  assertWasmCompilationAllowed,
  installVerifiedOrtRuntime,
  createPinnedInferenceSession,
} from "../../../../packages/security/dist/src/index.js";
