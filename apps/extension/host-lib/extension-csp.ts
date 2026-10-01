/**
 * ADR-0013 — WHICH `extension_pages` POLICY A BUILD SHIPS. A pure function, so the product/evidence
 * distinction is a value a test can read rather than a property of whichever build last ran.
 *
 *   product   connect-src 'self' <the reasoner endpoint, exactly>
 *   evidence  connect-src 'self' <the collector origin>    (the test frame sink and evidence POSTs)
 *
 * Every other directive is identical. No other input changes the policy.
 */
import { buildExtensionPagesCspV2 } from "../../../packages/security/src/csp";

export interface ExtensionCspInput {
  readonly build: "product" | "evidence";
  /** The loopback collector origin, e.g. `http://127.0.0.1:8995`. */
  readonly collectorOrigin: string;
  /** The reasoner endpoint's path on that origin, e.g. `/v1/chat/completions`. */
  readonly reasonerPath: string;
  readonly styleHashes: readonly string[];
}

export function extensionPagesCsp(input: ExtensionCspInput): string {
  const connect = input.build === "evidence" ? [input.collectorOrigin] : [`${input.collectorOrigin}${input.reasonerPath}`];
  return buildExtensionPagesCspV2({ connect, styleHashes: input.styleHashes });
}
