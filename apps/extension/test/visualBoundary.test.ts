/**
 * M3 — WHAT THE VISUAL TIER IS STRUCTURALLY INCAPABLE OF CARRYING.
 *
 * The three-act harness checks what actually crossed on a real run, by scanning the worker's own
 * recording, the reasoner's received bytes and the egress payload. These are the other half: rules
 * over the types and the source, which catch a mistake before a browser is ever launched and which
 * hold for inputs no fixture happens to produce.
 *
 * The distinction that matters most here is the one the file exists to protect. `PerceptionSummary`
 * is what leaves the realm that holds the pixels. Every field in it is a count, a code, a geometry
 * or a timing — so a leak is not a check that has to pass, it is a shape that cannot be built.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { UI_CLASSES, UI_DETECTOR_ROLE, cssBox, docBox, frameId, fuse, nodeId } from "@pratibimb/perception";

import { perceptionRefused, type PerceptionSummary } from "../host-lib/perception-realm";

const APP = join(__dirname, "..");
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Anything that looks like an encoded image, anywhere in a structure. */
const carriesPixels = (anything: unknown): boolean => {
  const text = typeof anything === "string" ? anything : JSON.stringify(anything ?? null);
  return text.includes("iVBORw0KGgo") || text.includes("data:image") || /[A-Za-z0-9+/]{200,}/.test(text);
};

