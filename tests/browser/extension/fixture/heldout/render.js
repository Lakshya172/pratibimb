/**
 * HELD-OUT VISUAL-TEXT SET (RE-1) — the renderer every held-out page shares.
 *
 * Draws a page's text into its canvas and measures its ground truth from the same draw calls, so
 * the truth cannot drift from the pixels. Deterministic: no timers, no randomness, no network, no
 * animation. Everything drawn is synthetic.
 *
 * GROUND TRUTH IS GEOMETRY, NEVER TEXT. For every run of text it records:
 *   glyphs  one ink box per non-whitespace character — `measureText` of the character, placed at the
 *           kerned advance of its prefix, using actualBoundingBox{Left,Right,Ascent,Descent}
 *   ink     the union of those glyph boxes
 *   line    the font line box — fontBoundingBox{Ascent,Descent} — across the run's non-whitespace
 *           advance. RE-1 treats padding up to this box as free, because it is where text lives.
 * All in CSS viewport pixels, converted through the canvas's own rect and attribute-to-CSS scale.
 * The characters themselves are not written to `__groundTruth`.
 *
 * THIS SET IS HELD OUT. It exists to be scored ONCE per candidate under RE-1, after the development
 * screen, and never to choose a threshold, a post-processing parameter or an input size. See
 * docs/perception/redaction-evaluation.md §6.
 */
(function () {
  const spec = window.__spec;
  const canvas = document.getElementById("img");
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  ctx.fillStyle = spec.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const d of spec.decorations || []) {
    ctx.fillStyle = d.fill;
    ctx.fillRect(d.x, d.y, d.w, d.h);
  }

  const rc = canvas.getBoundingClientRect();
  const sx = rc.width / canvas.width;
  const sy = rc.height / canvas.height;
  const css = (x, y, w, h) => ({ x: rc.x + x * sx, y: rc.y + y * sy, w: w * sx, h: h * sy });
  const union = (boxes) => {
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  const strings = [];
  for (const line of spec.lines) {
    let x = line.x;
    for (const run of line.runs) {
      ctx.font = run.font || line.font;
      ctx.fillStyle = run.color || line.color || "#111111";
      ctx.fillText(run.text, x, line.baseline);

      const glyphs = [];
      for (let i = 0; i < run.text.length; i += 1) {
        const c = run.text[i];
        if (/\s/.test(c)) continue;
        const advance = ctx.measureText(run.text.slice(0, i)).width;
        const m = ctx.measureText(c);
        const left = x + advance - m.actualBoundingBoxLeft;
        const right = x + advance + m.actualBoundingBoxRight;
        const top = line.baseline - m.actualBoundingBoxAscent;
        const bottom = line.baseline + m.actualBoundingBoxDescent;
        if (right > left && bottom > top) glyphs.push(css(left, top, right - left, bottom - top));
      }

      const whole = ctx.measureText(run.text);
      if (glyphs.length > 0) {
        const lead = run.text.length - run.text.trimStart().length;
        const start = x + ctx.measureText(run.text.slice(0, lead)).width;
        const end = x + ctx.measureText(run.text.trimEnd()).width;
        const top = line.baseline - whole.fontBoundingBoxAscent;
        const height = whole.fontBoundingBoxAscent + whole.fontBoundingBoxDescent;
        strings.push({
          id: run.id,
          sensitive: run.sensitive === true,
          font: ctx.font,
          glyphCount: glyphs.length,
          glyphs,
          ink: union(glyphs),
          line: css(start, top, end - start, height),
        });
      }
      x += whole.width;
    }
  }

  window.__groundTruth = {
    image: spec.id,
    case: spec.case,
    region: css(0, 0, canvas.width, canvas.height),
    strings,
  };
  window.__fixtureReady = true;
})();
