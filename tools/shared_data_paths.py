"""Read-only resolver for shared local datasets excluded from Git (.gitignore).

When running inside a clean Git worktree (for example `../repo-gemini-a`), raw caches
(`data/raw/`), intermediate staging outputs (`data/staging/`) and rebuilt 900-chunk
staging regions (`public/world/cc-blender-staging/`) are not tracked by Git.
This helper locates the shared read-only copies without ever mutating sibling
worktrees or touching production (`public/world/cc-monumental/`).
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

WORKTREE_ROOT = Path(__file__).resolve().parent.parent


def _candidate_roots() -> list[Path]:
    candidates: list[Path] = [WORKTREE_ROOT]
    env_root = os.environ.get("CTA_SHARED_DATA_ROOT")
    if env_root:
        candidates.append(Path(env_root).expanduser().resolve())

    try:
        proc = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=str(WORKTREE_ROOT),
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        if proc.returncode == 0:
            for line in proc.stdout.splitlines():
                if line.startswith("worktree "):
                    wt = Path(line[9:].strip()).resolve()
                    if wt not in candidates:
                        candidates.append(wt)
    except OSError:
        pass

    sibling_repo = (WORKTREE_ROOT.parent / "repo").resolve()
    if sibling_repo not in candidates:
        candidates.append(sibling_repo)
    return candidates


def resolve_shared_readonly_path(relative_path: str | Path) -> Path:
    """Resolve an existing file or directory across local worktree or shared read-only repo."""
    rel = Path(relative_path)
    checked: list[str] = []
    for root in _candidate_roots():
        candidate = root / rel
        checked.append(str(candidate))
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"Cannot locate shared read-only dataset '{rel}'. "
        f"Set CTA_SHARED_DATA_ROOT to the primary repository holding raw/staging caches. "
        f"Checked: {', '.join(checked)}"
    )
