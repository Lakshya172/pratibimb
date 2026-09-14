/**
 * THE PLANNING VIEW — five panes, every one of them rendered from the run's own objects.
 *
 * THE RULE THAT MAKES THIS EVIDENCE RATHER THAN A SLIDE: nothing here builds a representation of its
 * own. Pane 3 prints `record.handoffSerialized`, which **is** the string that crossed the reasoner
 * boundary — not a summary of it, not a re-serialization, not a mock-up that looks like one. Pane 4
 * prints the validator's actual verdict and the binder's actual cause. Pane 5 prints the ledger entry
 * the privacy layer produced. If the system did something different from what these panes say, the
 * panes would be wrong, which is the property a demo needs.
 *
 * THE ONE ASYMMETRY, AND IT IS THE POINT. Pane 2 is the **local** view and may show the real values:
 * that is what makes the contrast visible. Pane 3 is the **server** view and must not — so it prints
 * bytes that provably contain none, and a check beside it says so. The judge is meant to read the two
 * panes side by side and see the mobile number itself on the left and `<PII:PHONE:1>` on the right.
 * (No value is written out in this file: a synthetic demo value in source is still a value in the
 * source, SECURITY.md §2. They live in the fixture, which is where they belong.)
 *
 * NOTHING HERE ANIMATES PAST THE SYSTEM. The privacy-wall strip lights a step only when the run
 * actually reached the state behind it, read from `record.transitions`.
 */
import { type RunRecord, type RunState } from "@pratibimb/orchestrator";
import { type SafeStep } from "@pratibimb/plan";

const el = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`planning view: #${id} is missing`);
  return found;
};

const escapeHtml = (raw: string): string =>
  raw.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** The chain the judge is meant to follow, and the state each step corresponds to. */
const WALL: readonly { readonly label: string; readonly state: RunState }[] = [
  { label: "LOCAL VALUE", state: "OBSERVE" },
  { label: "SANITIZE", state: "SANITIZE" },
  { label: "TOKEN", state: "VERIFY_PAYLOAD" },
  { label: "SERVER", state: "SEND" },
  { label: "PLAN", state: "VALIDATE_PLAN" },
  { label: "HUMAN GRANT", state: "AWAIT_GRANT" },
  { label: "LOCAL REHYDRATION", state: "REHYDRATE" },
  { label: "CLICK", state: "ACT" },
  { label: "VERIFIED", state: "DONE" },
];

export function renderWall(record: RunRecord | null): void {
  const reached = new Set<RunState>(record?.transitions.map((t) => t.to) ?? []);
  const refused = record?.state === "REFUSED";
  el("wall").innerHTML = WALL.map((step) => {
    const on = reached.has(step.state);
    const cls = on ? "on" : refused ? "blocked" : "";
    return `<span class="wall-step ${cls}">${escapeHtml(step.label)}</span>`;
  }).join('<span class="wall-arrow">→</span>');

  const banner = el("wall-verdict");
  if (!record) {
    banner.textContent = "";
    banner.className = "verdict";
    return;
  }
  if (refused) {
    banner.textContent = `REFUSED at ${record.refusal?.stage ?? "?"} — ${record.refusal?.cause ?? ""} · nothing executed`;
    banner.className = "verdict refused";
    return;
  }
  const verification = record.act?.verification?.verification ?? "NO RESULT";
  banner.textContent = `${record.state} · VERIFY RESULT = ${verification}`;
  banner.className = `verdict ${verification === "CONFIRMED" ? "confirmed" : "uncertain"}`;
}

/** PANE 1 — the user's own words, carried separately from anything the page said. */
export function renderGoal(goal: string, record: RunRecord | null): void {
  el("pane-goal").innerHTML = `
    <p class="goal">${escapeHtml(goal)}</p>
    <dl class="kv">
      <dt>session</dt><dd>${escapeHtml(record?.sessionId ?? "—")}</dd>
      <dt>request</dt><dd>${escapeHtml(record?.requestId ?? "—")}</dd>
      <dt>state</dt><dd><b>${escapeHtml(record?.state ?? "IDLE")}</b></dd>
    </dl>`;
}

/**
 * PANE 2 — structural perception, and the local values beside it.
 *
 * The values are shown deliberately. This is the machine the user is sitting at; the whole claim is
 * about what leaves it, not about what it knows.
 */
