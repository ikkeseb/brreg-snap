#!/bin/sh
# The main checkout owns the optional maintainer check; linked worktrees
# share it. Missing setup is allowed, but failed discovery must be visible.
warn() { echo "public-hygiene: warning: $*; check skipped" >&2; }
absolute_dir() { (unset CDPATH; cd "$1" 2>/dev/null && pwd -P); }
if ! common=$(git rev-parse --git-common-dir 2>/dev/null) ||
   ! common=$(absolute_dir "$common") ||
   ! current=$(git rev-parse --git-dir 2>/dev/null) ||
   ! current=$(absolute_dir "$current"); then
  warn "cannot locate the repository metadata"
  exit 0
fi
if [ "$common" = "$current" ]; then
  # Also works for separate git directories and submodule checkouts.
  top=$(git rev-parse --show-toplevel 2>/dev/null) || {
    warn "cannot locate the main checkout"; exit 0;
  }
else
  worktrees=$(git -c core.quotePath=false worktree list --porcelain 2>/dev/null) || {
    warn "cannot list worktrees"; exit 0;
  }
  first=${worktrees%%'
'*}
  case $first in
    'worktree '*) top=${first#worktree } ;;
    *) warn "cannot locate the main checkout"; exit 0 ;;
  esac
  # Git can report only the metadata directory for a separate main gitdir.
  # Reject that result (and quoted paths) instead of silently skipping setup.
  main_dir=$(
    unset GIT_DIR GIT_WORK_TREE
    cd "$top" 2>/dev/null &&
      dir=$(git rev-parse --git-dir 2>/dev/null) && absolute_dir "$dir"
  ) || { warn "cannot resolve the main checkout"; exit 0; }
  if [ "$main_dir" != "$common" ]; then
    warn "cannot validate the main checkout"; exit 0
  fi
  main_top=$(
    unset GIT_DIR GIT_WORK_TREE
    git -C "$top" rev-parse --show-toplevel 2>/dev/null
  ) || { warn "main checkout is unavailable"; exit 0; }
  top=$main_top
fi
[ -d "$top/maintainer" ] || exit 0
check="$top/maintainer/hooks/check.sh"
if [ ! -f "$check" ]; then
  warn "maintainer check is missing (pull the maintainer folder)"
  exit 0
fi
exec bash "$check" "$@"
