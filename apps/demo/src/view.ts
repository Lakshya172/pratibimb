/**
 * THE PLANNING VIEW — the story first, the proof underneath.
 *
 * A judge watching this screen from across a room has seconds. So the top of the page tells one story
 * in plain words — the task, the privacy boundary with the device on one side and the reasoner on the
 * other, the model proposing, the client deciding, a human approving once, the value restored locally,
 * and a verified result — and the technical evidence that backs every word of it sits underneath.
 *
 * THIS FILE DECIDES NOTHING. Every status, verdict and check comes from `story.ts`, which derives it
 * from the run's own objects and is tested against real runs. This file only turns that model into
 * markup. If the story were wrong, the tests would fail before a judge ever saw it.
 *
 * THE ONE ASYMMETRY, STILL THE POINT. The device side of the boundary shows the real values; the
 * reasoner side shows only what crossed. Nothing else on the screen carries a value. (No value is
 * written in this file — SECURITY.md §2. They live in the fixture.)
 *
 * THE EVIDENCE PANES keep their ids and their wording, because the LOOP-1 and DEMO-1 runners read
 * them. They are no longer the headline; they are the proof.
 *
 * NOTHING ANIMATES PAST THE SYSTEM. A region is repainted only when what it says has changed, so a
 * motion plays once, at the moment the run actually reached the state behind it.
 */
import { type RunRecord } from "@pratibimb/orchestrator";
import { type SafeStep } from "@pratibimb/plan";

import { ACTS, RUNNING_ORDER, type ActId } from "./demoScript.js";
import { egressEvidenceOf, type EgressAttempt } from "./evidence.js";
import {
  actionOf,
  approvalOf,
  boundaryRowsOf,
  decisionOf,
  leavingOf,
  outcomeOf,
  pipelineOf,
  proposalOf,
  restorationOf,
  taskStatusOf,
  TRUST,
  type StoryInput,
} from "./story.js";

const el = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`planning view: #${id} is missing`);
  return found;
};

const esc = (raw: string): string =>
  raw.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const count = (n: number): string => new Intl.NumberFormat("en-US").format(n);

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// ── icons: one stroke style, drawn inline so the page makes no request for them ─────────────────

const PATHS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  minus: '<path d="M6.5 12h11"/>',
  shield: '<path d="M12 3l7.5 3v5.4c0 4.6-3.2 8.4-7.5 9.9-4.3-1.5-7.5-5.3-7.5-9.9V6z"/>',
  shieldCheck: '<path d="M12 3l7.5 3v5.4c0 4.6-3.2 8.4-7.5 9.9-4.3-1.5-7.5-5.3-7.5-9.9V6z"/><path d="M8.7 12.2l2.3 2.3 4.4-4.6"/>',
  shieldX: '<path d="M12 3l7.5 3v5.4c0 4.6-3.2 8.4-7.5 9.9-4.3-1.5-7.5-5.3-7.5-9.9V6z"/><path d="M9.6 9.6l4.8 4.8M14.4 9.6l-4.8 4.8"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 017 0v2.7"/>',
  laptop: '<rect x="4.5" y="5" width="15" height="10.5" rx="1.8"/><path d="M2.5 19h19"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>',
  alert: '<path d="M12 4.2l8.6 15.3H3.4z"/><path d="M12 10v4.2M12 17.1v.2"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0115 0"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.7"/><path d="M4 4v4.7h4.7"/>',
  cursor: '<path d="M6 4l12.5 6.3-5.4 1.6-1.9 5.6z"/>',
  arrowRight: '<path d="M5 12h14M13.5 6.5L19 12l-5.5 5.5"/>',
  arrowDown: '<path d="M12 5v14M6.5 13.5L12 19l5.5-5.5"/>',
  cloudOff: '<path d="M3.5 3.5l17 17M8.2 8.2A5 5 0 0 0 7 18h10.5M20.3 16.4A3.9 3.9 0 0 0 17 10.2h-.5A6 6 0 0 0 10.3 6"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3.5 3.5 0 000-7H9a3.5 3.5 0 010-7h6.8"/>',
  upload: '<path d="M12 15.5V4M7 8.5l5-5 5 5M5 14v4.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V14"/>',
  scale: '<path d="M12 4v16M7.5 20h9M5 7.5h14M5 7.5l-2.6 6a2.9 2.9 0 005.2 0zM19 7.5l-2.6 6a2.9 2.9 0 005.2 0z"/>',
} as const;
type IconName = keyof typeof PATHS;

