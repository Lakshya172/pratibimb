/**
 * M10.7 — THE TEST-ONLY LOOPBACK SINK for masked frames. Never part of any extension build.
 *
 * It listens on 127.0.0.1 ONLY (the extension's one pinned connect-src origin is
 * http://127.0.0.1:8995), on one path, and accepts one thing: a still WebP frame, POSTed with
 * `content-type: image/webp` from the expected extension origin, of the expected size, whose bytes
 * hash to the digest the sender declared. Everything else is rejected with a 4xx and recorded:
 *   wrong method or path · an origin other than the extension's · any other content type · an empty
 *   or oversized body · bytes that are not a RIFF/WEBP container · metadata chunks (EXIF, XMP, ICCP)
 *   or animation · a size other than expected · a body whose digest differs from the declared one.
 *
 * It never alters a payload: accepted bytes are kept exactly as received, and their SHA-256 is
 * recomputed whenever they are read back. It never decodes: pixel verification is the harness's job,
 * in a browser page that is not the extension.
 *
 * Every arrival — accepted or not — is recorded with its metadata: time, method, path, origin,
 * content type, size, SHA-256, verdict, reason. Never its body.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";

import { readWebpRiff } from "./webp-riff.mjs";

export const SINK_PATH = "/m10/frame";
const MAX_BYTES = 16 * 1024 * 1024;
const FORBIDDEN_CHUNKS = new Set(["EXIF", "XMP ", "ICCP", "ANIM", "ANMF"]);
const ADMITTED_CHUNKS = new Set(["VP8X", "ALPH", "VP8 ", "VP8L"]);

export const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** Why a body is not an acceptable frame, or `null` if it is. Pure; also used by the unit tests. */
export function judgeFrame({ method, path, origin, contentType, body, declaredSha256 }, expect) {
  if (method !== "POST") return `method ${method}`;
  if (path !== SINK_PATH) return `path ${path}`;
  if (!expect.origin || origin !== expect.origin) return `origin ${origin ?? "(none)"}`;
  if (contentType !== "image/webp") return `content-type ${contentType ?? "(none)"}`;
  if (body.length === 0) return "empty body";
  if (body.length > MAX_BYTES) return "oversized body";
  const riff = readWebpRiff(body);
  if (!riff.ok) return `not a WebP container: ${riff.reason}`;
  const ids = riff.chunks.map((c) => c.id);
  const bad = ids.find((id) => FORBIDDEN_CHUNKS.has(id) || !ADMITTED_CHUNKS.has(id));
  if (bad) return `chunk ${JSON.stringify(bad)} not admitted`;
  if (riff.vp8xFlags !== null && (riff.vp8xFlags & (0x20 | 0x08 | 0x04 | 0x02)) !== 0) return "VP8X declares metadata or animation";
  if (ids.filter((id) => id === "VP8 " || id === "VP8L").length !== 1) return "not exactly one image chunk";
  if (riff.width === null || riff.height === null) return "no readable bitstream size";
  if (riff.canvas && (riff.canvas.w !== riff.width || riff.canvas.h !== riff.height)) return "canvas and bitstream disagree";
  if (expect.width !== undefined && (riff.width !== expect.width || riff.height !== expect.height)) return `size ${riff.width}x${riff.height}, expected ${expect.width}x${expect.height}`;
  if (declaredSha256 !== sha256(body)) return "body does not hash to the declared digest";
  return null;
}

/**
 * @param {{ port?: number, host?: string }} [options]
 * @returns {Promise<{ url: string, origin: string, arrivals: object[], accepted: () => {id:number, bytes: Buffer}[], expect: (e: object) => void, close: () => Promise<void> }>}
 */
export async function startFrameSink({ port = 8995, host = "127.0.0.1" } = {}) {
  if (host !== "127.0.0.1") throw new Error("the frame sink binds loopback only");
  let expectation = { origin: null };
  const arrivals = [];
  const kept = [];
  const server = createServer((req, res) => {
    const parts = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size <= MAX_BYTES + 1) parts.push(c);
    });
    req.on("end", () => {
      const body = Buffer.concat(parts);
      const meta = {
        id: arrivals.length,
        at: new Date().toISOString(),
        method: req.method,
        path: req.url,
        origin: req.headers.origin ?? null,
        remoteAddress: req.socket.remoteAddress,
        contentType: req.headers["content-type"] ?? null,
        bytes: body.length,
        sha256: sha256(body),
        declaredSha256: req.headers["x-pratibimb-payload-sha256"] ?? null,
      };
      const reason = judgeFrame({ method: req.method, path: req.url, origin: meta.origin, contentType: meta.contentType, body, declaredSha256: meta.declaredSha256 }, expectation);
      arrivals.push({ ...meta, accepted: reason === null, reason });
      if (reason === null) {
        kept.push({ id: meta.id, bytes: body });
        res.writeHead(200, { "x-pratibimb-received-sha256": meta.sha256, "x-pratibimb-received-bytes": String(body.length), "content-type": "text/plain" });
        res.end("accepted");
      } else {
        res.writeHead(reason.startsWith("method") ? 405 : reason.startsWith("origin") ? 403 : reason.startsWith("content-type") ? 415 : 400, { "content-type": "text/plain" });
        res.end("rejected");
      }
    });
  });
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(port, host, ok);
  });
  const bound = server.address().port;
  return {
    url: `http://${host}:${bound}${SINK_PATH}`,
    origin: `http://${host}:${bound}`,
    arrivals,
    accepted: () => kept.map((k) => ({ id: k.id, bytes: k.bytes, sha256: sha256(k.bytes) })),
    expect: (e) => {
      expectation = { ...e };
    },
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}
