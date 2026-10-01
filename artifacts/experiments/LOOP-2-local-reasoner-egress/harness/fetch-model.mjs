#!/usr/bin/env node
/**
 * Acquire the reasoner's weights — pinned, licence-verified, and never committed.
 *
 * Mirrors `W1-S04a1`'s `fetch-models.py`: the revision is pinned in source, the download is timed,
 * the bytes are hashed, and everything is written to a metadata record beside the weights. What is
 * NOT done is equally deliberate — **no weights enter git** (`.gitignore` excludes `*.gguf` and
 * `models/`), and the script refuses to run against a moving `main`.
 *
 * SECURITY.md §7: a licence claimed on a model card is `UNKNOWN` until someone opens the revision.
 * So this script fetches the LICENSE file **at the pinned revision** and records its digest beside
 * the weights' — the claim and the artifact are recorded together or not at all.
 *
 * Download approval: EXPLICIT, recorded in
 * `artifacts/experiments/LOOP-2-local-reasoner-egress/README.md` §approval. E9 stopped at this
 * boundary for want of one; this run does not proceed without it.
 *
 * Usage: node artifacts/experiments/LOOP-2-local-reasoner-egress/harness/fetch-model.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { hostname } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");

/** Pinned. Never `main`. Changing this is a dependency decision, not a maintenance edit. */
export const MODEL = {
  repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
  revision: "9217f5db79a29953eb74d5343926648285ec7e67",
  file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
  quantisation: "Q4_K_M",
  licenceFile: "LICENSE",
  licenceClaimed: "apache-2.0",
  baseModel: "Qwen/Qwen2.5-0.5B-Instruct",
};

/**
 * The runtime, pinned to a build number for the same reason the weights are pinned to a revision.
 *
 * CPU x64 — 18 MB against CUDA's 254 MB, and a 0.5B model at Q4_K_M does not need a GPU. Choosing
 * the CPU build also means the measurements below are the ones a judging machine without a GPU
 * would see.
 */
export const RUNTIME = {
  repo: "ggml-org/llama.cpp",
  build: "b10956",
  asset: "llama-b10956-bin-win-cpu-x64.zip",
  licence: "MIT",
  binary: "llama-server.exe",
};

export const MODEL_DIR = join(ROOT, "models", "qwen2.5-0.5b-instruct-gguf");
export const MODEL_PATH = join(MODEL_DIR, MODEL.file);
export const RUNTIME_DIR = join(ROOT, "models", "llama.cpp-" + RUNTIME.build);
export const SERVER_PATH = join(RUNTIME_DIR, RUNTIME.binary);
const META_PATH = join(MODEL_DIR, "acquisition.json");

const url = (path) => `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${path}`;

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function fetchToFile(from, to) {
  const started = Date.now();
  const response = await fetch(from, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${from}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(to));
  return Date.now() - started;
}

async function main() {
  mkdirSync(MODEL_DIR, { recursive: true });

  // ── the licence, at the revision, before anything else ────────────────────────────────────
  const licenceResponse = await fetch(url(MODEL.licenceFile), { redirect: "follow" });
  if (!licenceResponse.ok) throw new Error(`licence unreadable at the pinned revision (HTTP ${licenceResponse.status})`);
  const licenceText = Buffer.from(await licenceResponse.arrayBuffer());
  const licenceFirstLine = licenceText.toString("utf8").split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  if (!/Apache License/i.test(licenceText.toString("utf8").slice(0, 400))) {
    throw new Error(`REFUSING: the licence at ${MODEL.revision} is not the claimed Apache-2.0 (first line: ${licenceFirstLine})`);
  }
  writeFileSync(join(MODEL_DIR, "LICENSE"), licenceText);

  // ── the weights ───────────────────────────────────────────────────────────────────────────
  let downloadMs = 0;
  if (existsSync(MODEL_PATH)) {
    console.log(`already present: ${MODEL_PATH}`);
  } else {
    console.log(`downloading ${MODEL.file} @ ${MODEL.revision.slice(0, 12)} …`);
    downloadMs = await fetchToFile(url(MODEL.file), MODEL_PATH);
  }

  // ── the runtime ───────────────────────────────────────────────────────────────────────────
  let runtimeMs = 0;
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const zip = join(RUNTIME_DIR, RUNTIME.asset);
  if (!existsSync(zip)) {
    const from = `https://github.com/${RUNTIME.repo}/releases/download/${RUNTIME.build}/${RUNTIME.asset}`;
    console.log(`downloading ${RUNTIME.asset} …`);
    runtimeMs = await fetchToFile(from, zip);
  }
  if (!existsSync(SERVER_PATH)) {
    // bsdtar ships with Windows 11 and reads zip; no new dependency for an unpack step.
    execFileSync("tar", ["-xf", zip, "-C", RUNTIME_DIR], { stdio: "inherit", shell: process.platform === "win32" });
    if (!existsSync(SERVER_PATH)) throw new Error(`REFUSING: ${RUNTIME.binary} not found after unpacking`);
  }
  // Hashed whether or not this run downloaded it: the record describes the bytes on disk.
  const runtimeSha = sha256(readFileSync(zip));
  const runtimeBytes = statSync(zip).size;

  const bytes = readFileSync(MODEL_PATH);
  const record = {
    acquiredAt: new Date().toISOString(),
    workstation: "W2",
    host: hostname(),
    approval: "EXPLICIT — recorded in artifacts/experiments/LOOP-2-local-reasoner-egress/README.md",
    model: MODEL,
    source: url(MODEL.file),
    licence: {
      verifiedAtRevision: true,
      spdx: "Apache-2.0",
      file: url(MODEL.licenceFile),
      sha256: sha256(licenceText),
      bytes: licenceText.length,
      readOn: new Date().toISOString().slice(0, 10),
      method: "LICENSE file fetched at the pinned revision and its text checked, not the card tag",
    },
    weights: { path: `models/qwen2.5-0.5b-instruct-gguf/${MODEL.file}`, bytes: bytes.length, sha256: sha256(bytes) },
    runtime: {
      ...RUNTIME,
      source: `https://github.com/${RUNTIME.repo}/releases/download/${RUNTIME.build}/${RUNTIME.asset}`,
      zipSha256: runtimeSha,
      zipBytes: runtimeBytes,
      downloadMs: runtimeMs,
      path: `models/llama.cpp-${RUNTIME.build}/${RUNTIME.binary}`,
    },
    downloadMs,
    committed: false,
    note: "weights are NOT committed: .gitignore excludes *.gguf and models/ (SECURITY.md — reference, do not vendor)",
  };
  writeFileSync(META_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  console.log(`licence  : Apache-2.0 VERIFIED at revision (${licenceText.length} B)`);
  console.log(`weights  : ${(bytes.length / 1e6).toFixed(1)} MB  sha256 ${record.weights.sha256.slice(0, 16)}…`);
  console.log(`runtime  : llama.cpp ${RUNTIME.build} CPU x64 (${RUNTIME.licence}) → ${SERVER_PATH}`);
  console.log(`download : weights ${downloadMs} ms · runtime ${runtimeMs} ms`);
  console.log(`record   : ${META_PATH}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