const icon = (name: IconName): string =>
  `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;

const head = (name: IconName, title: string): string =>
  `<div class="dhead"><span class="dicon">${icon(name)}</span><span class="eyebrow">${esc(title)}</span></div>`;

/**
 * Repaint a region only when what it says changed.
 *
 * CSS animations run when an element is created, so skipping identical markup is what makes each
 * motion happen once — when the run reached a new state — rather than on every repaint.
 */
const painted = new WeakMap<HTMLElement, string>();
const paintInto = (id: string, html: string, className?: string): HTMLElement => {
  const host = el(id);
  if (className !== undefined && host.className !== className) host.className = className;
  if (painted.get(host) !== html) {
    painted.set(host, html);
    host.innerHTML = html;
  }
  return host;
};

// ── the task and the pipeline ────────────────────────────────────────────────────────────────

function renderTask(goal: string, input: StoryInput, act: ActId | null): void {
  const status = taskStatusOf(input);
  const current = act ? ACTS[act] : null;
  const number = act ? RUNNING_ORDER.indexOf(act) + 1 : 0;
  paintInto(
    "task",
    `<div class="task-head">
      <div class="task-main">
        <span class="eyebrow">Task</span>
        <p class="goal">${esc(goal)}</p>
        <p class="act-line">${
          current
            ? `<span class="act-tag act-${current.id.toLowerCase()}">Act ${number} · ${esc(current.label)}</span><span>${esc(current.blurb)}</span>`
            : `<span class="muted">Choose an act above to begin.</span>`
        }</p>
      </div>
      <div class="status tone-${status.tone}" role="status"><span class="status-dot"></span>${esc(status.label)}</div>
    </div>`
  );
}

function renderPipeline(input: StoryInput): void {
  const steps = pipelineOf(input);
  const items = steps
    .map((s, i) => {
      const mark = s.status === "done" ? icon("check") : s.status === "blocked" ? icon("x") : String(i + 1);
      const link = i === 0 ? "" : `<li class="link${steps[i - 1]?.status === "done" ? " l-done" : ""}" aria-hidden="true"></li>`;
      return `${link}<li class="step s-${s.status}"><span class="step-dot">${mark}</span><span class="step-name">${s.step}</span></li>`;
    })
    .join("");
  paintInto("wall", `<ol class="steps">${items}</ol>`);
}

// ── the boundary: the hero ───────────────────────────────────────────────────────────────────

function renderBoundary(input: StoryInput): void {
  const rows = boundaryRowsOf(input);
  const empty = (text: string) => `<div class="zone-empty">${esc(text)}</div>`;

  const device = rows.length
    ? rows
        .map(
          (r, i) => `<div class="row" data-target="${esc(r.targetId)}" style="--i:${i}">
            <div class="row-label"><b>${esc(r.label)}</b><small>${esc(r.classLabel)} · ${esc(r.tier)}</small></div>
            <span class="value">${esc(r.localValue)}</span>
            <span class="echo-tag">${icon("alert")}Returned by the model</span>
          </div>`
        )
        .join("")
    : empty(input.phase === "idle" ? "The page has not been read yet." : "Reading the page…");

  const reasoner = rows.length
    ? rows
        .map(
          (r, i) => `<div class="row" data-target="${esc(r.targetId)}" style="--i:${i}">
            <div class="row-label"><b>${esc(r.label)}</b><small>${esc(r.classLabel)}</small></div>
            ${
              r.token
                ? `<code class="token">${esc(r.token)}</code><span class="hint">${esc(r.hint)}</span><span class="hint-echo">Only this reference was sent</span>`
                : `<span class="not-shared">${icon("lock")}Not shared · no reference</span>`
            }
          </div>`
        )
        .join("")
    : empty("Nothing has crossed yet.");

  const host = paintInto(
    "boundary",
    `<div class="bnd${rows.length ? " filled" : ""}">
      <div class="zone zone-device">
        <div class="zone-head">
          <span class="zone-icon">${icon("laptop")}</span>
          <div><div class="zone-title">On your device</div><div class="zone-sub">Actual value stays local.</div></div>
          <span class="badge badge-trusted">${icon("lock")}Trusted</span>
        </div>
        <div class="rows">${device}</div>
      </div>
      <div class="wall" aria-label="Privacy boundary">
        <div class="wall-badge">${icon("shieldCheck")}<b>PRIVACY<br />BOUNDARY</b></div>
        <p class="wall-note">Nothing crosses this boundary unless verified.</p>
      </div>
      <div class="zone zone-reasoner">
        <div class="zone-head">
          <span class="zone-icon">${icon("cpu")}</span>
          <div><div class="zone-title">What the reasoner sees</div><div class="zone-sub">Only safe context crosses the boundary.</div></div>
          <span class="badge badge-untrusted">${icon("alert")}Untrusted</span>
        </div>
        <div class="rows">${reasoner}</div>
      </div>
    </div>`
  );

  // The echo is applied as a class, not as new markup, so the rows are not recreated and their
  // crossing motion does not replay at the moment the refusal lands.
  const echoed = new Set(rows.filter((r) => r.echoed).map((r) => r.targetId));
  host.querySelectorAll<HTMLElement>(".row[data-target]").forEach((row) => {
    row.classList.toggle("echoed", echoed.has(row.dataset["target"] ?? ""));
  });
}

// ── model proposes → client decides → human approves → restore and act ───────────────────────

function renderModel(input: StoryInput): void {
  const p = proposalOf(input);
  const blocked = decisionOf(input).verdict === "blocked";

  const source =
    p.source === "LOCAL_MODEL"
      ? `<span class="source">${icon("cpu")}Local model${p.model ? ` · ${esc(p.model)}` : ""}</span>`
      : p.source === "FALLBACK"
        ? `<span class="source source-fallback">${icon("route")}Deterministic fallback</span>`
        : p.source === "PLANNER"
          ? `<span class="source">${icon("route")}Deterministic planner</span>`
          : "";
  const where =
    p.transport === "LOOPBACK_HTTP"
      ? `<span class="where">on this laptop · loopback HTTP</span>`
      : p.transport === "IN_PROCESS"
        ? `<span class="where">in-process</span>`
        : "";
  const outage = p.modelFailed
    ? `<div class="outage">${icon("cloudOff")}<span>${p.modelFailed === "UNAVAILABLE" ? "Model unavailable" : "Model plan unusable"}</span>${icon("arrowRight")}<span>Fallback</span></div>`
    : "";

  const steps = p.steps
    .map((s) => {
      if (s.kind === "click") return `<li><span class="verb">Click</span><span class="target">${esc(s.targetLabel)}</span></li>`;
      if (s.kind === "fill-reference") {
        return `<li><span class="verb">Fill</span><span class="target">${esc(s.targetLabel)}</span><span class="with">with</span><code class="token sm">${esc(s.ref)}</code></li>`;
      }
      return `<li${blocked ? ' class="hostile"' : ""}><span class="verb">Fill</span><span class="target">${esc(s.targetLabel)}</span><span class="with">with</span><span class="raw">${esc(s.marker)}</span>${
        blocked ? `<span class="raw-note">A raw value, not a reference — withheld from this screen.</span>` : ""
      }</li>`;
    })
    .join("");

  const body = steps
    ? `<ol class="proposed">${steps}</ol>`
    : p.waiting
      ? `<div class="thinking"><i></i><i></i><i></i><span>Planning from safe context…</span></div>`
      : `<p class="empty">No proposal yet.</p>`;

  paintInto(
    "d-model",
    `${head("cpu", "Model proposes")}
     ${source || where ? `<div class="source-row">${source}${where}</div>` : ""}
     ${outage}${body}
     <p class="fine">Untrusted. Its output is only a proposal.</p>`,
    `card dcard${blocked ? " t-hostile" : p.steps.length ? " t-active" : ""}`
  );
}

function renderClient(input: StoryInput): void {
  const d = decisionOf(input);
  const body =
    d.verdict === "allowed"
      ? `<div class="verdict v-ok">${icon("check")}ALLOWED</div><p class="reason">${esc(d.reason)}</p>`
      : d.verdict === "blocked"
        ? `<div class="verdict v-bad">${icon("shieldX")}BLOCKED</div><p class="reason">${esc(d.reason)}</p>`
        : d.verdict === "refused"
          ? `<div class="verdict v-bad">${icon("x")}REFUSED</div><p class="reason">${esc(d.reason)}</p>`
          : d.verdict === "waiting"
            ? `<div class="thinking"><i></i><i></i><i></i><span>${esc(d.reason)}</span></div>`
            : d.verdict === "no-plan"
              ? `<p class="empty">${esc(d.reason)}</p>`
              : `<p class="empty">Every proposal is checked here before anything happens.</p>`;
  paintInto(
    "d-client",
    `${head("shieldCheck", "Client decides")}${body}<p class="fine">Validated on this device, against values it never sent.</p>`,
    `card dcard t-${d.verdict}`
  );
}

function renderHuman(input: StoryInput): void {
  const a = approvalOf(input);
  let body: string;
  switch (a.state) {
    case "requested":
      body = `<p class="ask-title">Sensitive action requested</p>
        <p class="ask">Use your registered <b>${esc((a.valueLabel ?? "value").toLowerCase())}</b> to fill
          <b>${esc(a.targetLabel ?? "")}</b>, then click <b>${esc(a.actionLabel ?? "")}</b>?</p>
        <div class="scope"><span>This page</span><span>This field</span><span>This session</span><span>Once</span></div>
        <div class="approve-row">
          <button id="grant-deny" type="button" class="btn btn-outline" data-grant="deny">Don't allow</button>
          <button id="grant-allow" type="button" class="btn btn-primary btn-approve" data-grant="allow">${icon("check")}Approve once</button>
        </div>`;
      break;
    case "approved":
      body = `<div class="verdict v-ok">${icon("check")}APPROVED</div>
        <p class="reason">One-time authorization${a.spent === true ? " — used and spent" : ""}.</p>`;
      break;
    case "declined":
      body = `<div class="verdict v-warn">${icon("x")}NOT APPROVED</div><p class="reason">${esc(a.reason ?? "Nothing was restored or clicked.")}</p>`;
      break;
    case "not-requested":
      body = `<p class="empty">Not requested. The plan was stopped before it could ask.</p>`;
      break;
    case "not-needed":
      body = `<p class="empty">No sensitive value was needed.</p>`;
      break;
    default:
      body = `<p class="empty">You are asked only before a private value is used.</p>`;
  }
  paintInto("d-human", `${head("user", "Human approval")}${body}`, `card dcard t-${a.state}`);
}

function renderAct(input: StoryInput): void {
  const r = restorationOf(input);
  const action = actionOf(input);
  let body: string;
  if (r.state === "restored") {
    const items = r.items
      .map(
        (item) => `<div class="node">${icon("lock")}<code class="token sm">${esc(item.ref)}</code></div>
          <div class="down">${icon("arrowDown")}</div>
          <div class="node ok">${icon("restore")}Restored locally</div>
          <div class="down">${icon("arrowDown")}</div>
          <div class="node ${item.inserted ? "ok" : "bad"}">${icon(item.inserted ? "check" : "x")}${esc(item.targetLabel)} ${item.inserted ? "filled" : "not filled"}</div>`
      )
      .join("");
    const click =
      action.targetLabel !== null
        ? `<div class="down">${icon("arrowDown")}</div>
           <div class="node ${action.state === "executed" ? "ok" : "muted"}">${icon("cursor")}Click ${esc(action.targetLabel)}${
             action.verified ? ` <span class="verified">verified</span>` : ""
           }</div>`
        : "";
    body = `<div class="flow">${items}${click}</div><p class="caption">The real value comes from your device — not the model.</p>`;
  } else if (r.state === "none") {
    body = `<div class="held">
        <div class="node">${icon("x")}No rehydration</div>
        <div class="node">${icon("x")}No action executed</div>
      </div>
      <p class="caption">Nothing reached the page.</p>`;
  } else if (r.state === "restoring") {
    body = `<div class="thinking"><i></i><i></i><i></i><span>Restoring locally…</span></div>`;
  } else {
    body = `<p class="empty">Values are restored on this device, only after approval.</p>`;
  }
  paintInto("d-act", `${head("restore", "Restore & act")}${body}`, `card dcard t-${r.state}`);
}

// ── the outcome ──────────────────────────────────────────────────────────────────────────────

const STAGE_TEXT: Readonly<Record<string, string>> = {
  OBSERVE: "observation",
  SANITIZE: "sanitization",
  VERIFY_PAYLOAD: "payload verification",
  SEND: "send",
  PARSE_PLAN: "plan parsing",
  VALIDATE_PLAN: "plan validation",
  AWAIT_GRANT: "approval",
  REHYDRATE: "rehydration",
  ACT: "action",
};

function renderOutcome(input: StoryInput): void {
  const o = outcomeOf(input);
  const record = input.record;
  if (o.kind === "none" || !record) {
    const text =
      input.phase === "idle" ? "The outcome appears here." : input.phase === "approval" ? "Waiting for your decision…" : "Working…";
    paintInto("wall-verdict", `<div class="outcome-empty">${esc(text)}</div>`, "outcome k-none");
    return;
  }

  const symbol = o.kind === "blocked" ? "shieldX" : o.kind === "completed" || o.kind === "completed-fallback" ? "shieldCheck" : "alert";
  const proof = record.refusal
    ? `Refused at ${STAGE_TEXT[record.refusal.stage] ?? record.refusal.stage} · ${record.refusal.planRefusal?.literalCause ?? record.refusal.cause}`
    : `VERIFY RESULT · ${record.act?.verification?.verification ?? "NO RESULT"}`;

  const sameGates = o.checks.some((c) => c.ok && c.text.startsWith("Same validation"));
  const failed = proposalOf(input).modelFailed;
  const fallback =
    o.kind === "completed-fallback"
      ? `<div class="fallback-flow">
          <span class="ff ff-model">${icon("cloudOff")}Model <b>${failed === "UNUSABLE" ? "plan unusable" : "unavailable"}</b></span>
          <span class="ff-arrow">${icon("arrowRight")}</span>
          <span class="ff">${icon("route")}Deterministic fallback</span>
          <span class="ff-arrow">${icon("arrowRight")}</span>
          <span class="ff ff-ok">${icon("check")}Task continues</span>
          ${sameGates ? `<span class="ff-note">Privacy and action controls remain unchanged.</span>` : ""}
        </div>`
      : "";

  paintInto(
    "wall-verdict",
    `<div class="outcome-icon">${icon(symbol)}</div>
     <div class="outcome-body">
       <div class="outcome-title">${esc(o.title.toUpperCase())}</div>
       <p class="outcome-sub">${esc(o.subtitle)}</p>
       <span class="proof-word">${esc(proof)}</span>
     </div>
     <ul class="outcome-checks">${o.checks
       .map((c) => `<li class="${c.ok ? "ok" : "bad"}">${icon(c.ok ? "check" : "x")}${esc(c.text)}</li>`)
       .join("")}</ul>
     ${fallback}`,
    `outcome k-${o.kind}`
  );
}

// ── what left, and who is trusted with what ──────────────────────────────────────────────────

function renderLeaving(input: StoryInput): void {
  const l = leavingOf(input);
  const checks = l.checks
    .map((c) => {
      const kind = c.neutral ? "neutral" : c.ok ? "ok" : "bad";
      const mark = c.neutral ? "minus" : c.ok ? "check" : "x";
      return `<li class="${kind}"><span class="ck-icon">${icon(mark)}</span><span class="ck-text">${esc(c.text)}</span><span class="ck-detail">${esc(c.detail)}</span></li>`;
    })
    .join("");
  const proof = l.proof
    ? `<dl class="proof">
        <dt>Destination</dt><dd>${esc(hostOf(l.proof.destination))}</dd>
        <dt>Payload</dt><dd>${count(l.proof.bytes)} bytes</dd>
        <dt>SHA-256</dt><dd class="digest-pair"><span title="${esc(l.proof.clientSha256)}">${esc(l.proof.clientSha256.slice(0, 12))}…</span>${
          l.proof.agrees === null
            ? ""
            : `<span class="eq ${l.proof.agrees ? "ok" : "bad"}">${l.proof.agrees ? "=" : "≠"}</span><span title="${esc(l.proof.peerSha256 ?? "")}">${esc(
                (l.proof.peerSha256 ?? "").slice(0, 12)
              )}…</span>`
        }</dd>
      </dl>
      <p class="fine">Left: this device's digest of the exact bytes it sent. Right: what the receiving service reported. Full hashes in the evidence below.</p>`
    : "";
  paintInto(
    "leaving",
    `<div class="panel-head"><span class="dicon">${icon("upload")}</span><h2>${esc(l.title)}</h2></div>
     <p class="panel-note">${esc(l.note)}</p>
     ${checks ? `<ul class="checklist">${checks}</ul>` : ""}
     ${proof}`,
    `card panel l-${l.state}`
  );
}

