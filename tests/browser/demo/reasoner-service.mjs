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

/**
 * A second front, for the compromised-reasoner act.
 *
 * The presenter has to be able to run SUCCESS, then REFUSAL, then FALLBACK without restarting
 * anything, so the honest and the hostile services listen at the same time on different ports and
 * the client simply addresses a different one. Nothing is toggled mid-flight, no process holds a
 * mode that could drift out of step with the UI, and the model is spawned once.
 */
export const HOSTILE_PORT = 8979;
export const HOSTILE_URL = `http://127.0.0.1:${HOSTILE_PORT}/v1/chat/completions`;

/**
 * A loopback port with nothing behind it, for the outage act.
 *
 * This is how `MODEL_UNAVAILABLE` is forced without touching a line of security code: the client
 * makes a real request to a real address and the connection is really refused, which is what happens
 * when `llama-server` dies. No flag, no mock, no demo-only branch.
 */
export const OUTAGE_PORT = 8989;
export const OUTAGE_URL = `http://127.0.0.1:${OUTAGE_PORT}/v1/chat/completions`;

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
  const port = options.port ?? (mode === "hostile" ? HOSTILE_PORT : FRONT_PORT);
  const captures = [];
  let model = null;

  // `hostile` and `malformed` never reach the model, so they never need one started. That also lets
  // the demo run an honest front and a hostile front side by side over a single llama-server.
  if (mode === "forward" && options.spawnModel !== false) {
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
      // Without this the browser hides the receipt headers from the page, and the Planning View
      // would show "the peer said nothing" for a peer that did in fact answer.
      "access-control-expose-headers": "x-pratibimb-received-sha256, x-pratibimb-received-bytes",
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
        // Namespaced by port: two fronts run at once during the demo and must not overwrite each
        // other's captures.
        writeFileSync(
          join(CAPTURE_DIR, `request-${port}-${captures.length}.json`),
          `${JSON.stringify(capture, null, 2)}\n`,
          "utf8"
        );

        /**
         * THE RECEIPT. The independent half of the payload proof, stated by the party that received
         * the bytes rather than by the party that sent them.
         *
         * It is the digest of exactly what arrived, computed here, before anything interprets or
         * forwards it. The client compares it with its own and shows whether they agree. It is a
         * claim by a peer, and the client records it as one — a hostile service could put any string
         * here, which is precisely why the client's guarantee does not rest on it.
         */
        const receipt = {
          "x-pratibimb-received-sha256": capture.receivedSha256,
          "x-pratibimb-received-bytes": String(capture.receivedBytes),
        };

        if (mode === "hostile") {
          response.writeHead(200, { "content-type": "application/json", ...cors, ...receipt });
          response.end(hostilePlan(options.literal ?? ""));
          return;
        }
        if (mode === "malformed") {
          response.writeHead(200, { "content-type": "text/plain", ...cors, ...receipt });
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
          response.writeHead(upstream.status, { "content-type": "application/json", ...cors, ...receipt });
          response.end(text);
        } catch {
          response.writeHead(502, { "content-type": "application/json", ...cors, ...receipt });
          response.end(JSON.stringify({ error: "upstream unavailable" }));
        }
      })();
    });
  });

  if (mode !== "down") {
    await new Promise((ok, fail) => {
      front.once("error", fail);
      front.listen(port, "127.0.0.1", ok);
    });
  }

  return {
    url: `http://127.0.0.1:${port}/v1/chat/completions`,
    port,
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
  const portIndex = process.argv.indexOf("--port");
  const service = await startReasonerService({
    mode: modeIndex > 0 ? process.argv[modeIndex + 1] : "forward",
    ...(portIndex > 0 ? { port: Number(process.argv[portIndex + 1]) } : {}),
  });
  console.log(`reasoner service (${service.mode}) on ${service.url}`);
  console.log("127.0.0.1 only. Ctrl-C to stop.");
}
