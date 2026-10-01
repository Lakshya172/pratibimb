/**
 * M13 (ADR-0013) — what "the evidence build's capture route is the product's" means once the two
 * builds' CSPs legitimately differ.
 *
 * Since ADR-0013 a product build's `connect-src` names the reasoner endpoint exactly, and an evidence
 * build names the whole collector origin (its test sink). Everything else in the manifest must still
 * be byte-identical, so the route hash covers the manifest with that ONE source normalised, and the
 * difference itself is recorded and checked separately — never ignored.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const manifestOf = (ext) => JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));

/** The manifest's connect-src sources, as built. */
export function connectSrcOf(ext) {
  const csp = manifestOf(ext).content_security_policy?.extension_pages ?? "";
  return /connect-src ([^;]*)/.exec(csp)?.[1] ?? null;
}

/** SHA-256 of the manifest with the connect-src directive's sources replaced by a placeholder. */
export function manifestRouteSha(ext) {
  const m = manifestOf(ext);
  const csp = m.content_security_policy?.extension_pages;
  if (typeof csp === "string") m.content_security_policy.extension_pages = csp.replace(/connect-src [^;]*/, "connect-src <NORMALISED>");
  return createHash("sha256").update(JSON.stringify(m)).digest("hex");
}
