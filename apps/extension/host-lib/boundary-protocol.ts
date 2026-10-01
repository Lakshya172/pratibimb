/**
 * THE MESSAGE SCHEMA FOR THE PRIVACY BOUNDARY — and what it is built to make impossible.
 *
 * The page's values are read, classified and held in the content script's isolated world. The
 * orchestrator, the reasoner and the egress guard are in the offscreen document. Everything the two
 * say to each other crosses the service worker, so this file is where "no raw value crosses" has to
 * be true, and it tries to be true **by construction** rather than by care:
 *
 * - **There is no `value` field anywhere in these types.** Not optional, not `unknown`, not a
 *   `Record<string, unknown>` something could be tucked into. Adding one would be an edit to this
 *   file, which is the point of keeping them here and nowhere else.
 * - **What goes down** is a value-free element graph, references, targets, identities and grants.
 * - **What comes up** is redaction spans, scrubbed element names, descriptors, a view of field
 *   classes, and counts — plus, for a question asked of the vault, a class and a boolean.
 * - **What is never in either direction** is a form value, a vault entry, or the text of anything
 *   the vault recognised.
 *
 * THE ONE THING THAT MUST NOT CROSS IN THE OPEN is a literal a reasoner returned, because in the
 * refusal case that literal *is* the page's value, arriving back from a hostile peer. So it does not
 * travel as a message: the core realm arms a capability, the worker carries a nonce, and the page
 * realm collects the text as a **reply** — the one direction MV3 offers that the worker cannot read.
 * See `value-release.ts`.
 *
 * A SCHEMA IS NOT AN ENFORCEMENT, so it is not the only one. `page-privacy-boundary.ts` runs every
 * outgoing message past its own vault before sending it, and refuses to send anything the vault
 * recognises. The types say what may cross; the scan proves what did.
 */
import { frameId, type ElementGraph, type ElementNode, type SanitizedElement } from "@pratibimb/perception";
import {
  type HeldLiteral,
  type PiiClass,
  type RefDescriptor,
  type Redaction,
  type SanitizeReport,
  type UseGrant,
  type ViewField,
} from "@pratibimb/privacy";

/** A graph, as JSON carries it. `byId` is rebuilt on arrival; it is derived, never sent. */
export interface WireGraph {
  readonly frameId: string;
  readonly nodes: readonly ElementNode[];
}

export const encodeGraph = (graph: ElementGraph): WireGraph => ({
  frameId: String(graph.frameId),
  nodes: graph.nodes,
});

export const decodeGraph = (wire: WireGraph): ElementGraph => ({
  frameId: frameId(wire.frameId),
  nodes: wire.nodes,
  byId: new Map(wire.nodes.map((node) => [node.id, node])),
});

/** A `BindView`, as JSON carries it: a Map does not survive extension messaging. */
export interface WireView {
  readonly viewId: string;
  readonly documentId: string;
  readonly fields: readonly (readonly [string, ViewField])[];
}

/** What the core realm asks the page realm to classify. A value-free graph and some identities. */
export interface WireClassifyAsk {
  readonly graph: WireGraph;
  readonly sessionId: string;
  readonly requestId: string;
  readonly viewId: string;
  readonly origin: string;
  readonly documentId: string;
  readonly viewport: {
    readonly w: number;
    readonly h: number;
    readonly dpr: number;
    readonly zoom: number;
    readonly scrollX: number;
    readonly scrollY: number;
  };
  readonly now: number;
}

/**
 * What classification produced.
 *
 * Read the members: spans that name a class and a token, element text the vault already scrubbed,
 * descriptors that say what each reference stands for, and a view of what each field accepts. There
 * is no member here that can hold a value, and `fieldsSeen` is a count because a count is all the
 * other realm needs.
 */
export interface WireClassified {
  readonly redactions: readonly Redaction[];
  readonly elements: readonly SanitizedElement[];
  readonly report: SanitizeReport;
  readonly descriptors: readonly RefDescriptor[];
  readonly view: WireView;
  readonly fieldsSeen: number;
}

/** One restoration, authorised. A reference and a target — the value is already where it is going. */
export interface WireReleaseAsk {
  readonly ref: string;
  readonly target: string;
  readonly viewId: string;
  readonly sessionId: string;
  readonly currentDocumentId: string;
  readonly classOriginGrants: readonly string[];
  readonly useGrants: readonly UseGrant[];
  readonly now: number;
}

/**
 * What a capability hands over when the page realm collects it.
 *
 * `QUESTION` is the only member that carries text, and it travels only as a reply. The text is a
 * reasoner's, not a page's — and asking whether it is a page's is the entire purpose.
 */
export type CapabilityPayload =
  | { readonly kind: "RELEASE"; readonly ask: WireReleaseAsk }
  | { readonly kind: "QUESTION"; readonly texts: readonly string[] };

/** Core realm → page realm, carried by the worker. */
export type BoundaryRequest =
  | { readonly kind: "CLASSIFY"; readonly ask: WireClassifyAsk }
  /** "A capability is waiting." A nonce and a field name; nothing else, and nothing secret. */
  | { readonly kind: "CAPABILITY"; readonly nonce: string; readonly target: string }
  | { readonly kind: "FORGET" };

/** Page realm → core realm, carried by the worker. Counts, classes, booleans and refusals. */
export type BoundaryReply =
  | { readonly ok: true; readonly kind: "CLASSIFIED"; readonly classified: WireClassified }
  | { readonly ok: true; readonly kind: "RELEASED"; readonly ref: string; readonly piiClass: PiiClass; readonly inserted: boolean }
  | { readonly ok: true; readonly kind: "ANSWERED"; readonly answers: readonly HeldLiteral[] }
  | { readonly ok: true; readonly kind: "FORGOTTEN"; readonly refs: number }
  | { readonly ok: false; readonly refused: string };

/** The capability the target field is named with when the payload is a question, not a field. */
export const QUESTION_TARGET = "::vault-question::";
