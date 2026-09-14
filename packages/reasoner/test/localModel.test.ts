/**
 * THE LOCAL MODEL, OVER A REAL SOCKET — and the fallback policy behind it.
 *
 * The adapter is tested against an actual HTTP server on loopback that returns whatever the case
 * needs: a good plan, nonsense, a hostile plan, silence. A stubbed `propose` would test the wrong
 * boundary; the thing worth testing is that *bytes go out and untrusted bytes come back*.
 *
 * Two claims:
 *
 * 1. **The model has zero authority.** Everything it can say is either refused or handed to the
 *    validator. It cannot reach a value, cannot widen the action set, and cannot be believed.
 * 2. **Failure and misbehaviour are different events.** A model that did not answer may be replaced
 *    by the deterministic planner. A model that returned a plan the client refused may not.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

import {
  DEFAULT_FALLBACK_POLICY,
  NEVER_FALLBACK,
  decideFallback,
  deterministicReasoner,
  localModelReasoner,
  outcomeOfRefusal,
  outcomeOfResponse,
  sendToReasoner,
  unavailableReasoner,
} from "../src/index.js";
import { DEMO, GOAL, ORIGIN, REQUEST, SESSION, verifiedHandoff } from "./support/handoff.js";

/** What the fake model answers next, and every body it received. */
let reply: { status: number; contentType: string; body: string } = { status: 200, contentType: "application/json", body: "" };
const received: string[] = [];
let server: Server;
let endpoint: string;

const asContent = (steps: unknown) => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ steps }) } }] });

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (c: Buffer) => chunks.push(c));
    request.on("end", () => {
      received.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(reply.status, { "content-type": reply.contentType });
      response.end(reply.body);
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

const ask = async (over: Record<string, unknown> = {}) => {
  const { handoff, vault } = await verifiedHandoff();
  const client = localModelReasoner({ endpoint, ...over });
  const response = await sendToReasoner(client, {
    handoff,
    vault,
    goal: GOAL,
    requestId: REQUEST,
    sessionId: SESSION,
    origin: ORIGIN,
  });
  return { response, client };
};

describe("the request that goes out", () => {
  it("is a real HTTP request carrying references and no values", async () => {
    reply = { status: 200, contentType: "application/json", body: asContent([{ op: "click", target: "#submit" }]) };
    const before = received.length;
    await ask();
    expect(received).toHaveLength(before + 1);
    const body = received[received.length - 1]!;

    expect(body).toContain("<PII:PHONE:1>");
    for (const secret of [DEMO.mobile, DEMO.aadhaar, DEMO.name, DEMO.dob, DEMO.otp]) {
      expect(body, secret.slice(0, 4)).not.toContain(secret);
    }
  });

  it("tells the model which field is empty without telling it what is in any of them", async () => {
    reply = { status: 200, contentType: "application/json", body: asContent([{ op: "click", target: "#submit" }]) };
    await ask();
    // Parsed rather than string-matched: the context is a JSON document inside a JSON body, and an
    // assertion on the raw text would pass or fail on escaping rather than on content.
    const sent = JSON.parse(received[received.length - 1]!) as { messages: { role: string; content: string }[] };
    const context = JSON.parse(sent.messages[sent.messages.length - 1]!.content) as {
      fields: { id: string; name: string; empty: boolean }[];
      references: { token: string; class: string }[];
    };

    const confirm = context.fields.find((f) => f.id === "#mobile_confirm");
    expect(confirm?.empty).toBe(true);
    // The fields that hold values are named, and marked as not needing one — a name and a flag,
    // never a value.
    expect(context.fields.find((f) => f.id === "#mobile")?.empty).toBe(false);
    expect(Object.keys(confirm ?? {}).sort()).toEqual(["empty", "id", "name"]);
    expect(context.references.map((r) => r.class).sort()).toEqual(["AADHAAR", "DOB", "NAME", "PHONE"]);
  });

  it("constrains what the model may name to what actually exists", async () => {
    reply = { status: 200, contentType: "application/json", body: asContent([{ op: "click", target: "#submit" }]) };
    await ask();
    const body = received[received.length - 1]!;
    // enum grounding: the decoder cannot emit a selector the page does not have.
    expect(body).toContain('"enum"');
    expect(body).toContain("json_schema");
  });

  it("reports itself as loopback HTTP, never as in-process", async () => {
    reply = { status: 200, contentType: "application/json", body: asContent([{ op: "click", target: "#submit" }]) };
    const { response } = await ask();
    expect(response.received).toBe(true);
    if (!response.received) return;
    expect(response.transport).toBe("LOOPBACK_HTTP");
    expect(response.reasoner).toContain("local-model");
  });
});

describe("what comes back is untrusted", () => {
  const raw = async () => {
    const { response } = await ask();
    return response.received ? response.raw : undefined;
  };

  it("assembles provenance from the client, never from the model", async () => {
    reply = {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                steps: [{ op: "click", target: "#submit" }],
                provenance: { requestId: "attacker", sessionId: "attacker", viewId: "attacker" },
              }),
            },
          },
        ],
      }),
    };
    const value = (await raw()) as { provenance: { requestId: string; sessionId: string } };
    expect(value.provenance.requestId).toBe(REQUEST);
    expect(value.provenance.sessionId).toBe(SESSION);
  });

  it.each([
    ["not JSON at all", { status: 200, contentType: "text/plain", body: "here is your plan" }],
    ["an HTTP error", { status: 500, contentType: "application/json", body: "{}" }],
    ["an empty body", { status: 200, contentType: "application/json", body: "" }],
    ["JSON with no choices", { status: 200, contentType: "application/json", body: '{"error":"nope"}' }],
  ])("survives %s without throwing", async (_label, answer) => {
    reply = answer;
    const { response } = await ask();
    expect(response.received).toBe(true);
  });

  it("passes an unsupported operation straight through to be refused", async () => {
    reply = { status: 200, contentType: "application/json", body: asContent([{ op: "execute_javascript", target: "#submit" }]) };
    const value = (await raw()) as { steps: { op: string }[] };
    // The adapter does not sanitise the model's output — that is the validator's job, and an
    // adapter that quietly dropped bad steps would be deciding something it may not decide.
    expect(value.steps[0]?.op).toBe("execute_javascript");
  });

  it("passes a raw secret straight through to be refused", async () => {
    reply = {
      status: 200,
      contentType: "application/json",
      body: asContent([{ op: "insert", target: "#mobile_confirm", literal: DEMO.mobile }]),
    };
    const value = (await raw()) as { steps: { literal?: string }[] };
    expect(value.steps[0]?.literal).toBe(DEMO.mobile);
  });
});

