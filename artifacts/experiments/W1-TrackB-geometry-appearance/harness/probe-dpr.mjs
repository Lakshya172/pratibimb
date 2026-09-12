/**
 * Does a fractional deviceScaleFactor give a NATIVE raster, or an internal downsample?
 *
 *   node artifacts/experiments/W1-TrackB-geometry-appearance/harness/probe-dpr.mjs
 *
 * The whole GEOM family rests on one assumption: that asking Chromium for viewport
 * `k*640` at DPR `1/k` makes it lay out at k*640 CSS px and RASTERISE at 640 device px,
 * so glyphs and edges are drawn sharp at their final size. If instead Chromium renders at
 * k*640 and scales the bitmap down, GEOM is not isolating geometry at all — it is just
 * NAT with extra steps, and the experiment would silently answer nothing.
 *
 * The test is decisive and cheap:
 *
 *   A = viewport k*640, DPR 1/k        -> 640 px capture
 *   B = viewport k*640, DPR 1          -> k*640 px capture, then Lanczos down to 640
 *
 * If A and B are pixel-identical, Chromium downsampled and the assumption is FALSE.
 * If they differ materially, A is a native raster and the assumption HOLDS.
 *
 * Text is the discriminator: a natively-rasterised glyph is hinted and snapped to the
 * device grid, a downsampled one is not. They cannot agree by accident.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const OUT = join(HERE, "generated", "probe");
const PORT = 8991;
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };

// Deliberately text-heavy and edge-heavy: the two things resampling destroys first.
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#fff;font-family:Segoe UI,system-ui,sans-serif}
.r{position:absolute;border:1px solid #202124;background:#f1f3f4;font-size:11px;line-height:13px;color:#202124}
</style></head><body id="b"></body>
<script>
const b=document.getElementById("b");let h="";
for(let r=0;r<24;r++)for(let c=0;c<10;c++){
  h+='<div class="r" style="left:'+(8+c*94)+'px;top:'+(8+r*26)+'px;width:88px;height:20px">Item '+r+'.'+c+'</div>';
}
b.innerHTML=h;
</script></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(HTML);
});
server.listen(PORT, "127.0.0.1");

const require2 = createRequire(join(ROOT, "node_modules", "noop.js"));
let chromium;
try { ({ chromium } = require2("playwright")); } catch { refuse("playwright not resolvable"); }
const exe = process.env.CHROME_PATH || chromium.executablePath();
if (!existsSync(exe)) refuse(`no Chromium at ${exe} (set CHROME_PATH)`);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: exe });
const results = [];

try {
  for (const k of [2.0, 4.0]) {
    const vw = Math.round(640 * k);
    const vh = Math.round(427 * k);

    // A — fractional DPR. The claim under test.
    const ctxA = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 / k });
    const pA = await ctxA.newPage();
    await pA.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    const obsA = await pA.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
    const pngA = await pA.screenshot({ type: "png" });
    await ctxA.close();

    // B — DPR 1 at the same CSS viewport. Downsampled to 640 outside the browser.
    const ctxB = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    const pB = await ctxB.newPage();
    await pB.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    const obsB = await pB.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
    const pngB = await pB.screenshot({ type: "png" });
    await ctxB.close();

    writeFileSync(join(OUT, `k${k}-A-dpr.png`), pngA);
    writeFileSync(join(OUT, `k${k}-B-native.png`), pngB);
    results.push({ k, vw, vh, obsA, obsB, aBytes: pngA.length, bBytes: pngB.length });
    console.log(`k=${k} viewport ${vw}x${vh}`);
    console.log(`  A: css ${obsA.w}x${obsA.h} dpr ${obsA.dpr}  png ${pngA.length} B`);
    console.log(`  B: css ${obsB.w}x${obsB.h} dpr ${obsB.dpr}  png ${pngB.length} B`);
  }
} finally {
  await browser.close();
  server.close();
}

writeFileSync(join(OUT, "probe.json"), JSON.stringify({ results }, null, 1));
console.log(`\nwrote ${OUT}`);
console.log("now run compare-probe.py to decide whether A is a native raster");
