#!/usr/bin/env node
/**
 * The loopback reasoner service, and the independent record of what arrived.
 *
 * Two processes, both on 127.0.0.1 and nothing else:
 *
 *   client ──HTTP──▶ recording front (8978) ──HTTP──▶ llama-server (8977) ──▶ Qwen2.5-0.5B
 *                          │
 *                          └── writes the EXACT received bytes + their SHA-256
 *
 * WHY A FRONT AND NOT JUST THE MODEL. The payload proof has to be *independent*. The client's egress
 * ledger says "I sent bytes with digest X"; this process says "I received these bytes, and their
 * digest is X". Two parties, computed separately, compared afterwards. A single process printing its
 * own outgoing object would prove nothing — it would be the same belief twice.
 *
 * MODES. The front is also how the refusal and fallback paths are exercised over a real network,
 * without touching a line of security code:
 *
 * - `forward`  — proxy to the model. The real success path.
 * - `hostile`  — answer with a plan containing a raw value the client holds locally. The model never
 *                sees the request. This is a *simulated compromised server*, and it has to be handed
 *                the value by the harness because nothing in the request contains one — which is the
 *                sanitizer's result, not a shortcut.
 * - `malformed`— answer with something that is not a plan.
 * - `down`     — refuse the connection, for the fallback path.
 *
 * THE TRIPWIRE is metadata-only and deliberately secondary. It records that *something PII-shaped*
 * arrived, by class and by where it was seen — never the text. **It is not a privacy guard.** The
 * client refused before sending; if this ever fires on a real run, the client has already failed and
 * the tripwire is how we would find out. A server that had to be trusted to protect the user would
 * be the architecture this project exists to avoid.
 *
 * Usage: node tests/browser/demo/reasoner-service.mjs [--mode forward|hostile|malformed|down]
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./server.mjs";
import { MODEL_PATH, SERVER_PATH } from "../../../artifacts/experiments/LOOP-2-local-reasoner-egress/harness/fetch-model.mjs";

export const MODEL_PORT = 8977;
export const FRONT_PORT = 8978;
export const FRONT_URL = `http://127.0.0.1:${FRONT_PORT}/v1/chat/completions`;
const CAPTURE_DIR = join(ROOT, "artifacts", "experiments", "LOOP-2-local-reasoner-egress", "logs", "captures");

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Metadata-only shapes. Deliberately crude and deliberately not the client's detectors — an
 * independent observer that agreed with the thing it is observing would be worth less.
 */
const SHAPES = [
  { class: "PHONE", re: /\b[6-9]\d{9}\b/ },
  { class: "AADHAAR", re: /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/ },
  { class: "DOB", re: /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/ },
  { class: "OTP", re: /\b\d{6}\b/ },
];

/** Classes only. The matched text is never captured, logged or returned. */
export const tripwire = (body) =>
  SHAPES.filter((shape) => shape.re.test(body)).map((shape) => ({ class: shape.class, source: "server-tripwire" }));

/** A plan the client will refuse: it carries a value the client never sent. */
const hostilePlan = (literal) =>
  JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({
            steps: [
              { op: "insert", target: "#mobile_confirm", literal },
              { op: "click", target: "#submit" },
            ],
          }),
        },
      },
    ],
  });

export async function startReasonerService(options = {}) {
  const mode = options.mode ?? "forward";
  const captures = [];
  let model = null;

  if (mode === "forward") {
    if (!existsSync(MODEL_PATH)) throw new Error(`no weights at ${MODEL_PATH} — run harness/fetch-model.mjs`);
    if (!existsSync(SERVER_PATH)) throw new Error(`no llama-server at ${SERVER_PATH}`);
    model = spawn(
      SERVER_PATH,
      ["-m", MODEL_PATH, "--host", "127.0.0.1", "--port", String(MODEL_PORT), "-c", "4096", "-t", "8", "--no-webui"],
      { stdio: "ignore", windowsHide: true }
    );
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (Date.now() > deadline) throw new Error("llama-server did not become healthy");
      try {
        const health = await fetch(`http://127.0.0.1:${MODEL_PORT}/health`);
        if (health.ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const front = createServer((request, response) => {
    // The Planning View is served from another loopback port, so the browser preflights.
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, cors);
      response.end();
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      void (async () => {
        // THE EXACT BYTES, before anything interprets them.
        const raw = Buffer.concat(chunks);
        const body = raw.toString("utf8");
        const capture = {
          at: new Date().toISOString(),
          method: request.method,
          url: request.url,
          contentType: request.headers["content-type"] ?? null,
          receivedBytes: raw.length,
          receivedSha256: sha256(body),
          tripwire: tripwire(body),
          mode,
        };
        captures.push({ ...capture, body });
        mkdirSync(CAPTURE_DIR, { recursive: true });
        writeFileSync(join(CAPTURE_DIR, `request-${captures.length}.json`), `${JSON.stringify(capture, null, 2)}\n`, "utf8");

        if (mode === "hostile") {
          response.writeHead(200, { "content-type": "application/json", ...cors });
          response.end(hostilePlan(options.literal ?? ""));
          return;
        }
        if (mode === "malformed") {
          response.writeHead(200, { "content-type": "text/plain", ...cors });
          response.end("here is your plan, boss");
          return;
        }
        try {
          const upstream = await fetch(`http://127.0.0.1:${MODEL_PORT}${request.url}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          });
          const text = await upstream.text();
          response.writeHead(upstream.status, { "content-type": "application/json", ...cors });
          response.end(text);
        } catch {
          response.writeHead(502, { "content-type": "application/json", ...cors });
          response.end(JSON.stringify({ error: "upstream unavailable" }));
        }
      })();
    });
  });

  if (mode !== "down") {
    await new Promise((ok, fail) => {
      front.once("error", fail);
      front.listen(FRONT_PORT, "127.0.0.1", ok);
    });
  }

  return {
    url: FRONT_URL,
    mode,
    /** Everything that arrived, exact bytes included. In memory only; the files hold metadata. */
    captures,
    async stop() {
      if (mode !== "down") await new Promise((r) => front.close(r));
      if (model && !model.killed) model.kill();
    },
  };
}

if (process.argv[1]?.endsWith("reasoner-service.mjs")) {
  const modeIndex = process.argv.indexOf("--mode");
  const service = await startReasonerService({ mode: modeIndex > 0 ? process.argv[modeIndex + 1] : "forward" });
  console.log(`reasoner service (${service.mode}) on ${service.url}`);
  console.log("127.0.0.1 only. Ctrl-C to stop.");
}
