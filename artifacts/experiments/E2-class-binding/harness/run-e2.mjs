/**
 * E2 — run the pre-registered class-binding table. Pure, deterministic, no network.
 *
 * PASS (pre-registered): 0 adversarial accepts, 0 legitimate refusals, every SENSITIVE residual routed
 * to a human grant. Every outcome is also compared exactly — decision and cause — and a cause that
 * differs from the pre-registration is reported as a deviation even when the decision is safe.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

import { BINDING_CASES, CLASSIFIER_CASES, ISSUANCE_CASES, ORIGIN } from "./cases.mjs";
import { bind, classifyField, issueToken, newVault } from "./binder.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const lfSha = (p) => createHash("sha256").update(readFileSync(p, "utf8").replace(/\r\n/g, "\n")).digest("hex");
const NOW = 1_000_000;

// ── classifier ─────────────────────────────────────────────────────────────────────────────
const classified = new Map();
const classifierResults = CLASSIFIER_CASES.map((c) => {
  const got = classifyField(c.field);
  classified.set(c.id, { ...c, accepts: got });
  return { id: c.id, set: c.set, expect: c.expect, got, ok: got === c.expect };
});

// ── issuance ───────────────────────────────────────────────────────────────────────────────
const issuanceResults = ISSUANCE_CASES.map((c) => {
  const r = issueToken(newVault(), c.class, ORIGIN);
  const got = r.issued ? "ISSUED" : "REFUSED";
  return { id: c.id, class: c.class, expect: c.expect, got, cause: r.cause ?? null, ok: got === c.expect };
});

// ── binding ────────────────────────────────────────────────────────────────────────────────
const fingerprint = (caseId, origin) => {
  const f = classified.get(caseId)?.field ?? {};
  return createHash("sha256").update(JSON.stringify([caseId, origin, f.tag, f.type, f.name, f.label])).digest("hex").slice(0, 16);
};

const bindingResults = BINDING_CASES.map((c) => {
  const tokenOrigin = c.tokenOrigin ?? ORIGIN;
  const fieldOrigin = c.fieldOrigin ?? tokenOrigin;
  const vault = newVault();
  for (const cls of ["PHONE", "NAME", "DOB", "AADHAAR"]) issueToken(vault, cls, tokenOrigin);
  if (c.injectCriticalToken) vault.tokens.set("<PII:OTP:1>", { class: "OTP", tier: "CRITICAL", origin: tokenOrigin }); // a defect, simulated

  const fields = new Map();
  for (const [id, entry] of classified) fields.set(id, { accepts: entry.accepts, origin: fieldOrigin, fingerprint: fingerprint(id, fieldOrigin) });

  const grantOrigin = c.grants?.origin ?? fieldOrigin;
  const ctx = {
    vault,
    view: { viewId: "v3", documentId: "doc-1", fields },
    currentDocumentId: c.currentDocumentId ?? "doc-1",
    consumed: new Set((c.consumed ?? []).map((x) => `${x.ref}|${fingerprint(x.field, fieldOrigin)}`)),
    classOriginGrants: new Set((c.grants?.classOrigin ?? []).map((cls) => `${cls}|${grantOrigin}`)),
    useGrants: (c.grants?.use ?? []).map((g) => ({
      ref: g.ref,
      fingerprint: fingerprint(g.field, fieldOrigin),
      origin: fieldOrigin,
      used: Boolean(g.used),
      expiresAt: g.expired ? NOW - 1 : NOW + 60_000,
    })),
    now: NOW,
  };
  const got = bind({ ref: c.step.ref, targetId: c.step.field, viewId: c.step.viewId ?? "v3" }, ctx);
  const decisionOk = got.decision === c.expect;
  const causeOk = c.cause === undefined || got.cause === c.cause;
  return {
    id: c.id,
    set: c.set,
    expect: c.expect,
    expectCause: c.cause ?? null,
    got: got.decision,
    gotCause: got.cause ?? null,
    exact: decisionOk && causeOk,
    adversarialAccept: c.set === "ADVERSARIAL" && got.decision === "BIND_OK",
    legitimateRefusal: c.set === "LEGIT" && !decisionOk,
    note: c.note ?? null,
  };
});

// ── verdict ────────────────────────────────────────────────────────────────────────────────
const classifierLegitWrong = classifierResults.filter((r) => r.set === "LEGIT" && !r.ok);
const classifierAmbiguousGuessed = classifierResults.filter((r) => r.set === "AMBIGUOUS" && !r.ok);
const classifierResidualWrong = classifierResults.filter((r) => r.set === "RESIDUAL" && !r.ok);
const adversarialAccepts = bindingResults.filter((r) => r.adversarialAccept);
const legitimateRefusals = bindingResults.filter((r) => r.legitimateRefusal);
const sensitiveResiduals = bindingResults.filter((r) => r.set === "RESIDUAL" && r.expect === "NEEDS_HUMAN_GRANT");
const sensitiveResidualsRouted = sensitiveResiduals.filter((r) => r.got === "NEEDS_HUMAN_GRANT");
const deviations = bindingResults.filter((r) => !r.exact);
const issuanceWrong = issuanceResults.filter((r) => !r.ok);

const pass =
  adversarialAccepts.length === 0 &&
  legitimateRefusals.length === 0 &&
  classifierLegitWrong.length === 0 &&
  classifierAmbiguousGuessed.length === 0 &&
  sensitiveResidualsRouted.length === sensitiveResiduals.length &&
  issuanceWrong.length === 0;

const count = (arr, set) => arr.filter((r) => r.set === set).length;
const log = {
  experiment: "E2-class-binding",
  recordedAt: new Date().toISOString(),
  workstation: "W2",
  hostname: hostname(),
  node: process.version,
  preRegistration: { casesFile: "harness/cases.mjs", commit: "277e136", casesSha256LF: lfSha(join(HERE, "cases.mjs")) },
  harnessSha256LF: { binder: lfSha(join(HERE, "binder.mjs")), runner: lfSha(join(HERE, "run-e2.mjs")) },
  counts: {
    classifier: { total: classifierResults.length, legit: count(classifierResults, "LEGIT"), ambiguous: count(classifierResults, "AMBIGUOUS"), residual: count(classifierResults, "RESIDUAL") },
    binding: { total: bindingResults.length, legit: count(bindingResults, "LEGIT"), adversarial: count(bindingResults, "ADVERSARIAL"), residual: count(bindingResults, "RESIDUAL") },
    issuance: issuanceResults.length,
  },
  summary: {
    adversarialAccepts: adversarialAccepts.map((r) => r.id),
    legitimateRefusals: legitimateRefusals.map((r) => ({ id: r.id, expect: r.expect, got: r.got, gotCause: r.gotCause })),
    classifierLegitWrong: classifierLegitWrong.map(({ id, expect, got }) => ({ id, expect, got })),
    classifierAmbiguousGuessed: classifierAmbiguousGuessed.map(({ id, expect, got }) => ({ id, expect, got })),
    classifierResidualWrong: classifierResidualWrong.map(({ id, expect, got }) => ({ id, expect, got })),
    sensitiveResidualsRouted: `${sensitiveResidualsRouted.length}/${sensitiveResiduals.length}`,
    exactBindingMatches: `${bindingResults.length - deviations.length}/${bindingResults.length}`,
    causeDeviations: deviations.map(({ id, expect, expectCause, got, gotCause }) => ({ id, expect, expectCause, got, gotCause })),
    issuanceWrong: issuanceWrong.map(({ id, expect, got }) => ({ id, expect, got })),
  },
  classifierResults,
  bindingResults,
  issuanceResults,
  verdict: pass ? "PASS" : "FAIL",
};
mkdirSync(join(HERE, "..", "logs"), { recursive: true });
writeFileSync(join(HERE, "..", "logs", "e2.json"), JSON.stringify(log, null, 2) + "\n");
console.log(JSON.stringify({ counts: log.counts, summary: log.summary }, null, 2));
console.log(`VERDICT ${log.verdict}`);
process.exit(pass ? 0 : 1);
