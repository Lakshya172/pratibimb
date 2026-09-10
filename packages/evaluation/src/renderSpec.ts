/**
 * Deterministic spec → HTML, for the rendered T1 training set.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THE LABELS COME FROM THE DOM AND NOT FROM THIS FILE
 *
 * This module decides WHAT to render. It does not decide where anything ends up. The
 * labels are read back from the rendered document with `getBoundingClientRect()`, so the
 * boxes are, by construction, where the browser actually painted the pixels.
 *
 * The alternative — emitting boxes from the same code that emits the CSS — is the classic
 * way to train a detector on a lie. A one-pixel border, a line-height rounding, a font
 * that loads at a different metric, and the labels drift from the pixels while every test
 * still passes, because the test compares the generator against itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * DETERMINISM
 *
 * Every choice below is drawn from a seeded PRNG. Same version + seed ⇒ same HTML ⇒ same
 * pixels ⇒ same labels. Nothing here calls `Math.random()`, `Date.now()`, or reads the
 * environment.
 *
 * Fonts are declared as generic families only (`system-ui`, `serif`, `monospace`). Naming
 * a specific font would make the rendered pixels depend on what is installed on the
 * machine that rendered them, which is exactly the kind of hidden non-determinism that
 * makes a dataset irreproducible six months later.
 */
import { mulberry32 } from "./generator.js";

/** Rendered-sample layout knobs. Every one is a real source of detector error. */
export interface RenderSpec {
  readonly id: string;
  readonly seed: number;
  readonly viewport: { readonly w: number; readonly h: number };
  readonly density: "sparse" | "normal" | "dense";
  readonly palette: number;
  readonly fontFamily: "system-ui, sans-serif" | "Georgia, serif" | "ui-monospace, monospace";
  readonly baseFontPx: number;
}

/** Distinct enough to change contrast and edge strength, which detectors are sensitive to. */
const PALETTES = [
  { bg: "#ffffff", fg: "#111111", ctl: "#e8eef6", border: "#9db4cc", accent: "#12395c" },
  { bg: "#f6f7f9", fg: "#1a1a1a", ctl: "#ffffff", border: "#c9ced6", accent: "#7a3e00" },
  { bg: "#fffdf7", fg: "#20180a", ctl: "#fff3d6", border: "#d8bd7a", accent: "#8a6d1f" },
  { bg: "#f2f6f2", fg: "#0f1a0f", ctl: "#e3f0e3", border: "#a3c6a3", accent: "#1f5c2e" },
] as const;

const LABELS = [
  "Apply", "Submit", "Cancel", "Save", "Save as", "Continue", "Back", "Verify",
  "Download receipt", "Check status", "Renew", "Print", "Next", "Confirm details",
] as const;

const FIELDS = [
  "Full name", "Phone", "Email address", "District", "PIN code", "Application number",
  "Date of birth", "Father's name", "Account number", "IFSC",
] as const;

const LINKS = [
  "Terms of service", "Privacy policy", "Need help?", "What documents do I need?",
  "Track my application", "Contact the office",
] as const;

