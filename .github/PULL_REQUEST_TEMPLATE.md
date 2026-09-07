<!--
PratiBimb pull request.
Every section is answered. "None — documentation only" is a valid answer.
An empty section is not. See CONTRIBUTING.md §4.
-->

## Summary

<!-- One paragraph. What does this PR do, and what state is the repository in after it? -->

## Motivation

<!-- Why now? Which UNKNOWN does it resolve, which gate does it unblock, which dossier
     requirement does it serve? Link the issue or ADR. -->

## Changes

<!-- Bullet list of the coherent change. If you cannot describe it without the word "also",
     it is probably two PRs. -->

## Architecture Impact

<!-- Does this touch a FROZEN decision in docs/architecture/constitution.md?
     If yes, name the ADR that authorises it. If no, say "None — no frozen contract touched." -->

- Frozen contract touched: **No / Yes → ADR-____**
- Interface changed: **No / Yes → which**
- New dependency: **No / Yes → name, version, licence**

## Security Impact

<!-- Which of INV-01..INV-25 does this code become responsible for, and which test
     exercises each? See docs/security/security-invariants.md -->

- Invariants affected:
- Tests exercising them:
- Egress path changed: **No / Yes**
- New network call introduced: **No / Yes → through the egress module only?**

## Privacy Impact

- Touches the vault, verifier, manifest, redaction or logging: **No / Yes**
- Any new value that could cross the trust boundary: **No / Yes → how is it tokenised?**
- Any new log statement that could carry plaintext: **No / Yes**
- Requires `privacy-security-engineer` review: **No / Yes**

## Tests / Evidence

<!-- Paste the command and its real output, or link the artifact.
     Do not describe a test you did not run. -->

```
# command and output
```

- Artifact path (for spikes / benchmarks):

## Performance Impact

<!-- Only measured figures. A projected budget is labelled "projected".
     State backend and hardware. "Not measured — no runtime code" is valid. -->

## Risks

<!-- What could this break? What is the worst realistic failure? -->

## Rollback Plan

<!-- Exactly how to undo this. Normally: `git revert <sha>`.
     If revert is not clean, say what else is required. -->

```bash
git revert <sha>
```

## Dossier / ADR References

- Dossier section(s):
- ADR(s):
- Issue(s):

## Spike verdict — spike/ branches only

<!-- Delete this section on non-spike PRs. -->

- [ ] **ACCEPT** — works in the exact target context
- [ ] **REJECT** — does not work; evidence preserved and merged anyway
- [ ] **CONDITIONAL** — works only under stated constraints (list them)
- [ ] **INCONCLUSIVE** — did not answer the question (say what would)

---

## Checklist

- [ ] No unrelated changes in this PR
- [ ] Commits are atomic and conventionally formatted
- [ ] Tests added / updated, and actually run
- [ ] Security invariants preserved (`docs/security/security-invariants.md`)
- [ ] Privacy boundary preserved — nothing crosses that should not
- [ ] **No secret material committed** (`git diff --cached` reviewed; `scripts/check-secrets.sh` run)
- [ ] **No real PII in fixtures, screenshots or logs** — synthetic only
- [ ] No arbitrary network endpoint introduced
- [ ] No unsafe execution path introduced (`eval`, arbitrary JS, shell, download-and-run)
- [ ] No model weights or large binaries committed
- [ ] Documentation updated where necessary
- [ ] Relevant experiment artifacts included under `artifacts/experiments/`
- [ ] Every number labelled `measured` or `projected`
- [ ] Every capability claim labelled `FACT`, `INFERENCE` or `UNKNOWN`
- [ ] Applicable quality gate passed (`agentos/gates/README.md`)
- [ ] `agentos/state.md` updated if project state changed
