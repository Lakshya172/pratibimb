#!/usr/bin/env python3
"""
PratiBimb repository verifier.

Checks the governance properties this repository actually claims, against what is
actually on disk. It resolves its own root from __file__ and therefore runs on any
machine -- unlike the framework validator audited in
artifacts/reviews/AUDIT-0001-agentos-framework.md, which is why that check exists here.

This validates GOVERNANCE, not code. Product build/lint/type/test jobs are added to CI
when product code exists. Run:  python scripts/verify-repo.py
"""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAIL: list[str] = []
WARN: list[str] = []


def fail(check: str, msg: str) -> None:
    FAIL.append(f"[{check}] {msg}")


def warn(check: str, msg: str) -> None:
    WARN.append(f"[{check}] {msg}")


def _git_list(*args: str) -> list[Path] | None:
    """Ask git for a file list. None if this is not a git checkout."""
    try:
        out = subprocess.run(
            ["git", "ls-files", *args],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout.splitlines()
    except (OSError, subprocess.CalledProcessError):
        return None
    skip = {".git", "node_modules", ".venv", "__pycache__", "dist", ".output", ".wxt"}
    return [
        ROOT / line for line in out
        if line.strip() and (ROOT / line).is_file()
        and not any(x in (ROOT / line).parts for x in skip)
    ]


def _walk() -> list[Path]:
    skip = {".git", "node_modules", ".venv", "__pycache__", "dist", ".output", ".wxt"}
    return [
        p for p in ROOT.rglob("*")
        if p.is_file() and not any(x in p.parts for x in skip)
    ]


def committed_files() -> list[Path]:
    """
    Files git is actually tracking.

    Used for the BANNED-SUFFIX check, and the distinction matters more than it looks.
    .gitignore already carries a global `*.onnx` rule, so a check that skipped ignored
    files would be permanently dead for exactly the file types it exists to catch - and
    would still pass if someone forced one in with `git add -f`. Asking what is TRACKED
    is the question that matches the failure message.
    """
    return _git_list("--cached") or _walk()


def committable_files() -> list[Path]:
    """
    Tracked files, plus untracked files that are not ignored.

    Used for the SECRET-PATTERN scan, where catching a token BEFORE it is committed is
    the entire value. Ignored files are excluded because they cannot reach a commit by
    accident, and flagging a locally-trained model in an ignored directory reported
    "committed" about a file that was not - a false positive that fails the build for
    anyone who trains locally, and the usual response to a guard that cries wolf is to
    stop believing it.
    """
    return _git_list("--cached", "--others", "--exclude-standard") or _walk()


# ── 1. Required governance files exist ──────────────────────────────────────
REQUIRED = [
    "README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE",
    "CHANGELOG.md", "ENGINEERING_PRINCIPLES.md", ".gitignore", ".env.example",
    "docs/dossier/README.md",
    "docs/architecture/constitution.md",
    "docs/security/security-invariants.md",
    "docs/security/threat-model.md",
    "docs/testing/benchmark-contract.md",
    "docs/operations/git-workflow.md",
    "docs/adr/README.md",
    "agentos/state.md",
    "agentos/registry/model-registry.md",
    "agentos/registry/feasibility-matrix.md",
    "agentos/gates/README.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/CODEOWNERS",
]


def check_required() -> None:
    for rel in REQUIRED:
        if not (ROOT / rel).is_file():
            fail("structure", f"missing required file: {rel}")


# ── 2. The governing dossier has not silently changed ───────────────────────
DOSSIER = {
    "docs/dossier/PratiBimb-Engineering-Dossier-v4.0.pdf":
        "ae8d99c72981a1cb543d189f9bac8eefa76fae4055bf67a86c363306af9b6bba",
    "docs/dossier/PratiBimb-Engineering-Dossier-v4.0.txt":
        "0328966b9cf43b0d54f9f4861f5dadfcf13ebbecdb2e6a5f61b04645c87ef348",
}


def check_dossier() -> None:
    for rel, expect in DOSSIER.items():
        p = ROOT / rel
        if not p.is_file():
            fail("dossier", f"governing artifact missing: {rel}")
            continue
        got = hashlib.sha256(p.read_bytes()).hexdigest()
        if got != expect:
            fail("dossier", f"{rel} hash changed.\n    expected {expect}\n    actual   {got}\n"
                            "    The dossier is the implementation baseline. Changing it "
                            "requires an approved ADR.")


# ── 3. No secret-shaped or banned file types are committed ──────────────────
BANNED_SUFFIX = {".pem", ".key", ".p12", ".pfx", ".crt", ".cer",
                 ".onnx", ".safetensors", ".gguf", ".pt", ".pth"}
SECRET_PATTERNS = [
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"), "GitHub token"),
    (re.compile(r"github_pat_[A-Za-z0-9_]{20,}"), "GitHub PAT"),
    (re.compile(r"hf_[A-Za-z0-9]{30,}"), "HuggingFace token"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "AWS access key"),
    (re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"), "private key"),
]
TEXT_SUFFIX = {".md", ".py", ".js", ".ts", ".tsx", ".json", ".yml", ".yaml",
               ".html", ".css", ".sh", ".txt", ".toml", ".cfg"}


def check_secrets() -> None:
    # Banned artefacts are only a problem once git is tracking them.
    for p in committed_files():
        rel = p.relative_to(ROOT).as_posix()
        if p.suffix.lower() in BANNED_SUFFIX:
            fail("secrets", f"banned file type committed: {rel}")
        if p.name == ".env":
            fail("secrets", ".env must never be committed")

    # Secret-shaped text is worth catching before it is ever committed.
    for p in committable_files():
        rel = p.relative_to(ROOT).as_posix()
        if p.suffix.lower() not in TEXT_SUFFIX:
            continue
        try:
            body = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pat, label in SECRET_PATTERNS:
            if pat.search(body):
                # The scanner's own pattern definitions are not findings.
                if rel in ("scripts/verify-repo.py", "scripts/check-secrets.sh"):
                    continue
                fail("secrets", f"{label} shape found in {rel}")


# ── 4. Relative Markdown links resolve ──────────────────────────────────────
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")


def check_links() -> None:
    for p in committable_files():
        if p.suffix != ".md":
            continue
        for target in LINK.findall(p.read_text(encoding="utf-8", errors="ignore")):
            if target.startswith(("http://", "https://", "#", "mailto:")):
                continue
            dest = (p.parent / target.split("#")[0]).resolve()
            if not dest.exists():
                fail("links", f"{p.relative_to(ROOT).as_posix()} -> broken link '{target}'")


# ── 5. YAML parses ──────────────────────────────────────────────────────────
def check_yaml() -> None:
    try:
        import yaml
    except ImportError:
        warn("yaml", "PyYAML not installed; skipping YAML validation")
        return
    for p in committable_files():
        if p.suffix not in (".yml", ".yaml"):
            continue
        try:
            yaml.safe_load(p.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            fail("yaml", f"{p.relative_to(ROOT).as_posix()} does not parse: {exc}")


# ── 6. Evidence discipline: no ADOPTED model without an artifact ────────────
def check_evidence() -> None:
    reg = ROOT / "agentos/registry/model-registry.md"
    if not reg.is_file():
        return
    body = reg.read_text(encoding="utf-8")
    # A model may only be ADOPTED if a benchmark artifact exists.
    # Only rows of the wide Registry table count as an adoption claim. The status
    # legend near the top of the file is a 3-column table that merely explains what
    # "ADOPTED" means -- matching it would be a false positive.
    adopted = any(
        "`ADOPTED`" in line and len(line.split("|")) >= 9
        for line in body.splitlines()
    )
    if adopted:
        bench = ROOT / "artifacts/benchmarks"
        if not bench.is_dir() or not any(bench.iterdir()):
            fail("evidence",
                 "model-registry.md marks a model ADOPTED but artifacts/benchmarks/ is "
                 "empty. A model is adopted on evidence, never on documentation "
                 "(agentos/workflows/model-adoption.md).")

    fm = ROOT / "agentos/registry/feasibility-matrix.md"
    if fm.is_file():
        fbody = fm.read_text(encoding="utf-8")
        # Any cell claiming a result must be backed by an experiment artifact.
        if re.search(r"\bLOAD:\s*yes\b", fbody):
            exp = ROOT / "artifacts/experiments"
            if not exp.is_dir() or not any(exp.iterdir()):
                fail("evidence",
                     "feasibility-matrix.md records a filled cell but "
                     "artifacts/experiments/ is empty.")


# ── 7. Experiment artifacts are well-formed ─────────────────────────────────
def check_experiments() -> None:
    exp = ROOT / "artifacts/experiments"
    if not exp.is_dir():
        return
    for d in sorted(exp.iterdir()):
        if not d.is_dir():
            continue
        readme = d / "README.md"
        if not readme.is_file():
            fail("experiments", f"{d.name}/ has no README.md")
            continue
        body = readme.read_text(encoding="utf-8", errors="ignore").lower()
        # The sections an experiment log must state (per the spike workflow):
        for section in ("hypothesis", "environment", "expected result",
                        "actual result", "conclusion", "reproducib"):
            if section not in body:
                warn("experiments", f"{d.name}/README.md has no '{section}' section")
        if not (d / "decision.md").is_file():
            warn("experiments", f"{d.name}/ has no decision.md (verdict record)")


def main() -> int:
    for fn in (check_required, check_dossier, check_secrets,
               check_links, check_yaml, check_evidence, check_experiments):
        fn()

    print("=" * 66)
    print("PratiBimb repository verification")
    print(f"root: {ROOT}")
    print("=" * 66)
    for w in WARN:
        print(f"WARN  {w}")
    for f in FAIL:
        print(f"FAIL  {f}")
    print("-" * 66)
    print(f"{len(FAIL)} failure(s), {len(WARN)} warning(s)")
    if FAIL:
        print("RESULT: FAIL")
        return 1
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
