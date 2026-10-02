/**
 * THE EGRESS CHOKE POINT.
 *
 * One claim, and everything here is an attempt to break it:
 *
 *     **No request leaves without a verified sanitized payload, and the bytes that were checked are
 *     the bytes that go.**
 *
 * The tests run against a real HTTP server on loopback, because a guard tested against a stub would
 * be tested against the thing it is supposed to distrust. Where a refusal is expected, the assertion
 * is that **the server never received anything** — not merely that the function returned false.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isLoopback, sendVerified } from "../src/index.js";
import { DEMO, SESSION, REQUEST, ORIGIN, verifiedHandoff } from "./support/handoff.js";

/** Everything the server actually received. The independent half of the payload proof. */
const arrivals: { body: string; sha256: string; contentType: string | undefined }[] = [];
let server: Server;
let endpoint: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (c: Buffer) => chunks.push(c));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      arrivals.push({
        body,
        sha256: createHash("sha256").update(body, "utf8").digest("hex"),
        contentType: request.headers["content-type"],
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("test setup");
  endpoint = `http://127.0.0.1:${address.port}/v1/chat/completions`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

const request = async (over: Record<string, unknown> = {}) => {
  const { handoff, vault } = await verifiedHandoff();
  return {
    handoff,
    vault,
    body: { messages: [{ role: "user", content: "reference <PII:PHONE:1> only" }] },
    destination: endpoint,
    requestId: REQUEST,
    sessionId: SESSION,
    reasoner: "test",
    ...over,
  } as Parameters<typeof sendVerified>[0];
};

describe("a sanitized payload goes, and the bytes match", () => {
  it("sends, and the server receives exactly what the record describes", async () => {
    const before = arrivals.length;
    const outcome = await sendVerified(await request());

    expect(outcome.sent).toBe(true);
    if (!outcome.sent) return;
    expect(arrivals).toHaveLength(before + 1);
    const arrival = arrivals[arrivals.length - 1]!;

    // The independent comparison: the client's digest and size against the server's own.
    expect(outcome.record.payloadSha256).toBe(arrival.sha256);
    expect(outcome.record.payloadBytes).toBe(Buffer.byteLength(arrival.body, "utf8"));
    expect(outcome.record.leakCheck).toBe("CLEAN");
    expect(outcome.record.verified).toBe(true);
    expect(outcome.record.transport).toBe("LOOPBACK_HTTP");
    expect(outcome.record.responseStatus).toBe(200);
    expect(arrival.contentType).toContain("application/json");
  });

  it("records the references that left, and they are opaque", async () => {
    const outcome = await sendVerified(await request());
    if (!outcome.sent) throw new Error("setup");
    expect(outcome.record.references).toEqual(["<PII:PHONE:1>"]);
  });

  it("carries no value: the arrived bytes hold none of them", async () => {
    await sendVerified(await request());
    const arrival = arrivals[arrivals.length - 1]!;
    for (const secret of [DEMO.mobile, DEMO.aadhaar, DEMO.name, DEMO.dob, DEMO.otp]) {
      expect(arrival.body, secret.slice(0, 4)).not.toContain(secret);
    }
    expect(arrival.body).toContain("<PII:PHONE:1>");
  });
});

describe("what never reaches the wire", () => {
  const refused = async (over: Record<string, unknown>, cause: string) => {
    const before = arrivals.length;
    const outcome = await sendVerified(await request(over));
    expect(outcome.sent).toBe(false);
    if (outcome.sent) return null;
    expect(outcome.refusal.cause).toBe(cause);
    // The claim that matters: nothing arrived.
    expect(arrivals).toHaveLength(before);
    return outcome.refusal;
  };

  it("refuses a handoff the privacy verifier did not produce", async () => {
    const { handoff } = await verifiedHandoff();
    const forged = JSON.parse(JSON.stringify(handoff)) as typeof handoff;
    expect(forged.verified).toBe(true); // the flag is right; the membership is not
    await refused({ handoff: forged }, "HANDOFF_NOT_VERIFIED");
  });

  it("refuses a destination that is not on this machine", async () => {
    for (const destination of [
      "https://example.invalid/v1",
      "http://10.0.0.5:8977/v1",
      "http://127.0.0.1.evil.invalid/v1",
      "file:///etc/passwd",
      "not a url",
    ]) {
      await refused({ destination }, "DESTINATION_NOT_LOOPBACK");
    }
  });

  it("refuses a body that cannot be serialized", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await refused({ body: cyclic }, "NOT_SERIALIZABLE");
  });

  it("refuses a reference this handoff never issued", async () => {
    await refused({ body: { messages: [{ content: "use <PII:PHONE:9>" }] } }, "UNDECLARED_TOKEN");
    await refused({ body: { messages: [{ content: "use <PII:EMAIL:1>" }] } }, "UNDECLARED_TOKEN");
  });

  it("REFUSES A VAULT VALUE, and records the class without the value", async () => {
    const refusal = await refused(
      { body: { messages: [{ content: `the number is ${DEMO.mobile}` }] } },
      "VAULT_VALUE_IN_PAYLOAD"
    );
    expect(refusal?.severity).toBe("LEAKAGE_EVENT");
    expect(refusal?.leakedClass).toBe("PHONE");
    expect(JSON.stringify(refusal)).not.toContain(DEMO.mobile);
    // Not even a digest: hashing secret-bearing bytes and publishing it is publishing an oracle.
    expect(JSON.stringify(refusal)).not.toContain("payloadSha256");
  });

  it("catches a value however it is written", async () => {
    for (const written of ["+91 90000 00001", "9000-000-001", "9OOOOOOOO1"]) {
      await refused({ body: { messages: [{ content: written }] } }, "VAULT_VALUE_IN_PAYLOAD");
    }
  });

  it("catches every class the vault holds, not just the phone number", async () => {
    for (const secret of [DEMO.aadhaar, DEMO.name, DEMO.dob]) {
      await refused({ body: { messages: [{ content: secret }] } }, "VAULT_VALUE_IN_PAYLOAD");
    }
  });

  it("refuses a destination that stops answering", async () => {
    const dead = createServer(() => {
      /* accept and never reply */
    });
    await new Promise<void>((ok) => dead.listen(0, "127.0.0.1", ok));
    const address = dead.address();
    if (typeof address === "string" || address === null) throw new Error("setup");
    const outcome = await sendVerified(await request({ destination: `http://127.0.0.1:${address.port}/`, timeoutMs: 150 }));
    expect(outcome.sent).toBe(false);
    if (!outcome.sent) expect(outcome.refusal.cause).toBe("TRANSPORT_TIMEOUT");
    await new Promise((r) => dead.close(r));
  });

  it("refuses when nothing is listening", async () => {
    const outcome = await sendVerified(await request({ destination: "http://127.0.0.1:1/" }));
    expect(outcome.sent).toBe(false);
    if (!outcome.sent) expect(outcome.refusal.cause).toBe("TRANSPORT_FAILED");
  });
});

describe("the order is the property", () => {
  it("checks the payload before the destination is ever contacted", async () => {
    // A leaking body aimed at a live endpoint: the scan must win.
    const before = arrivals.length;
    const outcome = await sendVerified(await request({ body: { m: DEMO.aadhaar } }));
    expect(outcome.sent).toBe(false);
    expect(arrivals).toHaveLength(before);
  });

  it("recognises loopback and nothing else", () => {
    for (const good of ["http://127.0.0.1:8977/x", "http://localhost:1/", "https://127.0.0.1/"]) {
      expect(isLoopback(good), good).toBe(true);
    }
    for (const bad of ["http://127.0.0.2/", "http://example.com/", "ws://127.0.0.1/", "", "127.0.0.1"]) {
      expect(isLoopback(bad), bad).toBe(false);
    }
  });
});

describe("it runs where it is imported", () => {
  it("uses no Node-only global", () => {
    // The Planning View imports this module, so it must not reach for `Buffer`, `process` or
    // `require`. Learned the hard way: `Buffer.byteLength` threw in the browser and the resulting
    // ReferenceError was reported as TRANSPORT_FAILED — a bug in this file wearing a network
    // failure's clothes.
    const source = readFileSync(fileURLToPath(new URL("../src/guard.ts", import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const forbidden of ["Buffer.", "process.", "require(", "__dirname"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("reports a transport failure only for an actual transport failure", async () => {
    // The catch covers the fetch and nothing else, so a defect in record-building cannot disguise
    // itself as the service being down.
    const source = readFileSync(fileURLToPath(new URL("../src/guard.ts", import.meta.url)), "utf8");
    const tryBlock = source.slice(source.indexOf("  try {\n    response = await fetch"), source.indexOf("  } catch (error) {"));
    expect(tryBlock).toContain("await fetch");
    expect(tryBlock).not.toContain("record:");
  });
});

/**
 * THE PEER'S RECEIPT — a second party's arithmetic, and nothing more.
 *
 * The client's guarantee is that the bytes it scanned are the bytes it sent. The receipt adds
 * whether they were still those bytes on arrival. It is read after the send, it gates nothing, and a
 * hostile service can put any string in the header — which is exactly why none of this is allowed to
 * become a check anything depends on.
 */
describe("what the receiving service says it got", () => {
  /** A server that can be told how to answer, so a lying peer can be tested as easily as an honest one. */
  let receiptServer: Server;
  let receiptEndpoint: string;
  let behaviour: "honest" | "silent" | "lying" | "malformed-bytes" = "honest";
  const received: string[] = [];

  beforeAll(async () => {
    receiptServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        received.push(body);
        const digest = createHash("sha256").update(body, "utf8").digest("hex");
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (behaviour === "honest") {
          headers["x-pratibimb-received-sha256"] = digest;
          headers["x-pratibimb-received-bytes"] = String(Buffer.byteLength(body, "utf8"));
        } else if (behaviour === "lying") {
          headers["x-pratibimb-received-sha256"] = "0".repeat(64);
          headers["x-pratibimb-received-bytes"] = "1";
        } else if (behaviour === "malformed-bytes") {
          headers["x-pratibimb-received-sha256"] = digest;
          headers["x-pratibimb-received-bytes"] = "not a number";
        }
        res.writeHead(200, headers);
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((ok) => receiptServer.listen(0, "127.0.0.1", ok));
    const address = receiptServer.address();
    if (typeof address === "string" || address === null) throw new Error("test setup");
    receiptEndpoint = `http://127.0.0.1:${address.port}/v1/chat/completions`;
  });

  afterAll(async () => {
    await new Promise((r) => receiptServer.close(r));
  });

  const sendTo = async () => sendVerified(await request({ destination: receiptEndpoint }));

  it("records agreement when the peer computed the same digest over the same bytes", async () => {
    behaviour = "honest";
    const outcome = await sendTo();
    if (!outcome.sent) throw new Error("setup");
    expect(outcome.record.peerReceipt?.sha256).toBe(outcome.record.payloadSha256);
    expect(outcome.record.peerReceipt?.agrees).toBe(true);
    expect(outcome.record.peerReceipt?.bytes).toBe(outcome.record.payloadBytes);
  });

  /**
   * A peer that claims nothing must be recorded as *no claim*, never as a mismatch. Rendering the
   * absence of a cross-check as a failed one would put a red cross on a correct run.
   */
  it("records a silent peer as no claim rather than as disagreement", async () => {
    behaviour = "silent";
    const outcome = await sendTo();
    if (!outcome.sent) throw new Error("setup");
    expect(outcome.record.peerReceipt).toBeUndefined();
  });

  it("records a peer whose digest differs as a disagreement", async () => {
    behaviour = "lying";
    const outcome = await sendTo();
    if (!outcome.sent) throw new Error("setup");
    expect(outcome.record.peerReceipt?.agrees).toBe(false);
  });

  /** A peer's claim is parsed defensively: it is untrusted input like everything else that comes back. */
  it("survives a peer that sends a byte count that is not a number", async () => {
    behaviour = "malformed-bytes";
    const outcome = await sendTo();
    if (!outcome.sent) throw new Error("setup");
    expect(outcome.record.peerReceipt?.bytes).toBeNull();
    expect(outcome.record.peerReceipt?.agrees).toBe(true);
  });

  /** The decisive property: a lying peer changes the record and nothing else. The send still happened. */
  it("lets a disagreeing peer change no decision — the payload was still checked before it left", async () => {
    behaviour = "lying";
    const before = received.length;
    const outcome = await sendTo();
    expect(outcome.sent).toBe(true);
    if (!outcome.sent) return;
    expect(received).toHaveLength(before + 1);
    expect(outcome.record.leakCheck).toBe("CLEAN");
    expect(outcome.record.verified).toBe(true);
    // The client's own digest is of its own bytes, and the peer's claim did not touch it.
    expect(outcome.record.payloadSha256).toBe(createHash("sha256").update(received[received.length - 1]!, "utf8").digest("hex"));
  });

  it("reads the receipt after the send, so it can gate nothing", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/guard.ts", import.meta.url)), "utf8");
    expect(source.indexOf("await fetch")).toBeLessThan(source.indexOf("PEER_SHA_HEADER)"));
  });
});