/** Build a spec deterministically from a seed. */
export function makeSpec(id: string, seed: number): RenderSpec {
  const r = mulberry32(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;

  // Viewport varies, because a detector that only ever saw 1024x640 has learned that too.
  const widths = [960, 1024, 1152, 1280] as const;
  const heights = [600, 640, 720, 800] as const;

  return {
    id,
    seed,
    viewport: { w: pick(widths), h: pick(heights) },
    density: pick(["sparse", "normal", "dense"] as const),
    palette: Math.floor(r() * PALETTES.length),
    fontFamily: pick([
      "system-ui, sans-serif",
      "Georgia, serif",
      "ui-monospace, monospace",
    ] as const),
    baseFontPx: 13 + Math.floor(r() * 4), // 13..16
  };
}

/**
 * Render a spec to a standalone HTML document.
 *
 * The document exposes `__measure()` with the same shape the T1 fixture uses, so labels
 * are derived by exactly the code path the perception tier itself uses.
 */
export function specToHtml(spec: RenderSpec): string {
  const r = mulberry32(spec.seed ^ 0x5f3759df);
  const p = PALETTES[spec.palette % PALETTES.length]!;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const between = (lo: number, hi: number) => lo + r() * (hi - lo);

  const counts =
    spec.density === "dense"
      ? { cards: 4, fields: 5, buttons: 3, links: 3 }
      : spec.density === "sparse"
        ? { cards: 1, fields: 2, buttons: 1, links: 1 }
        : { cards: 3, fields: 3, buttons: 2, links: 2 };

  const parts: string[] = [];
  let y = 72;

  // ── a masthead, so the top of every frame is not identical ──────────────────────
  parts.push(
    `<header id="masthead" style="position:absolute;left:0;top:0;width:100%;height:${Math.round(
      between(44, 60)
    )}px;background:${p.accent};color:#fff;padding:12px 16px">Seva Portal</header>`
  );

  // ── repeated cards, each with a nested button and link ──────────────────────────
  const cardW = Math.round(between(200, 280));
  const cardH = Math.round(between(96, 128));
  for (let i = 0; i < counts.cards; i += 1) {
    const x = Math.round(28 + i * (cardW + between(16, 32)));
    if (x + cardW > spec.viewport.w) break;
    parts.push(
      `<div class="card" style="left:${x}px;top:${y}px;width:${cardW}px;height:${cardH}px">` +
        `<div class="ttl">${pick(FIELDS)}</div>` +
        `<button id="cb${i}" type="button" style="position:absolute;left:10px;top:${
          cardH - 42
        }px;width:${Math.round(between(84, 130))}px;height:${Math.round(between(26, 34))}px">${pick(
          LABELS
        )}</button>` +
        `<a id="cl${i}" href="#x" style="position:absolute;left:10px;top:${cardH - 68}px">${pick(
          LINKS
        )}</a>` +
        `</div>`
    );
  }
  y += cardH + Math.round(between(20, 40));

  // ── text fields with varying width and label length ────────────────────────────
  for (let i = 0; i < counts.fields; i += 1) {
    const w = Math.round(between(180, 380));
    const h = Math.round(between(26, 36));
    parts.push(
      `<label id="fl${i}" for="f${i}" style="left:28px;top:${y}px">${pick(FIELDS)}</label>` +
        `<input id="f${i}" type="text" style="left:28px;top:${y + 20}px;width:${w}px;height:${h}px" />`
    );
    y += 20 + h + Math.round(between(10, 26));
  }

  // ── small controls: the class the evaluator showed is most fragile ─────────────
  const smallY = y;
  const sz = Math.round(between(13, 20));
  parts.push(
    `<input id="ck0" type="checkbox" style="left:30px;top:${smallY}px;width:${sz}px;height:${sz}px" />` +
      `<input id="rd0" type="radio" name="g" style="left:${
        30 + sz + Math.round(between(60, 120))
      }px;top:${smallY}px;width:${sz}px;height:${sz}px" />` +
      `<select id="sel0" style="left:${
        30 + sz * 2 + Math.round(between(150, 240))
      }px;top:${smallY - 4}px;width:${Math.round(between(140, 220))}px;height:${Math.round(
        between(26, 32)
      )}px"><option>Kerala</option></select>`
  );
  y = smallY + Math.round(between(40, 60));

  // ── a tab strip: visually similar, adjacent, same size ─────────────────────────
  const tabW = Math.round(between(70, 110));
  for (let i = 0; i < 3; i += 1) {
    parts.push(
      `<div id="tb${i}" role="tab" style="left:${28 + i * (tabW + 6)}px;top:${y}px;width:${tabW}px;height:${Math.round(
        between(26, 32)
      )}px">Step ${i + 1}</div>`
    );
  }
  y += Math.round(between(44, 64));

  // ── standalone buttons, some visually similar to each other ────────────────────
  for (let i = 0; i < counts.buttons; i += 1) {
    parts.push(
      `<button id="b${i}" type="button" style="left:${
        28 + i * Math.round(between(140, 170))
      }px;top:${y}px;width:${Math.round(between(100, 150))}px;height:${Math.round(
        between(28, 40)
      )}px">${pick(LABELS)}</button>`
    );
  }
  y += Math.round(between(46, 66));

  for (let i = 0; i < counts.links; i += 1) {
    parts.push(`<a id="l${i}" href="#y" style="left:28px;top:${y}px">${pick(LINKS)}</a>`);
    y += Math.round(between(22, 32));
  }

  // ── an icon in the corner ──────────────────────────────────────────────────────
  parts.push(
    `<div id="ic0" role="img" aria-label="Help" style="left:${
      spec.viewport.w - 48
    }px;top:14px;width:22px;height:22px;border-radius:50%;background:${p.ctl};border:1px solid ${
      p.border
    }"></div>`
  );

  // ── one control straddling the fold, and two below it ──────────────────────────
  parts.push(
    `<button id="clip0" type="button" style="left:28px;top:${
      spec.viewport.h - Math.round(between(8, 22))
    }px;width:${Math.round(between(150, 230))}px;height:${Math.round(between(34, 46))}px">${pick(
      LABELS
    )}</button>`
  );
  parts.push(
    `<button id="off0" type="button" style="left:28px;top:${
      spec.viewport.h + 260
    }px;width:150px;height:40px">${pick(LABELS)}</button>`
  );

  return `<!DOCTYPE html>
<meta charset="utf-8" />
<title>${spec.id}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:${p.bg};color:${p.fg};font:${spec.baseFontPx}px/1.35 ${spec.fontFamily}}
  main{position:relative;width:${spec.viewport.w}px;height:${spec.viewport.h + 600}px}
  .card{position:absolute;background:${p.ctl};border:1px solid ${p.border};padding:8px}
  .ttl{font-weight:600;margin-bottom:4px}
  button{position:absolute;background:${p.ctl};border:1px solid ${p.border};color:${p.fg};font:inherit;cursor:pointer}
  input[type=text]{position:absolute;background:#fff;border:1px solid ${p.border};font:inherit;padding:2px 6px}
  input[type=checkbox],input[type=radio]{position:absolute}
  select{position:absolute;background:${p.ctl};border:1px solid ${p.border};font:inherit}
  label{position:absolute}
  a{position:absolute;color:${p.accent}}
  [role=tab]{position:absolute;background:${p.ctl};border:1px solid ${p.border};text-align:center;padding-top:4px}
</style>
<main>${parts.join("")}</main>
<script>
  window.__measure = () => {
    if (document.compatMode !== "CSS1Compat") throw new Error("quirks mode");
    const roleOf = (n) => {
      const t = n.tagName;
      if (t === "BUTTON") return "button";
      if (t === "A") return "link";
      if (t === "SELECT") return "select";
      if (t === "INPUT") return n.type === "checkbox" ? "checkbox" : n.type === "radio" ? "radio" : "textbox";
      if (n.getAttribute("role") === "tab") return "tab";
      if (n.getAttribute("role") === "img") return "icon";
      return null;
    };
    const out = [];
    for (const n of document.querySelectorAll("button,a,select,input,[role=tab],[role=img]")) {
      const cls = roleOf(n);
      if (!cls) continue;
      const r = n.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      out.push({ id: n.id || cls + out.length, cls, x: r.x, y: r.y, w: r.width, h: r.height });
    }
    return {
      viewport: {
        dpr: window.devicePixelRatio,
        w: document.documentElement.clientWidth,
        h: document.documentElement.clientHeight,
      },
      elements: out,
    };
  };
</script>`;
}
