/**
 * QG-03a-B3-1 analysis for ONE machine.
 *
 *   node .../harness/analyze-b3.mjs [--log-dir=<dir under logs/>]
 *
 * Refuses a native reference or a cell that fails its guard (b3-guards.mjs), re-verifies every
 * raw dump against its logged digest, then compares, per realm, each browser cell against the
 * native ORT 1.29.0 CPU reference through the SHIPPED decode and NMS (b3-criterion.mjs), and
 * applies the candidate B1 criterion at the ACTUAL measured difference.
 *
 * Gating pairs, per realm: native vs WASM, native vs WebGPU. Reported, not gating: WASM vs
 * WebGPU (B2's pair) and document vs worker for the same backend.
 *
 * The criterion is reported on ALL 20 fixtures and on the 18 UI fixtures, because B4
 * (gradients-edges STRESS-ONLY) is proposed but not approved. gradients-edges is never dropped:
 * its margin is reported, and a failure at the real difference is flagged for escalation.
 *
 * Exit: 0 criterion met on every gating pair (both readings); 4 not met on at least one
 * reading; 1 evidence incomplete or rejected. None of these is a B3-1 verdict: a development
 * run can never satisfy B3-1, and a workstation-1 run is recorded only after review.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BACKENDS, EXPERIMENT, REALMS, cellName, evidenceClassFor, selectPngFixtures, sha256Hex, verifyCellLog, verifyNativeLog } from "./b3-guards.mjs";
import { CRITERION, compare, criterionOver, detect, geometry, scaledDelta } from "./b3-criterion.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const ROOT = join(HERE, "..", "..", "..", "..");
const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);
const argDir = (process.argv.find((a) => a.startsWith("--log-dir=")) || "").slice(10) || null;
const ev = evidenceClassFor(os.hostname());
const logDir = argDir || ev.logDir;
const LOGS = join(EXP, "logs", logDir);
const GEN = join(HERE, "generated", logDir);
const fixtures = selectPngFixtures(JSON.parse(readFileSync(join(ROOT, "artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/fixtures.json"), "utf8")));
const geom = Object.fromEntries(fixtures.map((f) => [f.name, geometry(P, f)]));
const ALPHAS = [1, 2, 5, 10, 50, 100];
const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);

function loadDumps(cell, log) {
  const out = {};
  for (const f of fixtures) {
    const row = log.rows.find((r) => r.name === f.name);
    const p = join(GEN, cell, `${f.name}.f32`);
    if (!row || !existsSync(p)) throw new Error(`${cell}/${f.name}: dump missing`);
    const buf = readFileSync(p);
    if (sha256Hex(buf) !== row.outputSha256) throw new Error(`${cell}/${f.name}: dump does not match the logged digest`);
    out[f.name] = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  }
  return out;
}

// ── evidence ──────────────────────────────────────────────────────────────────────────────
const cellStatus = {};
const logs = {};
const outputs = {};
const nativePath = join(LOGS, "b3-native-cpu.json");
const native = existsSync(nativePath) ? JSON.parse(readFileSync(nativePath, "utf8")) : null;
const ng = verifyNativeLog(native, fixtures);
cellStatus["native-cpu"] = ng.ok ? "ACCEPTED" : { rejected: ng.failures };
if (ng.ok) {
  try { outputs["native-cpu"] = loadDumps("native-cpu", native); logs["native-cpu"] = native; } catch (e) { cellStatus["native-cpu"] = { rejected: [String(e.message)] }; }
}
const REQUIRED = REALMS.flatMap((realm) => BACKENDS.map((b) => cellName(realm, b)));
for (const c of REQUIRED) {
  const p = join(LOGS, `b3-${c}.json`);
  if (!existsSync(p)) { cellStatus[c] = "MISSING"; continue; }
  const l = JSON.parse(readFileSync(p, "utf8"));
  const g = verifyCellLog(l, fixtures);
  if (!g.ok) { cellStatus[c] = { rejected: g.failures }; continue; }
  try { outputs[c] = loadDumps(c, l); logs[c] = l; cellStatus[c] = "ACCEPTED"; } catch (e) { cellStatus[c] = { rejected: [String(e.message)] }; }
}
const complete = ["native-cpu", ...REQUIRED].every((c) => cellStatus[c] === "ACCEPTED");

// The same input tensor must reach every cell, or nothing below is comparable.
const inputAgreement = fixtures.map((f) => {
  const shas = { reference: f.tensorSha256 };
  for (const c of Object.keys(logs)) shas[c] = logs[c].rows.find((r) => r.name === f.name)?.tensorSha256 ?? null;
  return { name: f.name, identical: new Set(Object.values(shas)).size === 1 };
});

// ── comparisons ───────────────────────────────────────────────────────────────────────────
function pair(a, b) {
  if (!outputs[a] || !outputs[b]) return { pair: `${a} vs ${b}`, unavailable: true };
  const rows = fixtures.map((f) => ({ name: f.name, stressOnlyProposed: f.stressOnlyProposed, ...compare(P, outputs[a][f.name], outputs[b][f.name], geom[f.name]) }));
  const raw = rows.map((r) => r.raw);
  return {
    pair: `${a} vs ${b}`,
    bitwiseIdenticalFixtures: raw.filter((x) => x.elementsDiffering === 0).length,
    raw: {
      maxAbs: Math.max(...raw.map((x) => x.maxAbs)),
      meanAbsMax: Math.max(...raw.map((x) => x.meanAbs)),
      meanSignedRange: [Math.min(...raw.map((x) => x.meanSigned)), Math.max(...raw.map((x) => x.meanSigned))],
      boxChannelMaxAbs: Math.max(...raw.map((x) => x.boxChannelMaxAbs)),
      classChannelMaxAbs: Math.max(...raw.map((x) => x.classChannelMaxAbs)),
      maxRelative: Math.max(...raw.map((x) => x.maxRelative)),
    },
    all20: criterionOver(rows),
    ui18: criterionOver(rows.filter((r) => !r.stressOnlyProposed)),
    stressOnlyProposed: rows.filter((r) => r.stressOnlyProposed).map((r) => ({ name: r.name, b1Pass: r.b1Pass, error: r.error ?? null, shipped: r.shipped ?? null })),
    perFixture: rows.map((r) => ({ name: r.name, raw: r.raw, tauCss: r6(r.tauCss), error: r.error ?? null, b1Pass: r.b1Pass, shipped: r.shipped ?? null, op055: r.op055 ?? null })),
  };
}
const gating = [];
const reported = [];
for (const realm of REALMS) {
  const w = cellName(realm, "wasm"), g = cellName(realm, "webgpu");
  gating.push(pair("native-cpu", w), pair("native-cpu", g));
  reported.push(pair(w, g));
}
for (const b of BACKENDS) reported.push(pair(cellName("document", b), cellName("worker", b)));

// Margin, never a gate: scale the ACTUAL native -> WebGPU difference.
const margin = {};
for (const realm of REALMS) {
  const g = cellName(realm, "webgpu");
  if (!outputs["native-cpu"] || !outputs[g]) continue;
  margin[realm] = fixtures.map((f) => {
    let firstFailingAlpha = null;
    for (const a of ALPHAS) {
      const c = scaledDelta(P, outputs["native-cpu"][f.name], outputs[g][f.name], geom[f.name], a);
      if (!c.b1Pass) { firstFailingAlpha = a; break; }
    }
    return { name: f.name, stressOnlyProposed: f.stressOnlyProposed, firstFailingAlpha };
  });
}
const escalations = [];
for (const p of gating) {
  if (p.unavailable) continue;
  for (const s of p.stressOnlyProposed) if (!s.b1Pass) escalations.push(`${s.name} fails at 1x the real difference in ${p.pair}: ESCALATE TO OWNER/ARCHITECT`);
}

// ── decoded detections, full precision, emission order (the NMS survivors) ─────────────────
mkdirSync(join(LOGS, "detections"), { recursive: true });
const decoded = {};
for (const c of Object.keys(outputs)) {
  const perFixture = {};
  decoded[c] = fixtures.map((f) => {
    const d = detect(P, outputs[c][f.name], geom[f.name]);
    if (d.error) { perFixture[f.name] = { error: d.error }; return { name: f.name, error: d.error }; }
    perFixture[f.name] = d.map((x) => [x.label, x.score, x.box.x, x.box.y, x.box.w, x.box.h]);
    const classes = {};
    for (const x of d) classes[x.label] = (classes[x.label] || 0) + 1;
    return { name: f.name, count: d.length, classes, orderedDigest: sha256Hex(JSON.stringify(perFixture[f.name])).slice(0, 16) };
  });
  writeFileSync(join(LOGS, "detections", `${c}.json`), JSON.stringify({ cell: c, units: "CSS px; [label, score, x, y, w, h]; shipped decode + NMS emission order", fixtures: perFixture }));
}

// ── performance ───────────────────────────────────────────────────────────────────────────
const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const p95 = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.95)] : null);
const performance = Object.fromEntries(Object.entries(logs).map(([c, l]) => {
  const rows = l.rows.filter((r) => !r.error);
  const warm = rows.flatMap((r) => (r.inferMs || []).slice(1));
  return [c, { sessionCreateMs: l.sessionCreateMs ?? null, firstInferenceMs: rows[0]?.inferMs?.[0] ?? null, warmMedianMs: med(warm), warmP95Ms: p95(warm), decodeNmsMedianMs: med(rows.map((r) => r.decodeNmsMs).filter((x) => x !== undefined)), preprocessMedianMs: med(rows.map((r) => r.preprocessMs).filter((x) => x !== undefined)) }];
}));

const readings = { all20: gating.every((p) => !p.unavailable && p.all20.met), ui18: gating.every((p) => !p.unavailable && p.ui18.met) };
const verdict = !complete
  ? "EVIDENCE INCOMPLETE OR REJECTED"
  : readings.all20 && readings.ui18
    ? "CRITERION MET ON EVERY GATING PAIR (all-20 and UI-18 readings)"
    : readings.ui18
      ? "CRITERION MET ON THE UI-18 READING ONLY (gradients-edges fails; B4 not approved)"
      : "CRITERION NOT MET";
const out = {
  experiment: EXPERIMENT,
  runAt: new Date().toISOString(),
  logDir,
  evidenceClass: logs["native-cpu"]?.evidenceClass ?? ev.evidenceClass,
  b3_1: ev.workstation1 && logDir === "workstation-1"
    ? "NOT RECORDED: a workstation-1 candidate run; B3-1 is recorded only after review"
    : "NOT SATISFIED BY THIS RUN: DEVELOPMENT / NON-W1 EVIDENCE",
  criterion: CRITERION,
  cellStatus,
  complete,
  cellIdentity: Object.fromEntries(Object.entries(logs).map(([c, l]) => [c, { browser: l.browser ?? null, ortVersion: l.runtime?.ortEnvVersions ?? l.ortVersion ?? null, adapter: l.gpu?.adapterFromRequestAdapter ?? null, submitsDuringInference: l.gpu?.submitsDuringInference ?? null, context: l.context ?? null, machine: l.machine?.hostname ?? null }])),
  inputAgreement: { fixtures: inputAgreement.length, identicalAcrossCellsAndReference: inputAgreement.filter((x) => x.identical).length },
  gating,
  reported,
  margin,
  escalations,
  decoded,
  performance,
  readings,
  verdict,
};
writeFileSync(join(LOGS, "b3-analysis.json"), JSON.stringify(out, null, 1));

console.log(`[${out.evidenceClass}] logs/${logDir}`);
for (const [c, s] of Object.entries(cellStatus)) console.log(`  ${c.padEnd(24)} ${s === "ACCEPTED" || s === "MISSING" ? s : "REJECTED: " + s.rejected.slice(0, 3).join("; ")}`);
console.log(`input tensors identical across cells and reference: ${out.inputAgreement.identicalAcrossCellsAndReference}/${out.inputAgreement.fixtures}`);
for (const p of [...gating, ...reported]) {
  if (p.unavailable) { console.log(`PAIR ${p.pair}: UNAVAILABLE`); continue; }
  const s = p.all20.shipped;
  console.log(`PAIR ${p.pair}: bitwise ${p.bitwiseIdenticalFixtures}/20; raw max ${p.raw.maxAbs.toExponential(3)} box ${p.raw.boxChannelMaxAbs.toExponential(3)} cls ${p.raw.classChannelMaxAbs.toExponential(3)}`);
  console.log(`   shipped: refDet ${s.refDetections} identical ${s.identical} sameAnchor ${s.sameAnchor} swap ${s.survivorSwap} TRUE ${s.trueFailures} worstDisp ${r6(s.worstMatchedDispCss)} | criterion all-20 ${p.all20.fixturesMeeting}/20, UI-18 ${p.ui18.fixturesMeeting}/18`);
}
for (const [realm, rows] of Object.entries(margin)) console.log(`MARGIN ${realm}: ${rows.filter((r) => r.firstFailingAlpha !== null).map((r) => `${r.name}@${r.firstFailingAlpha}x`).join(", ") || "no failure up to 100x"}`);
for (const e of escalations) console.log(`ESCALATE ${e}`);
console.log(`VERDICT (harness, not B3-1): ${verdict}`);
console.log(`B3-1: ${out.b3_1}`);
process.exit(!complete ? 1 : readings.all20 && readings.ui18 ? 0 : 4);