describe("the visual tier cannot carry pixels out of its realm", () => {
  it("a refused pass is a typed refusal with counts, never a quiet zero", () => {
    const summary = perceptionRefused("CAPTURE_THROTTLED", "captureVisibleTab rejected: quota");
    expect(summary.ran).toBe(false);
    expect(summary.refusal?.code).toBe("CAPTURE_THROTTLED");
    // A detector that returned an empty list would be indistinguishable from a page with no
    // controls. The refusal says which of those two things happened.
    expect(summary.detector.ran).toBe(false);
    expect(summary.capture).toBeNull();
    expect(summary.fusion).toBeNull();
    expect(carriesPixels(summary)).toBe(false);
  });

  it("serialises to something with no image in it, even when every field is filled", () => {
    // A summary with every optional block present, so the check is about the SHAPE rather than
    // about a happened-to-be-empty instance.
    const full: PerceptionSummary = {
      ran: true,
      refusal: null,
      capture: { w: 1600, h: 900, format: "png", bytes: 40703, dpr: 1, scaleToCss: 0.8 },
      detector: {
        modelId: "pratibimb-t1-ui-head",
        revision: "ba6d9e93695b",
        backend: "wasm",
        ran: true,
        detections: 100,
        byClass: { textbox: 47, button: 29 },
        refusal: null,
      },
      fusion: { matched: 6, visionOnly: 94, domOnly: 8, overlaySuspected: 6 },
      elements: [{ id: "#mobile", role: "textbox", name: "Mobile number", source: "dom+vision", visible: true, offscreen: false, enabled: true, bbox: [10, 20, 300, 24] }],
      sourceBySelector: { "#mobile": "dom+vision" },
      ms: { capture: 50, decode: 17, preprocess: 70, infer: 85, fuse: 2, total: 224 },
    };
    expect(carriesPixels(full)).toBe(false);
    // The capture block reports a LENGTH. There is no field that could hold the bytes themselves.
    expect(Object.keys(full.capture!)).toEqual(["w", "h", "format", "bytes", "dpr", "scaleToCss"]);
  });

  it("labels can only come from the head's eight classes, so a detection cannot be text", () => {
    // The structural reason there is nothing to sanitize in a detection: the head is defined over a
    // fixed list of interactable classes, with no text class and no OCR anywhere in this milestone.
    expect([...UI_CLASSES]).toEqual(["button", "link", "textbox", "checkbox", "radio", "select", "tab", "icon"]);
    expect(UI_CLASSES).not.toContain("text");
  });

  it("no message type in the extension can carry an image", () => {
    for (const file of ["host-lib/messages.ts", "host-lib/boundary-protocol.ts"]) {
      const code = withoutComments(readFileSync(join(APP, file), "utf8"));
      expect(code, `${file} names a pixel-bearing field`).not.toMatch(/\b(pixels|dataUrl|screenshot|image|bitmap)\s*[?]?:/i);
    }
  });

  it("only the perception realm decodes an image, and it persists nothing", () => {
    const walk = (dir: string, out: { path: string; text: string }[] = []): { path: string; text: string }[] => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith(".ts")) out.push({ path: full.slice(APP.length + 1).replace(/\\/g, "/"), text: withoutComments(readFileSync(full, "utf8")) });
      }
      return out;
    };
    const sources = [...walk(join(APP, "host")), ...walk(join(APP, "host-lib"))];

    // INVOCATION, not mention: the realm probe in the offscreen document asks whether
    // `createImageBitmap` EXISTS, which is how the capture architecture was established in the
    // first place and is not a decode. The rule is about which file turns bytes into pixels.
    const decoders = sources.filter((f) => /createImageBitmap\(|getImageData\(|new OffscreenCanvas\(/.test(f.text));
    expect(decoders.map((f) => f.path)).toEqual(["host-lib/perception-realm.ts"]);

    // No frame, and nothing derived from one, may outlive the run in any store.
    for (const file of sources) {
      expect(file.text, `${file.path} persists`).not.toMatch(/localStorage|sessionStorage|indexedDB|chrome\.storage/);
    }
    // And nothing logs: a console line is a place a frame could land without anyone deciding to.
    const realm = sources.find((f) => f.path === "host-lib/perception-realm.ts");
    expect(realm?.text).not.toContain("console.");
  });

  it("the worker records the shape of a capture ticket and never a frame", () => {
    const worker = withoutComments(readFileSync(join(APP, "host", "background.ts"), "utf8"));
    // M3.1: what the worker carries on the product path is an opaque handle, which is recorded in
    // full because it is an id. The degraded path's frame is recorded as a LENGTH, because a
    // diagnostic that stored every frame would be the leak it exists to detect.
    expect(worker).toContain("CAPTURE_TICKET");
    expect(worker).toContain("dataUrlLength");
    expect(worker).not.toMatch(/note\([^)]*dataUrl\s*\)/);
    expect(worker).not.toMatch(/dataUrl:\s*ticket/);
  });

  it("the product build has no way to capture a frame into the worker", () => {
    // The degraded path is a BUILD decision: `captureVisibleTab` is an optional property of the
    // browser adapter and is supplied only behind M3_WORKER_FRAME, so a product bundle contains no
    // reference to the API at all. The browser harness asserts the same thing over the artifact.
    const worker = withoutComments(readFileSync(join(APP, "host", "background.ts"), "utf8"));
    expect(worker).toContain("__M3_WORKER_FRAME__");
    const calls = worker.match(/chrome\.tabs\.captureVisibleTab/g) ?? [];
    expect(calls).toHaveLength(1);
    // ...and that one call sits inside the flag's branch, never outside it.
    const guarded = /__M3_WORKER_FRAME__[\s\S]{0,200}chrome\.tabs\.captureVisibleTab/.test(worker);
    expect(guarded, "the only captureVisibleTab call is inside the M3_WORKER_FRAME branch").toBe(true);
  });

  it("the default build asks for activeTab and not for every origin", () => {
    // `<all_urls>` arriving quietly in a privacy milestone is exactly the thing to have a test for.
    // The evidence harness sets M3_WORKER_FRAME because no harness can produce the invocation the
    // gesture route needs; this asserts what a build without that flag declares.
    const config = readFileSync(join(APP, "wxt.config.ts"), "utf8");
    expect(config).toContain('"activeTab"');
    expect(config).toContain("M3_WORKER_FRAME");
    const defaultBranch = /: \["http:\/\/127\.0\.0\.1\/\*"\];/.test(config);
    expect(defaultBranch, "the default host_permissions branch is loopback only").toBe(true);
  });
});

/**
 * M3.1 — VISUAL EVIDENCE STAYS VISUAL EVIDENCE.
 *
 * The detector has high recall and roughly four percent precision — QG-05 measured 3947 predictions
 * for 202 buttons on the model's own held-out set — so most of what it emits matches nothing. The
 * question is not whether that noise exists but what the system is allowed to do with it.
 *
 * The rule these tests hold is one sentence: **a box only pixels assert may be counted, and may not
 * become anything a plan can name or a vault can hold.** Provenance is a discriminated union rather
 * than a confidence number for exactly this reason — after averaging, "the DOM says a field is
 * here" and "a detector thinks something is here" are indistinguishable, and they must not be.
 */