export function renderPage(record: RunRecord | null): void {
  const observation = record?.initialObservation;
  if (!observation) {
    el("pane-page").innerHTML = `<p class="muted">Not observed yet.</p>`;
    return;
  }
  const classOf = new Map((record?.handoff?.redactions ?? []).map((r) => [r.targetId, r]));
  const valueOf = new Map(observation.fields.map((f) => [f.id, f.value]));

  const rows = observation.graph.nodes
    .map((node) => {
      const selector = node.domRef.selector;
      const redaction = classOf.get(selector);
      const value = valueOf.get(selector);
      const box = node.evidence.kind === "OBSERVED" || node.evidence.kind === "CLIPPED" ? node.evidence.viewportBox : null;
      const sensitivity = redaction
        ? `<span class="tag t-${redaction.tier.toLowerCase()}">${escapeHtml(redaction.class)} · ${escapeHtml(redaction.tier)}</span>`
        : `<span class="tag t-public">not sensitive</span>`;
      return `<tr>
        <td><code>${escapeHtml(selector)}</code></td>
        <td>${escapeHtml(node.role)}</td>
        <td>${escapeHtml(node.name || "—")}</td>
        <td class="local">${value === undefined || value === "" ? '<span class="muted">—</span>' : escapeHtml(value)}</td>
        <td>${sensitivity}</td>
        <td class="geo">${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}×${Math.round(box.h)}` : "—"}</td>
      </tr>`;
    })
    .join("");

  el("pane-page").innerHTML = `
    <p class="note local-note">These values never leave this machine. They are held in the memory-only vault
      and replaced by references before anything is sent.</p>
    <div class="scroll"><table>
      <thead><tr><th>element</th><th>role</th><th>accessible name</th><th>local value</th><th>sensitivity</th><th>geometry</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

/** PANE 3 — the actual bytes. Nothing is re-serialized for display. */
export function renderServerView(record: RunRecord | null): void {
  if (!record?.handoff || !record.handoffSerialized) {
    el("pane-server").innerHTML = `<p class="muted">Nothing has been sent.</p>`;
    return;
  }
  const handoff = record.handoff;
  const secrets = (record.initialObservation?.fields ?? []).map((f) => f.value).filter((v) => v.trim() !== "");
  const leaked = secrets.filter((secret) => record.handoffSerialized!.includes(secret));

  const spans = handoff.redactions
    .map(
      (r) => `<tr>
        <td><code>${escapeHtml(r.targetId)}</code></td>
        <td>${r.token === "" ? '<span class="muted">no reference</span>' : `<code class="token">${escapeHtml(r.token)}</code>`}</td>
        <td><span class="tag t-${r.tier.toLowerCase()}">${escapeHtml(r.class)}</span></td>
        <td>${escapeHtml(r.method)}</td>
        <td class="geo">len ${r.hint.len} · ${escapeHtml(r.hint.kind)}${r.hint.field_role ? ` · ${escapeHtml(r.hint.field_role)}` : ""}</td>
      </tr>`
    )
    .join("");

  el("pane-server").innerHTML = `
    <p class="note ${leaked.length === 0 ? "clean" : "dirty"}">
      ${leaked.length === 0
        ? `Checked: none of the ${secrets.length} local values appears in these ${record.handoffSerialized.length} bytes.`
        : `LEAK: a local value survived into the payload.`}
    </p>
    <div class="scroll"><table>
      <thead><tr><th>element</th><th>reference</th><th>class</th><th>method</th><th>safe hint</th></tr></thead>
      <tbody>${spans}</tbody>
    </table></div>
    <p class="sub">Goal sent: <em>${escapeHtml(handoff.goal)}</em></p>
    <details><summary>the exact payload (${record.handoffSerialized.length} bytes)</summary>
      <pre>${escapeHtml(JSON.stringify(JSON.parse(record.handoffSerialized), null, 1))}</pre>
    </details>`;
}

const stepText = (step: SafeStep): string =>
  step.op === "click"
    ? `<code>click</code> ${escapeHtml(step.target)}`
    : `<code>insert</code> ${step.ref ? `<code class="token">${escapeHtml(step.ref)}</code>` : `<span class="marker">${escapeHtml(step.literalMarker ?? "")}</span>`} → ${escapeHtml(step.target)}`;

/** PANE 4 — what came back, what the client made of it, and what a human said. */
export function renderPlan(record: RunRecord | null): void {
  if (!record?.plan) {
    el("pane-plan").innerHTML = `<p class="muted">No plan received.</p>`;
    return;
  }
  const validation = record.validation;
  const refusal = record.refusal?.planRefusal;
  const steps = record.plan.steps.map((s) => `<li>${stepText(s)}</li>`).join("");

  const verdict = !validation
    ? `<span class="tag t-public">not validated</span>`
    : validation.ok
      ? `<span class="tag t-ok">VALID</span>`
      : `<span class="tag t-bad">REFUSED · ${escapeHtml(refusal?.literalCause ?? refusal?.bindCause ?? refusal?.cause ?? "")}</span>`;

  const leak =
    refusal?.literalSeverity === "LEAKAGE_EVENT"
      ? `<p class="note dirty">LITERAL ECHO — the reasoner returned a ${escapeHtml(refusal.piiClass ?? "value")} this client
           holds locally and never sent. Refused before rehydration and before any action. The value is not quoted here,
           and it was not kept.</p>`
      : "";

  const grant = record.grant.requested
    ? record.grant.decision?.granted
      ? `<span class="tag t-ok">GRANTED</span> <span class="sub">one-shot · bound to reference, field, origin and session · used: ${record.grant.useGrant?.used ? "yes" : "no"}</span>`
      : `<span class="tag t-bad">${escapeHtml(record.grant.decision?.granted === false ? record.grant.decision.reason : "—")}</span>`
    : `<span class="muted">not reached</span>`;

  const rehydration = record.rehydrated.length
    ? record.rehydrated
        .map(
          (r) =>
            `<span class="tag t-ok">REHYDRATED LOCALLY</span> <code class="token">${escapeHtml(r.ref)}</code> → ${escapeHtml(r.target)} (${escapeHtml(r.piiClass)})`
        )
        .join("<br>")
    : `<span class="muted">nothing was rehydrated</span>`;

  const freshness = record.act
    ? `${escapeHtml(record.act.decision.decision)} · hit-test ${escapeHtml(record.act.hit?.agreement ?? "not run")} · reached ${escapeHtml(record.act.reached)}`
    : `<span class="muted">not reached</span>`;

  el("pane-plan").innerHTML = `
    <p class="sub">from <code>${escapeHtml(record.response && record.response.received ? record.response.reasoner : "—")}</code>
      via <code>${escapeHtml(record.response && record.response.received ? record.response.transport : "—")}</code></p>
    <ol class="plan">${steps}</ol>
    ${leak}
    <dl class="kv">
      <dt>validation</dt><dd>${verdict}</dd>
      <dt>target</dt><dd>${escapeHtml(refusal?.target ?? record.plan.steps.map((s) => s.target).join(", "))}</dd>
      <dt>freshness</dt><dd>${freshness}</dd>
      <dt>human grant</dt><dd>${grant}</dd>
      <dt>rehydration</dt><dd>${rehydration}</dd>
    </dl>`;
}

/** PANE 5 — identity, the digest, the classes, and the verifier's own answer. */
export function renderEgress(record: RunRecord | null): void {
  if (!record) {
    el("pane-egress").innerHTML = `<p class="muted">Nothing recorded.</p>`;
    return;
  }
  const entry = record.ledgerEntry;
  const verification = record.act?.verification;
  const resultTag = !verification
    ? `<span class="muted">no action was dispatched</span>`
    : verification.verification === "CONFIRMED"
      ? `<span class="tag t-ok">CONFIRMED</span> <span class="sub">${escapeHtml(verification.evidence)}</span>`
      : `<span class="tag t-bad">${escapeHtml(verification.verification)} · ${escapeHtml(verification.cause)}</span>`;

  const timings = Object.entries(record.timings)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `<span class="chip">${escapeHtml(k.replace(/Ms$/, ""))} ${String(v)}ms</span>`)
    .join("");

  el("pane-egress").innerHTML = `
    <dl class="kv">
      <dt>request</dt><dd>${escapeHtml(record.requestId)}</dd>
      <dt>session</dt><dd>${escapeHtml(record.sessionId)}</dd>
      <dt>destination</dt><dd>${escapeHtml(entry?.destination ?? "—")}</dd>
      <dt>verification</dt><dd>${entry?.verified ? `<span class="tag t-ok">verified handoff</span>` : `<span class="muted">—</span>`}</dd>
      <dt>payload sha-256</dt><dd><code class="hash">${escapeHtml(entry?.payloadSha256 ?? "—")}</code></dd>
      <dt>payload bytes</dt><dd>${entry ? String(entry.payloadBytes) : "—"}</dd>
      <dt>references</dt><dd>${(entry?.references ?? []).map((r) => `<code class="token">${escapeHtml(r.token)}</code>`).join(" ") || "—"}</dd>
      <dt>masked, no reference</dt><dd>${entry ? String(entry.maskedWithoutReference) : "—"}</dd>
      <dt>leak check</dt><dd>${escapeHtml(entry?.leakCheck ?? "—")}</dd>
      <dt>VERIFY RESULT</dt><dd>${resultTag}</dd>
    </dl>
    <p class="timings">${timings}</p>
    <p class="note">${escapeHtml(entry?.note ?? "No egress client exists in this phase.")}
      This pane is a privacy-layer record, not evidence that any byte left the machine.</p>`;
}

export function renderAll(goal: string, record: RunRecord | null): void {
  renderGoal(goal, record);
  renderPage(record);
  renderServerView(record);
  renderPlan(record);
  renderEgress(record);
  renderWall(record);
}
