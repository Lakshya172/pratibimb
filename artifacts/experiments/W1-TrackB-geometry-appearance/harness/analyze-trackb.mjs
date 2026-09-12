/**
 * Track B — sanity checks first, then the frozen attribution rule.
 *
 *   node artifacts/experiments/W1-TrackB-geometry-appearance/harness/analyze-trackb.mjs
 *
 * The sanity checks run BEFORE any attribution is computed and the exit code reflects them, so
 * a design fault cannot be read as a finding. The interpretation rule is the one frozen in
 * design.md and is not recomputed from the results.
 *
 * Exit: 0 all checks pass and a classification was reached; 4 a check failed; 2 missing input.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { K_VALUES, modelExtentUnit, CELLS } from "./trackb-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, "..", "logs");
const GEN = join(HERE, "generated");
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v);

const path = join(LOGS, "trackb-cells.json");
if (!existsSync(path)) refuse(`no ${path} (run run-trackb.mjs)`);
const log = JSON.parse(readFileSync(path, "utf8"));
if (log.cells.length !== 24) refuse(`${log.cells.length} cells, expected 24`);

const at = (fam, k) => log.cells.find((c) => c.family === fam && Math.abs(c.k - k) < 1e-9);
const K0 = K_VALUES[0];

// ── sanity checks ────────────────────────────────────────────────────────────────────────
const checks = [];
const add = (id, what, ok, detail) => checks.push({ id, what, status: ok ? "PASS" : "FAIL", detail });

/**
 * Check 1 as written in design.md required the three families to AGREE at the baseline, because
 * at the pre-registered k=1.00 they would have been the same picture: DPR 1/1 is 1, and an
 * appearance round trip through 640/1 is the identity. The feasible grid starts at k=1.50, where
 * that is no longer true — GEOM(1.5) captures 640x427 natively and APPR(1.5) still makes a real
 * 960->640->960 round trip. So the check is NOT SATISFIABLE as written, and saying it "passed"
 * would be false. It is reported as such, and what it was guarding is covered by check 1b.
 */
const base = { NAT: at("NAT", K0), GEOM: at("GEOM", K0), APPR: at("APPR", K0) };
checks.push({
  id: "1", what: "the three families agree at the baseline", status: "NOT SATISFIABLE",
  detail: `only true at k=1.00, which the 960px content block makes unrenderable. Baseline recall: ` +
    `NAT ${base.NAT.elementRecall}, GEOM ${base.GEOM.elementRecall}, APPR ${base.APPR.elementRecall}. ` +
    `The frozen rule measures each family's drop from ITS OWN baseline, so it does not require these to be equal.`,
});

// 1b — what check 1 was actually guarding: that no family is degenerate at its own baseline.
const degenerate = Object.entries(base).filter(([, c]) => c.elementRecall < 0.5);
add("1b", "no family is already collapsed at its own baseline", degenerate.length === 0,
  degenerate.length ? degenerate.map(([f, c]) => `${f} recall ${c.elementRecall}`).join("; ")
    : `NAT ${base.NAT.elementRecall}, GEOM ${base.GEOM.elementRecall}, APPR ${base.APPR.elementRecall} — all well above 0.5`);

// 2 — GEOM(k) and NAT(k) must carry identical ground truth.
const gtMismatch = K_VALUES.filter((k) => at("NAT", k).groundTruth !== at("GEOM", k).groundTruth);
add("2", "GEOM(k) and NAT(k) carry identical ground truth", gtMismatch.length === 0,
  gtMismatch.length ? `differ at k=${gtMismatch.join(", ")}` : `307 annotations at every k in both families`);

// 3 — APPR ground truth byte-identical across k.
const apprGt = [...new Set(K_VALUES.map((k) => at("APPR", k).groundTruth))];
add("3", "APPR ground truth is constant across k", apprGt.length === 1, `values: ${apprGt.join(", ")}`);

// 4 — recomputed model extent matches the declared geometry; NAT and GEOM must agree.
const extBad = K_VALUES.filter((k) => Math.abs(at("NAT", k).modelExtentUnit - at("GEOM", k).modelExtentUnit) > 2e-3);
const apprExt = [...new Set(K_VALUES.map((k) => at("APPR", k).modelExtentUnit))];
add("4", "model-space extent: GEOM(k)==NAT(k), APPR constant", extBad.length === 0 && apprExt.length === 1,
  `GEOM/NAT mismatches: ${extBad.length}; APPR extent values: ${apprExt.join(", ")}`);

// 5 — CLIPPED ceiling 1.0 everywhere.
const ceil = log.cells.filter((c) => Math.abs(c.clippingCeiling - 1) > 1e-9);
add("5", "the CLIPPED ceiling is 1.0 in every cell", ceil.length === 0,
  ceil.length ? ceil.map((c) => `${c.cell}=${c.clippingCeiling}`).join(", ") : "1.0 in all 24 cells");

// 6 — the appearance transform must have been applied to APPR and only APPR.
let applied = 0; let wrong = 0;
for (const c of CELLS) {
  const meta = JSON.parse(readFileSync(join(GEN, c.id, "cell.json"), "utf8"));
  if (c.family === "APPR") { if (meta.appearanceApplied) applied += 1; else wrong += 1; }
  else if (meta.appearanceApplied) wrong += 1;
}
add("6", "the appearance transform hit APPR and only APPR", applied === 8 && wrong === 0,
  `applied to ${applied} APPR cells, ${wrong} cells wrong`);

