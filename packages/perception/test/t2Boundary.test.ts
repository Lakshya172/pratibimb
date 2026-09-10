/**
 * The T2 migration point, kept visible and kept closed.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE HAZARD, STATED PLAINLY
 *
 * The element graph carries accessible names, because they are structural UI text and the
 * server must have them to plan "fill the phone field". An accessible name can also carry
 * a VALUE:
 *
 *     aria-label="Aadhaar 1234 5678 9012"
 *
 * So PII can be sitting inside a local `PerceptionState` right now. That is currently
 * SAFE, for exactly one reason: nothing can construct a handoff, so nothing leaves the
 * perception boundary. It is not safe because the data is clean.
 *
 * D3/D4 must NOT quietly fix this by redacting inside perception. The sanitize tier owns
 * the redaction contract — detection channels D1–D4, the fail-closed union, the manifest's
 * token format — and inventing a subset of that here would produce a second, undocumented
 * redaction path that the real one later has to discover and reconcile.
 *
 * The correct move is the one this file enforces: keep the data where it is, keep the
 * boundary structural, and make the migration point impossible to miss.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type CaptureGeometry,
  type DomMeasurement,
  buildElementGraph,
  fuse,
  projectElement,
  frameId,
} from "@pratibimb/perception";

const FRAME = frameId("f1");

const geometry: CaptureGeometry = {
  dpr: 1.0,
  zoom: 1.0,
  viewportCss: { w: 1024, h: 640 },
  captureSize: { w: 1024, h: 640 },
  scroll: { x: 0, y: 0 },
  origin: "https://seva.gov.in",
};

/** The hazard, concretely: a label that is also a value. */
const AADHAAR_LABEL = "Aadhaar 1234 5678 9012";

const measure = (over: Partial<DomMeasurement> = {}): DomMeasurement => ({
  selector: "#aadhaar",
  role: "textbox",
  name: AADHAAR_LABEL,
  rect: { x: 100, y: 100, w: 300, h: 32 },
  cssHidden: false,
  parentIndex: -1,
  ...over,
});

describe("perception preserves the name — it does not redact it", () => {
  it("keeps a PII-bearing accessible name in the local graph", () => {
    // Deliberate. Redacting here would be an undocumented shortcut through T2, producing a
    // second redaction path the real one would later have to discover and reconcile.
    const graph = buildElementGraph([measure()], geometry, FRAME);
    expect(graph.nodes[0]!.name).toBe(AADHAAR_LABEL);
  });

  it("carries it through fusion unchanged", () => {
    const graph = buildElementGraph([measure()], geometry, FRAME);
    const r = fuse(graph, [], false, geometry);
    expect(r.elements[0]!.name).toBe(AADHAAR_LABEL);
  });

  it("does not silently truncate or mask it either", () => {
    // A "helpful" partial mask would be worse than none: it looks handled, so nobody
    // checks, and the sanitize tier inherits a field it cannot trust either way.
    const graph = buildElementGraph([measure()], geometry, FRAME);
    const name = graph.nodes[0]!.name;
    expect(name).not.toMatch(/\*|•|\[REDACTED\]|<PII/);
    expect(name).toContain("1234");
  });
});

describe("but nothing can carry it out of perception", () => {
  it("provides no function that builds a complete handoff", () => {
    // The only exit is a SanitizedHandoff, and there is no constructor for one. That is
    // the whole mechanism: the boundary holds because crossing it is unimplemented, not
    // because callers are careful.
    const src = readFileSync(
      fileURLToPath(new URL("../src/perceptionState.ts", import.meta.url)),
      "utf8"
    );
    expect(src).not.toMatch(/function\s+toHandoff/);
    expect(src).not.toMatch(/:\s*SanitizedHandoff\s*\{/);
  });

  it("types `verified` so the only constructible value cannot be transmitted", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/perceptionState.ts", import.meta.url)),
      "utf8"
    );
    // The egress guard refuses unless verified === true; typed as literal false, the
    // un-sendable value is the only one that exists.
    expect(src).toMatch(/readonly verified:\s*false/);
  });

  it("has no network capability to carry it anywhere", () => {
    // Belt and braces with the G5 scan: perception may observe locally, but it must never
    // gain the authority to exfiltrate what it observed.
    const files = ["perceptionState.ts", "elementGraph.ts", "fusion.ts", "uiDetectorHead.ts"];
    for (const f of files) {
      const src = readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      for (const token of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket"]) {
        expect(src, `${f} must not reference ${token}`).not.toContain(token);
      }
    }
  });

  it("the projected element still carries the name, and still cannot leave", () => {
    // projectElement produces the manifest SHAPE, not a transmissible artifact. The name
    // is present because T2 has not run; the object has no route out.
    const graph = buildElementGraph([measure()], geometry, FRAME);
    const r = fuse(graph, [], false, geometry);
    const projected = projectElement(r.elements[0]!);
    expect(projected.name).toBe(AADHAAR_LABEL);
    expect(projected).not.toHaveProperty("verified");
  });
});

describe("the migration point is documented where it will be looked for", () => {
  it("elementGraph names the policy and points at the sanitize tier", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/elementGraph.ts", import.meta.url)),
      "utf8"
    );
    // If this comment is ever deleted, the reason the field is unredacted goes with it.
    expect(src).toMatch(/T2 sanitize tier/);
    expect(src).toMatch(/text policy|Text metadata only where policy allows/i);
  });

  it("perceptionState states that the handoff belongs to T2", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/perceptionState.ts", import.meta.url)),
      "utf8"
    );
    expect(src).toMatch(/T2 sanitize tier/);
    expect(src).toMatch(/QG-04/);
  });
});
