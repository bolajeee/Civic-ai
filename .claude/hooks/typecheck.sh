#!/usr/bin/env bash
# PostToolUse hook: after Claude edits a .ts/.tsx file in a TypeScript package,
# type-check that package and hand any errors straight back to Claude.
#
# Exit 2 is the hook protocol's "blocking" code: on PostToolUse the edit has
# already happened, so it doesn't undo anything — it feeds stderr to Claude as
# feedback so the error is fixed now instead of surfacing in CI.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[[ "$file" =~ \.tsx?$ ]] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
case "$file" in
  "$root"/services/api/*)     pkg="$root/services/api" ;;
  "$root"/apps/government/*)  pkg="$root/apps/government" ;;
  *) exit 0 ;;
esac

# Dependencies not installed yet (fresh clone): stay quiet rather than report
# hundreds of "cannot find module" errors that have nothing to do with the edit.
[ -x "$pkg/node_modules/.bin/tsc" ] || exit 0

if ! out=$(cd "$pkg" && ./node_modules/.bin/tsc --noEmit -p . 2>&1); then
  {
    echo "Type errors in ${pkg#"$root"/} after editing ${file#"$root"/}:"
    echo "$out" | head -40
  } >&2
  exit 2
fi
exit 0
