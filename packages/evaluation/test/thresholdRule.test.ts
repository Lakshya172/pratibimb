/**
 * The frozen operating-point rule, and the discipline around it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY A TEST AND NOT JUST A DOCUMENT
 *
 * The rule's only value is that it was fixed BEFORE the next held-out figure exists. That
 * property is invisible in the rule itself — "max F1 on dev" looks identical whether it was
 * chosen in advance or chosen because it produced a pleasing number. What makes it
 * defensible is a chain of facts:
 *
 *   * the analysis that produced it never opened the test split
 *   * the rule has not been applied to a held-out split yet
 *   * the OLD rule and the figures it produced are still on record, unedited
 *   * the selected threshold is interior to the sweep grid
 *
 * Each is checkable, so each is checked. A document alone can be quietly amended; a
 * document plus a failing test cannot be quietly amended.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const GATE = join(REPO, "artifacts/gates/T1-detector-training");
const ANALYSIS = join(GATE, "qg03-dev-threshold-analysis.json");
const OLD_RESULT = join(GATE, "qg05-detector-evaluation.json");
const DOC = join(REPO, "docs/testing/threshold-selection.md");

const analysis = existsSync(ANALYSIS) ? JSON.parse(readFileSync(ANALYSIS, "utf8")) : null;
const oldResult = existsSync(OLD_RESULT) ? JSON.parse(readFileSync(OLD_RESULT, "utf8")) : null;

describe("the DEV-only analysis stayed DEV-only", () => {
  it("the analysis exists and declares its split", () => {
    expect(analysis, `${ANALYSIS} missing — run: node tools/detector/qg03-dev-analysis.mjs`).toBeTruthy();
    expect(analysis.split).toBe("dev");
  });

  it("it records that the test split was never opened", () => {
    expect(analysis.testSplitOpened).toBe(false);
  });

  it("the analysis script does not read the test split", () => {
    // Asserting on the SOURCE, because the JSON flag is a self-report and a self-report is
    // exactly what this project has repeatedly refused to treat as evidence.
    const src = readFileSync(join(REPO, "tools/detector/qg03-dev-analysis.mjs"), "utf8");
    expect(src, "the analysis must never index allPreds.test").not.toMatch(/allPreds\s*\.\s*test/);
    expect(src, 'the analysis must never select split === "test"').not.toMatch(/split\s*===\s*["']test["']/);
    expect(src).toMatch(/split\s*===\s*["']dev["']/);
  });
});

describe("the old rule is recorded as a defect and NOT erased", () => {
  it("the original held-out evidence still exists, unchanged", () => {
    expect(oldResult, "the superseded result must remain published").toBeTruthy();
    expect(oldResult.thresholdSelection.rule).toBe("max mAP@0.5 on DEV");
    expect(oldResult.thresholdSelection.chosen).toBe(0.05);
    // The figures it produced stay on record too. Removing them would remove the evidence
    // that the defect happened, which is the more useful half of the finding.
    expect(typeof oldResult.heldOutTest.groundingAccuracy.value).toBe("number");
  });

  it("the analysis names the defect in measurable terms, not as an opinion", () => {
    expect(analysis.oldRule.status).toMatch(/METHODOLOGICAL DEFECT/);
    const ev = analysis.oldRule.evidence;
    // The point is not "the rule was too lax". It is that mAP barely moved while the thing
    // that mattered moved a lot — so the rule could not express a preference at all.
    expect(ev.mAPRangeWithinPlateau).toBeLessThan(0.01);
    expect(ev.groundingRangeWithinPlateau).toBeGreaterThan(ev.mAPRangeWithinPlateau * 10);
  });
});

describe("the replacement rule is frozen, and frozen means unused", () => {
  it("it has NOT been applied to a held-out split", () => {
    expect(
      analysis.candidateRule.appliedToTest,
      "applying the rule to an already-observed split would produce a second look wearing a first look's clothes"
    ).toBe(false);
    expect(analysis.candidateRule.appliedToTestNote).toMatch(/has not been read|second look|no longer fully held out/i);
  });

  it("the selected threshold is INTERIOR to the sweep grid", () => {
    // A maximum on a grid boundary means the grid chose, not the rule.
    expect(analysis.candidateRule.interiorMaximum).toBe(true);
    const grid: number[] = analysis.candidateRule.grid;
    expect(analysis.candidateRule.selects).not.toBe(grid[0]);
    expect(analysis.candidateRule.selects).not.toBe(grid[grid.length - 1]);
  });

  it("both terms of the rule are figures the dossier already requires", () => {
    expect(analysis.candidateRule.rule).toMatch(/element recall/);
    expect(analysis.candidateRule.rule).toMatch(/grounding accuracy/);
  });

  it("the flatness of the optimum is disclosed rather than hidden behind two decimals", () => {
    const s = analysis.candidateRule.selectionIsNotSharp;
    expect(Array.isArray(s.withinOnePercentOfBest)).toBe(true);
    expect(s.withinOnePercentOfBest.length).toBeGreaterThan(1);
    expect(s.devScreens).toBeGreaterThan(0);
  });

  it("the frozen rule is documented where a reviewer will find it", () => {
    expect(existsSync(DOC)).toBe(true);
    const doc = readFileSync(DOC, "utf8");
    expect(doc).toMatch(/FROZEN/);
    expect(doc).toMatch(/F1\(element recall, grounding accuracy\)/);
    expect(doc, "the document must state that the rule is not yet applied to a held-out split").toMatch(
      /has NOT been applied to the test split/
    );
  });
});

describe("the evaluation defects the analysis surfaced are recorded", () => {
  it("the recall ceiling imposed by CLIPPED elements is quantified", () => {
    const r = analysis.recallCeiling;
    expect(r.clippedAnnotations).toBeGreaterThan(0);
    expect(r.unreachableAtIou50).toBeGreaterThan(0);
    // If this ever reaches 1.0, either the dataset changed or the evaluator was fixed —
    // both are changes that must be made deliberately, not discovered later in a report.
    expect(r.recallCeiling).toBeLessThan(1);
    expect(r.consequence).toMatch(/cannot exceed/);
  });

  it("the failure taxonomy assigns every false positive to exactly one bucket", () => {
    for (const [name, a] of Object.entries<Record<string, unknown>>(analysis.failureAnalysis)) {
      const t = a.falsePositiveTaxonomy as Record<string, number>;
      const share = a.falsePositiveShare as Record<string, number>;
      const total = Object.values(t).reduce((x, y) => x + y, 0);
      expect(Object.keys(t).sort(), `${name}`).toEqual(["classConfusion", "duplicate", "localization", "spurious"]);
      const shareSum = Object.values(share).reduce((x, y) => x + y, 0);
      if (total > 0) expect(shareSum).toBeCloseTo(1, 6);
    }
  });

  it("the incumbent operating point is dominated by boxes that overlap nothing", () => {
    // The load-bearing conclusion of the whole analysis: at 0.05 the problem is threshold
    // policy, not capacity. If this ever stops being true the recommendation changes, and
    // it should stop being true loudly rather than silently.
    const inc = analysis.failureAnalysis.incumbent;
    expect(inc.threshold).toBe(0.05);
    expect(inc.falsePositiveShare.spurious).toBeGreaterThan(0.5);
  });
});
