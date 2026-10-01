/**
 * M8.2a — the Firefox liveness amendment is exactly one pref, and M8.2's recorded cells used none.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AMENDMENT, RUNNER_DEADLINE_MS, onlyTheAmendmentDiffers, prefDiff } from "../../../artifacts/experiments/M8.2a-firefox-wasm-rerun/harness/amendment.mjs";

const M82 = new URL("../../../artifacts/experiments/M8.2-qg03-visual-text-feasibility/", import.meta.url);

describe("the amendment", () => {
  it("is one pref, the one M8.2's diagnostic established, at the value it used", () => {
    expect(AMENDMENT.pref).toBe("extensions.background.idle.timeout");
    expect(AMENDMENT.arg).toBe(`${AMENDMENT.pref}=${AMENDMENT.valueMs}`);
    expect(AMENDMENT.userJsLine).toBe(`user_pref("${AMENDMENT.pref}", ${AMENDMENT.valueMs});`);
    const diag = JSON.parse(readFileSync(new URL("logs/diagnostic-firefox-event-page-lifetime.json", M82), "utf8"));
    expect(diag.arms.idle900k).toBe(AMENDMENT.arg);
    expect(Object.isFrozen(AMENDMENT)).toBe(true);
  });

  it("keeps the probe alive at least as long as the runner waits for it", () => {
    expect(AMENDMENT.valueMs).toBeGreaterThanOrEqual(RUNNER_DEADLINE_MS);
  });
});

describe("prefDiff", () => {
  const base = ['user_pref("a", 1);', 'user_pref("b", true);'];

  it("accepts exactly the amendment, in any order", () => {
    expect(onlyTheAmendmentDiffers(base, [AMENDMENT.userJsLine, ...base].reverse())).toBe(true);
  });

  it("rejects any other difference", () => {
    expect(onlyTheAmendmentDiffers(base, base)).toBe(false);
    expect(onlyTheAmendmentDiffers(base, [...base, AMENDMENT.userJsLine, 'user_pref("c", 0);'])).toBe(false);
    expect(onlyTheAmendmentDiffers(base, [base[0], AMENDMENT.userJsLine])).toBe(false);
    expect(onlyTheAmendmentDiffers(base, [...base, 'user_pref("extensions.background.idle.timeout", 60000);'])).toBe(false);
  });

  it("reports additions and removals", () => {
    expect(prefDiff(base, [base[0], "x"])).toEqual({ added: ["x"], removed: [base[1]] });
  });
});

describe("M8.2 history is not rewritten", () => {
  it("no recorded M8.2 Firefox launch used an extra pref — only its diag-* files did", () => {
    const dir = new URL("results/", M82);
    for (const f of readdirSync(dir).filter((n) => n.includes("firefox") && !n.startsWith("diag-"))) {
      const j = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
      for (const l of j.launches) expect(l.extraPrefs ?? []).toEqual([]);
    }
  });

  it("M8.2's recorded verdicts are still TR-01 PASS and TR-02 FAIL", () => {
    const v = JSON.parse(readFileSync(new URL("results/qg03-verdict.json", M82), "utf8"));
    expect(v["TR-01"].verdict).toBe("PASS");
    expect(v["TR-02"].verdict).toBe("FAIL");
    expect(v["TR-02"].cells["Firefox WASM (Linux)"]).toBe("CONDITIONAL");
  });
});