function renderTrust(): void {
  const list = (items: readonly string[], yes: boolean) =>
    items.map((t) => `<li class="${yes ? "yes" : "no"}">${icon(yes ? "check" : "x")}<span>${esc(t)}</span></li>`).join("");
  paintInto(
    "trust",
    `<div class="panel-head"><span class="dicon">${icon("scale")}</span><h2>Who is trusted with what</h2></div>
     <div class="trust-cols">
       <div class="trust-col"><h3>${icon("laptop")}Local client</h3><ul>${list(TRUST.client, true)}</ul></div>
       <div class="trust-col"><h3>${icon("cpu")}Reasoner</h3><ul>${list(TRUST.reasonerCan, true)}${list(TRUST.reasonerCannot, false)}</ul></div>
     </div>`
  );
}

// ── the evidence: the proof behind every line above ──────────────────────────────────────────

/** The run's identity. */
function goalPane(goal: string, record: RunRecord | null): string {
  return `<p class="ev-goal">${esc(goal)}</p>
    <dl class="kv">
      <dt>session</dt><dd>${esc(record?.sessionId ?? "—")}</dd>
      <dt>request</dt><dd>${esc(record?.requestId ?? "—")}</dd>
      <dt>state</dt><dd><b>${esc(record?.state ?? "IDLE")}</b></dd>
      <dt>path</dt><dd>${esc(record ? record.transitions.map((t) => t.to).join(" → ") : "—")}</dd>
    </dl>`;
}

