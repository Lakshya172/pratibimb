/**
 * M8.2 — in-browser preprocessing, for TIMING ONLY. It is M8.1's page-side definition (bilinear
 * with cv2.INTER_LINEAR's half-pixel convention, BGR, ImageNet mean/std) plus the two resize rules
 * each candidate's inference.yml declares. The tensor fed to every model in every cell is the
 * Python tensor from prep-native.py; this one is only timed and compared with it.
 */
globalThis.M82_PREPROCESS = (() => {
  const MEAN = [0.485, 0.456, 0.406].map(Math.fround);
  const STD = [0.229, 0.224, 0.225].map(Math.fround);
  /** Python's round(): half to even. */
  const pyRound = (x) => {
    const f = Math.floor(x);
    const d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  };
  function targetSize(rule, h, w) {
    if (rule.type === 2) {
      const ratio = rule.resize_long / (h > w ? h : w);
      const rh = Math.trunc(h * ratio);
      const rw = Math.trunc(w * ratio);
      const s = rule.stride;
      return [Math.floor((rh + s - 1) / s) * s, Math.floor((rw + s - 1) / s) * s];
    }
    let ratio = 1;
    if (Math.min(h, w) < rule.limit_side_len) ratio = h < w ? rule.limit_side_len / h : rule.limit_side_len / w;
    let rh = Math.trunc(h * ratio);
    let rw = Math.trunc(w * ratio);
    if (Math.max(rh, rw) > rule.max_side_limit) {
      const r = rule.max_side_limit / Math.max(rh, rw);
      rh = Math.trunc(rh * r);
      rw = Math.trunc(rw * r);
    }
    const s = rule.stride;
    return [Math.max(pyRound(rh / s) * s, s), Math.max(pyRound(rw / s) * s, s)];
  }
  function resizeNormalise(rgba, ih, iw, oh, ow) {
    const out = new Float32Array(3 * oh * ow);
    const plane = oh * ow;
    const x0s = new Int32Array(ow), x1s = new Int32Array(ow), wx = new Float64Array(ow);
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(Math.max((x + 0.5) * (iw / ow) - 0.5, 0), iw - 1);
      x0s[x] = Math.floor(sx);
      x1s[x] = Math.min(x0s[x] + 1, iw - 1);
      wx[x] = sx - x0s[x];
    }
    for (let y = 0; y < oh; y++) {
      const sy = Math.min(Math.max((y + 0.5) * (ih / oh) - 0.5, 0), ih - 1);
      const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, ih - 1), wy = sy - y0;
      for (let x = 0; x < ow; x++) {
        for (let c = 0; c < 3; c++) {
          const ch = 2 - c;
          const a = rgba[(y0 * iw + x0s[x]) * 4 + ch], b = rgba[(y0 * iw + x1s[x]) * 4 + ch];
          const d = rgba[(y1 * iw + x0s[x]) * 4 + ch], e = rgba[(y1 * iw + x1s[x]) * 4 + ch];
          const top = a * (1 - wx[x]) + b * wx[x];
          const bottom = d * (1 - wx[x]) + e * wx[x];
          const v = Math.fround((top * (1 - wy) + bottom * wy) / 255);
          out[c * plane + y * ow + x] = Math.fround(Math.fround(v - MEAN[c]) / STD[c]);
        }
      }
    }
    return out;
  }
  return { targetSize, resizeNormalise };
})();
