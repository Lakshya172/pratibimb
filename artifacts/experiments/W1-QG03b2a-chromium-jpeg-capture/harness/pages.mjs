/**
 * The ten fixture pages, and the capture size each one needs.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE PAGES AND NOT IMAGES
 *
 * QG-03b-2 encoded images with Pillow and asked whether the browser decoded them the way
 * Pillow did. It answered yes, on every format, bitwise. But every one of those files was
 * written by the SAME LIBRARY FAMILY the reference uses, so agreement was close to
 * structural. This experiment removes that comfort: the bytes are produced by Chromium's
 * own encoder, reached through the real `chrome.tabs.captureVisibleTab`, and Pillow sees
 * them for the first time as a decoder.
 *
 * A capture is of a VIEWPORT, so the only way to choose the image dimensions is to choose
 * the window size. `size` below is the CAPTURE size wanted; the runner calibrates the
 * window chrome away to hit it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * DETERMINISM, AND ITS LIMIT
 *
 * The pages avoid animation, randomness, dates, and network resources, so a re-capture on
 * the same machine and browser build reproduces the same bytes — verified, not assumed:
 * the runner captures twice and compares.
 *
 * They are NOT reproducible ACROSS machines. Font rasterisation is a property of the
 * installed fonts and the compositor. That is why the committed byte hashes are recorded
 * as machine-bound evidence and no CI test re-renders a page to check one.
 */

/** Shared styling. No @font-face, no remote anything, no animation. */
const BASE = `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;
font-family:Segoe UI,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.btn{display:inline-block;padding:7px 14px;margin:4px;border:1px solid #9aa0a6;border-radius:4px;
background:linear-gradient(#fdfdfd,#e8eaed);font-size:13px;color:#202124}
.btn.pri{background:linear-gradient(#4285f4,#1967d2);border-color:#1967d2;color:#fff}
input,select{font-size:13px;padding:5px 8px;border:1px solid #9aa0a6;border-radius:4px;background:#fff}
h1{font-size:20px;margin:0 0 10px}h2{font-size:15px;margin:14px 0 6px;color:#3c4043}
p{font-size:13px;line-height:1.55;margin:0 0 9px;color:#3c4043}`;

const LOREM =
  "The quick brown fox jumps over the lazy dog while seventeen zebras quietly index " +
  "every paragraph of a document that nobody intends to read in full. Rendering text at " +
  "small sizes produces the highest spatial frequencies a screenshot can contain, which " +
  "is exactly why it belongs in a compression conformance fixture.";

