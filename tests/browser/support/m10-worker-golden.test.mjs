/**
 * M10.4 — THE WORKER REPRODUCES M10.1 EXACTLY. Golden equivalence of the detector worker's core.
 *
 * The worker core (`apps/extension/host-lib/tr01-worker-core.ts`) is handed each real frozen frame as
 * RGBA, and a session whose `infer` returns THIS MACHINE'S recorded probability map for that frame.
 * What it posts must equal, box for box and bit for bit:
 *
 *   - the M10.1 product detector (`createTextRegionDetector`) run directly on the same inputs;
 *   - the screened `dbPostprocess` (M8.1) on the same map;
 *   - this workstation's baseline box geometry.
 *
 * And the tensor the worker's session is handed must be the baseline's committed input hash. No
 * tolerance, no tuning: a mismatch here means STOP.
 *
 * THE BASELINE IS PER MACHINE, and the comparison is no weaker for it. M8.2's native reference is
 * machine-local: onnxruntime returns a different output for a byte-identical tensor and model on a
 * different CPU, and a different GPU rasterises the same DOM to different pixels. W1 keeps M8.1's
 * historical record; another machine uses its own; an unknown machine REFUSES rather than borrowing
 * one. See tests/browser/support/m82-baseline.mjs.
 *
 * Real frames are M8.2's git-ignored fixtures. Absent, the layer is SKIPPED VISIBLY, never passed.
 * The real ORT session in a real worker is `tests/browser/extension/run-tr01-worker.mjs`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { createTextRegionDetector, frameId, TR01 } from "@pratibimb/perception";

import { createTr01WorkerCore } from "../../../apps/extension/host-lib/tr01-worker-core.ts";
import { decodePng } from "./png-decode.mjs";
import { baselineWorkstation, fixturesDir, FIXTURE_NAMES, hasBaseline, loadBaseline } from "./m82-baseline.mjs";
import { dbPostprocess as screenedDbPostprocess } from "./text-detector-screening.mjs";

const WS = baselineWorkstation();
const FIX = pathToFileURL(fixturesDir(WS) + "/");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const bytesOf = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);

const NAMES = FIXTURE_NAMES;
// A fixture set with no baseline for this machine is NOT silently skipped as "absent": it is a
// different and more serious condition, and `loadBaseline` says so loudly when the layer runs.
const haveFixtures = NAMES.every((n) => existsSync(new URL(`screenshots/${n}.png`, FIX)) && existsSync(new URL(`TR-01/native-${n}.f32`, FIX)));
const baseline = haveFixtures ? loadBaseline("TR-01", WS) : null;

describe.skipIf(!haveFixtures)(`worker core == M10.1 product detector == screened (real frames, ${WS.id} baseline)`, () => {
  for (const name of NAMES) {
    it(`${name}: same tensor, same boxes, same scores`, async () => {
      const img = decodePng(readFileSync(new URL(`screenshots/${name}.png`, FIX)));
      const raw = readFileSync(new URL(`TR-01/native-${name}.f32`, FIX));
      const map = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      const seen = [];
      const session = {
        infer: async (t, dims) => {
          seen.push(sha256(bytesOf(t)));
          return { data: map, dims: [1, 1, dims[2], dims[3]] };
        },
      };

      const posted = [];
      const core = createTr01WorkerCore({
        installRuntime: async () => {},
        loadModel: async () => ({ bytes: new Uint8Array(1), sha256: TR01.onnxSha256 }),
        createSession: async () => session,
        post: (r) => posted.push(r),
        now: () => 0,
      });
      await core.handle({ type: "TR01_INIT", protocol: 1 });
      await core.handle({ type: "TR01_DETECT", protocol: 1, runId: 1, width: img.width, height: img.height, rgba: img.rgba });
      const result = posted[1];
      expect(result.type).toBe("TR01_RESULT");
      expect(seen[0]).toBe(baseline.inputs[name].inputSha256);

      // the M10.1 product detector, directly
      const direct = await createTextRegionDetector({
        modelId: TR01.modelId, revision: TR01.revision, acceptedBackends: ["wasm"],
        pixels: () => img, infer: session.infer,
      }).detect({ id: frameId(name), capturedAt: 0, source: "live", geometry: { dpr: 1, zoom: 1, viewportCss: { w: img.width, h: img.height }, captureSize: { w: img.width, h: img.height }, scroll: { x: 0, y: 0 }, origin: "https://fixture.invalid" } }, "wasm");
      expect(direct.ok).toBe(true);
      expect(result.detections).toEqual(direct.value.map((d) => ({ x: d.box.x, y: d.box.y, w: d.box.w, h: d.box.h, score: d.score })));

      // the screened post-processing, and M8.1's recorded geometry
      const [H, W] = baseline.inputs[name].input.resized_hw;
      const screened = screenedDbPostprocess(map, H, W, baseline.inputs[name].input.ratio_h, baseline.inputs[name].input.ratio_w, img.height, img.width);
      expect(result.detections).toEqual(screened.boxes);
      expect(result.detections.map((b) => [b.x, b.y, b.w, b.h])).toEqual(baseline.inputs[name].boxes.map((b) => [b.x, b.y, b.w, b.h]));
      for (const d of result.detections) expect(Object.keys(d).sort()).toEqual(["h", "score", "w", "x", "y"]);
    });
  }
});

describe("the worker golden layer is not silently absent", () => {
  it("states whether it ran", () => {
    expect(typeof haveFixtures).toBe("boolean");
    // A machine with fixtures but no baseline must not reach the layer at all.
    if (haveFixtures) expect(hasBaseline("TR-01", WS)).toBe(true);
    if (!haveFixtures) console.warn(`m10 worker golden: M8.2 fixtures absent for ${WS.id} — the real-frame layer was SKIPPED`);
  });
});