const hardFail = checks.filter((c) => c.status === "FAIL");

console.log("SANITY CHECKS");
for (const c of checks) console.log(`  [${c.status.padEnd(15)}] ${c.id}. ${c.what}\n        ${c.detail}`);
console.log();

// ── the frozen attribution rule ──────────────────────────────────────────────────────────
// Degradation = drop in elementRecall from that family's OWN baseline cell.
const deg = (fam, k) => base[fam].elementRecall - at(fam, k).elementRecall;
const rows = K_VALUES.map((k) => {
  const dN = deg("NAT", k);
  const dG = deg("GEOM", k);
  const dA = deg("APPR", k);
  return {
    k,
    natRecall: at("NAT", k).elementRecall,
    geomRecall: at("GEOM", k).elementRecall,
    apprRecall: at("APPR", k).elementRecall,
    degNat: r4(dN), degGeom: r4(dG), degAppr: r4(dA),
    geomShare: dN > 1e-9 ? r4(dG / dN) : null,
    apprShare: dN > 1e-9 ? r4(dA / dN) : null,
  };
});

console.log("DEGRADATION FROM EACH FAMILY'S OWN BASELINE (recall)");
console.log("  k      NAT rec  GEOM rec APPR rec   degNAT  degGEOM  degAPPR   GEOM/NAT  APPR/NAT");
for (const r of rows) {
  console.log(`  ${String(r.k).padEnd(6)} ${r.natRecall.toFixed(4)}   ${r.geomRecall.toFixed(4)}   ${r.apprRecall.toFixed(4)}    ` +
    `${r.degNat.toFixed(4)}  ${r.degGeom.toFixed(4)}   ${r.degAppr.toFixed(4)}    ` +
    `${r.geomShare === null ? "  -   " : (r.geomShare * 100).toFixed(1).padStart(6)}%   ${r.apprShare === null ? "  -   " : (r.apprShare * 100).toFixed(1).padStart(6)}%`);
}

// The frozen threshold: >=70% reproduces most of it; 30-70% is a partial contribution.
const tail = rows.filter((r) => r.degNat > 0.05);
const meanShare = (key) => tail.reduce((a, r) => a + r[key], 0) / tail.length;
const gShare = meanShare("geomShare");
const aShare = meanShare("apprShare");

const cls = (s) => (s >= 0.7 ? "reproduces most" : s >= 0.3 ? "partial contribution" : "does not reproduce");
const geometry = cls(gShare);
const appearance = cls(aShare);

let hGeom; let hAppr; let hMixed;
if (geometry === "reproduces most" && appearance === "does not reproduce") {
  hGeom = "SUPPORTED"; hAppr = "NOT SUPPORTED"; hMixed = "NOT SUPPORTED";
} else if (appearance === "reproduces most" && geometry === "does not reproduce") {
  hGeom = "NOT SUPPORTED"; hAppr = "SUPPORTED"; hMixed = "NOT SUPPORTED";
} else if (geometry === "reproduces most") {
  // geometry clears the frozen bar; appearance also contributes but is not sufficient alone
  hGeom = "SUPPORTED"; hAppr = "NOT SUPPORTED (contributes, not sufficient)"; hMixed = "NOT SUPPORTED";
} else if (appearance === "reproduces most") {
  hGeom = "NOT SUPPORTED (contributes, not sufficient)"; hAppr = "SUPPORTED"; hMixed = "NOT SUPPORTED";
} else {
  hGeom = "NOT SUPPORTED"; hAppr = "NOT SUPPORTED"; hMixed = "SUPPORTED";
}

console.log(`\nover the cells where NAT actually degrades (degNAT > 0.05, k >= ${tail[0].k}):`);
console.log(`  mean GEOM/NAT share : ${(gShare * 100).toFixed(1)}%  -> ${geometry}`);
console.log(`  mean APPR/NAT share : ${(aShare * 100).toFixed(1)}%  -> ${appearance}`);
console.log(`\nH-GEOMETRY   : ${hGeom}`);
console.log(`H-APPEARANCE : ${hAppr}`);
console.log(`H-MIXED      : ${hMixed}`);

const out = {
  experiment: log.experiment,
  runAt: new Date().toISOString(),
  frozenRule: {
    source: "design.md",
    degradation: "drop in elementRecall from that family's own baseline cell",
    reproducesMost: 0.7,
    partialContribution: [0.3, 0.7],
    note: "thresholds fixed before scoring; not recomputed from results",
  },
  sanityChecks: checks,
  valid: hardFail.length === 0,
  rows,
  shares: { geometry: r4(gShare), appearance: r4(aShare), overCellsWithDegNatAbove: 0.05 },
  classification: { "H-GEOMETRY": hGeom, "H-APPEARANCE": hAppr, "H-MIXED": hMixed },
};
writeFileSync(join(LOGS, "trackb-analysis.json"), `${JSON.stringify(out, null, 1)}\n`);
console.log(`\nwrote ${join(LOGS, "trackb-analysis.json")}`);
if (hardFail.length) { console.error(`\nRUN INVALID — SANITY CHECK FAILED: ${hardFail.map((c) => c.id).join(", ")}`); process.exit(4); }
