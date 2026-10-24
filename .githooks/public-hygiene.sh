#!/bin/sh
# Runs the maintainer's public-hygiene check (pre-commit, commit-msg). The
# check lives in the gitignored maintainer/ folder of the main checkout, so
# linked worktrees share it; where that folder lacks it, this does nothing.
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
check="${common%/.git}/maintainer/hooks/check.sh"
[ -f "$check" ] || exit 0
exec bash "$check" "$@"
