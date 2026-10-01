/**
 * M10.7 — WHERE THE WEBP AND FRAME-EGRESS CODE MAY LIVE, AND WHAT IT MAY TOUCH. Read from source.
 *
 *   - the codec is the perception realm's, handed in by the offscreen document and referenced nowhere
 *     else; `@pratibimb/privacy` checks pixels and never touches a browser codec;
 *   - frame egress is called from the TR-01 evidence probe only: no product module calls it, so the
 *     product build sends no frame;
 *   - none of the codec, the attestation, frame egress or the test sink can OCR, read the DOM, call a
 *     model, act on a page or change a permission.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/**
 * Source without the comments that START a line, so a sentence ABOUT a forbidden thing does not count
 * as using it. Only line-leading comments: a string like "http://127.0.0.1/*" must never open a
 * "comment" that swallows real code. A trailing comment that names a forbidden thing fails safe.
 */
const code = (p: string) => read(p).replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f === ".output" || f === ".wxt" || f === "dist" || f === "test") return [];
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.(ts|mts|mjs)$/.test(f) ? [p.replaceAll("\\", "/")] : [];
  });
const extensionSources = walk("apps/extension");

/** The codec, cut out of the perception realm that owns it (the rest of that file runs models by design). */
const codecBlock = (() => {
  const src = code("apps/extension/host-lib/perception-realm.ts");
  return src.slice(src.indexOf("const opaque2d"), src.indexOf("export const perceptionRefused"));
})();

const M107 = [
  "packages/privacy/src/maskedArtifact.ts",
  "packages/egress/src/frame.ts",
  "packages/egress/src/webpContainer.ts",
  "tests/browser/support/frame-sink.mjs",
  "tests/browser/support/webp-riff.mjs",
];

const WORD = (w: string) => new RegExp(`(^|[^A-Za-z0-9_$])${w}([^A-Za-z0-9_$]|$)`);

describe("M10.7: the codec and frame egress stay where the architecture puts them", () => {
  it("the codec is defined in the perception realm and handed in by the offscreen document only", () => {
    const users = extensionSources.filter((f) => WORD("browserWebpCodec").test(code(f)));
    expect(users.sort()).toEqual(["apps/extension/host-lib/perception-realm.ts", "apps/extension/host/offscreen/main.ts"]);
    expect(codecBlock).toContain("export const browserWebpCodec");
    expect(codecBlock).toContain('convertToBlob({ type: "image/webp", quality })');
  });

  it("the codec cannot OCR, read the DOM, call a model, act on a page, change a permission or reach the network", () => {
    for (const forbidden of ["tesseract", "document.", "querySelector", "window.", "InferenceSession", "ort.", "textRegions", "dispatch", "chrome.", "fetch(", "XMLHttpRequest", "WebSocket"]) {
      expect(codecBlock.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("no product module calls frame egress: only the TR-01 evidence probe does", () => {
    const callers = extensionSources.filter((f) => code(f).includes("sendMaskVerifiedFrame"));
    expect(callers).toEqual(["apps/extension/probe/tr01.ts"]);
    expect(code("apps/extension/probe/tr01-absent.ts")).not.toMatch(/sendMaskVerifiedFrame|encodeSanitized|webp/i);
  });

  it("the service worker and the content script neither encode nor send a frame", () => {
    for (const f of ["apps/extension/host/background.ts", "apps/extension/host/content.ts"]) {
      expect(code(f)).not.toMatch(/webp|encodeSanitized|sendMaskVerifiedFrame|convertToBlob|attestMaskedFrame/i);
    }
  });

  it("the TR-01 worker has no codec and no egress", () => {
    for (const f of ["apps/extension/host/tr01-worker.ts", "apps/extension/host-lib/tr01-worker-core.ts"]) {
      expect(code(f)).not.toMatch(/webp|convertToBlob|sendMaskVerified|fetch\(/i);
    }
  });

  it("@pratibimb/privacy checks pixels; it never touches a browser codec or the network", () => {
    const src = code("packages/privacy/src/maskedArtifact.ts");
    for (const forbidden of ["OffscreenCanvas", "createImageBitmap", "convertToBlob", "ImageData", "toDataURL", "fetch(", "XMLHttpRequest"]) {
      expect(src.includes(forbidden), forbidden).toBe(false);
    }
  });

  it.each(M107)("%s cannot OCR, read the DOM, call a model, act on a page or change a permission", (f) => {
    const src = code(f);
    // An OCR import or call. (The manifest NAMES the OCR step that did not run; naming is not calling.)
    expect(src).not.toMatch(/tesseract|from\s+["'][^"']*ocr|[^A-Za-z]ocr\w*\s*\(|\.recogni[sz]e\(/i);
    for (const forbidden of ["document.", "querySelector", "window.", "onnxruntime", "InferenceSession", "ort.", "tr01-host", "createTr01Host", "dispatch", "chrome.", ".click(", "host_permissions", "optional_permissions"]) {
      expect(src.includes(forbidden), `${f}: ${forbidden}`).toBe(false);
    }
  });

  it("frame egress is reachable only through the attestation and only to loopback", () => {
    const src = code("packages/egress/src/frame.ts");
    expect(src.indexOf("isMaskVerifiedFrame(request.frame)")).toBeGreaterThan(-1);
    expect(src.indexOf("isLoopback(request.destination)")).toBeGreaterThan(src.indexOf("isMaskVerifiedFrame(request.frame)"));
    expect(src.split("fetch(").length - 1).toBe(1);
  });

  it("the sink binds loopback only and is never imported by extension code", () => {
    expect(read("tests/browser/support/frame-sink.mjs")).toContain('if (host !== "127.0.0.1") throw');
    expect(extensionSources.filter((f) => /frame-sink|webp-riff/.test(read(f)))).toEqual([]);
  });

  it("the extension's pinned connect-src is unchanged: one loopback origin", () => {
    expect(read("apps/extension/wxt.config.ts")).toContain('export const HOST_COLLECTOR_ORIGIN = "http://127.0.0.1:8995";');
  });
});