/**
 * The full structural observation, with the local values beside it. Shown deliberately: this is the
 * machine the user is sitting at, and the whole claim is about what leaves it.
 */
function pagePane(record: RunRecord | null): string {
  const observation = record?.initialObservation;
  if (!observation) return `<p class="muted">Not observed yet.</p>`;
  const classOf = new Map((record?.handoff?.redactions ?? []).map((r) => [r.targetId, r]));
  const valueOf = new Map(observation.fields.map((f) => [f.id, f.value]));

  const rows = observation.graph.nodes
    .map((node) => {
      const selector = node.domRef.selector;
      const redaction = classOf.get(selector);
      const value = valueOf.get(selector);
      const box = node.evidence.kind === "OBSERVED" || node.evidence.kind === "CLIPPED" ? node.evidence.viewportBox : null;
      const sensitivity = redaction
        ? `<span class="tag t-${redaction.tier.toLowerCase()}">${esc(redaction.class)} · ${esc(redaction.tier)}</span>`
        : `<span class="tag t-public">not sensitive</span>`;
      return `<tr>
        <td><code>${esc(selector)}</code></td>
        <td>${esc(node.role)}</td>
        <td>${esc(node.name || "—")}</td>
        <td class="local">${value === undefined || value === "" ? '<span class="muted">—</span>' : esc(value)}</td>
        <td>${sensitivity}</td>
        <td class="geo">${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}×${Math.round(box.h)}` : "—"}</td>
      </tr>`;
    })
    .join("");

  return `<p class="note local-note">These values never leave this machine. They are held in the memory-only vault
      and replaced by references before anything is sent.</p>
    <div class="scroll"><table>
      <thead><tr><th>element</th><th>role</th><th>accessible name</th><th>local value</th><th>sensitivity</th><th>geometry</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

/** The sanitized representation — the string itself, never re-serialized for display. */
function serverPane(record: RunRecord | null): string {
  if (!record?.handoff || !record.handoffSerialized) return `<p class="muted">Nothing has been sent.</p>`;
  const handoff = record.handoff;
  const secrets = (record.initialObservation?.fields ?? []).map((f) => f.value).filter((v) => v.trim() !== "");
  const leaked = secrets.filter((secret) => record.handoffSerialized!.includes(secret));

  const spans = handoff.redactions
    .map(
      (r) => `<tr>
        <td><code>${esc(r.targetId)}</code></td>
        <td>${r.token === "" ? '<span class="muted">no reference</span>' : `<code class="token sm">${esc(r.token)}</code>`}</td>
        <td><span class="tag t-${r.tier.toLowerCase()}">${esc(r.class)}</span></td>
        <td>${esc(r.method)}</td>
        <td class="geo">len ${r.hint.len} · ${esc(r.hint.kind)}${r.hint.field_role ? ` · ${esc(r.hint.field_role)}` : ""}</td>
      </tr>`
    )
    .join("");

  return `<p class="note ${leaked.length === 0 ? "clean" : "dirty"}">${
    leaked.length === 0
      ? `Checked: none of the ${secrets.length} local values appears in these ${record.handoffSerialized.length} bytes.`
      : `LEAK: a local value survived into the payload.`
  }</p>
    <div class="scroll"><table>
      <thead><tr><th>element</th><th>reference</th><th>class</th><th>method</th><th>safe hint</th></tr></thead>
      <tbody>${spans}</tbody>
    </table></div>
    <p class="sub">Goal sent: <em>${esc(handoff.goal)}</em>. The request on the wire is built from this and prompt
      scaffolding — its bytes and digest are in the ledger.</p>
    <details><summary>the sanitized representation (${record.handoffSerialized.length} bytes)</summary>
      <pre>${esc(JSON.stringify(JSON.parse(record.handoffSerialized), null, 1))}</pre>
    </details>`;
}

const stepText = (step: SafeStep): string =>
  step.op === "click"
    ? `<code>click</code> ${esc(step.target)}`
    : `<code>insert</code> ${
        step.ref ? `<code class="token sm">${esc(step.ref)}</code>` : `<span class="marker">${esc(step.literalMarker ?? "")}</span>`
      } → ${esc(step.target)}`;

/** The received plan, the validator's own verdict, the freshness gate, the grant and the restoration. */
function planPane(record: RunRecord | null): string {
  if (!record?.plan) return `<p class="muted">No plan received.</p>`;
  const validation = record.validation;
  const refusal = record.refusal?.planRefusal;
  const steps = record.plan.steps.map((s) => `<li>${stepText(s)}</li>`).join("");

  const verdict = !validation
    ? `<span class="tag t-public">not validated</span>`
    : validation.ok
      ? `<span class="tag t-ok">VALID</span>`
      : `<span class="tag t-bad">REFUSED · ${esc(refusal?.literalCause ?? refusal?.bindCause ?? refusal?.cause ?? "")}</span>`;

  const leak =
    refusal?.literalSeverity === "LEAKAGE_EVENT"
      ? `<p class="note dirty">LITERAL ECHO — the reasoner returned a ${esc(refusal.piiClass ?? "value")} this client
           holds locally and never sent. Refused before rehydration and before any action. The value is not quoted here,
           and it was not kept.</p>`
      : "";

  const grant = record.grant.requested
    ? record.grant.decision?.granted
      ? `<span class="tag t-ok">GRANTED</span> <span class="sub">one-shot · bound to reference, field, origin and session · used: ${record.grant.useGrant?.used ? "yes" : "no"}</span>`
      : `<span class="tag t-bad">${esc(record.grant.decision?.granted === false ? record.grant.decision.reason : "—")}</span>`
    : `<span class="muted">not reached</span>`;

  const rehydration = record.rehydrated.length
    ? record.rehydrated
        .map((r) => `<span class="tag t-ok">REHYDRATED LOCALLY</span> <code class="token sm">${esc(r.ref)}</code> → ${esc(r.target)} (${esc(r.piiClass)})`)
        .join("<br>")
    : `<span class="muted">nothing was rehydrated</span>`;

  const freshness = record.act
    ? `${esc(record.act.decision.decision)} · hit-test ${esc(record.act.hit?.agreement ?? "not run")} · reached ${esc(record.act.reached)}`
    : `<span class="muted">not reached</span>`;

  return `<p class="sub">from <code>${esc(record.response && record.response.received ? record.response.reasoner : "—")}</code>
      via <code>${esc(record.response && record.response.received ? record.response.transport : "—")}</code></p>
    <ol class="plan">${steps}</ol>
    ${leak}
    <dl class="kv">
      <dt>validation</dt><dd>${verdict}</dd>
      <dt>target</dt><dd>${esc(refusal?.target ?? record.plan.steps.map((s) => s.target).join(", "))}</dd>
      <dt>freshness</dt><dd>${freshness}</dd>
      <dt>human grant</dt><dd>${grant}</dd>
      <dt>rehydration</dt><dd>${rehydration}</dd>
    </dl>`;
}

/**
 * The ledger entry and the egress record, in full.
 *
 * The client's digest is of the exact bytes it serialized, scanned and sent. The peer's digest is what
 * the receiving service reported, labelled as a claim because a hostile service could report anything;
 * `null` means it claimed nothing and is shown as such, never as a mismatch.
 */
function egressPane(record: RunRecord | null, attempts: readonly EgressAttempt[]): string {
  if (!record) return `<p class="muted">Nothing recorded.</p>`;
  const entry = record.ledgerEntry;
  const evidence = egressEvidenceOf(record, attempts);
  const sent = evidence?.sent ?? null;
  const transport = record.response && record.response.received ? record.response.transport : (sent?.transport ?? "—");
  const destination = sent?.destination ?? evidence?.blocked[0]?.destination ?? "—";

  const digestRow =
    sent === null
      ? `<span class="muted">nothing was sent over the network</span>`
      : sent.digestsAgree === null
        ? `<code class="hash">${esc(sent.clientSha256)}</code> <span class="sub">the receiving service claimed no digest</span>`
        : `<code class="hash">${esc(sent.clientSha256)}</code>
           <span class="eq ${sent.digestsAgree ? "ok" : "bad"}">${sent.digestsAgree ? "==" : "≠"}</span>
           <code class="hash">${esc(sent.peerSha256 ?? "")}</code>
           <span class="sub">client digest ${sent.digestsAgree ? "matches" : "DIFFERS FROM"} the digest the receiving service reported (its claim, not a guarantee)</span>`;

  const blocked = (evidence?.blocked ?? [])
    .map((b) => `<div class="blocked"><span class="tag t-bad">NOT SENT</span> ${esc(b.cause)} at ${esc(b.stage)}${b.leakedClass ? ` · ${esc(b.leakedClass)}` : ""}</div>`)
    .join("");

  const verification = record.act?.verification;
  const result = !verification
    ? `<span class="muted">no action was dispatched</span>`
    : verification.verification === "CONFIRMED"
      ? `<span class="tag t-ok">CONFIRMED</span> <span class="sub">${esc(verification.evidence)}</span>`
      : `<span class="tag t-bad">${esc(verification.verification)} · ${esc(verification.cause)}</span>`;

  const timings = Object.entries(record.timings)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `<span class="chip">${esc(k.replace(/Ms$/, ""))} ${String(v)}ms</span>`)
    .join("");

  return `<dl class="kv">
      <dt>request</dt><dd>${esc(record.requestId)}</dd>
      <dt>reasoner</dt><dd>${esc(record.reasonerKind ?? "—")}${
        record.fallback?.fellBack === true ? ` <span class="sub">model outcome ${esc(record.fallback.outcome ?? "")}</span>` : ""
      }</dd>
      <dt>transport</dt><dd><code>${esc(transport)}</code></dd>
      <dt>destination</dt><dd><code>${esc(destination)}</code></dd>
      <dt>verified handoff</dt><dd>${entry?.verified ? `<span class="tag t-ok">verified</span>` : `<span class="muted">—</span>`}</dd>
      <dt>ledger sha-256</dt><dd><code class="hash">${esc(entry?.payloadSha256 ?? "—")}</code></dd>
      <dt>wire bytes</dt><dd>${sent ? count(sent.payloadBytes) : "—"}</dd>
      <dt>client == server</dt><dd class="digests">${digestRow}</dd>
      <dt>references sent</dt><dd>${
        (sent?.references ?? (entry?.references ?? []).map((r) => r.token)).map((t) => `<code class="token sm">${esc(t)}</code>`).join(" ") || "—"
      }</dd>
      <dt>leak scan</dt><dd>${sent ? `<span class="tag t-ok">${esc(sent.leakCheck)}</span>` : esc(entry?.leakCheck ?? "—")}</dd>
      <dt>VERIFY RESULT</dt><dd>${result}</dd>
    </dl>
    ${blocked}
    <p class="timings">${timings}</p>
    <p class="note">Synthetic data, one loopback destination, no TLS and no authentication: this is not production egress security.</p>`;
}

function renderEvidence(goal: string, record: RunRecord | null, attempts: readonly EgressAttempt[]): void {
  paintInto("pane-goal", goalPane(goal, record));
  paintInto("pane-page", pagePane(record));
  paintInto("pane-server", serverPane(record));
  paintInto("pane-plan", planPane(record));
  paintInto("pane-egress", egressPane(record, attempts));
}

/** Paint everything. Cheap to call often: unchanged regions are left alone. */
export function render(goal: string, input: StoryInput, act: ActId | null): void {
  document.body.dataset["phase"] = input.phase;
  renderTask(goal, input, act);
  renderPipeline(input);
  renderBoundary(input);
  renderModel(input);
  renderClient(input);
  renderHuman(input);
  renderAct(input);
  renderOutcome(input);
  renderLeaving(input);
  renderTrust();
  renderEvidence(goal, input.record, input.attempts);
}
