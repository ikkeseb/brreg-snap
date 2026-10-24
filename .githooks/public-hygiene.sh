#!/bin/sh
# Runs the maintainer's public-hygiene check (pre-commit, pre-merge-commit,
# commit-msg). The check lives in the gitignored maintainer/ folder of the
# main checkout, so linked worktrees share it. No maintainer/ folder: this
# does nothing. A folder without the check: a warning, and the commit goes on.
warn() { echo "public-hygiene: warning: $*; check skipped" >&2; }
if ! common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
  [ -d maintainer ] && warn "cannot locate the main checkout (git 2.31 or later needed)"
  exit 0
fi
top=${common%/.git}
[ -d "$top/maintainer" ] || exit 0
check="$top/maintainer/hooks/check.sh"
if [ ! -f "$check" ]; then
  warn "$check is missing (pull the maintainer folder)"
  exit 0
fi
exec bash "$check" "$@"
