/**
 * M8.2a — THE HARNESS AMENDMENT, as data, so it is exact, recorded and testable.
 *
 * M8.2 found that Firefox 155.0.1 does not let a probe running past the MV3 background idle timeout
 * report from an event page (logs/diagnostic-firefox-event-page-lifetime.json in M8.2: default 0/4,
 * raised 4/4). The amendment removes that liveness confound and nothing else: ONE pref, passed per
 * launch to web-ext's TEMPORARY profile, with the value M8.2's diagnostic already established.
 * The user's Firefox installation and every other pref are untouched.
 *
 * `prefDiff` is how a validation launch proves that the amended profile differs from the default
 * one by exactly this pref.
 */

export const AMENDMENT = Object.freeze({
  pref: "extensions.background.idle.timeout",
  valueMs: 900000,
  /** The exact argument handed to run-firefox.mjs as `--pref <arg>`, and by it to web-ext. */
  arg: "extensions.background.idle.timeout=900000",
  /** The user.js line web-ext writes for it. */
  userJsLine: 'user_pref("extensions.background.idle.timeout", 900000);',
  established: "M8.2 diagnostic: the same value made 4/4 over-30 s probes report, for both candidates",
  readBy: "Firefox background-page idle manager (ExtensionCommon.sys.mjs / ext-backgroundPage.js)",
});

/** The runner's per-launch deadline (run-firefox.mjs default, unchanged by the amendment). */
export const RUNNER_DEADLINE_MS = 900000;

/** Lines present in `amended` but not `base`, and vice versa. Order-insensitive. */
export function prefDiff(baseLines, amendedLines) {
  const a = new Set(baseLines);
  const b = new Set(amendedLines);
  return { added: [...b].filter((l) => !a.has(l)).sort(), removed: [...a].filter((l) => !b.has(l)).sort() };
}

/** Validation criterion 3: the amended profile differs from the default one by exactly the amendment. */
export function onlyTheAmendmentDiffers(baseLines, amendedLines) {
  const d = prefDiff(baseLines, amendedLines);
  return d.removed.length === 0 && d.added.length === 1 && d.added[0] === AMENDMENT.userJsLine;
}
