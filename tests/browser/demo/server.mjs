/**
 * The demo's loopback server.
 *
 * It serves three things from ONE origin, which is what lets the Planning View and the page it drives
 * be different documents that can still talk: the Planning View at `/`, the synthetic fixture at
 * `/fixture/`, and the **built** packages under `/pkg/<name>/`.
 *
 * SERVING `dist/` IS THE POINT. The page imports `@pratibimb/privacy` and the rest through an import
 * map that resolves to the compiled output the repository builds. So the browser runs the shipped
 * code, not a re-implementation written for the demo. Run `npm run typecheck` first.
 *
 * It is a static file server on 127.0.0.1 with no routes that write, no upload path and no proxy. It
 * is not, and must not be described as, a reasoner endpoint: this phase has no network client.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..", "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Package name → the directory its compiled entry points live in. */
const PACKAGES = {
  perception: "packages/perception/dist/src",
  privacy: "packages/privacy/dist/src",
  agent: "packages/agent/dist/src",
  plan: "packages/plan/dist/src",
  reasoner: "packages/reasoner/dist/src",
  orchestrator: "packages/orchestrator/dist/src",
  egress: "packages/egress/dist/src",
};

/** Resolve a request path to a file inside the repository, or `null`. Never escapes ROOT. */
function locate(pathname) {
  if (pathname === "/" || pathname === "/index.html") return join(ROOT, "apps/demo/index.html");
  if (pathname === "/planning-view.css") return join(ROOT, "apps/demo/planning-view.css");
  if (pathname === "/fixture" || pathname === "/fixture/") return join(HERE, "fixture/application.html");
  /**
   * M3.1's perception fixture, which is NOT the demo's.
   *
   * `application.html` belongs to the frozen presentation branch and is left exactly as it is. The
   * visual fixture lives beside the extension harness that uses it and is reachable only at its own
   * path, so nothing the demo serves or renders changes.
   */
  if (pathname === "/visual" || pathname === "/visual/") return join(ROOT, "tests/browser/extension/fixture/visual.html");

  /**
   * M6.1's structural-signal fixture, which is neither of the other two.
   *
   * It exists to be mutated in three precisely different ways while the extension watches, one
   * of which changes an element's size through the CSSOM and produces no DOM record at all.
   * Same arrangement as `/visual`: its own path, beside the harness that drives it, and nothing
   * the demo serves changes.
   */
  /**
   * The held-out visual-text set (RE-1): six synthetic pages and the renderer they share.
   *
   * Scored once per candidate under docs/perception/redaction-evaluation.md and never used for
   * tuning. Only file names made of letters, digits, dots and dashes are served from that one
   * directory, so this route cannot be walked out of it.
   */
  const heldout = /^\/heldout\/([a-z0-9.-]+)$/.exec(pathname);
  if (heldout) return join(ROOT, "tests/browser/extension/fixture/heldout", heldout[1]);

  if (pathname === "/structural" || pathname === "/structural/") {
    return join(ROOT, "tests/browser/extension/fixture/structural.html");
  }

  /** M10's visual-only region fixture: canvases and images, some deliberately not enumerable. */
  if (pathname === "/regions" || pathname === "/regions/") {
    return join(ROOT, "tests/browser/extension/fixture/visual-regions.html");
  }

  if (pathname.startsWith("/demo/")) {
    return join(ROOT, "apps/demo/dist/src", pathname.slice("/demo/".length));
  }
  if (pathname.startsWith("/pkg/")) {
    const [, , name, ...rest] = pathname.split("/");
    const base = PACKAGES[name];
    if (!base) return null;
    return join(ROOT, base, rest.join("/") || "index.js");
  }
  return null;
}

const inside = (file) => {
  const normalised = normalize(file);
  return normalised.startsWith(ROOT) && !normalised.includes(`..${"\\"}`) && !normalised.includes("../");
};

export function createDemoServer() {
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const file = locate(pathname);
    if (!file || !inside(file) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(`not found: ${pathname}`);
      return;
    }
    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(response);
  });
}

/** Start on a fixed port, so every artifact names the same origin. */
export async function startDemoServer(port = 8975) {
  const server = createDemoServer();
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", ok);
  });
  return { server, origin: `http://127.0.0.1:${port}` };
}

// `node tests/browser/demo/server.mjs` serves the demo for a human to click through.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { origin } = await startDemoServer(Number(process.env.PORT ?? 8975));
  console.log(`PratiBimb Planning View: ${origin}/`);
  console.log("(run `npm run typecheck` first — the page imports the built packages)");
}
