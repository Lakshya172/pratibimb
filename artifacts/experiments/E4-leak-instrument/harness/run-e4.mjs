/**
 * E4 — validate the leak instrument before any privacy evidence is collected with it.
 *
 *   test emitter ──HTTP──► loopback collector (B-02 derivative) ──bytes──► canary scanner
 *
 * POSITIVE CONTROL: requests that deliberately carry a synthetic canary, in every in-scope variant
 * over every transport. The instrument MUST detect each one, with the right class, in every run.
 * NEGATIVE CONTROL: near-miss values and clean payloads. The instrument MUST report nothing.
 * BLIND-SPOT PROBES: the declared out-of-scope forms. Reported, never counted toward PASS.
 * BLIND-INSTRUMENT CHECK: the same leak traffic scanned with an EMPTY canary set must yield nothing,
 * proving detections come from canary knowledge and not from a generic digit heuristic.
 *
 * This validates the INSTRUMENT. It proves nothing about the privacy of any product, because no
 * product component is involved: the emitter is test code that leaks on purpose.
 *
 * Synthetic values only. 127.0.0.1 only. No external network.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

import { SCANNER_VERSION, compileCanaries, scanArrival } from "./scanner.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const collector = require("./collector.cjs");

const PORT = 8995;
const RUNS = 10;
/**
 * Attempt 1 (seeds 20260913-22, e4-scanner-1) FAILED; its log is kept as logs/e4-attempt-1-FAIL.json.
 * A re-run after an instrument fix starts from scratch on a FRESH seed block, never the seeds it
 * failed on.
 */
const ATTEMPT = 2;
const BASE_SEED = 20260913 + RUNS * (ATTEMPT - 1);
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** mulberry32 — the same PRNG `packages/evaluation/src/generator.ts` uses. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanaries(rand) {
  const digit = (lo = 0) => String(lo + Math.floor(rand() * (10 - lo)));
  const digits = (n, first = 0) => digit(first) + Array.from({ length: n - 1 }, () => digit()).join("");
  const syll = () => "bdfgklmnprstvz"[Math.floor(rand() * 14)] + "aeiou"[Math.floor(rand() * 5)];
  const word = () => {
    const w = syll() + syll() + syll() + syll();
    return w[0].toUpperCase() + w.slice(1);
  };
  const y = 1950 + Math.floor(rand() * 56);
  const m = 1 + Math.floor(rand() * 12);
  // Day 13-28: a design constraint of the canary, not of users — it keeps D-M-Y and M-D-Y apart.
  const d = 13 + Math.floor(rand() * 16);
  return {
    PHONE: digits(10, 6),
    AADHAAR: digits(12, 2),
    DOB: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    NAME: `${word()} ${word()}`,
    OTP: digits(6, 1),
  };
}