describe("the model has no authority", () => {
  it("cannot make the request go anywhere but this machine", async () => {
    const { handoff, vault } = await verifiedHandoff();
    const offMachine = localModelReasoner({ endpoint: "https://example.invalid/v1/chat/completions" });
    const response = await sendToReasoner(offMachine, {
      handoff,
      vault,
      goal: GOAL,
      requestId: REQUEST,
      sessionId: SESSION,
      origin: ORIGIN,
    });
    // The egress guard refuses, so the adapter has nothing to return.
    expect(response.received).toBe(true);
    if (response.received) expect(response.raw).toBeUndefined();
  });

  it("cannot reach a value: the adapter never touches the vault's reveal path", async () => {
    // Structural, not behavioural. `REVEAL` is not exported by @pratibimb/privacy at all, so no
    // adapter can import it; this pins that the source does not try.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(fileURLToPath(new URL("../src/localModel.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("REVEAL");
    expect(source).not.toMatch(/vault\s*\[/);
  });

  it("performs no fetch of its own: every byte goes through the egress guard", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const dir = fileURLToPath(new URL("../src", import.meta.url));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(`${dir}/${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
    }
  });
});

describe("failure and misbehaviour are different events", () => {
  it("permits the deterministic planner after a failure", async () => {
    for (const outcome of ["UNAVAILABLE", "TIMEOUT", "MALFORMED", "UNUSABLE"] as const) {
      expect(decideFallback(outcome).fellBack, outcome).toBe(true);
    }
  });

  it("refuses to fall back from a plan the client rejected", () => {
    const decision = decideFallback("HOSTILE");
    expect(decision.fellBack).toBe(false);
    expect(decision.reason).toContain("hide a caught event");
  });

  it("classifies a refusal by what it is evidence of", () => {
    // A leak or an unissued reference says something is wrong upstream; a bad selector says the
    // model is not very good, which is what the fallback is for.
    expect(outcomeOfRefusal("LITERAL_REFUSED")).toBe("HOSTILE");
    expect(outcomeOfRefusal("PRIVACY_REFUSED")).toBe("HOSTILE");
    expect(outcomeOfRefusal("NOT_A_PARSED_PLAN")).toBe("HOSTILE");
    for (const benign of ["UNKNOWN_TARGET", "TARGET_NOT_ACTIONABLE", "CLICK_BEFORE_INSERT", "NO_EXECUTABLE_STEP"]) {
      expect(outcomeOfRefusal(benign), benign).toBe("UNUSABLE");
    }
  });

  it("classifies a response that never arrived", async () => {
    const { handoff, vault } = await verifiedHandoff();
    const response = await sendToReasoner(unavailableReasoner(), {
      handoff,
      vault,
      goal: GOAL,
      requestId: REQUEST,
      sessionId: SESSION,
      origin: ORIGIN,
    });
    expect(outcomeOfResponse(response)).toBe("UNAVAILABLE");
  });

  it("honours a policy that never falls back", () => {
    for (const outcome of ["UNAVAILABLE", "TIMEOUT", "MALFORMED", "HOSTILE"] as const) {
      expect(decideFallback(outcome, NEVER_FALLBACK).fellBack).toBe(false);
    }
    expect(DEFAULT_FALLBACK_POLICY.permits("UNAVAILABLE")).toBe(true);
  });

  it("keeps the deterministic planner untrusted too", async () => {
    const { handoff, vault } = await verifiedHandoff();
    const response = await sendToReasoner(deterministicReasoner(), {
      handoff,
      vault,
      goal: GOAL,
      requestId: REQUEST,
      sessionId: SESSION,
      origin: ORIGIN,
    });
    expect(response.received).toBe(true);
    if (!response.received) return;
    // Same shape, same lack of privilege: `raw` is `unknown` whoever produced it.
    expect(Object.keys(response)).toContain("raw");
  });
});
