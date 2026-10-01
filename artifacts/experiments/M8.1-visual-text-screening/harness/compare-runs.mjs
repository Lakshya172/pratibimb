#!/usr/bin/env node
/**
 * M8.1 — G4 across two COMPLETE runs, and the candidate's screening verdict.
 *
 * RE-1 G4: "boxes across two complete runs; outputs across >= 5 inferences per input —
 * byte-identical". Each run already checked its own five inferences per input; this checks that
 * run1 and run2 produced the same WASM outputs, the same native outputs and the same boxes on every
 * input. Then the held-out set is re-judged with that full G4, and the owner's M8.1 acceptance list
 * is applied by `screeningVerdict`, which was committed before any candidate ran.
 *
 * Usage: node artifacts/experiments/M8.1-visual-text-screening/harness/compare-runs.mjs TR-01|TR-02
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scoreSet } from "../../../../tests/browser/support/redaction-metrics.mjs";
import { screeningVerdict } from "../../../../tests/browser/support/text-detector-screening.mjs";

const EXP = dirname(dirname(fileURLToPath(import.meta.url)));
const cid = process.argv[2];
if (!["TR-01", "TR-02"].includes(cid)) {
  console.error("usage: compare-runs.mjs TR-01|TR-02");
  process.exit(1);
}
const read = (p) => JSON.parse(readFileSync(join(EXP, p), "utf8"));
const conversion = read(`logs/${cid.toLowerCase()}-conversion.json`);
const [r1, r2] = ["run1", "run2"].map((r) => read(`results/${cid.toLowerCase()}-${r}.json`));

const measured = !r1.failure && !r2.failure && r1.inputs && r2.inputs;
const perInput = {};
if (measured) {
  for (const name of Object.keys(r1.inputs)) {
    const a = r1.inputs[name];
    const b = r2.inputs[name];
    perInput[name] = {
      inputSame: a.inputSha256 === b.inputSha256,
      wasmSame: a.wasm.outputSha256 === b.wasm.outputSha256,
      nativeSame: a.native.outputSha256 === b.native.outputSha256,
      boxesSame: a.boxesSha256 === undefined ? null : a.boxesSha256 === b.boxesSha256,
      withinRun: a.wasm.deterministic && a.native.deterministic && b.wasm.deterministic && b.native.deterministic,
    };
  }
}
const deterministic =
  measured && Object.values(perInput).every((p) => p.inputSame && p.wasmSame && p.nativeSame && p.boxesSame !== false && p.withinRun);

const realistic = measured ? Object.keys(r1.inputs).filter((n) => n !== "synthetic") : [];
const wasmEvery = measured && realistic.every((n) => r1.inputs[n].s04a1.pass && r2.inputs[n].s04a1.pass);
const heldOutSet = measured
  ? scoreSet(r1.heldOut.perImage, { wasmPassedOnEveryInput: wasmEvery, deterministic, noPlaintextOutput: r1.g6.pass && r2.g6.pass })
  : null;

const verdict = screeningVerdict({
  provenanceVerified: conversion.identity?.licenceAtRevision === "apache-2.0" && conversion.identity?.matchesRepo === true,
  reproducible: conversion.reproducible === true,
  runtimeCompatible: measured && r1.web?.wasmIsPinned === true && r2.web?.wasmIsPinned === true,
  qg03RealisticPass: measured && r1.qg03RealisticCell.pass && r2.qg03RealisticCell.pass,
  heldOutPass: heldOutSet?.pass === true,
  deterministic,
  noPlaintext: measured && r1.g6.pass && r2.g6.pass,
  // Evaluation infrastructure only: nothing crosses a realm, nothing is recognised, nothing leaves.
  noBoundaryConflict: true,
  devScreenPass: measured && r1.developmentScreen.pass && r2.developmentScreen.pass,
});

const out = {
  candidate: cid,
  runsCompared: ["run1", "run2"],
  measured: Boolean(measured),
  g4: { deterministic, perInput },
  heldOutSetWithFullG4: heldOutSet,
  developmentScreenPass: measured ? r1.developmentScreen.pass && r2.developmentScreen.pass : null,
  qg03RealisticCell: measured ? { run1: r1.qg03RealisticCell, run2: r2.qg03RealisticCell } : null,
  syntheticDiagnostic: measured ? { run1: r1.inputs.synthetic.s04a1, run2: r2.inputs.synthetic.s04a1 } : null,
  verdict,
};
writeFileSync(join(EXP, "results", `${cid.toLowerCase()}-verdict.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ candidate: cid, g4: deterministic, set: heldOutSet?.gates, verdict }, null, 1));