describe("fusion semantics for visual-only evidence", () => {
  const graph = {
    frameId: frameId("f1"),
    nodes: [
      {
        id: nodeId("n1"),
        domRef: { selector: "#reference" },
        role: "textbox",
        name: "Document reference",
        box: cssBox(140, 300, 400, 32),
        // `fuse` matches against the EVIDENCE's viewport box, not against `node.box` — an element
        // with no pixels in this frame has nothing a detection could be attributed to, which is
        // the off-screen rule doing its job. So the evidence has to be real here.
        evidence: {
          kind: "OBSERVED" as const,
          frameId: frameId("f1"),
          viewportBox: cssBox(140, 300, 400, 32),
          documentBox: docBox(140, 300, 400, 32),
        },
        enabled: true,
      },
    ],
    byId: new Map(),
  };
  graph.byId.set(graph.nodes[0]!.id, graph.nodes[0]!);

  const detection = (x: number, y: number, w: number, h: number, label = "textbox", score = 0.9) => ({
    box: cssBox(x, y, w, h),
    label,
    score,
    role: UI_DETECTOR_ROLE,
    frameId: frameId("f1"),
    modelId: "pratibimb-t1-ui-head",
    revision: "ba6d9e93695b",
  });

  const geometry = {
    dpr: 1,
    zoom: 1,
    viewportCss: { w: 1280, h: 720 },
    captureSize: { w: 1280, h: 720 },
    scroll: { x: 0, y: 0 },
    origin: "http://127.0.0.1:8975",
  };

  it("marks an element dom+vision only when both actually contributed", () => {
    const overlapping = fuse(graph, [detection(140, 300, 400, 32)], true, geometry);
    expect(overlapping.matchedCount).toBe(1);
    expect(overlapping.elements[0]?.provenance.source).toBe("dom+vision");

    // The same DOM node, with the detector finding nothing near it, stays dom — and says WHY,
    // because "vision missed it" and "it was off screen" are different facts.
    const missed = fuse(graph, [detection(900, 20, 40, 40)], true, geometry);
    const domOnly = missed.elements.find((e) => e.provenance.source === "dom");
    expect(domOnly).toBeDefined();
    expect(domOnly?.provenance.source === "dom" && domOnly.provenance.visualAbsence).toBe("NOT_DETECTED");
  });

  it("says NO_DETECTOR rather than NOT_DETECTED when the detector never ran", () => {
    // A detector that could not run and a detector that looked and found nothing are not the same
    // claim, and an element that conflated them would overstate what the client checked.
    const noDetector = fuse(graph, [], false, geometry);
    const element = noDetector.elements[0];
    expect(element?.provenance.source === "dom" && element.provenance.visualAbsence).toBe("NO_DETECTOR");
  });

  it("keeps a vision-only box out of everything a plan could name", () => {
    const result = fuse(graph, [detection(140, 300, 400, 32), detection(900, 20, 40, 40, "button")], true, geometry);
    expect(result.visionOnlyCount).toBe(1);

    const visionOnly = result.elements.find((e) => e.provenance.source === "vision");
    expect(visionOnly).toBeDefined();
    // It has a synthetic id and no DOM reference, so there is nothing for the manifest to key it
    // to. That is the mechanism, not a convention: `sourceBySelector` is built by looking each
    // fused element up in the graph, and this one is not in it.
    expect(graph.byId.get(visionOnly!.id)).toBeUndefined();
  });

  it("never turns a detection into a vault entry, because a box is not a literal", () => {
    // The vault is opened by `classifyObservation` in the page realm, over DOM field VALUES. The
    // detector runs in a different realm, emits boxes and class labels, and has no path to it.
    // This is the source rule for that: nothing in the perception adapter touches the vault.
    const realm = withoutComments(readFileSync(join(APP, "host-lib", "perception-realm.ts"), "utf8"));
    expect(realm).not.toContain("createVault");
    expect(realm).not.toContain("Vault");
    expect(realm).not.toContain("rehydrate");
    expect(realm).not.toContain("piiClass");
  });

  it("carries a score alongside provenance rather than blended into it", () => {
    const result = fuse(graph, [detection(140, 300, 400, 32, "textbox", 0.42)], true, geometry);
    const element = result.elements[0];
    expect(element?.provenance.source).toBe("dom+vision");
    // A DOM-only element at 0.9 and a vision-only one at 0.9 warrant completely different
    // treatment; after averaging they are the same number.
    expect(element?.provenance.source === "dom+vision" && element.provenance.detection.score).toBe(0.42);
  });
});