function page(title, body, extraCss = "") {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>${BASE}${extraCss}</style></head><body>${body}</body></html>`
  );
}

const buttons = (n, cls = "") =>
  Array.from({ length: n }, (_, i) => `<span class="btn ${cls}">Action ${i + 1}</span>`).join("");

const rows = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join("");

export const PAGES = [
  {
    name: "text-heavy",
    category: "text-heavy UI",
    size: { w: 1264, h: 800 },
    html: page(
      "text",
      `<div style="padding:18px">${rows(9, (i) => `<h2>Section ${i + 1}</h2><p>${LOREM}</p>`)}</div>`
    ),
  },
  {
    name: "controls",
    category: "buttons and controls",
    size: { w: 1264, h: 800 },
    html: page(
      "controls",
      `<div style="padding:24px"><h1>Account preferences</h1>${buttons(6, "pri")}${buttons(10)}
       <div style="margin-top:20px">${rows(
         8,
         (i) =>
           `<div style="margin:9px 0"><label style="font-size:13px;display:inline-block;width:170px">Field ${i + 1}</label>` +
           `<input value="value ${i + 1}" size="24"><select><option>Alpha</option></select></div>`
       )}</div></div>`
    ),
  },
  {
    name: "small-controls",
    category: "small controls",
    size: { w: 1264, h: 800 },
    html: page(
      "small",
      `<div style="padding:12px;font-size:10px">${rows(
        26,
        (r) =>
          `<div style="margin:2px 0">${rows(
            22,
            (c) =>
              `<span style="display:inline-block;width:40px;height:13px;line-height:13px;margin-right:2px;` +
              `border:1px solid #9aa0a6;border-radius:2px;background:${(r + c) % 3 ? "#f1f3f4" : "#fff"};` +
              `font-size:8px;text-align:center">${r}.${c}</span>`
          )}</div>`
      )}</div>`
    ),
  },
  {
    name: "dense-ui",
    category: "dense UI",
    size: { w: 1264, h: 800 },
    html: page(
      "dense",
      `<div style="padding:8px"><table style="border-collapse:collapse;font-size:11px;width:100%">${rows(
        40,
        (r) =>
          `<tr>${rows(
            11,
            (c) =>
              `<td style="border:1px solid #dadce0;padding:2px 5px;background:${r % 2 ? "#fff" : "#f8f9fa"}">` +
              `${r === 0 ? `Column ${c}` : `${(r * 37 + c * 101) % 1000}`}</td>`
          )}</tr>`
      )}</table></div>`
    ),
  },
  {
    name: "gradients-edges",
    category: "gradients and high-frequency edges",
    size: { w: 1264, h: 800 },
    // A 1px checkerboard is the worst case a DCT codec can be handed, and it sits beside
    // smooth gradients so ringing and banding appear in the same frame.
    html: page(
      "gradients",
      `<div style="height:200px;background:linear-gradient(90deg,#ff0000,#00ff00,#0000ff)"></div>
       <div style="height:160px;background:linear-gradient(#000,#fff)"></div>
       <div style="height:220px;background-image:
         repeating-linear-gradient(0deg,#000 0 1px,#fff 1px 2px),
         repeating-linear-gradient(90deg,rgba(0,0,0,.5) 0 1px,rgba(255,255,255,.5) 1px 2px)"></div>
       <div style="height:220px;background:conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"></div>`
    ),
  },
  {
    name: "wide",
    category: "wide layout",
    size: { w: 1600, h: 600 },
    html: page(
      "wide",
      `<div style="padding:16px"><h1>Wide</h1>${buttons(24)}<p>${LOREM}</p>${buttons(18, "pri")}</div>`
    ),
  },
  {
    name: "tall",
    category: "tall layout",
    size: { w: 700, h: 1000 },
    html: page(
      "tall",
      `<div style="padding:14px"><h1>Tall</h1>${rows(
        7,
        (i) => `<h2>Block ${i + 1}</h2><p>${LOREM}</p>${buttons(3)}`
      )}</div>`
    ),
  },
  {
    name: "odd-dims",
    category: "odd dimensions (both axes odd)",
    size: { w: 1023, h: 641 },
    html: page(
      "odd",
      `<div style="padding:11px"><h1>Odd</h1>${buttons(9)}<p>${LOREM}</p>
      <div style="height:180px;background:linear-gradient(45deg,#202124,#f8f9fa)"></div>${buttons(7, "pri")}</div>`
    ),
  },
  {
    name: "fractional-letterbox",
    category: "fractional letterbox geometry",
    // 960x640 -> scale 0.6667, resized 640x427, continuous pad 106.667 vs raster pad 106.
    // The exact disagreement QG-03b was opened to settle, re-exercised on a real capture.
    size: { w: 960, h: 640 },
    html: page(
      "frac",
      `<div style="padding:13px"><h1>Fractional</h1>${buttons(8)}<p>${LOREM}</p>${buttons(6, "pri")}</div>`
    ),
  },
  {
    name: "realistic-ui",
    category: "realistic mixed UI",
    size: { w: 1264, h: 800 },
    html: page(
      "realistic",
      `<div style="display:flex;height:100%">
        <nav style="width:210px;background:#f1f3f4;padding:14px;font-size:13px">
          <div style="font-weight:600;margin-bottom:12px">PratiBimb</div>
          ${rows(
            9,
            (i) =>
              `<div style="padding:6px 8px;border-radius:4px;margin:2px 0;` +
              `background:${i === 2 ? "#d2e3fc" : "transparent"}">Navigation ${i + 1}</div>`
          )}
        </nav>
        <main style="flex:1;padding:18px">
          <h1>Dashboard</h1>${buttons(3, "pri")}${buttons(4)}
          <div style="display:flex;gap:12px;margin:16px 0">
            ${rows(
              3,
              (i) =>
                `<div style="flex:1;border:1px solid #dadce0;border-radius:8px;padding:12px">` +
                `<h2>Card ${i + 1}</h2><p>${LOREM.slice(0, 120)}</p>` +
                `<div style="height:56px;background:linear-gradient(90deg,#e8f0fe,#4285f4)"></div></div>`
            )}
          </div>
          <table style="border-collapse:collapse;font-size:12px;width:100%">${rows(
            12,
            (r) =>
              `<tr>${rows(
                6,
                (c) =>
                  `<td style="border-bottom:1px solid #e8eaed;padding:5px 8px">` +
                  `${r === 0 ? `Header ${c}` : `Row ${r} cell ${c}`}</td>`
              )}</tr>`
          )}</table>
        </main></div>`
    ),
  },
];