const jsonEscapeAll = (s) => [...s].map((c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const bump = (d) => String((Number(d) + 1) % 10);

/** In-scope variants per class. Each must be detected. */
function variants(c) {
  const p = c.PHONE;
  const a = c.AADHAAR;
  const [y, m, d] = c.DOB.split("-");
  const [n1, n2] = c.NAME.split(" ");
  const o = c.OTP;
  return {
    PHONE: {
      exact: p,
      spaced_5_5: `${p.slice(0, 5)} ${p.slice(5)}`,
      spaced_3_3_4: `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`,
      punct_dash: `${p.slice(0, 5)}-${p.slice(5)}`,
      punct_dot: `${p.slice(0, 5)}.${p.slice(5)}`,
      punct_paren: `(${p.slice(0, 5)}) ${p.slice(5)}`,
      plus91_space: `+91 ${p}`,
      plus91_dash: `+91-${p.slice(0, 5)}-${p.slice(5)}`,
      leading_zero: `0${p}`,
      json_escape: jsonEscapeAll(p),
      url_encoded: encodeURIComponent(`+91 ${p}`),
      base64: b64(p),
    },
    AADHAAR: {
      exact: a,
      spaced_4_4_4: `${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`,
      punct_dash: `${a.slice(0, 4)}-${a.slice(4, 8)}-${a.slice(8)}`,
      punct_dot: `${a.slice(0, 4)}.${a.slice(4, 8)}.${a.slice(8)}`,
      json_escape: jsonEscapeAll(a),
      url_encoded: encodeURIComponent(`${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`),
      base64: b64(a),
    },
    DOB: {
      exact_iso: c.DOB,
      digits_only: `${y}${m}${d}`,
      dmy_slash: `${d}/${m}/${y}`,
      dmy_dash: `${d}-${m}-${y}`,
      dmy_dot: `${d}.${m}.${y}`,
      dmy_space: `${d} ${m} ${y}`,
      ymd_slash: `${y}/${m}/${d}`,
      mdy_slash: `${m}/${d}/${y}`,
      json_escape: jsonEscapeAll(c.DOB),
      url_encoded: encodeURIComponent(`${d}/${m}/${y}`),
      base64: b64(c.DOB),
    },
    NAME: {
      exact: c.NAME,
      upper: c.NAME.toUpperCase(),
      lower: c.NAME.toLowerCase(),
      double_space: `${n1}  ${n2}`,
      underscore: `${n1}_${n2}`,
      dot: `${n1}.${n2}`,
      json_escape: jsonEscapeAll(c.NAME),
      url_encoded: encodeURIComponent(c.NAME),
      url_plus: `${n1}+${n2}`,
      base64: b64(c.NAME),
    },
    OTP: {
      exact: o,
      spaced_3_3: `${o.slice(0, 3)} ${o.slice(3)}`,
      punct_dash: `${o.slice(0, 3)}-${o.slice(3)}`,
      json_escape: jsonEscapeAll(o),
      base64: b64(o),
    },
  };
}

/** Near misses. None may be detected. */
function negatives(c) {
  const p = c.PHONE;
  const a = c.AADHAAR;
  const o = c.OTP;
  const [y, m, d] = c.DOB.split("-");
  const [n1, n2] = c.NAME.split(" ");
  const flipLast = (s) => s.slice(0, -1) + bump(s.slice(-1));
  const transpose = (s) => {
    for (let i = 1; i < s.length; i += 1) if (s[i] !== s[i - 1]) return s.slice(0, i - 1) + s[i] + s[i - 1] + s.slice(i + 1);
    return flipLast(s);
  };
  const letterSwap = (w) => w.slice(0, 2) + (w[2] === "x" ? "y" : "x") + w.slice(3);
  const dd = String(Number(d) + 1).padStart(2, "0");
  const mm = String((Number(m) % 12) + 1).padStart(2, "0");
  return {
    PHONE: { one_digit_changed: flipLast(p), transposed: transpose(p) },
    AADHAAR: { one_digit_changed: flipLast(a), transposed: transpose(a) },
    DOB: { day_plus_one: `${y}-${m}-${dd}`, month_changed: `${y}-${mm}-${d}`, year_plus_one: `${Number(y) + 1}-${m}-${d}` },
    NAME: { first_token_altered: `${letterSwap(n1)} ${n2}`, second_token_altered: `${n1} ${letterSwap(n2)}` },
    OTP: { one_digit_changed: flipLast(o), transposed: transpose(o) },
  };
}

/** Declared blind spots. Expected NOT to be detected; reported, never counted toward PASS. */
function blindSpots(c) {
  const p = c.PHONE;
  const [n1, n2] = c.NAME.split(" ");
  return {
    PHONE_split_across_fields: { a: p.slice(0, 5), b: p.slice(5) },
    PHONE_last_four: `ending ${p.slice(-4)}`,
    PHONE_reversed: [...p].reverse().join(""),
    PHONE_embedded_in_longer_run: `4${p}7`,
    NAME_reversed_order: `${n2} ${n1}`,
    AADHAAR_base64_fused_in_text: `ref${b64(c.AADHAAR)}x`,
  };
}

/** Correlation ids use letters only, so the instrument's own metadata cannot resemble a numeric canary. */
function letterId(n) {
  let s = "";
  let x = n + 1;
  while (x > 0) {
    s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
    x = Math.floor((x - 1) / 26);
  }
  return `e4-${s}`;
}

/** Realistic filler: timestamps and other numbers put pressure on false positives. */
const filler = (value, i) => ({
  manifest_version: "pv1-draft",
  step: i,
  ts: Date.now(),
  elements: [{ id: "v3.e4", role: "textbox", label: "Mobile number", accepts: "PHONE" }],
  note: value,
});

async function send(transport, value, correlationId, i) {
  const url = `http://127.0.0.1:${PORT}/egress`;
  const base = { "x-pratibimb-correlation-id": correlationId };
  if (transport === "POST_JSON") {
    const body = JSON.stringify(filler(value, i));
    await fetch(url, { method: "POST", headers: { ...base, "content-type": "application/json", "x-pratibimb-payload-sha256": sha(Buffer.from(body)) }, body });
    return sha(Buffer.from(body));
  }
  if (transport === "QUERY") {
    await fetch(`${url}?step=${i}&note=${encodeURIComponent(value)}`, { method: "GET", headers: { ...base, "x-pratibimb-payload-sha256": sha(Buffer.alloc(0)) } });
    return sha(Buffer.alloc(0));
  }
  if (transport === "HEADER") {
    await fetch(url, { method: "GET", headers: { ...base, "x-note": value, "x-pratibimb-payload-sha256": sha(Buffer.alloc(0)) } });
    return sha(Buffer.alloc(0));
  }
  if (transport === "MULTIPART") {
    const form = new FormData();
    form.append("step", String(i));
    form.append("note", value);
    const req = new Request(url, { method: "POST", body: form });
    const bytes = Buffer.from(await req.arrayBuffer());
    await fetch(url, { method: "POST", headers: { ...base, "content-type": req.headers.get("content-type"), "x-pratibimb-payload-sha256": sha(bytes) }, body: bytes });
    return sha(bytes);
  }
  throw new Error(`unknown transport ${transport}`);
}

async function sendSplit(transport, parts, correlationId, i) {
  const url = `http://127.0.0.1:${PORT}/egress`;
  const body = JSON.stringify({ step: i, first: parts.a, second: parts.b });
  if (transport === "POST_JSON" || transport === "MULTIPART") {
    await fetch(url, { method: "POST", headers: { "x-pratibimb-correlation-id": correlationId, "content-type": "application/json", "x-pratibimb-payload-sha256": sha(Buffer.from(body)) }, body });
    return sha(Buffer.from(body));
  }
  if (transport === "QUERY") {
    await fetch(`${url}?first=${parts.a}&second=${parts.b}`, { headers: { "x-pratibimb-correlation-id": correlationId, "x-pratibimb-payload-sha256": sha(Buffer.alloc(0)) } });
  } else {
    await fetch(url, { headers: { "x-pratibimb-correlation-id": correlationId, "x-first": parts.a, "x-second": parts.b, "x-pratibimb-payload-sha256": sha(Buffer.alloc(0)) } });
  }
  return sha(Buffer.alloc(0));
}

const TRANSPORTS = ["POST_JSON", "QUERY", "HEADER", "MULTIPART"];

/**
 * Instrument identity is the SHA-256 of LF-normalised content. With `core.autocrlf` a checkout may
 * carry CRLF line endings, which changes raw bytes but not the code; hashing normalised text keeps the
 * "byte-identical instrument" rule about the instrument rather than about line endings.
 */
const lf = (path) => Buffer.from(readFileSync(path, "utf8").replace(/\r\n/g, "\n"), "utf8");
const scannerFile = lf(join(HERE, "scanner.mjs"));
const collectorFile = lf(join(HERE, "collector.cjs"));
const { server, arrivals } = await collector.start(PORT);

const runs = [];
let counter = 0;
for (let run = 0; run < RUNS; run += 1) {
  const seed = BASE_SEED + run;
  const rand = mulberry32(seed);
  const canaries = makeCanaries(rand);
  const canaryList = Object.entries(canaries).map(([cls, value]) => ({ class: cls, value }));
  const compiled = compileCanaries(canaryList);
  const empty = compileCanaries([]);
  const plan = [];

  for (const [cls, vs] of Object.entries(variants(canaries))) {
    for (const [variant, value] of Object.entries(vs)) {
      for (const t of TRANSPORTS) plan.push({ kind: "POSITIVE", cls, variant, transport: t, value });
    }
  }
  for (const [cls, vs] of Object.entries(negatives(canaries))) {
    for (const [variant, value] of Object.entries(vs)) {
      for (const t of TRANSPORTS) plan.push({ kind: "NEGATIVE", cls, variant, transport: t, value });
    }
  }
  for (const t of TRANSPORTS) plan.push({ kind: "CLEAN", cls: null, variant: "no_canary", transport: t, value: "Complete the application form" });
  for (const [probe, value] of Object.entries(blindSpots(canaries))) {
    for (const t of TRANSPORTS) plan.push({ kind: "BLIND_SPOT", cls: probe.split("_")[0], variant: probe, transport: t, value });
  }

  // Seeded shuffle, so transport and variant order carry no systematic effect.
  for (let i = plan.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }

  const results = [];
  for (const item of plan) {
    const id = letterId(counter++);
    const before = arrivals.length;
    const sentHash =
      typeof item.value === "object"
        ? await sendSplit(item.transport, item.value, id, counter)
        : await send(item.transport, item.value, id, counter);
    const arrival = arrivals.slice(before).find((a) => a.correlationId === id);
    if (!arrival) {
      results.push({ ...item, value: undefined, arrived: false, detected: [], blind: [], hashIntegrity: false });
      continue;
    }
    results.push({
      kind: item.kind,
      cls: item.cls,
      variant: item.variant,
      transport: item.transport,
      arrived: true,
      hashIntegrity: arrival.actualHash === sentHash && arrival.hashMatches === true,
      detected: scanArrival(arrival, compiled),
      blind: scanArrival(arrival, empty),
    });
  }

  const positives = results.filter((r) => r.kind === "POSITIVE");
  const posMiss = positives.filter((r) => !r.detected.includes(r.cls));
  const posExtra = positives.filter((r) => r.detected.some((c) => c !== r.cls));
  const negHit = results.filter((r) => (r.kind === "NEGATIVE" || r.kind === "CLEAN") && r.detected.length > 0);
  const blindHit = results.filter((r) => r.blind.length > 0);
  const notArrived = results.filter((r) => !r.arrived);
  const hashBad = results.filter((r) => r.arrived && !r.hashIntegrity);
  const probes = results.filter((r) => r.kind === "BLIND_SPOT");
  runs.push({
    run,
    seed,
    requests: results.length,
    positives: positives.length,
    positiveMisses: posMiss.map(({ cls, variant, transport }) => ({ cls, variant, transport })),
    positiveExtraClasses: posExtra.map(({ cls, variant, transport, detected }) => ({ cls, variant, transport, detected })),
    negativeControls: results.filter((r) => r.kind === "NEGATIVE" || r.kind === "CLEAN").length,
    falsePositives: negHit.map(({ kind, cls, variant, transport, detected }) => ({ kind, cls, variant, transport, detected })),
    blindInstrumentDetections: blindHit.length,
    notArrived: notArrived.length,
    hashIntegrityFailures: hashBad.length,
    blindSpotProbes: probes.map(({ variant, transport, detected }) => ({ variant, transport, detected })),
  });
  console.log(
    `run ${run} seed ${seed}: ${results.length} requests · positives ${positives.length} · misses ${posMiss.length} · ` +
      `extra-class ${posExtra.length} · false positives ${negHit.length} · blind-instrument ${blindHit.length} · ` +
      `not arrived ${notArrived.length} · hash failures ${hashBad.length}`
  );
}
server.close();

const totals = {
  runs: runs.length,
  requests: runs.reduce((s, r) => s + r.requests, 0),
  positives: runs.reduce((s, r) => s + r.positives, 0),
  positiveMisses: runs.reduce((s, r) => s + r.positiveMisses.length, 0),
  positiveExtraClasses: runs.reduce((s, r) => s + r.positiveExtraClasses.length, 0),
  negativeControls: runs.reduce((s, r) => s + r.negativeControls, 0),
  falsePositives: runs.reduce((s, r) => s + r.falsePositives.length, 0),
  blindInstrumentDetections: runs.reduce((s, r) => s + r.blindInstrumentDetections, 0),
  notArrived: runs.reduce((s, r) => s + r.notArrived, 0),
  hashIntegrityFailures: runs.reduce((s, r) => s + r.hashIntegrityFailures, 0),
};
const blindSpotSummary = {};
for (const r of runs) for (const p of r.blindSpotProbes) {
  const k = p.variant;
  blindSpotSummary[k] ??= { probes: 0, detected: 0 };
  blindSpotSummary[k].probes += 1;
  if (p.detected.length > 0) blindSpotSummary[k].detected += 1;
}
const pass =
  totals.positiveMisses === 0 &&
  totals.positiveExtraClasses === 0 &&
  totals.falsePositives === 0 &&
  totals.blindInstrumentDetections === 0 &&
  totals.notArrived === 0 &&
  totals.hashIntegrityFailures === 0;

const log = {
  experiment: "E4-leak-instrument",
  attempt: ATTEMPT,
  recordedAt: new Date().toISOString(),
  workstation: "W2",
  hostname: hostname(),
  node: process.version,
  cell: "W2 Windows host · Node emitter → 127.0.0.1 collector (no browser)",
  instrument: {
    scannerVersion: SCANNER_VERSION,
    scannerSha256: sha(scannerFile),
    collectorSha256: sha(collectorFile),
    collectorDerivedFrom: "artifacts/experiments/W1-B02-invariant-e-observation/harness/collector.js (unchanged transport and hashing; adds retained bytes)",
  },
  design: { runs: RUNS, baseSeed: BASE_SEED, transports: TRANSPORTS, classes: ["PHONE", "AADHAAR", "DOB", "NAME", "OTP"] },
  passCriterion:
    "every in-scope positive detected with exactly its own class in every run; zero detections on negative and clean controls; " +
    "zero detections with an empty canary set; every request arrived; every arrival's recomputed SHA-256 equals the sender's",
  totals,
  blindSpotSummary,
  runs,
  verdict: pass ? "PASS" : "FAIL",
};
mkdirSync(join(HERE, "..", "logs"), { recursive: true });
writeFileSync(join(HERE, "..", "logs", "e4.json"), JSON.stringify(log, null, 2) + "\n");
console.log("\nTOTALS", JSON.stringify(totals));
console.log("BLIND SPOTS", JSON.stringify(blindSpotSummary));
console.log(`VERDICT ${log.verdict}`);
process.exit(pass ? 0 : 1);
